import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ChildProcess } from "node:child_process";

export interface InjectedPromptItem {
  id: string;
  prompt: string;
  timestamp: string;
  consumed?: boolean;
}

export interface SessionControlState {
  sessionId: string;
  status: "active" | "paused" | "aborted";
  pausedAt?: string;
  resumedAt?: string;
  abortedAt?: string;
  injectedPrompts: InjectedPromptItem[];
  updatedAt: string;
}

export interface RegisteredProcess {
  pid: number;
  process?: ChildProcess;
  agent?: string;
  startedAt: string;
}

/**
 * Global in-memory registry of active agent child processes spawned by TraceEval.
 */
class ProcessRegistry {
  private processes = new Map<string, RegisteredProcess>();

  register(sessionId: string, info: { pid: number; process?: ChildProcess; agent?: string }): void {
    this.processes.set(sessionId, {
      pid: info.pid,
      process: info.process,
      agent: info.agent,
      startedAt: new Date().toISOString(),
    });
  }

  unregister(sessionId: string): void {
    this.processes.delete(sessionId);
  }

  get(sessionId: string): RegisteredProcess | undefined {
    return this.processes.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  list(): Array<{ sessionId: string; pid: number; agent?: string }> {
    return Array.from(this.processes.entries()).map(([sessionId, p]) => ({
      sessionId,
      pid: p.pid,
      agent: p.agent,
    }));
  }

  /**
   * Terminates all currently registered child processes cleanly.
   */
  terminateAll(): void {
    for (const [sessionId, reg] of this.processes.entries()) {
      try {
        if (reg.process && !reg.process.killed) {
          reg.process.kill("SIGTERM");
        } else if (reg.pid > 0 && reg.pid !== process.pid) {
          process.kill(reg.pid, "SIGTERM");
        }
      } catch {
        // Ignore errors during termination
      }
      this.processes.delete(sessionId);
    }
  }
}

export const SessionProcessRegistry = new ProcessRegistry();

// Ensure active child processes are cleaned up if TraceEval receives SIGINT/SIGTERM
let cleanupRegistered = false;
export function registerProcessCleanupHandlers(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    SessionProcessRegistry.terminateAll();
  };

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}

registerProcessCleanupHandlers();

/**
 * Resolves path to control state directory (.traceeval/control).
 */
export function getControlDir(baseDir?: string): string {
  const dir = baseDir || path.resolve(process.cwd(), ".traceeval");
  if (path.basename(dir) === ".traceeval") {
    return path.join(dir, "control");
  }
  return path.join(dir, ".traceeval", "control");
}

/**
 * Resolves path to a session's control state file, safely scoped to prevent directory traversal.
 */
export function getControlFilePath(sessionId: string, baseDir?: string): string {
  const controlDir = path.resolve(getControlDir(baseDir));
  const safeId = (sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "_") || "session";
  const resolved = path.resolve(controlDir, `${safeId}.json`);

  if (!resolved.startsWith(controlDir + path.sep)) {
    throw new Error(`Security error: Session ID '${sessionId}' escapes control directory`);
  }

  return resolved;
}

/**
 * Reads the current control state for a session.
 */
