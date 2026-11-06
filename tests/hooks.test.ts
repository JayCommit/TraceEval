import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  installClaudeHooks,
  parseClaudeHookPayload,
  resolveSessionId,
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  getActiveSessionPath,
  extractSessionIdFromPayload,
} from "../src/hooks/claude.js";
import { runHook, isHookDebugEnabled, logHookDebug } from "../src/commands/hook.js";
import { StorageManager } from "../src/storage/index.js";

describe("Claude Code Hook Integration", () => {
  let tmpDir: string;
  let traceevalDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-hook-test-"));
    traceevalDir = path.join(tmpDir, ".traceeval");
    delete process.env.TRACEEVAL_SESSION_ID;
    delete process.env.TRACEEVAL_DEBUG;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    delete process.env.TRACEEVAL_SESSION_ID;
    delete process.env.TRACEEVAL_DEBUG;
    delete process.env.DEBUG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1. Hook Installation
  // --------------------------------------------------------------------------
  it("should install hook definitions into settings.json", () => {
    const { configPath } = installClaudeHooks({ cwd: tmpDir });
    expect(fs.existsSync(configPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.UserPromptSubmit).toBeDefined();
    expect(content.hooks.PostToolUse[0].command).toContain("traceeval hook post-tool");
    expect(content.hooks.PreToolUse[0].command).toContain("traceeval hook pre-tool");
    expect(content.hooks.Stop[0].command).toContain("traceeval hook stop");
  });

  it("should preserve existing settings when installing hooks", () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ customSetting: true, hooks: {} }),
      "utf-8"
    );

    const { configPath, backupPath } = installClaudeHooks({ cwd: tmpDir });
    expect(backupPath).toBeDefined();

    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content.customSetting).toBe(true);
    expect(content.hooks.PostToolUse).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 2. Event Ingestion & Parsing for All Hook Types
  // --------------------------------------------------------------------------
  it("should parse UserPromptSubmit payload into TraceEvent with prompt data", () => {
    const rawPayload = JSON.stringify({
      session_id: "claude-session-99",
      prompt: "Refactor auth logic",
    });

    const event = parseClaudeHookPayload("prompt", rawPayload, { baseDir: traceevalDir });
    expect(event.sessionId).toBe("claude-session-99");
    expect(event.type).toBe("user_prompt");
    expect(event.agent).toBe("claude-code");
    expect(event.data.prompt).toBe("Refactor auth logic");
  });

  it("should support UserPromptSubmit casing aliases (e.g. user_prompt_submit, UserPromptSubmit)", () => {
    const payload = JSON.stringify({ user_prompt: "Build an API" });
    const event1 = parseClaudeHookPayload("UserPromptSubmit", payload, { baseDir: traceevalDir });
    const event2 = parseClaudeHookPayload("user-prompt-submit", payload, { baseDir: traceevalDir });

    expect(event1.type).toBe("user_prompt");
    expect(event1.data.prompt).toBe("Build an API");
    expect(event2.type).toBe("user_prompt");
  });

  it("should parse PreToolUse payload into tool_call_start TraceEvent", () => {
    const rawPayload = JSON.stringify({
      session_id: "claude-session-99",
      tool_name: "Bash",
      tool_input: { command: "git status" },
      tool_use_id: "toolu_01",
    });

    const event = parseClaudeHookPayload("pre-tool", rawPayload, { baseDir: traceevalDir });
    expect(event.sessionId).toBe("claude-session-99");
    expect(event.type).toBe("tool_call_start");
    expect(event.data.toolName).toBe("Bash");
    expect(event.data.input).toEqual({ command: "git status" });
    expect(event.data.toolUseId).toBe("toolu_01");
  });

  it("should parse PostToolUse payload into tool_call TraceEvent with output and status", () => {
    const rawPayload = JSON.stringify({
      session_id: "claude-session-99",
      tool_name: "Edit",
      tool_input: { file_path: "index.ts" },
      tool_result: "File updated successfully",
      duration_ms: 150,
      tool_use_id: "toolu_02",
    });

    const event = parseClaudeHookPayload("post-tool", rawPayload, { baseDir: traceevalDir });
    expect(event.sessionId).toBe("claude-session-99");
    expect(event.type).toBe("tool_call");
    expect(event.data.toolName).toBe("Edit");
    expect(event.data.output).toBe("File updated successfully");
    expect(event.data.durationMs).toBe(150);
    expect(event.data.status).toBe("success");
    expect(event.data.toolUseId).toBe("toolu_02");
  });

  it("should parse PostToolUse payload with error into tool_call with error status", () => {
    const rawPayload = JSON.stringify({
      session_id: "claude-session-99",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      error: "Command failed with exit code 1",
      duration_ms: 320,
    });

    const event = parseClaudeHookPayload("post-tool", rawPayload, { baseDir: traceevalDir });
    expect(event.type).toBe("tool_call");
    expect(event.data.status).toBe("error");
    expect(event.data.error).toBe("Command failed with exit code 1");
  });

  it("should parse Stop hook into session_end TraceEvent", () => {
    const rawPayload = JSON.stringify({
      session_id: "claude-session-99",
      reason: "completed_goal",
    });

    const event = parseClaudeHookPayload("stop", rawPayload, { baseDir: traceevalDir });
    expect(event.sessionId).toBe("claude-session-99");
    expect(event.type).toBe("session_end");
    expect(event.data.reason).toBe("completed_goal");
  });

  // --------------------------------------------------------------------------
  // 3. Session Correlation & Identification
  // --------------------------------------------------------------------------
  it("should extract session ID from various payload keys (session_id, sessionId, conversation_id, nested)", () => {
    expect(extractSessionIdFromPayload({ session_id: "sess-1" })).toBe("sess-1");
    expect(extractSessionIdFromPayload({ sessionId: "sess-2" })).toBe("sess-2");
    expect(extractSessionIdFromPayload({ conversation_id: "conv-1" })).toBe("conv-1");
    expect(extractSessionIdFromPayload({ conversationId: "conv-2" })).toBe("conv-2");
    expect(extractSessionIdFromPayload({ session: { id: "nested-sess" } })).toBe("nested-sess");
    expect(extractSessionIdFromPayload({ context: { session_id: "ctx-sess" } })).toBe("ctx-sess");
    expect(extractSessionIdFromPayload({ context: { conversation_id: "ctx-conv" } })).toBe("ctx-conv");
    expect(extractSessionIdFromPayload({})).toBeUndefined();
    expect(extractSessionIdFromPayload(null)).toBeUndefined();
  });

  it("should prioritize explicit session ID over payload and env var", () => {
    process.env.TRACEEVAL_SESSION_ID = "env-session";
    const sessionId = resolveSessionId({
      explicitId: "explicit-session",
      payload: { session_id: "payload-session" },
      baseDir: traceevalDir,
    });
    expect(sessionId).toBe("explicit-session");
  });

  it("should prioritize payload session ID over env var when explicit ID is absent", () => {
    process.env.TRACEEVAL_SESSION_ID = "env-session";
    const sessionId = resolveSessionId({
      payload: { conversation_id: "payload-conv" },
      baseDir: traceevalDir,
    });
    expect(sessionId).toBe("payload-conv");
  });

  it("should use TRACEEVAL_SESSION_ID env var when payload has no session ID", () => {
    process.env.TRACEEVAL_SESSION_ID = "env-session-42";
    const sessionId = resolveSessionId({
      payload: { tool_name: "Edit" },
      baseDir: traceevalDir,
    });
    expect(sessionId).toBe("env-session-42");
  });

  // --------------------------------------------------------------------------
  // 4. Active Session Persistence across Multiple Hook Calls
  // --------------------------------------------------------------------------
  it("should persist and correlate session ID across multiple hook calls when no session ID is in payload", () => {
    // Call 1: prompt hook with no session ID
    const event1 = parseClaudeHookPayload("prompt", JSON.stringify({ prompt: "Fix bug" }), {
      baseDir: traceevalDir,
    });
    const sessionId = event1.sessionId;
    expect(sessionId).toBeDefined();
    expect(sessionId).toMatch(/^session-\d+-[a-f0-9]+/);

    // Verify .active_session was written
    const activeFile = getActiveSessionPath(traceevalDir);
    expect(fs.existsSync(activeFile)).toBe(true);
    expect(getActiveSession(traceevalDir)).toBe(sessionId);

    // Call 2: pre-tool hook with no session ID -> should share the same sessionId!
    const event2 = parseClaudeHookPayload(
      "pre-tool",
      JSON.stringify({ tool_name: "Edit", tool_input: { file: "a.ts" } }),
      { baseDir: traceevalDir }
    );
    expect(event2.sessionId).toBe(sessionId);

    // Call 3: post-tool hook with no session ID -> should share the same sessionId!
    const event3 = parseClaudeHookPayload(
      "post-tool",
      JSON.stringify({ tool_name: "Edit", tool_result: "ok" }),
      { baseDir: traceevalDir }
    );
    expect(event3.sessionId).toBe(sessionId);

    // Call 4: stop hook with no session ID -> should share the same sessionId!
    const event4 = parseClaudeHookPayload("stop", JSON.stringify({ reason: "done" }), {
      baseDir: traceevalDir,
    });
    expect(event4.sessionId).toBe(sessionId);
  });

  it("should remember and propagate payload session ID from prompt to subsequent tool hooks missing session ID", () => {
    // First hook provides session_id
    const event1 = parseClaudeHookPayload(
      "prompt",
      JSON.stringify({ session_id: "claude-upstream-xyz", prompt: "Hello" }),
      { baseDir: traceevalDir }
    );
    expect(event1.sessionId).toBe("claude-upstream-xyz");

    // Subsequent tool hook lacks session_id in payload
    const event2 = parseClaudeHookPayload(
      "pre-tool",
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
      { baseDir: traceevalDir }
    );
    expect(event2.sessionId).toBe("claude-upstream-xyz");

    const event3 = parseClaudeHookPayload(
      "post-tool",
      JSON.stringify({ tool_name: "Bash", tool_result: "file.txt" }),
      { baseDir: traceevalDir }
    );
    expect(event3.sessionId).toBe("claude-upstream-xyz");
  });

  it("should expire active session after TTL and generate a new session ID", () => {
    setActiveSession("old-session", traceevalDir);

    // Manually backdate the session file to simulate expiration
    const activeFile = getActiveSessionPath(traceevalDir);
    const expiredData = {
      sessionId: "old-session",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    };
    fs.writeFileSync(activeFile, JSON.stringify(expiredData), "utf-8");

    // Check with 10 second TTL -> should be expired
    const active = getActiveSession(traceevalDir, 10000);
    expect(active).toBeNull();

    // Resolving should now generate a new session ID
    const newSessionId = resolveSessionId({
      baseDir: traceevalDir,
      ttlMs: 10000,
    });
    expect(newSessionId).not.toBe("old-session");
  });

  it("should allow clearing active session cleanly", () => {
    setActiveSession("session-to-clear", traceevalDir);
    expect(getActiveSession(traceevalDir)).toBe("session-to-clear");

    clearActiveSession(traceevalDir);
    expect(getActiveSession(traceevalDir)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 5. End-to-End runHook Storage Ingestion
  // --------------------------------------------------------------------------
  it("should ingest events and correlate them into storage via runHook", async () => {
    // 1. User prompt
    await runHook("prompt", {
      data: JSON.stringify({ prompt: "Refactor database client", session_id: "corr-session-1" }),
      baseDir: traceevalDir,
    });

    // 2. Pre-tool (omits session_id, relies on active correlation)
    await runHook("pre-tool", {
      data: JSON.stringify({ tool_name: "Edit", tool_input: { path: "db.ts" } }),
      baseDir: traceevalDir,
    });

    // 3. Post-tool
    await runHook("post-tool", {
      data: JSON.stringify({
        tool_name: "Edit",
        tool_input: { path: "db.ts" },
        tool_result: "success",
        duration_ms: 85,
      }),
      baseDir: traceevalDir,
    });

    // 4. Stop
    await runHook("stop", {
      data: JSON.stringify({ reason: "finished" }),
      baseDir: traceevalDir,
    });

    const storage = new StorageManager({ baseDir: traceevalDir });
    const session = storage.getSession("corr-session-1");

    expect(session).not.toBeNull();
    expect(session!.id).toBe("corr-session-1");
    expect(session!.prompt).toBe("Refactor database client");
    expect(session!.status).toBe("completed");
    expect(session!.events).toHaveLength(4);

    const [e1, e2, e3, e4] = session!.events;
    expect(e1.type).toBe("user_prompt");
    expect(e1.data.prompt).toBe("Refactor database client");

    expect(e2.type).toBe("tool_call_start");
    expect(e2.data.toolName).toBe("Edit");

    expect(e3.type).toBe("tool_call");
    expect(e3.data.toolName).toBe("Edit");
    expect(e3.data.output).toBe("success");
    expect(e3.data.durationMs).toBe(85);

    expect(e4.type).toBe("session_end");
    expect(e4.data.reason).toBe("finished");

    storage.close();
  });

  // --------------------------------------------------------------------------
  // 6. Silent Fail-Safe Error Handling
  // --------------------------------------------------------------------------
  it("should never throw when encountering malformed JSON in hook payload", () => {
    const rawMalformed = "{ malformed json ::: ";
    let event: any;
    expect(() => {
      event = parseClaudeHookPayload("prompt", rawMalformed, { baseDir: traceevalDir });
    }).not.toThrow();

    expect(event).toBeDefined();
    expect(event.sessionId).toBeDefined();
    expect(event.data.raw).toBe(rawMalformed);
  });

  it("should never throw in runHook even if internal operations fail", async () => {
    // Intentionally pass an invalid directory that causes a write error
    // e.g. path that is a file where a directory is expected
    const blockerFile = path.join(tmpDir, "blocker");
    fs.writeFileSync(blockerFile, "file-not-dir");

    // runHook should catch errors silently and complete
    await expect(
      runHook("prompt", {
        data: JSON.stringify({ prompt: "Test" }),
        baseDir: blockerFile, // This will fail because blockerFile is a file, not a directory
      })
    ).resolves.not.toThrow();
  });

  it("should recover gracefully if active_session file contains corrupted data", () => {
    const activeFile = getActiveSessionPath(traceevalDir);
    fs.mkdirSync(path.dirname(activeFile), { recursive: true });
    fs.writeFileSync(activeFile, "CORRUPT_NOT_JSON", "utf-8");

    // Should read as raw text or recover without throwing
    const active = getActiveSession(traceevalDir);
    expect(active).toBe("CORRUPT_NOT_JSON");

    // If completely empty:
    fs.writeFileSync(activeFile, "", "utf-8");
    expect(getActiveSession(traceevalDir)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 7. Debug Logging Support
  // --------------------------------------------------------------------------
  it("should correctly detect debug mode via options or environment variables", () => {
    expect(isHookDebugEnabled({ debug: true })).toBe(true);
    expect(isHookDebugEnabled({ debug: false })).toBe(false);
    expect(isHookDebugEnabled()).toBe(false);

    process.env.TRACEEVAL_DEBUG = "1";
    expect(isHookDebugEnabled()).toBe(true);

    delete process.env.TRACEEVAL_DEBUG;
    process.env.DEBUG = "traceeval";
    expect(isHookDebugEnabled()).toBe(true);
  });

  it("should log to stderr when debug mode is enabled", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runHook("prompt", {
      data: JSON.stringify({ prompt: "Debug test", session_id: "debug-session-1" }),
      debug: true,
      baseDir: traceevalDir,
    });

    expect(stderrSpy).toHaveBeenCalled();
    const calls = stderrSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((msg) => typeof msg === "string" && msg.includes("[traceeval:hook:debug]"))).toBe(true);

    stderrSpy.mockRestore();
  });

  it("should stay completely silent on stdout and stderr when debug mode is off", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runHook("prompt", {
      data: JSON.stringify({ prompt: "Silent test", session_id: "silent-session-1" }),
      debug: false,
      baseDir: traceevalDir,
    });

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
