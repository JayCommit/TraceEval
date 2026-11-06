import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { StorageManager } from "../src/storage/index.js";
import { TraceSession } from "../src/types/index.js";
import { compareTraces } from "../src/engine/differencer.js";
import { runTracesShow, runTracesDiff } from "../src/commands/traces.js";

describe("Trace Inspection & Differencer", () => {
  let tmpDir: string;
  let storage: StorageManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-traces-test-"));
    storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sessionA: TraceSession = {
    id: "session-a",
    agent: "claude-code",
    startTime: "2026-11-06T00:00:00.000Z",
    endTime: "2026-11-06T00:00:02.000Z",
    status: "completed",
    command: "claude -p 'refactor greeting'",
    prompt: "refactor greeting",
    metadata: {
      cost: 0.015,
      tokens: { total: 1200 },
    },
    events: [
      {
        id: "1",
        sessionId: "session-a",
        timestamp: "2026-11-06T00:00:00.100Z",
        type: "tool_call",
        agent: "claude-code",
        data: { toolName: "ReadFile", input: { path: "src/greet.ts" } },
      },
      {
        id: "2",
        sessionId: "session-a",
        timestamp: "2026-11-06T00:00:01.000Z",
        type: "tool_call",
        agent: "claude-code",
        data: { toolName: "Edit", input: { path: "src/greet.ts" } },
      },
    ],
  };

  const sessionB: TraceSession = {
    id: "session-b",
    agent: "claude-code",
    startTime: "2026-11-06T00:05:00.000Z",
    endTime: "2026-11-06T00:05:03.500Z",
    status: "completed",
    command: "claude -p 'refactor greeting with tests'",
    prompt: "refactor greeting with tests",
    metadata: {
      cost: 0.035,
      tokens: { total: 2500 },
    },
    events: [
      {
        id: "1",
        sessionId: "session-b",
        timestamp: "2026-11-06T00:05:00.200Z",
        type: "tool_call",
        agent: "claude-code",
        data: { toolName: "ReadFile", input: { path: "src/greet.ts" } },
      },
      {
        id: "2",
        sessionId: "session-b",
        timestamp: "2026-11-06T00:05:01.000Z",
        type: "tool_call",
        agent: "claude-code",
        data: { toolName: "Edit", input: { path: "src/greet.ts" } },
      },
      {
        id: "3",
        sessionId: "session-b",
        timestamp: "2026-11-06T00:05:02.000Z",
        type: "tool_call",
        agent: "claude-code",
        data: { toolName: "Bash", input: { command: "npm test" } },
      },
      {
        id: "4",
        sessionId: "session-b",
        timestamp: "2026-11-06T00:05:02.500Z",
        type: "file_change",
        agent: "claude-code",
        data: { path: "src/greet.test.ts", changeType: "created" },
      },
    ],
  };

  describe("compareTraces", () => {
    it("should compute step delta, tool delta, duration, cost, and files touched delta", () => {
      const diff = compareTraces(sessionA, sessionB);

      expect(diff.sessionA.id).toBe("session-a");
      expect(diff.sessionB.id).toBe("session-b");
      expect(diff.stepDelta).toBe(1); // 2 steps -> 3 steps
      expect(diff.stepPercentDelta).toBe(50); // +50%
      expect(diff.toolsAdded).toContain("Bash");
      expect(diff.toolDeltas["Bash"].delta).toBe(1);
      expect(diff.toolDeltas["Edit"].delta).toBe(0);
      expect(diff.costDelta).toBe(0.02); // $0.035 - $0.015
      expect(diff.filesAdded).toContain("src/greet.test.ts");
      expect(diff.filesShared).toContain("src/greet.ts");
    });
  });

  describe("runTracesShow & runTracesDiff CLI commands", () => {
    it("should format timeline and metrics without errors", () => {
      // Save sessions
      storage.upsertSession({
        id: sessionA.id,
        agent: sessionA.agent,
        startTime: sessionA.startTime,
        endTime: sessionA.endTime,
        status: sessionA.status,
        prompt: sessionA.prompt,
        metadata: sessionA.metadata,
      });
      for (const e of sessionA.events) {
        storage.recordEvent(e);
      }

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Use a custom cwd storage setup
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        runTracesShow(sessionA.id);
        expect(logSpy).toHaveBeenCalled();
      } finally {
        process.chdir(origCwd);
        logSpy.mockRestore();
      }
    });

    it("should execute runTracesDiff comparing two sessions", () => {
      storage.upsertSession({
        id: sessionA.id,
        agent: sessionA.agent,
        startTime: sessionA.startTime,
        endTime: sessionA.endTime,
        status: sessionA.status,
      });
      for (const e of sessionA.events) storage.recordEvent(e);

      storage.upsertSession({
        id: sessionB.id,
        agent: sessionB.agent,
        startTime: sessionB.startTime,
        endTime: sessionB.endTime,
        status: sessionB.status,
      });
      for (const e of sessionB.events) storage.recordEvent(e);

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        runTracesDiff(sessionA.id, sessionB.id);
        expect(logSpy).toHaveBeenCalled();
      } finally {
        process.chdir(origCwd);
        logSpy.mockRestore();
      }
    });
  });
});
