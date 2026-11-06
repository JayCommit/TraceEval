import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TraceEvent, TraceSession } from "../types/index.js";

export class SqliteStorage {
  private db: DatabaseSync | null = null;
  public readonly dbPath: string;
  private available = false;
  private isClosed = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.initialize();
  }

  public isAvailable(): boolean {
    return this.available && !this.isClosed && this.db !== null;
  }

  private initialize(): void {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.openAndSetup();
    } catch {
      this.available = false;
    }
  }

  private openAndSetup(): void {
    try {
      this.db = new DatabaseSync(this.dbPath);
      this.setupPragmas();
      this.initSchema();
      this.available = true;
    } catch (err) {
      if (this.db) {
        try {
          this.db.close();
        } catch {
          // Ignore
        }
        this.db = null;
      }

      // If database file appears corrupted or unreadable as SQLite, quarantine and recreate
      if (fs.existsSync(this.dbPath) && this.dbPath !== ":memory:") {
        try {
          const corruptBackup = `${this.dbPath}.corrupt.${Date.now()}`;
          fs.renameSync(this.dbPath, corruptBackup);
          this.db = new DatabaseSync(this.dbPath);
          this.setupPragmas();
          this.initSchema();
          this.available = true;
          return;
        } catch {
          this.available = false;
        }
      } else {
        this.available = false;
      }
    }
  }

  private setupPragmas(): void {
    if (!this.db) return;
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA busy_timeout = 5000;");
      this.db.exec("PRAGMA synchronous = NORMAL;");
    } catch {
      // Pragmas may not apply in all environments (e.g. memory)
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        command TEXT,
        prompt TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        tool_name TEXT,
        agent TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
    `);
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
  }): boolean {
    if (!this.isAvailable() || !this.db) return false;

    try {
      const existing = this.db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(session.id) as Record<string, unknown> | undefined;

      const now = Date.now();
      const agent = session.agent ?? (existing?.agent as string) ?? "claude-code";
      const startTime =
        session.startTime ??
        (existing?.start_time as string) ??
        new Date().toISOString();
      const endTime = session.endTime ?? (existing?.end_time as string) ?? null;
      const durationMs =
        session.durationMs ?? (existing?.duration_ms as number) ?? null;
      const status =
        session.status ?? (existing?.status as string) ?? "active";
      const command =
        session.command ?? (existing?.command as string) ?? null;
      const prompt = session.prompt ?? (existing?.prompt as string) ?? null;
      const metadataJson = session.metadata
        ? JSON.stringify(session.metadata)
        : (existing?.metadata_json as string) ?? null;

      if (existing) {
        const stmt = this.db.prepare(`
          UPDATE sessions
          SET agent = ?, start_time = ?, end_time = ?, duration_ms = ?, status = ?, command = ?, prompt = ?, metadata_json = ?
          WHERE id = ?
        `);
        stmt.run(
          agent,
          startTime,
          endTime,
          durationMs,
          status,
          command,
          prompt,
          metadataJson,
          session.id
        );
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO sessions (id, agent, start_time, end_time, duration_ms, status, command, prompt, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          session.id,
          agent,
          startTime,
          endTime,
          durationMs,
          status,
          command,
          prompt,
          metadataJson,
          now
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  insertEvent(event: TraceEvent): boolean {
    if (!this.isAvailable() || !this.db) return false;

    try {
      // Ensure session exists
      this.upsertSession({ id: event.sessionId, agent: event.agent });

      const toolName =
        (event.data?.toolName as string) ||
        (event.data?.tool as string) ||
        null;

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO events (id, session_id, timestamp, type, tool_name, agent, data_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        event.id,
        event.sessionId,
        event.timestamp,
        event.type,
        toolName,
        event.agent,
        JSON.stringify(event.data || {}),
        Date.now()
      );
      return true;
    } catch {
      return false;
    }
  }

  getEvents(sessionId: string): TraceEvent[] {
    if (!this.isAvailable() || !this.db) return [];

    try {
      const rows = this.db
        .prepare(
          "SELECT id, session_id, timestamp, type, agent, data_json FROM events WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC"
        )
        .all(sessionId) as Array<{
        id: string;
        session_id: string;
        timestamp: string;
        type: string;
        agent: string;
        data_json: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        timestamp: r.timestamp,
        type: r.type as TraceEvent["type"],
        agent: r.agent,
        data: JSON.parse(r.data_json || "{}"),
      }));
    } catch {
      return [];
    }
  }

  getSession(sessionId: string): TraceSession | null {
    if (!this.isAvailable() || !this.db) return null;

    try {
      const row = this.db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(sessionId) as Record<string, unknown> | undefined;

      if (!row) return null;

      const events = this.getEvents(sessionId);
      return {
        id: row.id as string,
        agent: row.agent as string,
        startTime: row.start_time as string,
        endTime: (row.end_time as string) || undefined,
        durationMs: (row.duration_ms as number) || undefined,
        status: (row.status as "active" | "completed" | "error") || "active",
        command: (row.command as string) || undefined,
        prompt: (row.prompt as string) || undefined,
        events,
        metadata: row.metadata_json
          ? JSON.parse(row.metadata_json as string)
          : undefined,
      };
    } catch {
      return null;
    }
  }

  getLatestSession(): TraceSession | null {
    if (!this.isAvailable() || !this.db) return null;

    try {
      const row = this.db
        .prepare("SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1")
        .get() as { id: string } | undefined;

      if (!row) return null;
      return this.getSession(row.id);
    } catch {
      return null;
    }
  }

  listSessions(limit = 20): Array<{
    id: string;
    agent: string;
    startTime: string;
    status: string;
    command?: string;
    eventCount: number;
  }> {
    if (!this.isAvailable() || !this.db) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT s.id, s.agent, s.start_time, s.status, s.command, COUNT(e.id) as event_count
           FROM sessions s
           LEFT JOIN events e ON s.id = e.session_id
           GROUP BY s.id
           ORDER BY s.created_at DESC
           LIMIT ?`
        )
        .all(limit) as Array<{
        id: string;
        agent: string;
        start_time: string;
        status: string;
        command: string | null;
        event_count: number;
      }>;

      return rows.map((r) => ({
        id: r.id,
        agent: r.agent,
        startTime: r.start_time,
        status: r.status,
        command: r.command || undefined,
        eventCount: Number(r.event_count || 0),
      }));
    } catch {
      return [];
    }
  }

  close(): void {
    if (this.isClosed || !this.db) {
      this.isClosed = true;
      this.available = false;
      return;
    }
    try {
      this.isClosed = true;
      this.available = false;
      this.db.close();
      this.db = null;
    } catch {
      // Ignore
    }
  }
}
