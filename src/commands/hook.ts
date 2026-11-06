import { StorageManager } from "../storage/index.js";
import { parseClaudeHookPayload } from "../hooks/claude.js";
import { parseOpenCodeHookPayload } from "../hooks/opencode.js";

export interface HookOptions {
  session?: string;
  agent?: string;
  tool?: string;
  data?: string;
  debug?: boolean;
  baseDir?: string;
  stdinTimeoutMs?: number;
}

/**
 * Checks whether debug logging is enabled via CLI option or environment variables.
 */
export function isHookDebugEnabled(options?: HookOptions): boolean {
  if (options?.debug) return true;
  const envDebug = process.env.TRACEEVAL_DEBUG;
  if (envDebug === "1" || envDebug === "true") return true;
  const genericDebug = process.env.DEBUG;
  if (
    genericDebug === "1" ||
    genericDebug === "true" ||
    genericDebug?.toLowerCase().includes("traceeval")
  ) {
    return true;
  }
  return false;
}

/**
 * Emits debug message to stderr with standardized prefix.
 */
export function logHookDebug(message: string, ...args: unknown[]): void {
  console.error(`[traceeval:hook:debug] ${message}`, ...args);
}

/**
 * Reads payload from stdin if available without blocking indefinitely.
 */
export async function readStdin(timeoutMs = 500): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise((resolve) => {
    let data = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(data);
      }
    }, timeoutMs);
    timer.unref();

    process.stdin.setEncoding("utf-8");

    process.stdin.on("data", (chunk) => {
      data += chunk;
    });

    process.stdin.on("end", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(data);
      }
    });

    process.stdin.on("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve("");
      }
    });
  });
}

/**
 * Main hook execution function called by `traceeval hook <type>`.
 * Non-blocking, completely fail-safe: never throws or breaks the caller.
 */
export async function runHook(
  hookType: string,
  options: HookOptions = {}
): Promise<void> {
  const debug = isHookDebugEnabled(options);

  try {
    if (debug) {
      logHookDebug(`Hook invoked: type="${hookType}"`);
    }

    let rawPayload = "";

    // If options.data was explicitly provided, use it directly without waiting for stdin
    if (options.data) {
      try {
        const parsedData = JSON.parse(options.data);
        if (typeof parsedData === "object" && parsedData !== null) {
          if (options.tool && !parsedData.tool_name && !parsedData.tool) {
            parsedData.tool_name = options.tool;
          }
          rawPayload = JSON.stringify(parsedData);
        } else {
          rawPayload = JSON.stringify({ tool_name: options.tool, data: options.data });
        }
      } catch {
        rawPayload = options.data;
      }
    } else {
      const rawStdin = await readStdin(options.stdinTimeoutMs ?? 500);
      rawPayload = rawStdin.trim();

      if (!rawPayload && options.tool) {
        rawPayload = JSON.stringify({ tool_name: options.tool });
      }
    }

    if (debug) {
      logHookDebug(`Payload length: ${rawPayload.length} bytes`);
      if (rawPayload.length > 0) {
        logHookDebug(`Payload preview: ${rawPayload.slice(0, 150)}`);
      }
    }

    let isOpencode = options.agent?.toLowerCase() === "opencode";
    if (!isOpencode && rawPayload.includes('"opencode"')) {
      try {
        const checkJson = JSON.parse(rawPayload);
        if (checkJson.agent === "opencode") {
          isOpencode = true;
        }
      } catch {
        // ignore
      }
    }

    const event = isOpencode
      ? parseOpenCodeHookPayload(hookType, rawPayload, {
          sessionId: options.session,
          baseDir: options.baseDir,
          debug,
        })
      : parseClaudeHookPayload(hookType, rawPayload, {
          sessionId: options.session,
          baseDir: options.baseDir,
          debug,
        });

    if (options.tool && (!event.data.toolName || event.data.toolName === "unknown")) {
      event.data.toolName = options.tool;
    }

    if (debug) {
      logHookDebug(
        `Parsed event: id=${event.id}, type=${event.type}, session=${event.sessionId}, tool=${
          event.data.toolName ?? "none"
        }`
      );
    }

    const storage = new StorageManager({ baseDir: options.baseDir });
    storage.recordEvent(event);

    // If event is user prompt, record session prompt in SQLite
    if (
      event.type === "user_prompt" &&
      typeof event.data.prompt === "string" &&
      event.data.prompt
    ) {
      storage.upsertSession({
        id: event.sessionId,
        prompt: event.data.prompt,
        agent: event.agent,
        status: "active",
      });
    }

    // If event is session end, update session completion status in SQLite
    if (event.type === "session_end") {
      storage.upsertSession({
        id: event.sessionId,
        endTime: event.timestamp,
        status: "completed",
      });
    }

    storage.close();

    if (debug) {
      logHookDebug(`Event ${event.id} persisted successfully for session ${event.sessionId}`);
    }
  } catch (err: unknown) {
    // Hooks should NEVER throw or break the calling agent process.
    if (debug) {
      console.error(`[traceeval:hook:error] Failed to process hook "${hookType}":`, err);
    }
  }
}
