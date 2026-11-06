import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installAntigravityHooks,
  parseAntigravityHookPayload,
} from "../src/hooks/antigravity.js";
import { runInstall } from "../src/commands/install.js";

describe("Antigravity Adapter & Customization Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-antigravity-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installAntigravityHooks", () => {
    it("should create .agents/hooks.json matching Antigravity hook structure", () => {
      const { configPath } = installAntigravityHooks({ cwd: tmpDir });

      expect(fs.existsSync(configPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(json.traceeval).toBeDefined();
      expect(json.traceeval.enabled).toBe(true);
      expect(json.traceeval.SessionStart[0].command).toContain("--agent antigravity");
      expect(json.traceeval.PreToolUse[0].hooks[0].command).toContain("pre-tool --agent antigravity");
      expect(json.traceeval.PostToolUse[0].hooks[0].command).toContain("post-tool --agent antigravity");
      expect(json.traceeval.Stop[0].command).toContain("stop --agent antigravity");
    });

    it("should preserve existing third-party hooks when updating .agents/hooks.json", () => {
      const agentsDir = path.join(tmpDir, ".agents");
      fs.mkdirSync(agentsDir, { recursive: true });
      const existingHooksPath = path.join(agentsDir, "hooks.json");
      fs.writeFileSync(
        existingHooksPath,
        JSON.stringify({
          "lint-checker": {
            PostToolUse: [{ matcher: "run_command", hooks: [{ command: "./lint.sh" }] }],
          },
        }),
        "utf-8"
      );

      installAntigravityHooks({ cwd: tmpDir });

      const updated = JSON.parse(fs.readFileSync(existingHooksPath, "utf-8"));
      expect(updated["lint-checker"]).toBeDefined();
      expect(updated.traceeval).toBeDefined();
    });

    it("should succeed via runInstall('antigravity') and alias 'agy'", () => {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(() => runInstall("antigravity")).not.toThrow();
        expect(() => runInstall("agy")).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, ".agents", "hooks.json"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("parseAntigravityHookPayload", () => {
    it("should parse tool execution payload with toolName and toolInput", () => {
      const raw = JSON.stringify({
        sessionId: "agy-sess-1",
        stepIndex: 3,
        toolName: "run_command",
        toolInput: { CommandLine: "npm test" },
      });

      const event = parseAntigravityHookPayload("pre-tool", raw);

      expect(event.agent).toBe("antigravity");
      expect(event.type).toBe("tool_call_start");
      expect(event.sessionId).toBe("agy-sess-1");
      expect(event.data.toolName).toBe("run_command");
      expect(event.data.input).toEqual({ CommandLine: "npm test" });
    });

    it("should parse tool output payload with durationMs and status", () => {
      const raw = JSON.stringify({
        sessionId: "agy-sess-1",
        toolName: "run_command",
        toolOutput: "All tests passed",
        durationMs: 450,
      });

      const event = parseAntigravityHookPayload("post-tool", raw);

      expect(event.agent).toBe("antigravity");
      expect(event.type).toBe("tool_call");
      expect(event.data.toolName).toBe("run_command");
      expect(event.data.output).toBe("All tests passed");
      expect(event.data.durationMs).toBe(450);
      expect(event.data.status).toBe("success");
    });

    it("should parse stop payload with terminationReason", () => {
      const raw = JSON.stringify({
        sessionId: "agy-sess-1",
        terminationReason: "NO_TOOL_CALL",
      });

      const event = parseAntigravityHookPayload("stop", raw);

      expect(event.agent).toBe("antigravity");
      expect(event.type).toBe("session_end");
      expect(event.data.reason).toBe("NO_TOOL_CALL");
    });
  });
});
