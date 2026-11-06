import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installOpenAIHooks,
  parseOpenAIHookPayload,
} from "../src/hooks/openai.js";
import { runInstall } from "../src/commands/install.js";

describe("OpenAI / ChatGPT Adapter & Lifecycle Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-openai-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installOpenAIHooks", () => {
    it("should create .openai/hooks.json, .openai/config.json, and .openai/mcp.json", () => {
      const { hooksPath, configPath, mcpPath } = installOpenAIHooks({ cwd: tmpDir });

      expect(fs.existsSync(hooksPath)).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
      expect(fs.existsSync(mcpPath)).toBe(true);

      const hooksJson = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
      expect(hooksJson.hooks.PreToolUse.command).toContain("--agent openai");

      const mcpJson = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      expect(mcpJson.mcpServers.traceeval).toBeDefined();
    });

    it("should succeed via runInstall('openai') and alias 'chatgpt'", () => {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(() => runInstall("openai")).not.toThrow();
        expect(() => runInstall("chatgpt")).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, ".openai", "hooks.json"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("parseOpenAIHookPayload", () => {
    it("should parse OpenAI function calls format into tool_call_start", () => {
      const raw = JSON.stringify({
        sessionId: "openai-run-99",
        tool_calls: [
          {
            id: "call_abc123",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "README.md" }),
            },
          },
        ],
        usage: {
          prompt_tokens: 350,
          completion_tokens: 60,
          total_tokens: 410,
        },
      });

      const event = parseOpenAIHookPayload("pre-tool", raw);

      expect(event.agent).toBe("openai");
      expect(event.type).toBe("tool_call_start");
      expect(event.sessionId).toBe("openai-run-99");
      expect(event.data.toolName).toBe("read_file");
      expect(event.data.tokens).toEqual({
        input: 350,
        output: 60,
        total: 410,
      });
    });

    it("should parse tool output into tool_call", () => {
      const raw = JSON.stringify({
        sessionId: "openai-run-99",
        tool: "read_file",
        output: "# TraceEval Documentation",
        durationMs: 80,
      });

      const event = parseOpenAIHookPayload("post-tool", raw);

      expect(event.agent).toBe("openai");
      expect(event.type).toBe("tool_call");
      expect(event.data.toolName).toBe("read_file");
      expect(event.data.output).toBe("# TraceEval Documentation");
      expect(event.data.durationMs).toBe(80);
      expect(event.data.status).toBe("success");
    });
  });
});
