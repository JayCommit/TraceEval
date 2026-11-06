import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StorageManager } from "../src/storage/index.js";
import { createViewerServer } from "../src/commands/view.js";
import {
  pauseSession,
  resumeSession,
  abortSession,
  injectPrompt,
  consumeInjectedPrompts,
  getSessionControlState,
  SessionProcessRegistry,
} from "../src/engine/control.js";

describe("Bidirectional Viewer Control Engine", () => {
  let tmpDir: string;
  let storage: StorageManager;
  const sessionId = "test-control-sess-1";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-ctrl-test-"));
    storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
    storage.upsertSession({
      id: sessionId,
      agent: "cursor",
      startTime: new Date().toISOString(),
      status: "active",
    });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should record and update control state for pause, resume, abort, and inject", () => {
    // 1. Initial state
    const init = getSessionControlState(sessionId, storage.baseDir);
    expect(init.status).toBe("active");
    expect(init.injectedPrompts.length).toBe(0);

    // 2. Pause
    const pauseRes = pauseSession(sessionId, storage.baseDir);
    expect(pauseRes.success).toBe(true);
    expect(pauseRes.status).toBe("paused");
    const paused = getSessionControlState(sessionId, storage.baseDir);
    expect(paused.status).toBe("paused");
    expect(paused.pausedAt).toBeDefined();

    // 3. Resume
    const resumeRes = resumeSession(sessionId, storage.baseDir);
    expect(resumeRes.success).toBe(true);
    expect(resumeRes.status).toBe("active");
    const resumed = getSessionControlState(sessionId, storage.baseDir);
    expect(resumed.status).toBe("active");
    expect(resumed.resumedAt).toBeDefined();

    // 4. Inject Prompt
    const injectRes = injectPrompt(sessionId, "Please inspect test coverage", storage.baseDir);
    expect(injectRes.success).toBe(true);
    expect(injectRes.item.prompt).toBe("Please inspect test coverage");

    // 5. Consume Prompt
    const consumed = consumeInjectedPrompts(sessionId, storage.baseDir);
    expect(consumed.length).toBe(1);
    expect(consumed[0].prompt).toBe("Please inspect test coverage");
    const reConsumed = consumeInjectedPrompts(sessionId, storage.baseDir);
    expect(reConsumed.length).toBe(0);

    // 6. Abort
    const abortRes = abortSession(sessionId, storage.baseDir);
    expect(abortRes.success).toBe(true);
    expect(abortRes.status).toBe("aborted");
    const aborted = getSessionControlState(sessionId, storage.baseDir);
    expect(aborted.status).toBe("aborted");
    expect(aborted.abortedAt).toBeDefined();
  });

  it("should track spawned processes in SessionProcessRegistry", () => {
    SessionProcessRegistry.register("mock-sess", {
      pid: 12345,
      agent: "claude-code",
    });

    expect(SessionProcessRegistry.has("mock-sess")).toBe(true);
    const reg = SessionProcessRegistry.get("mock-sess");
    expect(reg?.pid).toBe(12345);
    expect(reg?.agent).toBe("claude-code");

    SessionProcessRegistry.unregister("mock-sess");
    expect(SessionProcessRegistry.has("mock-sess")).toBe(false);
  });

  it("should handle REST API control commands via POST /api/control", async () => {
    const { server, close } = createViewerServer(storage, sessionId);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // 1. POST pause command
      const resPause = await fetch(`http://localhost:${port}/api/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", sessionId }),
      });
      expect(resPause.status).toBe(200);
      const dataPause = await resPause.json();
      expect(dataPause.success).toBe(true);
      expect(dataPause.status).toBe("paused");

      // Verify trace event was recorded
      const eventsAfterPause = storage.jsonl.readEvents(sessionId);
      expect(eventsAfterPause.some((e) => e.type === "session_pause")).toBe(true);

      // 2. POST inject prompt command
      const resInject = await fetch(`http://localhost:${port}/api/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inject",
          sessionId,
          message: "Check for regression in parser",
        }),
      });
      expect(resInject.status).toBe(200);
      const dataInject = await resInject.json();
      expect(dataInject.success).toBe(true);

      const eventsAfterInject = storage.jsonl.readEvents(sessionId);
      const injEvent = eventsAfterInject.find((e) => e.type === "injected_prompt");
      expect(injEvent).toBeDefined();
      expect(injEvent?.data?.prompt).toBe("Check for regression in parser");

      // 3. POST resume command
      const resResume = await fetch(`http://localhost:${port}/api/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", sessionId }),
      });
      expect(resResume.status).toBe(200);
      const dataResume = await resResume.json();
      expect(dataResume.success).toBe(true);
      expect(dataResume.status).toBe("active");

      // 4. POST abort command
      const resAbort = await fetch(`http://localhost:${port}/api/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abort", sessionId }),
      });
      expect(resAbort.status).toBe(200);
      const dataAbort = await resAbort.json();
      expect(dataAbort.success).toBe(true);
      expect(dataAbort.status).toBe("aborted");

      const sessionObj = storage.getSession(sessionId);
      expect(sessionObj?.status).toBe("aborted");
    } finally {
      close();
    }
  });

  it("should enforce authentication on /api/control when token option is set", async () => {
    const secretToken = "super-secret-eval-token";
    const { server, close } = createViewerServer(storage, sessionId, { token: secretToken });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // Unauthenticated request -> 401
      const resUnauth = await fetch(`http://localhost:${port}/api/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", sessionId }),
      });
      expect(resUnauth.status).toBe(401);

      // Authenticated with Bearer token -> 200
      const resAuth = await fetch(`http://localhost:${port}/api/control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretToken}`,
        },
        body: JSON.stringify({ action: "pause", sessionId }),
      });
      expect(resAuth.status).toBe(200);
      const data = await resAuth.json();
      expect(data.success).toBe(true);
    } finally {
      close();
    }
  });

  it("should handle bidirectional WebSocket control messages and broadcast events", async () => {
    const { server, close } = createViewerServer(storage, sessionId);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(e);
      });

      // Send inject command via WebSocket
      const ackPromise = new Promise<any>((resolve) => {
        ws.onmessage = (event) => {
          const msg = JSON.parse(String(event.data));
          if (msg.type === "control_ack") {
            resolve(msg);
          }
        };
      });

      ws.send(JSON.stringify({ action: "inject", sessionId, message: "Live prompt via WS" }));
      const ack = await ackPromise;
      expect(ack.success).toBe(true);
      expect(ack.action).toBe("inject");

      // Verify trace event in storage
      const events = storage.jsonl.readEvents(sessionId);
      expect(events.some((e) => e.type === "injected_prompt" && e.data?.prompt === "Live prompt via WS")).toBe(true);

      ws.close();
    } finally {
      close();
    }
  });
});
