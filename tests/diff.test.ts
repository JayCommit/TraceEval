import { describe, it, expect } from "vitest";
import {
  computeUnifiedDiff,
  extractDiffFromEvent,
  renderDiffHtml,
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

  it("should render syntax-styled HTML diff view", () => {
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
  });
});
