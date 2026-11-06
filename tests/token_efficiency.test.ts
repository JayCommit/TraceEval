import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { truncatePayload, safeJsonParse } from "../src/hooks/common.js";
import { runHook } from "../src/commands/hook.js";
import { StorageManager } from "../src/storage/index.js";
import { McpServer } from "../src/mcp/server.js";

describe("Token Efficiency & Payload Optimizations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-token-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("truncatePayload", () => {
    it("should keep strings under maxChars intact", () => {
      const shortStr = "Short log message";
      expect(truncatePayload(shortStr, 50)).toBe(shortStr);
    });

    it("should truncate oversized strings with head and tail preserving byte limit", () => {
      const hugeStr = "A".repeat(1000) + "MIDDLE" + "Z".repeat(1000);
      const truncated = truncatePayload(hugeStr, 200);

      expect(truncated.length).toBeLessThan(hugeStr.length);
      expect(truncated).toContain("[truncated");
      expect(truncated.startsWith("A".repeat(50))).toBe(true);
      expect(truncated.endsWith("Z".repeat(50))).toBe(true);
    });

    it("should recursively truncate nested arrays and object payloads", () => {
      const payload = {
        title: "Test Run",
        outputs: [
          { command: "cat large.log", output: "X".repeat(5000) },
        ],
      };

      const truncated = truncatePayload(payload, 100);
      expect(truncated.title).toBe("Test Run");
      expect(truncated.outputs[0].output).toContain("[truncated");
    });
  });

  describe("runHook Agent Routing", () => {
    it("should route hooks to respective agents based on --agent flag", async () => {
      const baseDir = path.join(tmpDir, ".traceeval");

      // Antigravity hook
      await runHook("pre-tool", {
        agent: "antigravity",
        session: "test-routing-agy",
        data: JSON.stringify({ toolName: "view_file", toolInput: { Path: "foo.ts" } }),
        baseDir,
      });

      // Cursor hook
      await runHook("post-tool", {
        agent: "cursor",
        session: "test-routing-cursor",
        data: JSON.stringify({ action: "edit_file", output: "Done" }),
        baseDir,
      });

      // Grok hook
      await runHook("pre-tool", {
        agent: "grok",
        session: "test-routing-grok",
        data: JSON.stringify({ tool: "code_search", input: "test" }),
        baseDir,
      });

      const storage = new StorageManager({ baseDir });
      const agySession = storage.getSession("test-routing-agy");
      const cursorSession = storage.getSession("test-routing-cursor");
      const grokSession = storage.getSession("test-routing-grok");

      expect(agySession?.events[0].agent).toBe("antigravity");
      expect(cursorSession?.events[0].agent).toBe("cursor");
      expect(grokSession?.events[0].agent).toBe("grok");

      storage.close();
    });
  });

  describe("MCP Server Token Efficiency", () => {
    it("should truncate tool output in get_trace when maxOutputLength is provided", async () => {
      const baseDir = path.join(tmpDir, ".traceeval");
      const storage = new StorageManager({ baseDir });
      const sessionId = "mcp-token-test-sess";

      storage.upsertSession({ id: sessionId, agent: "claude-code", status: "completed" });
      storage.recordEvent({
        id: "evt-1",
        sessionId,
        timestamp: new Date().toISOString(),
        type: "tool_call",
        agent: "claude-code",
        data: {
          toolName: "run_command",
          output: "LINE ".repeat(500), // ~2500 chars
        },
      });
      storage.close();

      const mcpServer = new McpServer(tmpDir);
      // Access private executeTool for unit testing
      const result = await (mcpServer as any).executeTool("get_trace", {
        sessionId,
        maxOutputLength: 100,
      });

      expect(result.stepCount).toBe(1);
      expect(result.toolCalls[0].output).toContain("[truncated");
      expect(result.toolCalls[0].output.length).toBeLessThan(300);
    });
  });
});
