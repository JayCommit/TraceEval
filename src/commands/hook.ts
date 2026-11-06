import { StorageManager } from "../storage/index.js";
import { TraceEvent } from "../types/index.js";
import { parseClaudeHookPayload } from "../hooks/claude.js";
import { parseOpenCodeHookPayload } from "../hooks/opencode.js";
import { parseCursorHookPayload } from "../hooks/cursor.js";
import { parseGrokHookPayload } from "../hooks/grok.js";
import { parseGrokBotHookPayload } from "../hooks/grok_bot.js";
import { parseOpenAIHookPayload } from "../hooks/openai.js";
import { parseAntigravityHookPayload } from "../hooks/antigravity.js";
import { safeJsonParse } from "../hooks/common.js";
import {
  getSessionControlState,
  consumeInjectedPrompts,
} from "../engine/control.js";

export interface HookOptions {
  session?: string;
  agent?: string;
  tool?: string;
  data?: string;
  debug?: boolean;
  baseDir?: string;
  stdinTimeoutMs?: number;
  truncate?: number | string;
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
 * Resolves the appropriate event parser function based on agent name or payload.
 */
function resolveAgentParser(agentName?: string, rawPayload?: string): (
  hookType: string,
  raw: string,
  options: { sessionId?: string; baseDir?: string; debug?: boolean }
) => TraceEvent {
  let target = (agentName || "").toLowerCase().trim();

  // If agent not explicitly specified, inspect payload
  if (!target && rawPayload) {
    const parsed = safeJsonParse<Record<string, unknown>>(rawPayload, {});
    if (typeof parsed.agent === "string") {
      target = parsed.agent.toLowerCase().trim();
    }
  }

  switch (target) {
    case "cursor":
      return parseCursorHookPayload;
    case "grok":
      return parseGrokHookPayload;
    case "grok-bot":
    case "grokbot":
      return parseGrokBotHookPayload;
    case "openai":
    case "chatgpt":
      return parseOpenAIHookPayload;
    case "antigravity":
    case "agy":
      return parseAntigravityHookPayload;
    case "opencode":
      return parseOpenCodeHookPayload;
    case "claude":
    case "claude-code":
    default:
      return parseClaudeHookPayload;
  }
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
  if (options.truncate) {
    process.env.TRACEEVAL_MAX_PAYLOAD = String(options.truncate);
  }

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

    const parser = resolveAgentParser(options.agent, rawPayload);
    const event = parser(hookType, rawPayload, {
      sessionId: options.session,
      baseDir: options.baseDir,
      debug,
    });

    if (options.tool && (!event.data.toolName || event.data.toolName === "unknown")) {
      event.data.toolName = options.tool;
    }

    // Check bidirectional control state (pause loop & injected prompts)
    let ctrl = getSessionControlState(event.sessionId, options.baseDir);
    if (ctrl.status === "paused") {
      let waitedMs = 0;
      while (ctrl.status === "paused" && waitedMs < 20000) {
        await new Promise((r) => setTimeout(r, 100));
        waitedMs += 100;
        ctrl = getSessionControlState(event.sessionId, options.baseDir);
      }
    }

    const unconsumedPrompts = consumeInjectedPrompts(event.sessionId, options.baseDir);
    if (unconsumedPrompts.length > 0) {
      event.data.injectedPrompts = unconsumedPrompts.map((p) => p.prompt);
    }

    if (debug) {
      logHookDebug(
        `Parsed event: id=${event.id}, agent=${event.agent}, type=${event.type}, session=${event.sessionId}, tool=${
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
