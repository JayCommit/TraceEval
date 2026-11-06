import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installCursorIntegration,
  parseCursorHookPayload,
} from "../src/hooks/cursor.js";
import { runInstall } from "../src/commands/install.js";

describe("Cursor Adapter & Lifecycle Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-cursor-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installCursorIntegration", () => {
    it("should create .cursor/hooks.json, .cursor/mcp.json, and .cursor/rules/traceeval.mdc", () => {
      const { hooksPath, mcpPath, rulePath } = installCursorIntegration({ cwd: tmpDir });

      expect(fs.existsSync(hooksPath)).toBe(true);
      expect(fs.existsSync(mcpPath)).toBe(true);
      expect(rulePath).toBeDefined();
      expect(fs.existsSync(rulePath!)).toBe(true);

      const hooksJson = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
      expect(hooksJson.hooks.PreToolUse).toBeDefined();
      expect(hooksJson.hooks.PostToolUse).toBeDefined();
      expect(hooksJson.hooks.PreToolUse[0].command).toContain("--agent cursor");

      const mcpJson = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      expect(mcpJson.mcpServers.traceeval).toBeDefined();
      expect(mcpJson.mcpServers.traceeval.args).toContain("mcp");

      const ruleContent = fs.readFileSync(rulePath!, "utf-8");
      expect(ruleContent).toContain("TraceEval");
    });

    it("should succeed via runInstall('cursor')", () => {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(() => runInstall("cursor")).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, ".cursor", "hooks.json"))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, ".cursor", "mcp.json"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("parseCursorHookPayload", () => {
    it("should parse pre-tool command payload into tool_call_start", () => {
      const raw = JSON.stringify({
        conversation_id: "cursor-conv-1",
        action: "run_terminal_command",
        command: "npm run build",
      });

      const event = parseCursorHookPayload("pre-tool", raw);

      expect(event.agent).toBe("cursor");
      expect(event.type).toBe("tool_call_start");
      expect(event.sessionId).toBe("cursor-conv-1");
      expect(event.data.toolName).toBe("run_terminal_command");
      expect(event.data.input).toBe("npm run build");
    });

    it("should parse post-tool file edit into tool_call", () => {
      const raw = JSON.stringify({
        session_id: "cursor-sess-42",
        tool: "edit_file",
        input: { file: "src/utils.ts" },
        output: "Lines replaced successfully",
        duration_ms: 150,
      });

      const event = parseCursorHookPayload("post-tool", raw);

      expect(event.agent).toBe("cursor");
      expect(event.type).toBe("tool_call");
      expect(event.sessionId).toBe("cursor-sess-42");
      expect(event.data.toolName).toBe("edit_file");
      expect(event.data.output).toBe("Lines replaced successfully");
      expect(event.data.durationMs).toBe(150);
      expect(event.data.status).toBe("success");
    });

    it("should handle error status when payload includes error", () => {
      const raw = JSON.stringify({
        tool: "run_terminal_command",
        error: "Command exited with status 1",
      });

      const event = parseCursorHookPayload("post-tool", raw);
      expect(event.data.status).toBe("error");
    });

    it("should parse user prompt into user_prompt event", () => {
      const raw = JSON.stringify({
        prompt: "Refactor auth middleware",
      });

      const event = parseCursorHookPayload("prompt", raw);
      expect(event.type).toBe("user_prompt");
      expect(event.data.prompt).toBe("Refactor auth middleware");
    });
  });
});
