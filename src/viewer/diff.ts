import { TraceEvent } from "../types/index.js";

export interface ParsedDiff {
  filename: string;
  diffText: string;
  additions: number;
  deletions: number;
  isTruncated: boolean;
}

export interface SplitDiffRow {
  type: "change" | "context" | "hunk" | "truncated" | "header";
  left?: {
    lineNum?: number;
    content: string;
    type: "del" | "context" | "empty";
  };
  right?: {
    lineNum?: number;
    content: string;
    type: "add" | "context" | "empty";
  };
  hunkHeader?: string;
  truncatedText?: string;
}

/**
 * Computes a unified line-by-line diff between two strings in pure TypeScript.
 * Zero external dependencies.
 */
export function computeUnifiedDiff(
  oldContent: string,
  newContent: string,
  filepath = "file"
): string {
  if (oldContent === newContent) {
    return "";
  }

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Compute Longest Common Subsequence (LCS) matrix for clean diffing
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, avoid unbounded matrix memory by limiting LCS window
  if (m > 1000 || n > 1000) {
    return `--- a/${filepath}\n+++ b/${filepath}\n@@ -1,${m} +1,${n} @@\n... [Large file diff: ${m} lines before, ${n} lines after] ...`;
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to recover diff operations
  const diffLines: string[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffLines.unshift(` ${oldLines[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffLines.unshift(`+${newLines[j - 1]}`);
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffLines.unshift(`-${oldLines[i - 1]}`);
      i--;
    }
  }

  return [
    `--- a/${filepath}`,
    `+++ b/${filepath}`,
    `@@ -1,${m} +1,${n} @@`,
    ...diffLines,
  ].join("\n");
}

/**
 * Parses unified diff text into structured side-by-side split rows with accurate line numbers.
 */
export function parseUnifiedDiffToSplit(diffText: string): SplitDiffRow[] {
  const lines = diffText.split("\n");
  const rows: SplitDiffRow[] = [];

  let oldLineNum = 1;
  let newLineNum = 1;
  let deletedChunk: string[] = [];
  let addedChunk: string[] = [];

  const flushChunks = () => {
    if (deletedChunk.length === 0 && addedChunk.length === 0) return;
    const count = Math.max(deletedChunk.length, addedChunk.length);
    for (let k = 0; k < count; k++) {
      const leftPart =
        k < deletedChunk.length
          ? { lineNum: oldLineNum++, content: deletedChunk[k], type: "del" as const }
          : { content: "", type: "empty" as const };

      const rightPart =
        k < addedChunk.length
          ? { lineNum: newLineNum++, content: addedChunk[k], type: "add" as const }
          : { content: "", type: "empty" as const };

      rows.push({
        type: "change",
        left: leftPart,
        right: rightPart,
      });
    }
    deletedChunk = [];
    addedChunk = [];
  };

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      flushChunks();
      rows.push({ type: "header", hunkHeader: line });
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      flushChunks();
      oldLineNum = parseInt(hunkMatch[1], 10);
      newLineNum = parseInt(hunkMatch[2], 10);
      rows.push({ type: "hunk", hunkHeader: line });
      continue;
    }

    if (line.includes("[diff truncated:") || line.includes("Large file diff:")) {
      flushChunks();
      rows.push({ type: "truncated", truncatedText: line });
      continue;
    }

    if (line.startsWith("-")) {
      deletedChunk.push(line.slice(1));
    } else if (line.startsWith("+")) {
      addedChunk.push(line.slice(1));
    } else {
      flushChunks();
      const content = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({
        type: "context",
        left: { lineNum: oldLineNum++, content, type: "context" },
        right: { lineNum: newLineNum++, content, type: "context" },
      });
    }
  }

  flushChunks();
  return rows;
}

/**
 * Extracts or generates diff data from a TraceEvent (file_change or file editing tool calls).
 */
export function extractDiffFromEvent(
  event: TraceEvent,
  maxDiffLines = 300
): ParsedDiff | null {
  const data = event.data || {};
  let filename = (data.path || data.file || data.filePath || "file") as string;
  let diffRaw: string | undefined;

  // 1. Direct diff or patch fields
  if (typeof data.diff === "string" && data.diff.trim().length > 0) {
    diffRaw = data.diff;
  } else if (typeof data.patch === "string" && data.patch.trim().length > 0) {
    diffRaw = data.patch;
  }

  // 2. Before / After content fields
  if (!diffRaw && typeof data.before === "string" && typeof data.after === "string") {
    diffRaw = computeUnifiedDiff(data.before, data.after, filename);
  }

  // 3. Tool call inputs (e.g. str_replace_editor, Edit, edit_file)
  if (!diffRaw) {
    const input = (data.input || {}) as Record<string, unknown>;
    const targetFile = (input.path || input.file || input.filePath || filename) as string;
    if (targetFile) filename = targetFile;

    const oldStr = input.old_str ?? input.old_string ?? input.target ?? input.search;
    const newStr = input.new_str ?? input.new_string ?? input.replacement ?? input.replace;

    if (typeof oldStr === "string" && typeof newStr === "string") {
      diffRaw = computeUnifiedDiff(oldStr, newStr, filename);
    }
  }

  if (!diffRaw || !diffRaw.trim()) {
    return null;
  }

  const rawLines = diffRaw.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of rawLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  let isTruncated = false;
  let finalLines = rawLines;

  if (rawLines.length > maxDiffLines) {
    isTruncated = true;
    const keepHalf = Math.floor(maxDiffLines / 2);
    finalLines = [
      ...rawLines.slice(0, keepHalf),
      `... [diff truncated: ${rawLines.length - maxDiffLines} lines omitted for readability] ...`,
      ...rawLines.slice(-keepHalf),
    ];
  }

  return {
    filename,
    diffText: finalLines.join("\n"),
    additions,
    deletions,
    isTruncated,
  };
}

/**
 * Escapes HTML characters safely.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Zero-dependency intra-line / token-level diff highlighter.
 * Identifies modified words/tokens within paired deletion and addition lines.
 */
export function computeIntraLineDiff(
  oldStr: string,
  newStr: string
): { leftHtml: string; rightHtml: string } {
  if (oldStr === newStr) {
    const escaped = escapeHtml(oldStr);
    return { leftHtml: escaped, rightHtml: escaped };
  }

  // Tokenize preserving whitespace and delimiters
  const tokenRegex = /(\s+|[a-zA-Z0-9_]+|[^\s\w])/g;
  const oldTokens = oldStr.match(tokenRegex) || (oldStr ? [oldStr] : []);
  const newTokens = newStr.match(tokenRegex) || (newStr ? [newStr] : []);

  if (oldTokens.length === 0 || newTokens.length === 0) {
    return { leftHtml: escapeHtml(oldStr), rightHtml: escapeHtml(newStr) };
  }

  // 1. Common prefix tokens
  let start = 0;
  while (
    start < oldTokens.length &&
    start < newTokens.length &&
    oldTokens[start] === newTokens[start]
  ) {
    start++;
  }

  // 2. Common suffix tokens
  let oldEnd = oldTokens.length - 1;
  let newEnd = newTokens.length - 1;
  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldTokens[oldEnd] === newTokens[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  const prefixTokens = oldTokens.slice(0, start);
  const suffixTokens = oldTokens.slice(oldEnd + 1);

  const midOld = oldTokens.slice(start, oldEnd + 1);
  const midNew = newTokens.slice(start, newEnd + 1);

  // If the lines are completely distinct with zero common tokens, avoid full-line word wrapping
  const commonCount = prefixTokens.length + suffixTokens.length;
  const maxTokens = Math.max(oldTokens.length, newTokens.length);
  if (commonCount === 0 && maxTokens > 3) {
    return { leftHtml: escapeHtml(oldStr), rightHtml: escapeHtml(newStr) };
  }

  let oldHighlightTokens: { text: string; isDel: boolean }[] = [];
  let newHighlightTokens: { text: string; isAdd: boolean }[] = [];

  // Compute LCS on middle tokens if both sides have content
  if (midOld.length > 0 && midNew.length > 0 && midOld.length <= 100 && midNew.length <= 100) {
    const m = midOld.length;
    const n = midNew.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (midOld[i] === midNew[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    let i = m;
    let j = n;
    const oldParts: { text: string; isDel: boolean }[] = [];
    const newParts: { text: string; isAdd: boolean }[] = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
        oldParts.unshift({ text: midOld[i - 1], isDel: false });
        newParts.unshift({ text: midNew[j - 1], isAdd: false });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        newParts.unshift({ text: midNew[j - 1], isAdd: true });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        oldParts.unshift({ text: midOld[i - 1], isDel: true });
        i--;
      }
    }
    oldHighlightTokens = oldParts;
    newHighlightTokens = newParts;
  } else {
    oldHighlightTokens = midOld.map((t) => ({ text: t, isDel: true }));
    newHighlightTokens = midNew.map((t) => ({ text: t, isAdd: true }));
  }

  // Format tokens into HTML, grouping consecutive highlight spans
  const formatTokens = (
    tokens: { text: string; isHighlighted: boolean }[],
    cssClass: string
  ): string => {
    let result = "";
    let buffer = "";

    for (const t of tokens) {
      if (t.isHighlighted) {
        buffer += t.text;
      } else {
        if (buffer) {
          result += `<span class="${cssClass}">${escapeHtml(buffer)}</span>`;
          buffer = "";
        }
        result += escapeHtml(t.text);
      }
    }
    if (buffer) {
      result += `<span class="${cssClass}">${escapeHtml(buffer)}</span>`;
    }
    return result;
  };

  const fullOld = [
    ...prefixTokens.map((t) => ({ text: t, isHighlighted: false })),
    ...oldHighlightTokens.map((t) => ({ text: t.text, isHighlighted: t.isDel })),
    ...suffixTokens.map((t) => ({ text: t, isHighlighted: false })),
  ];

  const fullNew = [
    ...prefixTokens.map((t) => ({ text: t, isHighlighted: false })),
    ...newHighlightTokens.map((t) => ({ text: t.text, isHighlighted: t.isAdd })),
    ...suffixTokens.map((t) => ({ text: t, isHighlighted: false })),
  ];

  return {
    leftHtml: formatTokens(fullOld, "diff-word-del"),
    rightHtml: formatTokens(fullNew, "diff-word-add"),
  };
}

/**
 * Renders an interactive, syntax-styled HTML diff view with toggleable side-by-side split and unified views,
 * including zero-dependency intra-line / token-level diff highlighting.
 */
export function renderDiffHtml(diff: ParsedDiff, defaultMode: "split" | "unified" = "split"): string {
  const lines = diff.diffText.split("\n");
  const renderedUnifiedLines: string[] = [];

  let lineIdx = 0;
  while (lineIdx < lines.length) {
    const line = lines[lineIdx];

    if (line.startsWith("-") && !line.startsWith("---")) {
      // Gather consecutive del lines
      const delLines: string[] = [];
      while (lineIdx < lines.length && lines[lineIdx].startsWith("-") && !lines[lineIdx].startsWith("---")) {
        delLines.push(lines[lineIdx].slice(1));
        lineIdx++;
      }

      // Gather consecutive add lines immediately following
      const addLines: string[] = [];
      while (lineIdx < lines.length && lines[lineIdx].startsWith("+") && !lines[lineIdx].startsWith("+++")) {
        addLines.push(lines[lineIdx].slice(1));
        lineIdx++;
      }

      const pairs = Math.min(delLines.length, addLines.length);

      // Render del lines with intra-line diff highlighting for paired rows
      for (let k = 0; k < delLines.length; k++) {
        let contentHtml: string;
        if (k < pairs) {
          const intra = computeIntraLineDiff(delLines[k], addLines[k]);
          contentHtml = intra.leftHtml;
        } else {
          contentHtml = escapeHtml(delLines[k]);
        }
        renderedUnifiedLines.push(
          `<div class="diff-line diff-del"><span class="diff-gutter">-</span><span class="diff-content">${contentHtml}</span></div>`
        );
      }

      // Render add lines with intra-line diff highlighting for paired rows
      for (let k = 0; k < addLines.length; k++) {
        let contentHtml: string;
        if (k < pairs) {
          const intra = computeIntraLineDiff(delLines[k], addLines[k]);
          contentHtml = intra.rightHtml;
        } else {
          contentHtml = escapeHtml(addLines[k]);
        }
        renderedUnifiedLines.push(
          `<div class="diff-line diff-add"><span class="diff-gutter">+</span><span class="diff-content">${contentHtml}</span></div>`
        );
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      renderedUnifiedLines.push(
        `<div class="diff-line diff-add"><span class="diff-gutter">+</span><span class="diff-content">${escapeHtml(line.slice(1))}</span></div>`
      );
      lineIdx++;
    } else if (line.startsWith("@@")) {
      renderedUnifiedLines.push(
        `<div class="diff-line diff-hunk"><span class="diff-gutter">@</span><span class="diff-content">${escapeHtml(line)}</span></div>`
      );
      lineIdx++;
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      renderedUnifiedLines.push(
        `<div class="diff-line diff-file-header"><span class="diff-gutter">#</span><span class="diff-content">${escapeHtml(line)}</span></div>`
      );
      lineIdx++;
    } else if (line.includes("[diff truncated:") || line.includes("Large file diff:")) {
      renderedUnifiedLines.push(
        `<div class="diff-line diff-truncated"><span class="diff-gutter">…</span><span class="diff-content">${escapeHtml(line)}</span></div>`
      );
      lineIdx++;
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      renderedUnifiedLines.push(
        `<div class="diff-line diff-context"><span class="diff-gutter">&nbsp;</span><span class="diff-content">${escapeHtml(content)}</span></div>`
      );
      lineIdx++;
    }
  }

  // Render Side-by-Side Split View Rows
  const splitRows = parseUnifiedDiffToSplit(diff.diffText);
  const renderedSplitRows: string[] = [];

  for (const row of splitRows) {
    if (row.type === "header") {
      continue;
    } else if (row.type === "hunk") {
      renderedSplitRows.push(
        `<div class="split-row split-hunk"><div class="split-cell-full"><span class="split-gutter-icon">@</span><span class="split-text">${escapeHtml(row.hunkHeader || "")}</span></div></div>`
      );
    } else if (row.type === "truncated") {
      renderedSplitRows.push(
        `<div class="split-row split-truncated"><div class="split-cell-full"><span class="split-gutter-icon">…</span><span class="split-text">${escapeHtml(row.truncatedText || "")}</span></div></div>`
      );
    } else {
      const leftClass = row.left?.type === "del" ? "split-del" : (row.left?.type === "empty" ? "split-empty" : "split-ctx");
      const rightClass = row.right?.type === "add" ? "split-add" : (row.right?.type === "empty" ? "split-empty" : "split-ctx");

      const leftNum = row.left?.lineNum !== undefined ? String(row.left.lineNum) : "&nbsp;";
      const rightNum = row.right?.lineNum !== undefined ? String(row.right.lineNum) : "&nbsp;";

      const leftSign = row.left?.type === "del" ? "-" : "&nbsp;";
      const rightSign = row.right?.type === "add" ? "+" : "&nbsp;";

      let leftCodeHtml = escapeHtml(row.left?.content || "");
      let rightCodeHtml = escapeHtml(row.right?.content || "");

      // Apply intra-line diff highlighting for paired modified rows
      if (row.left?.type === "del" && row.right?.type === "add") {
        const intra = computeIntraLineDiff(row.left.content, row.right.content);
        leftCodeHtml = intra.leftHtml;
        rightCodeHtml = intra.rightHtml;
      }

      renderedSplitRows.push(
        `<div class="split-row">` +
          `<div class="split-cell split-left ${leftClass}">` +
            `<span class="split-num">${leftNum}</span>` +
            `<span class="split-gutter-symbol">${leftSign}</span>` +
            `<span class="split-code">${leftCodeHtml}</span>` +
          `</div>` +
          `<div class="split-cell split-right ${rightClass}">` +
            `<span class="split-num">${rightNum}</span>` +
            `<span class="split-gutter-symbol">${rightSign}</span>` +
            `<span class="split-code">${rightCodeHtml}</span>` +
          `</div>` +
        `</div>`
      );
    }
  }

  return `
  <div class="file-diff-box view-${defaultMode}">
    <div class="diff-header">
      <span class="diff-filename">📄 ${escapeHtml(diff.filename)}</span>
      <div class="diff-header-right">
        <div class="diff-badges">
          <span class="diff-badge diff-badge-add">+${diff.additions}</span>
          <span class="diff-badge diff-badge-del">-${diff.deletions}</span>
          ${diff.isTruncated ? `<span class="diff-badge diff-badge-trunc">Truncated</span>` : ""}
        </div>
        <div class="diff-view-toggle">
          <button type="button" class="diff-toggle-btn ${defaultMode === "split" ? "active" : ""}" data-mode="split" onclick="toggleDiffView(this, 'split', event)">Split</button>
          <button type="button" class="diff-toggle-btn ${defaultMode === "unified" ? "active" : ""}" data-mode="unified" onclick="toggleDiffView(this, 'unified', event)">Unified</button>
        </div>
      </div>
    </div>
    <div class="diff-split-container">
      <div class="split-table">
        ${renderedSplitRows.join("\n")}
      </div>
    </div>
    <div class="diff-code-container diff-unified-container">
      ${renderedUnifiedLines.join("\n")}
    </div>
  </div>`;
}