export function getSessionControlState(sessionId: string, baseDir?: string): SessionControlState {
  const filePath = getControlFilePath(sessionId, baseDir);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      // Return default active state if file is unreadable
    }
  }

  return {
    sessionId,
    status: "active",
    injectedPrompts: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persists session control state atomically.
 */
export function saveSessionControlState(state: SessionControlState, baseDir?: string): void {
  const dir = getControlDir(baseDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = getControlFilePath(state.sessionId, baseDir);
  state.updatedAt = new Date().toISOString();
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Pauses an active session. If a child process is registered, sends SIGSTOP on Unix.
 */
export function pauseSession(
  sessionId: string,
  baseDir?: string
): { success: boolean; status: "paused"; error?: string } {
  try {
    const state = getSessionControlState(sessionId, baseDir);
    state.status = "paused";
    state.pausedAt = new Date().toISOString();
    saveSessionControlState(state, baseDir);

    const reg = SessionProcessRegistry.get(sessionId);
    if (reg && reg.pid > 0 && reg.pid !== process.pid && process.platform !== "win32") {
      try {
        if (reg.process && !reg.process.killed) {
          reg.process.kill("SIGSTOP");
        } else {
          process.kill(reg.pid, "SIGSTOP");
        }
      } catch {
        // Process might have terminated already
      }
    }

    return { success: true, status: "paused" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: "paused", error: message };
  }
}

/**
 * Resumes a paused session. If a child process is registered, sends SIGCONT on Unix.
 */
export function resumeSession(
  sessionId: string,
  baseDir?: string
): { success: boolean; status: "active"; error?: string } {
  try {
    const state = getSessionControlState(sessionId, baseDir);
    state.status = "active";
    state.resumedAt = new Date().toISOString();
    saveSessionControlState(state, baseDir);

    const reg = SessionProcessRegistry.get(sessionId);
    if (reg && reg.pid > 0 && reg.pid !== process.pid && process.platform !== "win32") {
      try {
        if (reg.process && !reg.process.killed) {
          reg.process.kill("SIGCONT");
        } else {
          process.kill(reg.pid, "SIGCONT");
        }
      } catch {
        // Ignore
      }
    }

    return { success: true, status: "active" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: "active", error: message };
  }
}

/**
 * Aborts a running session. Terminates any registered process via SIGINT/SIGTERM.
 */
export function abortSession(
  sessionId: string,
  baseDir?: string
): { success: boolean; status: "aborted"; error?: string } {
  try {
    const state = getSessionControlState(sessionId, baseDir);
    state.status = "aborted";
    state.abortedAt = new Date().toISOString();
    saveSessionControlState(state, baseDir);

    const reg = SessionProcessRegistry.get(sessionId);
    if (reg && reg.pid > 0 && reg.pid !== process.pid) {
      try {
        if (reg.process && !reg.process.killed) {
          reg.process.kill("SIGINT");
        } else {
          process.kill(reg.pid, "SIGINT");
        }
        setTimeout(() => {
          try {
            if (reg.process && !reg.process.killed) {
              reg.process.kill("SIGKILL");
            } else {
              process.kill(reg.pid, "SIGKILL");
            }
          } catch {
            // Already dead
          }
        }, 800).unref();
      } catch {
        // Ignore
      }
    }

    return { success: true, status: "aborted" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: "aborted", error: message };
  }
}

/**
 * Injects a prompt / steering instruction into an active session.
 */
export function injectPrompt(
  sessionId: string,
  prompt: string,
  baseDir?: string
): { success: boolean; item: InjectedPromptItem; error?: string } {
  try {
    const state = getSessionControlState(sessionId, baseDir);
    const item: InjectedPromptItem = {
      id: `inj-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      prompt: prompt.trim(),
      timestamp: new Date().toISOString(),
      consumed: false,
    };

    state.injectedPrompts.push(item);
    saveSessionControlState(state, baseDir);

    // If child process stdin is writable, write prompt to stdin
    const reg = SessionProcessRegistry.get(sessionId);
    if (reg?.process?.stdin && !reg.process.stdin.destroyed) {
      try {
        reg.process.stdin.write(prompt.trim() + "\n");
      } catch {
        // Stdin may not be open or accepting input
      }
    }

    return { success: true, item };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      item: { id: "", prompt, timestamp: new Date().toISOString() },
      error: message,
    };
  }
}

/**
 * Reads and marks any unconsumed injected prompts for a session.
 */
export function consumeInjectedPrompts(sessionId: string, baseDir?: string): InjectedPromptItem[] {
  try {
    const state = getSessionControlState(sessionId, baseDir);
    const unconsumed = state.injectedPrompts.filter((p) => !p.consumed);
    if (unconsumed.length > 0) {
      for (const p of state.injectedPrompts) {
        p.consumed = true;
      }
      saveSessionControlState(state, baseDir);
    }
    return unconsumed;
  } catch {
    return [];
  }
}
