import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installGrokBotHooks,
  parseGrokBotHookPayload,
} from "../src/hooks/grok_bot.js";
import { runInstall } from "../src/commands/install.js";

describe("Grok Bot Adapter & Plugin Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-grok-bot-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installGrokBotHooks", () => {
    it("should create .grok-bot/plugins/traceeval.js and .grok-bot/config.json", () => {
      const { pluginPath, configPath } = installGrokBotHooks({ cwd: tmpDir });

      expect(fs.existsSync(pluginPath)).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);

      const pluginContent = fs.readFileSync(pluginPath, "utf-8");
      expect(pluginContent).toContain("traceeval-grok-bot");
      expect(pluginContent).toContain("onBotTool");
      expect(pluginContent).toContain("onBotResult");

      const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(configJson.plugins).toContain("plugins/traceeval.js");
    });

    it("should succeed via runInstall('grok-bot') and alias 'grokbot'", () => {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(() => runInstall("grok-bot")).not.toThrow();
        expect(() => runInstall("grokbot")).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, ".grok-bot", "plugins", "traceeval.js"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("parseGrokBotHookPayload", () => {
    it("should parse bot action into tool_call_start", () => {
      const raw = JSON.stringify({
        sessionId: "grok-bot-pr-55",
        botId: "grok-reviewer",
        action: "run_linter",
        args: { fix: true },
      });

      const event = parseGrokBotHookPayload("pre-tool", raw);

      expect(event.agent).toBe("grok-bot");
      expect(event.type).toBe("tool_call_start");
      expect(event.data.toolName).toBe("run_linter");
      expect(event.sessionId).toBe("grok-bot-pr-55");
    });

    it("should parse bot result into tool_call with duration and status", () => {
      const raw = JSON.stringify({
        sessionId: "grok-bot-pr-55",
        tool: "run_linter",
        result: "Clean",
        durationMs: 310,
        status: "success",
      });

      const event = parseGrokBotHookPayload("post-tool", raw);

      expect(event.agent).toBe("grok-bot");
      expect(event.type).toBe("tool_call");
      expect(event.data.output).toBe("Clean");
      expect(event.data.durationMs).toBe(310);
      expect(event.data.status).toBe("success");
    });
  });
});
