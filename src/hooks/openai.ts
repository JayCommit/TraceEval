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

export interface OpenAIFunctionCall {
  name?: string;
  arguments?: string | Record<string, unknown>;
}

export interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: OpenAIFunctionCall;
  name?: string;
  arguments?: unknown;
}

export interface OpenAIHookPayload {
  session_id?: string;
  sessionId?: string;
  thread_id?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  tool?: string;
  tool_name?: string;
  name?: string;
  input?: unknown;
  args?: unknown;
  parameters?: unknown;
  output?: unknown;
  result?: unknown;
  duration_ms?: number;
  durationMs?: number;
  prompt?: string;
  message?: string;
  status?: string;
  error?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

export interface ParseOpenAIOptions {
  sessionId?: string;
  baseDir?: string;
  debug?: boolean;
}

export function getOpenAIConfigPaths(global = false, cwd = process.cwd()): {
  openaiDir: string;
  hooksPath: string;
  configPath: string;
  mcpPath: string;
} {
  const openaiDir = global ? path.join(os.homedir(), ".openai") : path.join(cwd, ".openai");
  const hooksPath = path.join(openaiDir, "hooks.json");
  const configPath = path.join(openaiDir, "config.json");
  const mcpPath = path.join(openaiDir, "mcp.json");
  return { openaiDir, hooksPath, configPath, mcpPath };
}

/**
 * Installs TraceEval recording hooks and MCP server config for OpenAI CLI / ChatGPT App.
 */
export function installOpenAIHooks(options: {
  global?: boolean;
  cwd?: string;
  binaryPath?: string;
}): {
  hooksPath: string;
  configPath: string;
  mcpPath: string;
  backupPath?: string;
} {
  const cwd = options.cwd || process.cwd();
  const bin = options.binaryPath || "traceeval";
  const { hooksPath, configPath, mcpPath } = getOpenAIConfigPaths(options.global, cwd);

  const hooksUpdate = updateJsonFile<Record<string, unknown>>(hooksPath, (existing) => {
    return {
      ...existing,
      version: "1.0",
      agent: "openai",
      hooks: {
        SessionStart: { command: `${bin} hook start --agent openai` },
        UserPrompt: { command: `${bin} hook prompt --agent openai` },
        PreToolUse: { command: `${bin} hook pre-tool --agent openai` },
        PostToolUse: { command: `${bin} hook post-tool --agent openai` },
        Stop: { command: `${bin} hook stop --agent openai` },
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

  updateJsonFile<Record<string, unknown>>(mcpPath, (existing) => {
    const mcpServers = (existing.mcpServers as Record<string, unknown>) || {};
    return {
      ...existing,
      mcpServers: {
        ...mcpServers,
        traceeval: {
          command: bin,
          args: ["mcp"],
        },
      },
    };
  });

  return {
    hooksPath,
    configPath,
    mcpPath,
    backupPath: hooksUpdate.backupPath,
  };
}

/**
 * Parses OpenAI function calls, Assistant API runs, and ChatGPT tool payloads into TraceEvents.
 */
export function parseOpenAIHookPayload(
  hookType: string,
  rawPayload: string | Record<string, unknown>,
  sessionOrOptions?: string | ParseOpenAIOptions
): TraceEvent {
  const options: ParseOpenAIOptions =
    typeof sessionOrOptions === "string"
      ? { sessionId: sessionOrOptions }
      : sessionOrOptions || {};

  const parsed = safeJsonParse<OpenAIHookPayload>(rawPayload, {});

  const sessionId = resolveSessionId({
    explicitId: options.sessionId,
    payload: parsed,
    baseDir: options.baseDir,
  });

  const eventId = createEventId("openai");
  const timestamp = new Date().toISOString();
  const normalized = normalizeHookType(hookType || "");

  let eventType: TraceEvent["type"] = "custom";
  const data: Record<string, unknown> = truncatePayload({ ...parsed }) as Record<string, unknown>;

  // Token usage
  if (parsed.usage) {
    data.tokens = {
      input: parsed.usage.prompt_tokens,
      output: parsed.usage.completion_tokens,
      total: parsed.usage.total_tokens,
    };
  }

  // Extract first tool call from OpenAI format if present
  let extractedToolName: string | undefined = parsed.tool || parsed.tool_name || parsed.name;
  let extractedInput: unknown = parsed.input ?? parsed.args ?? parsed.parameters;

  if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
    const firstCall = parsed.tool_calls[0];
    if (firstCall.function?.name) {
      extractedToolName = firstCall.function.name;
      extractedInput = firstCall.function.arguments;
    } else if (firstCall.name) {
      extractedToolName = firstCall.name;
      extractedInput = firstCall.arguments;
    }
  }

  switch (normalized) {
    case "start":
    case "sessionstart":
      eventType = "session_start";
      break;

    case "prompt":
    case "userprompt":
      eventType = "user_prompt";
      data.prompt = parsed.prompt || parsed.message || "";
      break;

    case "pretool":
    case "pretooluse":
    case "toolcall":
      eventType = "tool_call_start";
      data.toolName = extractedToolName || "unknown";
      data.input = extractedInput;
      break;

    case "posttool":
    case "posttooluse":
    case "tooloutput":
      eventType = "tool_call";
      data.toolName = extractedToolName || "unknown";
      data.input = extractedInput;
      data.output = parsed.output ?? parsed.result;
      data.durationMs = parsed.duration_ms ?? parsed.durationMs;
      data.status = parsed.error ? "error" : parsed.status || "success";
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
    agent: "openai",
    data,
  };
}
