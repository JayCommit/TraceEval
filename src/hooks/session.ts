import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ActiveSessionData {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  agent?: string;
  [key: string]: unknown;
}

/**
 * Returns the path to the active session tracker file (.traceeval/.active_session).
 */
export function getActiveSessionPath(baseDir?: string): string {
  const dir = baseDir || path.resolve(process.cwd(), ".traceeval");
  if (path.basename(dir) === ".traceeval") {
    return path.join(dir, ".active_session");
  }
  return path.join(dir, ".traceeval", ".active_session");
}

/**
 * Reads the current active session ID from the tracker file.
 * Returns null if the file does not exist, is unreadable, or has expired.
 */
export function getActiveSession(baseDir?: string, ttlMs?: number): string | null {
  try {
    const sessionFile = getActiveSessionPath(baseDir);
    if (!fs.existsSync(sessionFile)) {
      return null;
    }

    const raw = fs.readFileSync(sessionFile, "utf-8").trim();
    if (!raw) {
      return null;
    }

    let sessionId: string | null = null;
    let updatedAt: string | undefined;

    try {
      const data = JSON.parse(raw);
      if (typeof data === "object" && data !== null && typeof data.sessionId === "string") {
        sessionId = data.sessionId.trim();
        updatedAt = data.updatedAt || data.createdAt;
      }
    } catch {
      // If not JSON, treat raw text content as session ID
      sessionId = raw;
    }

    if (!sessionId) {
      return null;
    }

    // Check TTL if timestamp is present
    if (updatedAt) {
      const updatedTime = new Date(updatedAt).getTime();
      if (!isNaN(updatedTime)) {
        const envTtl = process.env.TRACEEVAL_SESSION_TTL_MS
          ? parseInt(process.env.TRACEEVAL_SESSION_TTL_MS, 10)
          : undefined;
        const effectiveTtl = ttlMs ?? envTtl ?? DEFAULT_SESSION_TTL_MS;
        if (effectiveTtl > 0 && Date.now() - updatedTime > effectiveTtl) {
          return null; // Expired
        }
      }
    }

    return sessionId;
  } catch {
    return null;
  }
}

/**
 * Persists the active session ID to .traceeval/.active_session.
 */
export function setActiveSession(
  sessionId: string,
  baseDir?: string,
  metadata?: Record<string, unknown>
): void {
  try {
    const sessionFile = getActiveSessionPath(baseDir);
    const dir = path.dirname(sessionFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let createdAt = new Date().toISOString();
    if (fs.existsSync(sessionFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
        if (existing.sessionId === sessionId && existing.createdAt) {
          createdAt = existing.createdAt;
        }
      } catch {
        // Ignore read/parse error
      }
    }

    const payload: ActiveSessionData = {
      sessionId,
      createdAt,
      updatedAt: new Date().toISOString(),
      agent: "claude-code",
      ...metadata,
    };

    fs.writeFileSync(sessionFile, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // Silent fail-safe: never throw
  }
}

/**
 * Removes the active session file.
 */
export function clearActiveSession(baseDir?: string): void {
  try {
    const sessionFile = getActiveSessionPath(baseDir);
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch {
    // Silent fail-safe
  }
}

/**
 * Generates a random session ID with timestamp.
 */
export function generateSessionId(prefix = "session"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Inspects hook payload object for known session ID fields.
 */
export function extractSessionIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const p = payload as Record<string, unknown>;

  const getStr = (val: unknown): string | undefined => {
    return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
  };

  const getNestedStr = (obj: unknown, key: string): string | undefined => {
    if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
      return getStr((obj as Record<string, unknown>)[key]);
    }
    return undefined;
  };

  const candidates: Array<string | undefined> = [
    getStr(p.session_id),
    getStr(p.sessionId),
    getStr(p.conversation_id),
    getStr(p.conversationId),
    getNestedStr(p.session, "id"),
    getNestedStr(p.context, "session_id"),
    getNestedStr(p.context, "sessionId"),
    getNestedStr(p.context, "conversation_id"),
    getNestedStr(p.context, "conversationId"),
    getNestedStr(p.event, "session_id"),
    getNestedStr(p.event, "sessionId"),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export interface ResolveSessionOptions {
  explicitId?: string;
  payload?: unknown;
  envId?: string;
  baseDir?: string;
  ttlMs?: number;
  autoPersist?: boolean;
}

/**
 * Resolves session ID in hierarchical order:
 * 1. Explicit ID
 * 2. Payload fields (session_id, sessionId, conversation_id, etc.)
 * 3. Environment variable (TRACEEVAL_SESSION_ID)
 * 4. Active session tracker (.traceeval/.active_session)
 * 5. Generated new session ID
 *
 * Automatically persists or updates the active session file unless autoPersist is false.
 */
export function resolveSessionId(options: ResolveSessionOptions = {}): string {
  // 1. Explicit ID
  if (options.explicitId && options.explicitId.trim()) {
    const resolved = options.explicitId.trim();
    if (options.autoPersist !== false) {
      setActiveSession(resolved, options.baseDir);
    }
    return resolved;
  }

  // 2. ID from hook payload
  const fromPayload = extractSessionIdFromPayload(options.payload);
  if (fromPayload) {
    if (options.autoPersist !== false) {
      setActiveSession(fromPayload, options.baseDir);
    }
    return fromPayload;
  }

  // 3. Environment variable
  const envId = (options.envId || process.env.TRACEEVAL_SESSION_ID || "").trim();
  if (envId) {
    if (options.autoPersist !== false) {
      setActiveSession(envId, options.baseDir);
    }
    return envId;
  }

  // 4. Active session from tracker file
  const activeSession = getActiveSession(options.baseDir, options.ttlMs);
  if (activeSession) {
    if (options.autoPersist !== false) {
      // Touch active session to update updatedAt timestamp
      setActiveSession(activeSession, options.baseDir);
    }
    return activeSession;
  }

  // 5. Generate fresh session ID
  const newSessionId = generateSessionId();
  if (options.autoPersist !== false) {
    setActiveSession(newSessionId, options.baseDir);
  }
  return newSessionId;
}
