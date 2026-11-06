import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { TraceEvent } from "../types/index.js";
import { resolveSessionId } from "./session.js";

export * from "./session.js";

/**
 * ============================================================================
 * Recording Strategies: Pure Hooks vs. Record Wrapper
 * ============================================================================
 *
 * TraceEval provides two complementary mechanisms to capture agent execution traces:
 *
 * 1. Pure Hooks (`traceeval install claude`):
 *    - Injects lifecycle hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`)
 *      directly into `.claude/settings.json` (project-local or `~/.claude/settings.json` global).
 *    - Zero-friction & transparent: developers run `claude` normally.
 *    - Hooks run in the background, pipe JSON payload from Claude Code to `traceeval hook <type>`,
 *      and persist events immediately into `.traceeval/traces/` (JSONL + SQLite).
 *    - Session correlation: events in the same session share a unified `sessionId`
 *      resolved from payload metadata (`session_id`), `TRACEEVAL_SESSION_ID`, or the
 *      active session tracker (`.traceeval/.active_session`).
 *    - Non-blocking & silent: hooks complete within ~10ms and fail silently (exit code 0)
 *      so agent execution is never interrupted or degraded.
 *
 * 2. Record Wrapper (`traceeval record -- <command...>`):
 *    - Spawns the agent command as a child process with explicit session boundaries.
 *    - Injects `TRACEEVAL_SESSION_ID=<sessionId>` into the child process environment,
 *      ensuring any hooks fired inside the command correlate directly into the wrapper session.
 *    - Captures total process duration, start/end events, and exit code.
 *    - Ideal for automated evaluations (`traceeval test`), CI pipelines, and batch benchmarking.
 * ============================================================================
 */

export interface ClaudeHookEntry {
  matcher?: string;
  command: string;
}

export interface ClaudeSettings {
  hooks?: {
    UserPromptSubmit?: ClaudeHookEntry[];
    PreToolUse?: ClaudeHookEntry[];
    PostToolUse?: ClaudeHookEntry[];
    Stop?: ClaudeHookEntry[];
    [key: string]: ClaudeHookEntry[] | undefined;
  };
  [key: string]: unknown;
}

export function getClaudeSettingsPath(global = false, cwd = process.cwd()): string {
  if (global) {
    return path.join(os.homedir(), ".claude", "settings.json");
  }
  return path.join(cwd, ".claude", "settings.json");
}

