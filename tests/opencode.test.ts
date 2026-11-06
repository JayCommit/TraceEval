import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installOpenCodePlugin,
  parseOpenCodeHookPayload,
} from "../src/hooks/opencode.js";
import { runInstall } from "../src/commands/install.js";

describe("OpenCode Adapter & Plugin Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-opencode-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installOpenCodePlugin", () => {
    it("should create .opencode/plugins/traceeval.js and update .opencode/config.json", () => {
      const { pluginPath, configPath } = installOpenCodePlugin({ cwd: tmpDir });

      expect(fs.existsSync(pluginPath)).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);

      const pluginContent = fs.readFileSync(pluginPath, "utf-8");
      expect(pluginContent).toContain("traceeval-opencode");
      expect(pluginContent).toContain("onToolExecute");
      expect(pluginContent).toContain("onToolComplete");
      expect(pluginContent).toContain("onFileChange");

      const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(configJson.plugins).toContain("plugins/traceeval.js");
    });

    it("should succeed via runInstall('opencode')", () => {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(() => runInstall("opencode")).not.toThrow();
        expect(fs.existsSync(path.join(tmpDir, ".opencode", "plugins", "traceeval.js"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe("parseOpenCodeHookPayload", () => {
    it("should parse tool execution payload into tool_call_start", () => {
      const raw = JSON.stringify({
        sessionId: "opencode-sess-1",
        type: "tool_execute",
        tool: "bash",
        command: "npm test",
      });

      const event = parseOpenCodeHookPayload("pre-tool", raw);

      expect(event.agent).toBe("opencode");
      expect(event.type).toBe("tool_call_start");
      expect(event.sessionId).toBe("opencode-sess-1");
      expect(event.data.toolName).toBe("bash");
      expect(event.data.input).toBe("npm test");
    });

    it("should parse tool completion payload into tool_call", () => {
      const raw = JSON.stringify({
        sessionId: "opencode-sess-1",
        tool: "file_editor",
        output: "Successfully updated 12 lines",
        duration_ms: 120,
        status: "success",
      });

      const event = parseOpenCodeHookPayload("post-tool", raw);

      expect(event.agent).toBe("opencode");
      expect(event.type).toBe("tool_call");
      expect(event.data.toolName).toBe("file_editor");
      expect(event.data.output).toBe("Successfully updated 12 lines");
      expect(event.data.durationMs).toBe(120);
      expect(event.data.status).toBe("success");
    });

    it("should parse file change events into file_change", () => {
      const raw = JSON.stringify({
        sessionId: "opencode-sess-1",
        file: "src/index.ts",
        status: "created",
      });

      const event = parseOpenCodeHookPayload("file", raw);

      expect(event.agent).toBe("opencode");
      expect(event.type).toBe("file_change");
      expect(event.data.path).toBe("src/index.ts");
      expect(event.data.changeType).toBe("created");
    });

    it("should parse session completion events into session_end", () => {
      const raw = JSON.stringify({
        sessionId: "opencode-sess-1",
        duration_ms: 3450,
      });

      const event = parseOpenCodeHookPayload("stop", raw);

      expect(event.agent).toBe("opencode");
      expect(event.type).toBe("session_end");
      expect(event.data.durationMs).toBe(3450);
    });
  });
});
