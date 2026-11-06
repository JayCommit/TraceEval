import fs from "node:fs";
import path from "node:path";
import { TraceEvent, TraceEventSchema, TraceSession } from "../types/index.js";

export class JsonlStorage {
  private tracesDir: string;

  constructor(tracesDir: string) {
    this.tracesDir = tracesDir;
    this.ensureDir();
  }

  public ensureDir(): void {
    if (!fs.existsSync(this.tracesDir)) {
      try {
        fs.mkdirSync(this.tracesDir, { recursive: true });
      } catch {
        // Ignore if created concurrently
      }
    }
  }

  public getSessionFilePath(sessionId: string): string {
    // Sanitize sessionId for filesystem
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.tracesDir, `${safeId}.jsonl`);
  }

  public hasSession(sessionId: string): boolean {
    const filePath = this.getSessionFilePath(sessionId);
    return fs.existsSync(filePath);
  }

  public touchSession(sessionId: string): void {
    this.ensureDir();
    const filePath = this.getSessionFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(filePath, "", { flag: "a", encoding: "utf-8" });
      } catch {
        // Ignore if error or concurrent creation
      }
    }
  }

  appendEvent(event: TraceEvent): void {
    this.ensureDir();
    const filePath = this.getSessionFilePath(event.sessionId);
    const line = JSON.stringify(event) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");
  }

  readEvents(sessionId: string): TraceEvent[] {
    const filePath = this.getSessionFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return [];
    }

    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const events: TraceEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const validated = TraceEventSchema.parse(parsed);
        events.push(validated);
      } catch {
        // Skip malformed or non-conforming lines gracefully
      }
    }

    return events;
  }

  buildSession(sessionId: string): TraceSession | null {
    const filePath = this.getSessionFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const events = this.readEvents(sessionId);
    let fileTime = new Date().toISOString();
    try {
      const stat = fs.statSync(filePath);
      const birthMs = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs;
      fileTime = new Date(birthMs > 0 ? birthMs : stat.mtimeMs).toISOString();
    } catch {
      // Fallback to now
    }

    if (events.length === 0) {
      return {
        id: sessionId,
        agent: "claude-code",
        startTime: fileTime,
        status: "active",
        events: [],
      };
    }

    const startEvent = events.find((e) => e.type === "session_start");
    const endEvent = events.find((e) => e.type === "session_end");
    const promptEvent = events.find((e) => e.type === "user_prompt");

    const first = events[0];
    const last = events[events.length - 1];

    const agent = startEvent?.agent || first.agent || "claude-code";
    const startTime = startEvent?.timestamp || first.timestamp || fileTime;
    const endTime = endEvent?.timestamp || (endEvent ? last.timestamp : undefined);
    const durationMs =
      (endEvent?.data?.durationMs as number | undefined) ??
      (endTime
        ? Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime())
        : undefined);

    let status: "active" | "completed" | "error" = "active";
    if (endEvent) {
      const exitCode = endEvent.data?.exitCode;
      status = exitCode === 0 || exitCode === undefined ? "completed" : "error";
    }

    const command = (startEvent?.data?.command as string | undefined) || undefined;
    const prompt =
      (startEvent?.data?.prompt as string | undefined) ||
      (promptEvent?.data?.prompt as string | undefined) ||
      undefined;

    return {
      id: sessionId,
      agent,
      startTime,
      endTime,
      durationMs,
      status,
      command,
      prompt,
      events,
    };
  }

  getSessionSummary(sessionId: string): {
    id: string;
    agent: string;
    startTime: string;
    status: string;
    command?: string;
    eventCount: number;
  } | null {
    const session = this.buildSession(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      agent: session.agent,
      startTime: session.startTime,
      status: session.status,
      command: session.command,
      eventCount: session.events.length,
    };
  }

  listSessionIds(): string[] {
    if (!fs.existsSync(this.tracesDir)) {
      return [];
    }
    try {
      const files = fs.readdirSync(this.tracesDir);
      return files
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => file.replace(/\.jsonl$/, ""));
    } catch {
      return [];
    }
  }

  listSessionSummaries(): Array<{
    id: string;
    agent: string;
    startTime: string;
    status: string;
    command?: string;
    eventCount: number;
  }> {
    const ids = this.listSessionIds();
    const summaries: Array<{
      id: string;
      agent: string;
      startTime: string;
      status: string;
      command?: string;
      eventCount: number;
    }> = [];

    for (const id of ids) {
      const summary = this.getSessionSummary(id);
      if (summary) {
        summaries.push(summary);
      }
    }

    summaries.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    return summaries;
  }
}
