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

export interface GrokHookPayload {
  session_id?: string;
  sessionId?: string;
  tool?: string;
  tool_name?: string;
  name?: string;
  command?: string;
  input?: unknown;
  args?: unknown;
  parameters?: unknown;
  arguments?: unknown;
  output?: unknown;
  result?: unknown;
  response?: unknown;
  duration_ms?: number;
  durationMs?: number;
  prompt?: string;
  message?: string;
  query?: string;
  error?: string;
  status?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    [key: string]: unknown;
  };
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  cost?: number;
  [key: string]: unknown;
}

export interface ParseGrokOptions {
  sessionId?: string;
  baseDir?: string;
  debug?: boolean;
}

export function getGrokConfigPaths(global = false, cwd = process.cwd()): {
  grokDir: string;
  hooksPath: string;
  configPath: string;
} {
  const grokDir = global ? path.join(os.homedir(), ".grok") : path.join(cwd, ".grok");
  const hooksPath = path.join(grokDir, "hooks.json");
  const configPath = path.join(grokDir, "config.json");
  return { grokDir, hooksPath, configPath };
}

/**
 * Installs TraceEval lifecycle hooks for Grok CLI and SDK agents.
 */
export function installGrokHooks(options: {
  global?: boolean;
  cwd?: string;
  binaryPath?: string;
}): {
  hooksPath: string;
  configPath: string;
  backupPath?: string;
} {
  const cwd = options.cwd || process.cwd();
  const bin = options.binaryPath || "traceeval";
  const { hooksPath, configPath } = getGrokConfigPaths(options.global, cwd);

  const hooksUpdate = updateJsonFile<Record<string, unknown>>(hooksPath, (existing) => {
    return {
      ...existing,
      version: "1.0",
      agent: "grok",
      hooks: {
        SessionStart: { command: `${bin} hook start --agent grok` },
        UserPrompt: { command: `${bin} hook prompt --agent grok` },
        PreToolUse: { command: `${bin} hook pre-tool --agent grok` },
        PostToolUse: { command: `${bin} hook post-tool --agent grok` },
        Stop: { command: `${bin} hook stop --agent grok` },
      },
    };
  });

  updateJsonFile<Record<string, unknown>>(configPath, (existing) => {
    return {
      ...existing,
      hooksEnabled: true,
      hooksFile: "hooks.json",
    };
  });

  return {
    hooksPath,
    configPath,
    backupPath: hooksUpdate.backupPath,
  };
}

/**
 * Parses Grok payload and normalizes into TraceEvent format.
 */
export function parseGrokHookPayload(
  hookType: string,
  rawPayload: string | Record<string, unknown>,
  sessionOrOptions?: string | ParseGrokOptions
): TraceEvent {
  const options: ParseGrokOptions =
    typeof sessionOrOptions === "string"
      ? { sessionId: sessionOrOptions }
      : sessionOrOptions || {};

  const parsed = safeJsonParse<GrokHookPayload>(rawPayload, {});

  const sessionId = resolveSessionId({
    explicitId: options.sessionId,
    payload: parsed,
    baseDir: options.baseDir,
  });

  const eventId = createEventId("grok");
  const timestamp = new Date().toISOString();
  const normalized = normalizeHookType(hookType || "");

  let eventType: TraceEvent["type"] = "custom";
  const data: Record<string, unknown> = truncatePayload({ ...parsed }) as Record<string, unknown>;

  // Token usage normalization
  if (parsed.usage) {
    const total = parsed.usage.total_tokens;
    const input = parsed.usage.prompt_tokens ?? parsed.usage.input_tokens;
    const output = parsed.usage.completion_tokens ?? parsed.usage.output_tokens;
    data.tokens = { input, output, total };
  }

  switch (normalized) {
    case "start":
    case "sessionstart":
      eventType = "session_start";
      break;

    case "prompt":
    case "userprompt":
      eventType = "user_prompt";
      data.prompt = parsed.prompt || parsed.message || parsed.query || "";
      break;

    case "pretool":
    case "pretooluse":
      eventType = "tool_call_start";
      data.toolName = parsed.tool || parsed.tool_name || parsed.name || parsed.command || "unknown";
      data.input = parsed.input ?? parsed.args ?? parsed.arguments ?? parsed.parameters;
      break;

    case "posttool":
    case "posttooluse":
      eventType = "tool_call";
      data.toolName = parsed.tool || parsed.tool_name || parsed.name || parsed.command || "unknown";
      data.input = parsed.input ?? parsed.args ?? parsed.arguments ?? parsed.parameters;
      data.output = parsed.output ?? parsed.result ?? parsed.response;
      data.durationMs = parsed.duration_ms ?? parsed.durationMs;
      data.status = parsed.error ? "error" : parsed.status || "success";
      break;

    case "file":
    case "filechange":
      eventType = "file_change";
      data.path = parsed.path || parsed.file || "unknown";
      break;

    case "stop":
    case "sessionend":
      eventType = "session_end";
      data.durationMs = parsed.duration_ms ?? parsed.durationMs;
      break;
  }

  return {
    id: eventId,
    sessionId,
    timestamp,
    type: eventType,
    agent: "grok",
    data,
  };
}
