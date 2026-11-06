import fs from "node:fs";
import path from "node:path";
import { TraceEvent, TraceSession, GoldenBaseline } from "../types/index.js";
import { JsonlStorage } from "./jsonl.js";
import { SqliteStorage } from "./sqlite.js";
import { GoldenStorage, SaveGoldenOptions } from "./golden.js";

export * from "./jsonl.js";
export * from "./sqlite.js";
export * from "./golden.js";

export interface StorageOptions {
  baseDir?: string;
}

export class StorageManager {
  public readonly baseDir: string;
  public readonly tracesDir: string;
  public readonly goldenDir: string;
  public readonly dbPath: string;
  public readonly jsonl: JsonlStorage;
  public readonly sqlite: SqliteStorage;
  public readonly golden: GoldenStorage;

  constructor(options: StorageOptions = {}) {
    this.baseDir = options.baseDir || path.resolve(process.cwd(), ".traceeval");
    this.tracesDir = path.join(this.baseDir, "traces");
    this.goldenDir = path.join(this.baseDir, "golden");
    this.dbPath = path.join(this.baseDir, "traces.db");

    if (!fs.existsSync(this.tracesDir)) {
      try {
        fs.mkdirSync(this.tracesDir, { recursive: true });
      } catch {
        // Ignore
      }
    }

    this.jsonl = new JsonlStorage(this.tracesDir);
    this.sqlite = new SqliteStorage(this.dbPath);
    this.golden = new GoldenStorage(this.goldenDir);
  }

  isSqliteAvailable(): boolean {
    return this.sqlite.isAvailable();
  }

  recordEvent(event: TraceEvent): void {
    // 1. Dual-write: Always persist to JSONL first
    this.jsonl.appendEvent(event);

    // 2. Dual-write: Persist to SQLite with graceful fallback
    try {
      this.sqlite.insertEvent(event);
    } catch {
      // Continue without failing if SQLite encounters errors
    }
  }

  upsertSession(session: {
    id: string;
    agent?: string;
    startTime?: string;
    endTime?: string;
    durationMs?: number;
    status?: string;
    command?: string;
    prompt?: string;
    metadata?: Record<string, unknown>;
  }): void {
    // Touch session file in JSONL so empty session is tracked even without events
    this.jsonl.touchSession(session.id);

    try {
      this.sqlite.upsertSession(session);
    } catch {
      // Graceful fallback
    }
  }

  getSession(sessionId: string): TraceSession | null {
    let sqliteSession: TraceSession | null = null;
    try {
      sqliteSession = this.sqlite.getSession(sessionId);
    } catch {
      sqliteSession = null;
    }

    // If SQLite returned session with events, return it directly
    if (sqliteSession && sqliteSession.events.length > 0) {
      return sqliteSession;
    }

    // Check JSONL storage as fallback or to see if JSONL has events
    const jsonlSession = this.jsonl.buildSession(sessionId);

    if (sqliteSession) {
      if (jsonlSession && jsonlSession.events.length > 0) {
        // SQLite had metadata but 0 events; JSONL has events: reconcile
        return {
          ...sqliteSession,
          events: jsonlSession.events,
          status:
            jsonlSession.status !== "active"
              ? jsonlSession.status
              : sqliteSession.status,
        };
      }
      return sqliteSession;
    }

    if (jsonlSession) {
      // Auto-heal SQLite cache if SQLite is healthy and missing this session
      if (this.sqlite.isAvailable()) {
        try {
          this.sqlite.upsertSession({
            id: jsonlSession.id,
            agent: jsonlSession.agent,
            startTime: jsonlSession.startTime,
            endTime: jsonlSession.endTime,
            durationMs: jsonlSession.durationMs,
            status: jsonlSession.status,
            command: jsonlSession.command,
            prompt: jsonlSession.prompt,
            metadata: jsonlSession.metadata,
          });
          for (const evt of jsonlSession.events) {
            this.sqlite.insertEvent(evt);
          }
        } catch {
          // Ignore auto-healing errors
        }
      }
      return jsonlSession;
    }

    return null;
  }

  getLatestSession(): TraceSession | null {
    let sqliteLatest: TraceSession | null = null;
    try {
      sqliteLatest = this.sqlite.getLatestSession();
    } catch {
      sqliteLatest = null;
    }

    const jsonlSummaries = this.jsonl.listSessionSummaries();

    if (sqliteLatest && jsonlSummaries.length > 0) {
      const newestJsonl = jsonlSummaries[0];
      const sqliteTime = new Date(sqliteLatest.startTime).getTime();
      const jsonlTime = new Date(newestJsonl.startTime).getTime();

      if (jsonlTime > sqliteTime) {
        return this.getSession(newestJsonl.id);
      }
      return sqliteLatest;
    }

    if (sqliteLatest) {
      return sqliteLatest;
    }

    if (jsonlSummaries.length > 0) {
      return this.getSession(jsonlSummaries[0].id);
    }

    return null;
  }

  listSessions(limit = 20): Array<{
    id: string;
    agent: string;
    startTime: string;
    status: string;
    command?: string;
    eventCount: number;
  }> {
    const sessionMap = new Map<
      string,
      {
        id: string;
        agent: string;
        startTime: string;
        status: string;
        command?: string;
        eventCount: number;
      }
    >();

    // 1. Read SQLite sessions if available
    try {
      const sqliteSessions = this.sqlite.listSessions(limit * 2);
      for (const s of sqliteSessions) {
        sessionMap.set(s.id, s);
      }
    } catch {
      // Fall through to JSONL
    }

    // 2. Discover sessions from JSONL (covers SQLite wiped, missing, or out of sync)
    const jsonlSummaries = this.jsonl.listSessionSummaries();
    for (const js of jsonlSummaries) {
      const existing = sessionMap.get(js.id);
      if (!existing) {
        sessionMap.set(js.id, js);
      } else {
        if (js.eventCount > existing.eventCount) {
          existing.eventCount = js.eventCount;
        }
        if (!existing.command && js.command) {
          existing.command = js.command;
        }
      }
    }

    const all = Array.from(sessionMap.values());
    all.sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    return all.slice(0, limit);
  }

  saveGolden(
    testName: string,
    traceSessionOrBaseline: TraceSession | GoldenBaseline,
    options?: SaveGoldenOptions
  ): GoldenBaseline {
    return this.golden.saveGolden(testName, traceSessionOrBaseline, options);
  }

  getGolden(testName: string): GoldenBaseline | null {
    return this.golden.getGolden(testName);
  }

  listGoldens(): GoldenBaseline[] {
    return this.golden.listGoldens();
  }

  removeGolden(testName: string): boolean {
    return this.golden.removeGolden(testName);
  }

  close(): void {
    try {
      this.sqlite.close();
    } catch {
      // Ignore
    }
  }
}
