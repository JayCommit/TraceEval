import fs from "node:fs";
import path from "node:path";
import {
  GoldenBaseline,
  GoldenBaselineSchema,
  TraceSession,
  TraceEvent,
} from "../types/index.js";
import { getDistinctToolCalls } from "../engine/assertions/utils.js";

/**
 * Normalizes a test name or file path into a filesystem-safe slug.
 */
export function testNameToSlug(name: string): string {
  let clean = path.basename(name).replace(/\.(yaml|yml|json)$/i, "").trim();
  clean = clean.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "unnamed-test";
}

/**
 * Extracts list of unique files referenced/touched in a trace session.
 */
export function extractFilesTouched(session: TraceSession): string[] {
  const files = new Set<string>();

  for (const event of session.events) {
    if (event.type === "file_change" && event.data) {
      const p = (event.data.path || event.data.file || event.data.filePath) as string | undefined;
      if (typeof p === "string" && p.trim()) {
        files.add(p.trim());
      }
    }

    if (
      (event.type === "tool_call" || event.type === "tool_call_start") &&
      event.data
    ) {
      const input = (event.data.input || event.data.tool_input) as
        | Record<string, unknown>
        | string
        | undefined;

      if (typeof input === "object" && input !== null) {
        const filePath = (input.file_path ||
          input.filePath ||
          input.path ||
          input.file ||
          input.target ||
          input.filename) as string | undefined;

        if (typeof filePath === "string" && filePath.trim()) {
          files.add(filePath.trim());
        }
      }
    }
  }

  return Array.from(files).sort();
}

/**
 * Calculates total session duration in milliseconds.
 */
export function calculateSessionDuration(session: TraceSession): number {
  if (typeof session.durationMs === "number" && session.durationMs > 0) {
    return session.durationMs;
  }

  if (session.startTime && session.endTime) {
    const diff = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
    if (!isNaN(diff) && diff >= 0) {
      return diff;
    }
  }

  if (session.events.length >= 2) {
    const first = new Date(session.events[0].timestamp).getTime();
    const last = new Date(session.events[session.events.length - 1].timestamp).getTime();
    const diff = last - first;
    if (!isNaN(diff) && diff >= 0) {
      return diff;
    }
  }

  return 0;
}

export interface SaveGoldenOptions {
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  snapshotMetadata?: Record<string, unknown>;
}

export class GoldenStorage {
  public readonly goldenDir: string;

  constructor(goldenDir: string) {
    this.goldenDir = goldenDir;
    this.ensureDir();
  }

  public ensureDir(): void {
    if (!fs.existsSync(this.goldenDir)) {
      try {
        fs.mkdirSync(this.goldenDir, { recursive: true });
      } catch {
        // Ignore concurrent creation
      }
    }
  }

  public getGoldenPath(testName: string): string {
    const slug = testNameToSlug(testName);
    return path.join(this.goldenDir, `${slug}.json`);
  }

  /**
   * Blesses and saves a trace session (or baseline object) as the golden standard for a test.
   */
  public saveGolden(
    testName: string,
    traceSessionOrBaseline: TraceSession | GoldenBaseline,
    options?: SaveGoldenOptions
  ): GoldenBaseline {
    this.ensureDir();

    let baseline: GoldenBaseline;

    // Check if input is already a complete GoldenBaseline
    if ("stepCount" in traceSessionOrBaseline && "toolCallBreakdown" in traceSessionOrBaseline) {
      baseline = {
        ...(traceSessionOrBaseline as GoldenBaseline),
        testName,
        createdAt: new Date().toISOString(),
      };
    } else {
      const traceSession = traceSessionOrBaseline as TraceSession;
      const distinctCalls = getDistinctToolCalls(traceSession.events);
      const stepCount = distinctCalls.length;

      const toolCallBreakdown: Record<string, number> = {};
      for (const call of distinctCalls) {
        toolCallBreakdown[call.toolName] = (toolCallBreakdown[call.toolName] || 0) + 1;
      }

      const filesTouched = extractFilesTouched(traceSession);
      const durationMs = calculateSessionDuration(traceSession);

      const cost =
        options?.cost ??
        (typeof traceSession.metadata?.cost === "number"
          ? (traceSession.metadata.cost as number)
          : undefined);

      const tokens =
        options?.tokens ??
        (traceSession.metadata?.tokens as
          | { input?: number; output?: number; total?: number }
          | undefined);

      const snapshotMetadata =
        options?.snapshotMetadata ??
        (traceSession.metadata?.snapshot as Record<string, unknown> | undefined);

      baseline = {
        testName,
        createdAt: new Date().toISOString(),
        traceSessionId: traceSession.id,
        stepCount,
        toolCallBreakdown,
        filesTouched,
        durationMs,
        cost,
        tokens,
        snapshotMetadata,
      };
    }

    const filePath = this.getGoldenPath(testName);
    fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2), "utf-8");
    return baseline;
  }

  /**
   * Retrieves the golden baseline for a test by name, slug, or file path.
   */
  public getGolden(testName: string): GoldenBaseline | null {
    const filePath = this.getGoldenPath(testName);

    let targetPath = filePath;
    if (!fs.existsSync(targetPath)) {
      // Check alternative filenames (e.g. exact name without slug conversion)
      const altPath = path.join(this.goldenDir, `${testName}.json`);
      if (fs.existsSync(altPath)) {
        targetPath = altPath;
      } else {
        return null;
      }
    }

    try {
      const raw = fs.readFileSync(targetPath, "utf-8");
      const parsed = JSON.parse(raw);
      const validation = GoldenBaselineSchema.safeParse(parsed);
      if (validation.success) {
        return validation.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Lists all registered golden baselines in the workspace.
   */
  public listGoldens(): GoldenBaseline[] {
    if (!fs.existsSync(this.goldenDir)) {
      return [];
    }

    const goldens: GoldenBaseline[] = [];
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.goldenDir);
    } catch {
      return [];
    }

    for (const file of files) {
      if (file.endsWith(".json")) {
        const fullPath = path.join(this.goldenDir, file);
        try {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const parsed = JSON.parse(raw);
          const validation = GoldenBaselineSchema.safeParse(parsed);
          if (validation.success) {
            goldens.push(validation.data);
          }
        } catch {
          // Ignore invalid files
        }
      }
    }

    goldens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return goldens;
  }

  /**
   * Deletes a golden baseline for a given test name.
   */
  public removeGolden(testName: string): boolean {
    const filePath = this.getGoldenPath(testName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    }

    const altPath = path.join(this.goldenDir, `${testName}.json`);
    if (fs.existsSync(altPath)) {
      try {
        fs.unlinkSync(altPath);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
}
