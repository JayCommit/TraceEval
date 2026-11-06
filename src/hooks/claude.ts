import path from "node:path";
import os from "node:os";
import { TraceEvent } from "../types/index.js";
import { resolveSessionId } from "./session.js";
import {
  createEventId,
  normalizeHookType,
  truncatePayload,
  safeJsonParse,
  updateJsonFile,
} from "./common.js";

export * from "./session.js";
export * from "./common.js";

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
  const bin = options.binaryPath || "traceeval";

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

  const updateResult = updateJsonFile<ClaudeSettings>(configPath, (settings) => {
    const hooks = settings.hooks || {};
    for (const [hookName, hookEntry] of Object.entries(requiredHooks)) {
      const currentList = hooks[hookName] || [];
      const exists = currentList.some((h) => h.command.includes("traceeval hook"));
      if (!exists) {
        hooks[hookName] = [...currentList, hookEntry];
      }
    }
    return {
      ...settings,
      hooks,
    };
  });

  return { configPath, backupPath: updateResult.backupPath };
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
  rawPayload: string | Record<string, unknown>,
  sessionOrOptions?: string | ParseHookOptions
): TraceEvent {
  const options: ParseHookOptions =
    typeof sessionOrOptions === "string"
      ? { sessionId: sessionOrOptions }
      : sessionOrOptions || {};

  const parsed = safeJsonParse<ClaudeHookPayload>(rawPayload, {});

  const sessionId = resolveSessionId({
    explicitId: options.sessionId,
    payload: parsed,
    baseDir: options.baseDir,
  });

  const eventId = createEventId("claude");
  const timestamp = new Date().toISOString();
  const normalized = normalizeHookType(hookType || "");

  let eventType: TraceEvent["type"] = "custom";
  const data: Record<string, unknown> = truncatePayload({ ...parsed }) as Record<string, unknown>;

  switch (normalized) {
    case "start":
    case "sessionstart":
      eventType = "session_start";
      break;

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

    case "file":
    case "filechange":
    case "filewrite":
      eventType = "file_change";
      data.path = (parsed.path || parsed.file || parsed.filePath || "unknown") as string;
      data.changeType = (parsed.status || "modified") as string;
      break;

    case "stop":
    case "sessionend":
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
