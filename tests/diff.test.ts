import { describe, it, expect } from "vitest";
import {
  computeUnifiedDiff,
  parseUnifiedDiffToSplit,
  extractDiffFromEvent,
  renderDiffHtml,
  computeIntraLineDiff,
} from "../src/viewer/diff.js";
import { TraceEvent } from "../src/types/index.js";

describe("Visual File Diff Engine", () => {
  it("should compute accurate unified diff between old and new contents", () => {
    const before = "function add(a, b) {\n  return a - b;\n}";
    const after = "function add(a, b) {\n  return a + b;\n}";

    const diff = computeUnifiedDiff(before, after, "src/math.ts");

    expect(diff).toContain("--- a/src/math.ts");
    expect(diff).toContain("+++ b/src/math.ts");
    expect(diff).toContain("-  return a - b;");
    expect(diff).toContain("+  return a + b;");
    expect(diff).toContain(" function add(a, b) {");
  });

  it("should return empty string if contents are identical", () => {
    const content = "const x = 42;\n";
    expect(computeUnifiedDiff(content, content)).toBe("");
  });

  it("should extract diff from tool calls with old_str and new_str", () => {
    const event: TraceEvent = {
      id: "evt-edit-1",
      sessionId: "sess-diff-1",
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agent: "claude-code",
      data: {
        toolName: "str_replace_editor",
        input: {
          path: "src/config.ts",
          old_str: "timeout: 5000",
          new_str: "timeout: 10000",
        },
        status: "success",
      },
    };

    const parsed = extractDiffFromEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.filename).toBe("src/config.ts");
    expect(parsed?.additions).toBeGreaterThan(0);
    expect(parsed?.deletions).toBeGreaterThan(0);
    expect(parsed?.diffText).toContain("+timeout: 10000");
    expect(parsed?.diffText).toContain("-timeout: 5000");
  });

  it("should extract diff from file_change event with before and after", () => {
    const event: TraceEvent = {
      id: "evt-fc-1",
      sessionId: "sess-diff-1",
      timestamp: new Date().toISOString(),
      type: "file_change",
      agent: "cursor",
      data: {
        path: "README.md",
        before: "# Hello\nOld intro",
        after: "# Hello\nNew intro",
      },
    };

    const parsed = extractDiffFromEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.filename).toBe("README.md");
    expect(parsed?.diffText).toContain("+New intro");
    expect(parsed?.diffText).toContain("-Old intro");
  });

  it("should extract diff from event when diff text is directly provided", () => {
    const rawDiff = "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new";
    const event: TraceEvent = {
      id: "evt-raw-1",
      sessionId: "sess-diff-1",
      timestamp: new Date().toISOString(),
      type: "file_change",
      agent: "antigravity",
      data: {
        path: "file.ts",
        diff: rawDiff,
      },
    };

    const parsed = extractDiffFromEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.additions).toBe(1);
    expect(parsed?.deletions).toBe(1);
  });

  it("should truncate oversized diffs with an indicator", () => {
    const longBefore = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const longAfter = Array.from({ length: 400 }, (_, i) => `line ${i} modified`).join("\n");

    const event: TraceEvent = {
      id: "evt-long",
      sessionId: "sess-diff-1",
      timestamp: new Date().toISOString(),
      type: "file_change",
      agent: "openai",
      data: {
        path: "large.ts",
        before: longBefore,
        after: longAfter,
      },
    };

    const parsed = extractDiffFromEvent(event, 50);
    expect(parsed).not.toBeNull();
    expect(parsed?.isTruncated).toBe(true);
    expect(parsed?.diffText).toContain("[diff truncated:");
  });

  it("should render syntax-styled HTML diff view with both split and unified containers", () => {
    const parsed = {
      filename: "src/auth.ts",
      diffText: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,2 +1,2 @@\n-const valid = false;\n+const valid = true;",
      additions: 1,
      deletions: 1,
      isTruncated: false,
    };

    const html = renderDiffHtml(parsed);
    expect(html).toContain("src/auth.ts");
    expect(html).toContain("diff-badge-add");
    expect(html).toContain("+1");
    expect(html).toContain("diff-badge-del");
    expect(html).toContain("-1");
    expect(html).toContain("diff-add");
    expect(html).toContain("diff-del");

    // Side-by-Side split elements
    expect(html).toContain("view-split");
    expect(html).toContain("diff-split-container");
    expect(html).toContain("diff-unified-container");
    expect(html).toContain("diff-toggle-btn");
    expect(html).toContain('data-mode="split"');
    expect(html).toContain('data-mode="unified"');
    expect(html).toContain("split-del");
    expect(html).toContain("split-add");

    // Token-level intra-line highlights in both split and unified
    expect(html).toContain('const valid = <span class="diff-word-del">false</span>;');
    expect(html).toContain('const valid = <span class="diff-word-add">true</span>;');
  });

  it("should compute token-level intra-line diff highlighting accurately", () => {
    // Single word change
    const single = computeIntraLineDiff("const x = 10;", "const x = 20;");
    expect(single.leftHtml).toBe('const x = <span class="diff-word-del">10</span>;');
    expect(single.rightHtml).toBe('const x = <span class="diff-word-add">20</span>;');

    // Multiple token changes in the same line
    const multi = computeIntraLineDiff("call(foo, bar);", "call(baz, qux);");
    expect(multi.leftHtml).toContain('<span class="diff-word-del">foo</span>');
    expect(multi.leftHtml).toContain('<span class="diff-word-del">bar</span>');
    expect(multi.rightHtml).toContain('<span class="diff-word-add">baz</span>');
    expect(multi.rightHtml).toContain('<span class="diff-word-add">qux</span>');

    // Identical lines
    const identical = computeIntraLineDiff("console.log('hi');", "console.log('hi');");
    expect(identical.leftHtml).toBe("console.log(&#039;hi&#039;);");
    expect(identical.rightHtml).toBe("console.log(&#039;hi&#039;);");
    expect(identical.leftHtml).not.toContain("diff-word");

    // HTML entity escaping inside changed tokens
    const htmlEsc = computeIntraLineDiff("<div>old</div>", "<div>new</div>");
    expect(htmlEsc.leftHtml).toBe('&lt;div&gt;<span class="diff-word-del">old</span>&lt;/div&gt;');
    expect(htmlEsc.rightHtml).toBe('&lt;div&gt;<span class="diff-word-add">new</span>&lt;/div&gt;');
  });

  it("should parse unified diff into aligned side-by-side split rows with accurate line numbers", () => {
    const diffText = [
      "--- a/math.ts",
      "+++ b/math.ts",
      "@@ -10,3 +20,4 @@",
      "-const oldVal = 1;",
      "+const newVal = 2;",
      "+const extraVal = 3;",
      " const ctx = 4;",
    ].join("\n");

    const splitRows = parseUnifiedDiffToSplit(diffText);
    expect(splitRows.length).toBeGreaterThan(0);

    // Hunk row
    const hunkRow = splitRows.find((r) => r.type === "hunk");
    expect(hunkRow).toBeDefined();
    expect(hunkRow?.hunkHeader).toContain("@@ -10,3 +20,4 @@");

    // Change rows
    const changeRows = splitRows.filter((r) => r.type === "change");
    expect(changeRows.length).toBe(2);

    // Row 0: oldVal replaced by newVal
    expect(changeRows[0].left?.lineNum).toBe(10);
    expect(changeRows[0].left?.content).toBe("const oldVal = 1;");
    expect(changeRows[0].left?.type).toBe("del");
    expect(changeRows[0].right?.lineNum).toBe(20);
    expect(changeRows[0].right?.content).toBe("const newVal = 2;");
    expect(changeRows[0].right?.type).toBe("add");

    // Row 1: empty on left, extraVal added on right
    expect(changeRows[1].left?.type).toBe("empty");
    expect(changeRows[1].right?.lineNum).toBe(21);
    expect(changeRows[1].right?.content).toBe("const extraVal = 3;");
    expect(changeRows[1].right?.type).toBe("add");

    // Context row
    const contextRow = splitRows.find((r) => r.type === "context");
    expect(contextRow).toBeDefined();
    expect(contextRow?.left?.lineNum).toBe(11);
    expect(contextRow?.right?.lineNum).toBe(22);
    expect(contextRow?.left?.content).toBe("const ctx = 4;");
  });

  it("should preserve truncation markers in side-by-side split diff rows", () => {
    const diffText = [
      "--- a/large.ts",
      "+++ b/large.ts",
      "@@ -1,2 +1,2 @@",
      "-old line",
      "+new line",
      "... [diff truncated: 50 lines omitted for readability] ...",
    ].join("\n");

    const splitRows = parseUnifiedDiffToSplit(diffText);
    const truncRow = splitRows.find((r) => r.type === "truncated");
    expect(truncRow).toBeDefined();
    expect(truncRow?.truncatedText).toContain("[diff truncated:");

    const html = renderDiffHtml({
      filename: "large.ts",
      diffText,
      additions: 1,
      deletions: 1,
      isTruncated: true,
    });
    expect(html).toContain("split-truncated");
    expect(html).toContain("diff-badge-trunc");
  });

  it("should support defaultMode override in renderDiffHtml", () => {
    const parsed = {
      filename: "test.ts",
      diffText: "--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-a\n+b",
      additions: 1,
      deletions: 1,
      isTruncated: false,
    };

    const htmlUnified = renderDiffHtml(parsed, "unified");
    expect(htmlUnified).toContain("view-unified");
    expect(htmlUnified).toContain('class="diff-toggle-btn active" data-mode="unified"');
  });
});
