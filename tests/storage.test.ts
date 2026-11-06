import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonlStorage } from "../src/storage/jsonl.js";
import { SqliteStorage } from "../src/storage/sqlite.js";
import { StorageManager } from "../src/storage/index.js";
import { TraceEvent } from "../src/types/index.js";

describe("Storage Layer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-storage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("JsonlStorage should append and read back events", () => {
    const tracesDir = path.join(tmpDir, "traces");
    const jsonl = new JsonlStorage(tracesDir);

    const event1: TraceEvent = {
      id: "evt-1",
      sessionId: "session-abc",
      timestamp: new Date().toISOString(),
      type: "session_start",
      agent: "claude-code",
      data: { command: "test" },
    };

    const event2: TraceEvent = {
      id: "evt-2",
      sessionId: "session-abc",
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agent: "claude-code",
      data: { toolName: "Edit", input: { file: "foo.ts" } },
    };

    jsonl.appendEvent(event1);
    jsonl.appendEvent(event2);

    const read = jsonl.readEvents("session-abc");
    expect(read).toHaveLength(2);
    expect(read[0].id).toBe("evt-1");
    expect(read[1].type).toBe("tool_call");
    expect(read[1].data.toolName).toBe("Edit");

    const sessionIds = jsonl.listSessionIds();
    expect(sessionIds).toContain("session-abc");
  });

  it("SqliteStorage should persist sessions and query indexed events", () => {
    const dbPath = path.join(tmpDir, "traces.db");
    const sqlite = new SqliteStorage(dbPath);

    sqlite.upsertSession({
      id: "sess-1",
      agent: "claude-code",
      command: "claude -p 'fix test'",
      status: "active",
    });

    const event: TraceEvent = {
      id: "evt-sqlite-1",
      sessionId: "sess-1",
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agent: "claude-code",
      data: { toolName: "Bash", status: "success" },
    };

    sqlite.insertEvent(event);

    const session = sqlite.getSession("sess-1");
    expect(session).not.toBeNull();
    expect(session?.id).toBe("sess-1");
    expect(session?.events).toHaveLength(1);
    expect(session?.events[0].data.toolName).toBe("Bash");

    const latest = sqlite.getLatestSession();
    expect(latest?.id).toBe("sess-1");

    const list = sqlite.listSessions(10);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBe("sess-1");
    expect(list[0].eventCount).toBe(1);

    sqlite.close();
  });

  it("StorageManager should coordinate dual writing", () => {
    const manager = new StorageManager({ baseDir: tmpDir });

    const event: TraceEvent = {
      id: "evt-dual-1",
      sessionId: "sess-dual",
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agent: "claude-code",
      data: { toolName: "Edit" },
    };

    manager.recordEvent(event);

    const session = manager.getSession("sess-dual");
    expect(session).not.toBeNull();
    expect(session?.events).toHaveLength(1);

    // Verify JSONL file was also created
    const jsonlPath = path.join(tmpDir, "traces", "sess-dual.jsonl");
    expect(fs.existsSync(jsonlPath)).toBe(true);

    manager.close();
  });

  it("StorageManager handles empty sessions without events", () => {
    const manager = new StorageManager({ baseDir: tmpDir });

    manager.upsertSession({
      id: "empty-session-1",
      agent: "claude-code",
      command: "npm test",
      status: "active",
    });

    const session = manager.getSession("empty-session-1");
    expect(session).not.toBeNull();
    expect(session?.id).toBe("empty-session-1");
    expect(session?.events).toHaveLength(0);
    expect(session?.command).toBe("npm test");

    const list = manager.listSessions(10);
    const found = list.find((s) => s.id === "empty-session-1");
    expect(found).toBeDefined();
    expect(found?.eventCount).toBe(0);

    // Also test an empty file directly in JSONL (0 events)
    const jsonlPath = path.join(tmpDir, "traces", "empty-direct.jsonl");
    fs.writeFileSync(jsonlPath, "", "utf-8");

    const directSession = manager.getSession("empty-direct");
    expect(directSession).not.toBeNull();
    expect(directSession?.id).toBe("empty-direct");
    expect(directSession?.events).toHaveLength(0);

    manager.close();
  });

  it("StorageManager automatically creates directories recursively", () => {
    const deepDir = path.join(tmpDir, "a", "b", "c", ".traceeval");
    expect(fs.existsSync(deepDir)).toBe(false);

    const manager = new StorageManager({ baseDir: deepDir });
    expect(fs.existsSync(path.join(deepDir, "traces"))).toBe(true);

    const event: TraceEvent = {
      id: "evt-deep-1",
      sessionId: "sess-deep",
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agent: "claude-code",
      data: { toolName: "Bash" },
    };

    manager.recordEvent(event);
    expect(fs.existsSync(path.join(deepDir, "traces", "sess-deep.jsonl"))).toBe(true);

    // Test deleting tracesDir mid-flight: recordEvent should recreate it recursively
    fs.rmSync(path.join(deepDir, "traces"), { recursive: true, force: true });
    expect(fs.existsSync(path.join(deepDir, "traces"))).toBe(false);

    manager.recordEvent({
      ...event,
      id: "evt-deep-2",
    });
    expect(fs.existsSync(path.join(deepDir, "traces", "sess-deep.jsonl"))).toBe(true);

    manager.close();
  });

  it("StorageManager reads sessions that exist only in JSONL when SQLite is wiped", () => {
    const manager = new StorageManager({ baseDir: tmpDir });

    const startTime = "2026-11-06T00:00:00.000Z";
    const endTime = "2026-11-06T00:00:05.000Z";

    manager.recordEvent({
      id: "evt-wipe-1",
      sessionId: "sess-jsonl-only",
      timestamp: startTime,
      type: "session_start",
      agent: "claude-code",
      data: { command: "build", prompt: "Fix authentication" },
    });

    manager.recordEvent({
      id: "evt-wipe-2",
      sessionId: "sess-jsonl-only",
      timestamp: endTime,
      type: "session_end",
      agent: "claude-code",
      data: { exitCode: 0, durationMs: 5000 },
    });

    manager.close();

    // Wipe SQLite files completely
    for (const file of fs.readdirSync(tmpDir)) {
      if (file.startsWith("traces.db")) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
    expect(fs.existsSync(path.join(tmpDir, "traces.db"))).toBe(false);

    // Open a fresh StorageManager without existing SQLite database
    const newManager = new StorageManager({ baseDir: tmpDir });

    // 1. getSession fallback to JSONL
    const session = newManager.getSession("sess-jsonl-only");
    expect(session).not.toBeNull();
    expect(session?.id).toBe("sess-jsonl-only");
    expect(session?.agent).toBe("claude-code");
    expect(session?.status).toBe("completed");
    expect(session?.command).toBe("build");
    expect(session?.prompt).toBe("Fix authentication");
    expect(session?.events).toHaveLength(2);

    // 2. listSessions fallback to JSONL
    const list = newManager.listSessions();
    expect(list.length).toBeGreaterThan(0);
    const item = list.find((s) => s.id === "sess-jsonl-only");
    expect(item).toBeDefined();
    expect(item?.eventCount).toBe(2);
    expect(item?.status).toBe("completed");
    expect(item?.command).toBe("build");

    // 3. getLatestSession fallback to JSONL
    const latest = newManager.getLatestSession();
    expect(latest?.id).toBe("sess-jsonl-only");

    newManager.close();
  });

  it("SqliteStorage recovers gracefully from corrupted database files", () => {
    const dbPath = path.join(tmpDir, "corrupt-traces.db");
    fs.writeFileSync(dbPath, "NOT A VALID SQLITE DATABASE FILE HEADER OR CONTENTS", "utf-8");

    // SqliteStorage should quarantine the corrupted db and initialize a fresh one
    const sqlite = new SqliteStorage(dbPath);
    expect(sqlite.isAvailable()).toBe(true);

    // Corrupted file backup should exist
    const files = fs.readdirSync(tmpDir);
    const backup = files.find((f) => f.includes("corrupt-traces.db.corrupt"));
    expect(backup).toBeDefined();

    // Queries should work normally on the fresh db
    sqlite.upsertSession({ id: "recovered-sess", agent: "claude-code" });
    const sess = sqlite.getSession("recovered-sess");
    expect(sess?.id).toBe("recovered-sess");

    sqlite.close();
  });

  it("handles concurrent and rapid successive writes safely", async () => {
    const manager = new StorageManager({ baseDir: tmpDir });
    const sessionId = "sess-concurrent";
    const totalEvents = 60;

    manager.upsertSession({
      id: sessionId,
      agent: "claude-code",
      command: "npm run stress",
      status: "active",
    });

    const writePromises = Array.from({ length: totalEvents }, (_, i) => {
      return Promise.resolve().then(() => {
        manager.recordEvent({
          id: `evt-concurrent-${i}`,
          sessionId,
          timestamp: new Date(Date.now() + i).toISOString(),
          type: "tool_call",
          agent: "claude-code",
          data: { toolName: `tool-${i % 5}`, index: i },
        });
      });
    });

    await Promise.all(writePromises);

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.events).toHaveLength(totalEvents);

    // Verify all event IDs are accounted for in JSONL
    const jsonl = new JsonlStorage(path.join(tmpDir, "traces"));
    const jsonlEvents = jsonl.readEvents(sessionId);
    expect(jsonlEvents).toHaveLength(totalEvents);

    manager.close();
  });

  it("skips invalid JSON lines, empty lines, and malformed schemas gracefully in JSONL", () => {
    const tracesDir = path.join(tmpDir, "traces");
    const jsonl = new JsonlStorage(tracesDir);
    const sessionId = "sess-malformed";
    const filePath = jsonl.getSessionFilePath(sessionId);

    // Construct raw file with valid and invalid lines interleaved
    const validEvent1: TraceEvent = {
      id: "evt-good-1",
      sessionId,
      timestamp: "2026-11-06T00:00:01Z",
      type: "session_start",
      agent: "claude-code",
      data: { command: "start" },
    };

    const validEvent2: TraceEvent = {
      id: "evt-good-2",
      sessionId,
      timestamp: "2026-11-06T00:00:02Z",
      type: "tool_call",
      agent: "claude-code",
      data: { toolName: "Edit" },
    };

    const lines = [
      JSON.stringify(validEvent1),
      "", // empty line
      "   ", // whitespace line
      "BROKEN NOT JSON {[[[",
      '{"id": "incomplete-json',
      '{"foo": "valid json but missing all required trace event fields"}',
      '{"id": 123, "sessionId": true, "type": "unknown_event_type"}',
      JSON.stringify(validEvent2),
    ].join("\n") + "\n";

    fs.writeFileSync(filePath, lines, "utf-8");

    const events = jsonl.readEvents(sessionId);
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("evt-good-1");
    expect(events[1].id).toBe("evt-good-2");

    // Also verify StorageManager can build session from it
    const manager = new StorageManager({ baseDir: tmpDir });
    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.events).toHaveLength(2);
    expect(session?.events[0].id).toBe("evt-good-1");
    expect(session?.events[1].id).toBe("evt-good-2");

    manager.close();
  });

  it("persists and lists traces reliably across process restarts and distinct sessions", () => {
    // Process 1: Record session 1
    const p1 = new StorageManager({ baseDir: tmpDir });
    p1.upsertSession({
      id: "sess-p1",
      agent: "claude-code",
      command: "test 1",
      startTime: "2026-11-06T01:00:00Z",
    });
    p1.recordEvent({
      id: "evt-p1-1",
      sessionId: "sess-p1",
      timestamp: "2026-11-06T01:00:00Z",
      type: "session_start",
      agent: "claude-code",
      data: { command: "test 1" },
    });
    p1.recordEvent({
      id: "evt-p1-2",
      sessionId: "sess-p1",
      timestamp: "2026-11-06T01:00:01Z",
      type: "tool_call",
      agent: "claude-code",
      data: { toolName: "Bash" },
    });
    p1.close();

    // Process 2: Record session 2
    const p2 = new StorageManager({ baseDir: tmpDir });
    p2.upsertSession({
      id: "sess-p2",
      agent: "claude-code",
      command: "test 2",
      startTime: "2026-11-06T02:00:00Z",
    });
    p2.recordEvent({
      id: "evt-p2-1",
      sessionId: "sess-p2",
      timestamp: "2026-11-06T02:00:00Z",
      type: "session_start",
      agent: "claude-code",
      data: { command: "test 2" },
    });
    p2.close();

    // Process 3: Query traces across both sessions
    const p3 = new StorageManager({ baseDir: tmpDir });
    const sessions = p3.listSessions(10);
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    const s1 = sessions.find((s) => s.id === "sess-p1");
    const s2 = sessions.find((s) => s.id === "sess-p2");
    expect(s1).toBeDefined();
    expect(s1?.eventCount).toBe(2);
    expect(s2).toBeDefined();
    expect(s2?.eventCount).toBe(1);

    const sess1 = p3.getSession("sess-p1");
    expect(sess1?.events).toHaveLength(2);

    const sess2 = p3.getSession("sess-p2");
    expect(sess2?.events).toHaveLength(1);

    const latest = p3.getLatestSession();
    expect(latest?.id).toBe("sess-p2");

    p3.close();
  });
});
