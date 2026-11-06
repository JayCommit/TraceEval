import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installGrokHooks,
  parseGrokHookPayload,
} from "../src/hooks/grok.js";
import { runInstall } from "../src/commands/install.js";

describe("Grok Adapter & Lifecycle Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-grok-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installGrokHooks", () => {
    it("should create .grok/hooks.json and .grok/config.json", () => {
      const { hooksPath, configPath } = installGrokHooks({ cwd: tmpDir });

      expect(fs.existsSync(hooksPath)).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);

      const hooksJson = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
      expect(hooksJson.hooks.PreToolUse.command).toContain("--agent grok");
      expect(hooksJson.hooks.PostToolUse.command).toContain("--agent grok");

      const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(configJson.hooksEnabled).toBe(true);
    });

    it("should succeed via runInstall('grok')", () => {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(() => runInstall("grok")).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, ".grok", "hooks.json"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("parseGrokHookPayload", () => {
    it("should parse tool execution payload and extract tokens", () => {
      const raw = JSON.stringify({
        sessionId: "grok-sess-100",
        tool_name: "code_search",
        parameters: { query: "export function evaluate" },
        usage: {
          prompt_tokens: 420,
          completion_tokens: 85,
          total_tokens: 505,
        },
      });

      const event = parseGrokHookPayload("pre-tool", raw);

      expect(event.agent).toBe("grok");
      expect(event.type).toBe("tool_call_start");
      expect(event.sessionId).toBe("grok-sess-100");
      expect(event.data.toolName).toBe("code_search");
      expect(event.data.tokens).toEqual({
        input: 420,
        output: 85,
        total: 505,
      });
    });

    it("should parse post-tool completion into tool_call", () => {
      const raw = JSON.stringify({
        sessionId: "grok-sess-100",
        tool: "bash",
        output: "Test suite completed with 0 errors",
        durationMs: 220,
      });

      const event = parseGrokHookPayload("post-tool", raw);

      expect(event.agent).toBe("grok");
      expect(event.type).toBe("tool_call");
      expect(event.data.toolName).toBe("bash");
      expect(event.data.output).toBe("Test suite completed with 0 errors");
      expect(event.data.durationMs).toBe(220);
      expect(event.data.status).toBe("success");
    });
  });
});
