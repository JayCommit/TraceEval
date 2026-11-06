import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { StorageManager } from "../src/storage/index.js";
import { createViewerServer } from "../src/commands/view.js";

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
});
