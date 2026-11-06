import { TraceEvent } from "../types/index.js";

export interface ParsedDiff {
  filename: string;
  diffText: string;
  additions: number;
  deletions: number;
  isTruncated: boolean;
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
 * Renders an interactive, syntax-styled HTML diff view for the trace viewer.
 */
export function renderDiffHtml(diff: ParsedDiff): string {
  const lines = diff.diffText.split("\n");
  const renderedLines: string[] = [];

  for (const line of lines) {
    const escaped = escapeHtml(line);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      renderedLines.push(`<div class="diff-line diff-add"><span class="diff-gutter">+</span><span class="diff-content">${escaped.slice(1)}</span></div>`);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      renderedLines.push(`<div class="diff-line diff-del"><span class="diff-gutter">-</span><span class="diff-content">${escaped.slice(1)}</span></div>`);
    } else if (line.startsWith("@@")) {
      renderedLines.push(`<div class="diff-line diff-hunk"><span class="diff-gutter">@</span><span class="diff-content">${escaped}</span></div>`);
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      renderedLines.push(`<div class="diff-line diff-file-header"><span class="diff-gutter">#</span><span class="diff-content">${escaped}</span></div>`);
    } else if (line.includes("[diff truncated:")) {
      renderedLines.push(`<div class="diff-line diff-truncated"><span class="diff-gutter">…</span><span class="diff-content">${escaped}</span></div>`);
    } else {
      renderedLines.push(`<div class="diff-line diff-context"><span class="diff-gutter">&nbsp;</span><span class="diff-content">${escaped.startsWith(" ") ? escaped.slice(1) : escaped}</span></div>`);
    }
  }

  return `
  <div class="file-diff-box">
    <div class="diff-header">
      <span class="diff-filename">📄 ${escapeHtml(diff.filename)}</span>
      <div class="diff-badges">
        <span class="diff-badge diff-badge-add">+${diff.additions}</span>
        <span class="diff-badge diff-badge-del">-${diff.deletions}</span>
        ${diff.isTruncated ? `<span class="diff-badge diff-badge-trunc">Truncated</span>` : ""}
      </div>
    </div>
    <div class="diff-code-container">
      ${renderedLines.join("\n")}
    </div>
  </div>`;
}
