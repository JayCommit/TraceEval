import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { StorageManager } from "../src/storage/index.js";
import { createViewerServer } from "../src/commands/view.js";
import { generateArenaHtml } from "../src/viewer/html.js";

describe("Live Real-Time Viewer Server & SSE Streaming", () => {
  let tmpDir: string;
  let storage: StorageManager;
  const sessionId = "test-live-stream-sess";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-live-test-"));
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

  it("should serve HTML on GET / and return session JSON on GET /api/session", async () => {
    const { server, close } = createViewerServer(storage, sessionId);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // 1. Test GET /
      const resHtml = await fetch(`http://localhost:${port}/`);
      expect(resHtml.status).toBe(200);
      expect(resHtml.headers.get("content-type")).toContain("text/html");
      const htmlText = await resHtml.text();
      expect(htmlText).toContain("TraceEval");
      expect(htmlText).toContain(sessionId);
      expect(htmlText).toContain("cursor");
      expect(htmlText).toContain("EventSource");

      // 2. Test GET /api/session
      const resJson = await fetch(`http://localhost:${port}/api/session`);
      expect(resJson.status).toBe(200);
      const json = await resJson.json();
      expect(json.id).toBe(sessionId);
      expect(json.agent).toBe("cursor");
    } finally {
      close();
    }
  });

  it("should stream newly recorded events to connected SSE client", async () => {
    const { server, close } = createViewerServer(storage, sessionId);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // Connect to SSE stream
      const sseEvents: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          expect(res.headers["content-type"]).toBe("text/event-stream");

          res.on("data", (chunk) => {
            const text = chunk.toString();
            sseEvents.push(text);
            if (text.includes("test_tool_live")) {
              req.destroy();
              resolve();
            }
          });

          // Once connected, record a new event into storage
          setTimeout(() => {
            storage.recordEvent({
              id: "evt-live-1",
              sessionId,
              timestamp: new Date().toISOString(),
              type: "tool_call",
              agent: "cursor",
              data: {
                toolName: "test_tool_live",
                output: "Success live result",
                durationMs: 50,
              },
            });
          }, 300);
        });

        req.on("error", (err) => {
          if (!sseEvents.some((e) => e.includes("test_tool_live"))) {
            reject(err);
          }
        });

        setTimeout(() => {
          if (!sseEvents.some((e) => e.includes("test_tool_live"))) {
            req.destroy();
            resolve();
          }
        }, 2000);
      });

      const allOutput = sseEvents.join("");
      expect(allOutput).toContain("trace_event");
      expect(allOutput).toContain("test_tool_live");
      expect(allOutput).toContain("Success live result");
    } finally {
      close();
    }
  });

  it("should enforce token authentication when token option is provided", async () => {
    const secretToken = "my-secret-test-token-123";
    const { server, close } = createViewerServer(storage, sessionId, { token: secretToken });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // 1. Request without token should be rejected with 401
      const resUnauthorized = await fetch(`http://localhost:${port}/`);
      expect(resUnauthorized.status).toBe(401);
      const errText = await resUnauthorized.text();
      expect(errText).toContain("401 Unauthorized");
      expect(errText).toContain("access token is required");

      // 2. Request with invalid token should be rejected with 401
      const resBadToken = await fetch(`http://localhost:${port}/?token=wrong-token`);
      expect(resBadToken.status).toBe(401);

      // 3. Request with valid query parameter token should succeed with 200
      const resValidQuery = await fetch(`http://localhost:${port}/?token=${secretToken}`);
      expect(resValidQuery.status).toBe(200);
      const htmlText = await resValidQuery.text();
      expect(htmlText).toContain("TraceEval");

      // 4. Request with valid Bearer authorization header should succeed with 200
      const resValidHeader = await fetch(`http://localhost:${port}/api/session`, {
        headers: { Authorization: `Bearer ${secretToken}` },
      });
      expect(resValidHeader.status).toBe(200);
    } finally {
      close();
    }
  });

  it("should stream diff events containing split view and toggle markup in SSE payload", async () => {
    const { server, close } = createViewerServer(storage, sessionId);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const sseEvents: string[] = [];

      await new Promise<void>((resolve) => {
        const req = http.get(`http://localhost:${port}/events`, (res) => {
          res.on("data", (chunk) => {
            const text = chunk.toString();
            sseEvents.push(text);
            if (text.includes("diff-split-container")) {
              req.destroy();
              resolve();
            }
          });

          // Stream a file editing tool call with diff
          setTimeout(() => {
            storage.recordEvent({
              id: "evt-diff-stream",
              sessionId,
              timestamp: new Date().toISOString(),
              type: "tool_call",
              agent: "cursor",
              data: {
                toolName: "str_replace_editor",
                input: {
                  path: "src/user.ts",
                  old_str: "const active = false;",
                  new_str: "const active = true;",
                },
                status: "success",
              },
            });
          }, 300);
        });

        setTimeout(() => {
          req.destroy();
          resolve();
        }, 2500);
      });

      const output = sseEvents.join("");
      expect(output).toContain("diff-split-container");
      expect(output).toContain("diff-toggle-btn");
      expect(output).toContain("split-del");
      expect(output).toContain("split-add");
    } finally {
      close();
    }
  });

  it("should serve Multi-Agent Arena layout when initialized with multiple sessions", async () => {
    const sessionB = "test-session-agent-b";
    storage.upsertSession({
      id: sessionB,
      agent: "claude-code",
      startTime: new Date().toISOString(),
      status: "completed",
    });

    const { server, close } = createViewerServer(storage, [sessionId, sessionB]);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // 1. GET / should return Arena mode
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("TraceEval ⚔️ Arena");
      expect(html).toContain("cursor");
      expect(html).toContain("claude-code");
      expect(html).toContain(`pane-${sessionId}`);
      expect(html).toContain(`pane-${sessionB}`);
      expect(html).toContain("arena-scoreboard");
      expect(html).toContain("Direct Head-to-Head Delta");

      // 2. GET /api/sessions should list all recorded sessions
      const resList = await fetch(`http://localhost:${port}/api/sessions`);
      expect(resList.status).toBe(200);
      const list = await resList.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((s: any) => s.id === sessionId)).toBe(true);
      expect(list.some((s: any) => s.id === sessionB)).toBe(true);
    } finally {
      close();
    }
  });

  it("should switch between single session and arena mode via ?sessions query param", async () => {
    const session2 = "sess-param-switch-2";
    storage.upsertSession({
      id: session2,
      agent: "openai",
      startTime: new Date().toISOString(),
      status: "completed",
    });

    const { server, close } = createViewerServer(storage, sessionId);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // Single session default
      const resSingle = await fetch(`http://localhost:${port}/`);
      const singleHtml = await resSingle.text();
      expect(singleHtml).toContain("Arena Mode (Compare Agents)");
      expect(singleHtml).not.toContain('class="arena-columns"');

      // Query param activates Arena
      const resArena = await fetch(`http://localhost:${port}/?sessions=${sessionId},${session2}`);
      const arenaHtml = await resArena.text();
      expect(arenaHtml).toContain("TraceEval ⚔️ Arena");
      expect(arenaHtml).toContain('class="arena-columns"');
      expect(arenaHtml).toContain("cursor");
      expect(arenaHtml).toContain("openai");
    } finally {
      close();
    }
  });

  it("should generate static Multi-Agent Arena HTML correctly via generateArenaHtml", () => {
    const sessA = {
      id: "agent-a-sess",
      agent: "claude-code",
      startTime: new Date().toISOString(),
      status: "completed" as const,
      events: [],
    };
    const sessB = {
      id: "agent-b-sess",
      agent: "cursor",
      startTime: new Date().toISOString(),
      status: "completed" as const,
      events: [],
    };

    const html = generateArenaHtml([sessA, sessB]);
    expect(html).toContain("TraceEval ⚔️ Arena");
    expect(html).toContain("agent-a-sess");
    expect(html).toContain("agent-b-sess");
    expect(html).toContain("arena-scoreboard");
    expect(html).toContain("Direct Head-to-Head Delta");
  });
});