export function installClaudeHooks(options: {
  global?: boolean;
  cwd?: string;
  binaryPath?: string;
}): { configPath: string; backupPath?: string } {
  const configPath = getClaudeSettingsPath(options.global, options.cwd);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let settings: ClaudeSettings = {};
  let backupPath: string | undefined;

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      settings = JSON.parse(raw);
      // Backup original
      backupPath = `${configPath}.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, raw, "utf-8");
    } catch {
      settings = {};
    }
  }

  const bin = options.binaryPath || "traceeval";

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const requiredHooks: Record<string, ClaudeHookEntry> = {
    UserPromptSubmit: {
      matcher: ".*",
      command: `${bin} hook prompt`,
    },
    PreToolUse: {
      matcher: ".*",
      command: `${bin} hook pre-tool`,
    },
    PostToolUse: {
      matcher: ".*",
      command: `${bin} hook post-tool`,
    },
    Stop: {
      matcher: ".*",
      command: `${bin} hook stop`,
    },
  };

  for (const [hookName, hookEntry] of Object.entries(requiredHooks)) {
    const currentList = settings.hooks[hookName] || [];
    // Check if traceeval hook already exists in list
    const exists = currentList.some((h) => h.command.includes("traceeval hook"));
    if (!exists) {
      settings.hooks[hookName] = [...currentList, hookEntry];
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf-8");
  return { configPath, backupPath };
}

export interface ParseHookOptions {
  sessionId?: string;
  baseDir?: string;
  debug?: boolean;
}

export interface ClaudeHookPayload {
  prompt?: string;
  user_prompt?: string;
  userPrompt?: string;
  message?: string;
  query?: string;
  text?: string;
  input?: unknown;
  tool_name?: string;
  toolName?: string;
  tool?: string;
  name?: string;
  tool_input?: unknown;
  parameters?: unknown;
  args?: unknown;
  arguments?: unknown;
  tool_use_id?: string;
  toolUseId?: string;
  id?: string;
  tool_result?: unknown;
  result?: unknown;
  toolResult?: unknown;
  output?: unknown;
  response?: unknown;
  duration_ms?: number;
  durationMs?: number;
  duration?: number;
  error?: string;
  status?: string;
  reason?: string;
  stop_reason?: string;
  stopReason?: string;
  raw?: string;
  [key: string]: unknown;
}

export function parseClaudeHookPayload(
  hookType: string,
  rawPayload: string,
  sessionOrOptions?: string | ParseHookOptions
): TraceEvent {
  const options: ParseHookOptions =
    typeof sessionOrOptions === "string"
      ? { sessionId: sessionOrOptions }
      : sessionOrOptions || {};

  let parsed: ClaudeHookPayload = {};
  try {
    if (rawPayload && rawPayload.trim().length > 0) {
      const parsedJson = JSON.parse(rawPayload);
      if (typeof parsedJson === "object" && parsedJson !== null) {
        parsed = parsedJson as ClaudeHookPayload;
      } else {
        parsed = { raw: rawPayload };
      }
    }
  } catch {
    // If not valid JSON, treat as raw string payload
    parsed = { raw: rawPayload };
  }

  const sessionId = resolveSessionId({
    explicitId: options.sessionId,
    payload: parsed,
    baseDir: options.baseDir,
  });

  const eventId = `evt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const timestamp = new Date().toISOString();

  const normalized = (hookType || "").toLowerCase().replace(/[-_]/g, "");
  let eventType: TraceEvent["type"] = "custom";
  const data: Record<string, unknown> = { ...parsed };

  switch (normalized) {
    case "prompt":
    case "userprompt":
    case "userpromptsubmit":
      eventType = "user_prompt";
      data.prompt =
        parsed.prompt ??
        parsed.user_prompt ??
        parsed.userPrompt ??
        parsed.message ??
        parsed.query ??
        parsed.text ??
        parsed.input ??
        "";
      break;

    case "pretool":
    case "pretooluse":
      eventType = "tool_call_start";
      data.toolName =
        parsed.tool_name ??
        parsed.toolName ??
        parsed.tool ??
        parsed.name ??
        "unknown";
      data.input =
        parsed.tool_input ??
        parsed.input ??
        parsed.parameters ??
        parsed.args ??
        parsed.arguments;
      if (parsed.tool_use_id || parsed.toolUseId || parsed.id) {
        data.toolUseId = parsed.tool_use_id || parsed.toolUseId || parsed.id;
      }
      break;

    case "posttool":
    case "posttooluse":
      eventType = "tool_call";
      data.toolName =
        parsed.tool_name ??
        parsed.toolName ??
        parsed.tool ??
        parsed.name ??
        "unknown";
      data.input =
        parsed.tool_input ??
        parsed.input ??
        parsed.parameters ??
        parsed.args ??
        parsed.arguments;
      data.output =
        parsed.tool_result ??
        parsed.result ??
        parsed.toolResult ??
        parsed.output ??
        parsed.response;
      data.durationMs =
        parsed.duration_ms ??
        parsed.durationMs ??
        parsed.duration;
      data.status = parsed.error ? "error" : (parsed.status || "success");
      if (parsed.error) {
        data.error = parsed.error;
      }
      if (parsed.tool_use_id || parsed.toolUseId || parsed.id) {
        data.toolUseId = parsed.tool_use_id || parsed.toolUseId || parsed.id;
      }
      break;

    case "stop":
      eventType = "session_end";
      data.reason =
        parsed.reason ??
        parsed.stop_reason ??
        parsed.stopReason ??
        parsed.message ??
        "stopped";
      break;
  }

  return {
    id: eventId,
    sessionId,
    timestamp,
    type: eventType,
    agent: "claude-code",
    data,
  };
}
