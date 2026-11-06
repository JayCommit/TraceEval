import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Standard event ID generator.
 */
export function createEventId(prefix?: string): string {
  const p = prefix ? `${prefix}-` : "";
  return `evt-${p}${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Normalizes hook and event names for flexible matching (e.g. "pre-tool" -> "pretool").
 */
export function normalizeHookType(type: string): string {
  return (type || "").toLowerCase().replace(/[-_.]/g, "");
}

/**
 * Safely truncates strings or serialized objects to prevent payload explosion
 * and reduce context token overhead when traces are processed.
 */
export function truncatePayload<T = unknown>(value: T, maxChars?: number): T {
  const envMax = process.env.TRACEEVAL_MAX_PAYLOAD
    ? parseInt(process.env.TRACEEVAL_MAX_PAYLOAD, 10)
    : undefined;
  const limit = maxChars ?? (envMax && !isNaN(envMax) ? envMax : 8192);

  if (typeof value === "string") {
    if (value.length <= limit) return value as T;
    const keepChars = Math.floor(limit / 2);
    const excess = value.length - limit;
    return `${value.slice(0, keepChars)}\n... [truncated ${excess} characters] ...\n${value.slice(-keepChars)}` as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => truncatePayload(item, limit)) as unknown as T;
  }

  if (value !== null && typeof value === "object") {
    const truncatedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      truncatedObj[k] = truncatePayload(v, limit);
    }
    return truncatedObj as unknown as T;
  }

  return value;
}

/**
 * Safely parses JSON string or returns raw content / fallback on error.
 */
export function safeJsonParse<T = Record<string, unknown>>(
  raw: unknown,
  fallback: T = {} as T
): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return fallback;

  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as T;
    }
    return { raw } as unknown as T;
  } catch {
    return { raw } as unknown as T;
  }
}

/**
 * Backs up an existing file before writing updated contents.
 */
export function backupAndWriteFile(
  filePath: string,
  content: string
): { backupPath?: string } {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let backupPath: string | undefined;
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf-8");
      backupPath = `${filePath}.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, existing, "utf-8");
    } catch {
      // Ignore backup error and proceed
    }
  }

  fs.writeFileSync(filePath, content, "utf-8");
  return { backupPath };
}

/**
 * Safely reads a JSON file, executes an updater callback, and writes back the updated JSON
 * with an automatic backup of the prior file.
 */
export function updateJsonFile<T extends Record<string, unknown>>(
  filePath: string,
  updater: (current: T) => T
): { backupPath?: string } {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let current: T = {} as T;
  let backupPath: string | undefined;

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      current = JSON.parse(raw) as T;
      backupPath = `${filePath}.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, raw, "utf-8");
    } catch {
      current = {} as T;
    }
  }

  const updated = updater(current);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  return { backupPath };
}
