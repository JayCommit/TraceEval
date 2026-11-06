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

export interface AntigravityHookPayload {
  sessionId?: string;
  conversationId?: string;
  session_id?: string;
  conversation_id?: string;
  stepIndex?: number;
  toolName?: string;
  tool_name?: string;
  tool?: string;
  name?: string;
  toolInput?: unknown;
  input?: unknown;
  parameters?: unknown;
  args?: unknown;
  toolOutput?: unknown;
  output?: unknown;
  toolResult?: unknown;
  result?: unknown;
  durationMs?: number;
  duration_ms?: number;
  terminationReason?: string;
  error?: string;
  prompt?: string;
  message?: string;
  userMessage?: string;
  [key: string]: unknown;
}

export interface ParseAntigravityOptions {
  sessionId?: string;
  baseDir?: string;
  debug?: boolean;
}

export function getAntigravityConfigPath(global = false, cwd = process.cwd()): string {
  if (global) {
    return path.join(os.homedir(), ".gemini", "config", "hooks.json");
  }
  return path.join(cwd, ".agents", "hooks.json");
}

/**
 * Installs TraceEval lifecycle hooks into Antigravity configuration (.agents/hooks.json).
 */
export function installAntigravityHooks(options: {
  global?: boolean;
  cwd?: string;
  binaryPath?: string;
}): { configPath: string; backupPath?: string } {
  const cwd = options.cwd || process.cwd();
  const bin = options.binaryPath || "traceeval";
  const configPath = getAntigravityConfigPath(options.global, cwd);

  const updateResult = updateJsonFile<Record<string, unknown>>(configPath, (existing) => {
    return {
      ...existing,
      traceeval: {
        enabled: true,
        SessionStart: [
          { type: "command", command: `${bin} hook start --agent antigravity` },
        ],
        PreToolUse: [
          {
            matcher: ".*",
            hooks: [
              { type: "command", command: `${bin} hook pre-tool --agent antigravity` },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: ".*",
            hooks: [
              { type: "command", command: `${bin} hook post-tool --agent antigravity` },
            ],
          },
        ],
        Stop: [
          { type: "command", command: `${bin} hook stop --agent antigravity` },
        ],
      },
    };
  });

  return {
    configPath,
    backupPath: updateResult.backupPath,
  };
}

/**
 * Parses Antigravity lifecycle event payloads into standardized TraceEvent format.
 */
export function parseAntigravityHookPayload(
  hookType: string,
  rawPayload: string | Record<string, unknown>,
  sessionOrOptions?: string | ParseAntigravityOptions
): TraceEvent {
  const options: ParseAntigravityOptions =
    typeof sessionOrOptions === "string"
      ? { sessionId: sessionOrOptions }
      : sessionOrOptions || {};

  const parsed = safeJsonParse<AntigravityHookPayload>(rawPayload, {});

  const sessionId = resolveSessionId({
    explicitId: options.sessionId,
    payload: parsed,
    baseDir: options.baseDir,
  });

  const eventId = createEventId("antigravity");
  const timestamp = new Date().toISOString();
  const normalized = normalizeHookType(hookType || "");

  let eventType: TraceEvent["type"] = "custom";
  const data: Record<string, unknown> = truncatePayload({ ...parsed }) as Record<string, unknown>;

  const toolName =
    parsed.toolName ||
    parsed.tool_name ||
    parsed.tool ||
    parsed.name ||
    "unknown";

  const toolInput =
    parsed.toolInput ??
    parsed.input ??
    parsed.parameters ??
    parsed.args;

  const toolOutput =
    parsed.toolOutput ??
    parsed.toolResult ??
    parsed.output ??
    parsed.result;

  switch (normalized) {
    case "start":
    case "sessionstart":
      eventType = "session_start";
      break;

    case "prompt":
    case "userprompt":
      eventType = "user_prompt";
      data.prompt = parsed.prompt || parsed.message || parsed.userMessage || "";
      break;

    case "pretool":
    case "pretooluse":
      eventType = "tool_call_start";
      data.toolName = toolName;
      data.input = toolInput;
      break;

    case "posttool":
    case "posttooluse":
      eventType = "tool_call";
      data.toolName = toolName;
      data.input = toolInput;
      data.output = toolOutput;
      data.durationMs = parsed.durationMs ?? parsed.duration_ms;
      data.status = parsed.error ? "error" : "success";
      break;

    case "stop":
      eventType = "session_end";
      data.reason = parsed.terminationReason || "completed";
      break;
  }

  return {
    id: eventId,
    sessionId,
    timestamp,
    type: eventType,
    agent: "antigravity",
    data,
  };
}
