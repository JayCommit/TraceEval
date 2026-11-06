import fs from "node:fs";
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
  backupAndWriteFile,
} from "./common.js";

export interface CursorHookPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  tool?: string;
  tool_name?: string;
  toolName?: string;
  action?: string;
  command?: string;
  input?: unknown;
  args?: unknown;
  parameters?: unknown;
  output?: unknown;
  result?: unknown;
  duration_ms?: number;
  durationMs?: number;
  status?: string;
  error?: string;
  path?: string;
  file?: string;
  prompt?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ParseCursorOptions {
  sessionId?: string;
  baseDir?: string;
  debug?: boolean;
}

/**
 * Returns paths for Cursor configuration files.
 */
export function getCursorConfigPaths(global = false, cwd = process.cwd()): {
  cursorDir: string;
  hooksPath: string;
  mcpPath: string;
  rulesDir: string;
  rulePath: string;
} {
  const cursorDir = global ? path.join(os.homedir(), ".cursor") : path.join(cwd, ".cursor");
  const hooksPath = path.join(cursorDir, "hooks.json");
  const mcpPath = path.join(cursorDir, "mcp.json");
  const rulesDir = path.join(cursorDir, "rules");
  const rulePath = path.join(rulesDir, "traceeval.mdc");
  return { cursorDir, hooksPath, mcpPath, rulesDir, rulePath };
}

/**
 * Installs TraceEval lifecycle hooks, MCP server entry, and agent rules into Cursor.
 */
export function installCursorIntegration(options: {
  global?: boolean;
  cwd?: string;
  binaryPath?: string;
}): {
  hooksPath: string;
  mcpPath: string;
  rulePath?: string;
  backupPath?: string;
} {
  const cwd = options.cwd || process.cwd();
  const bin = options.binaryPath || "traceeval";
  const { hooksPath, mcpPath, rulesDir, rulePath } = getCursorConfigPaths(options.global, cwd);

  // 1. Install / update .cursor/hooks.json
  const hooksUpdate = updateJsonFile<Record<string, unknown>>(hooksPath, (existing) => {
    const hooks = (existing.hooks as Record<string, unknown>) || {};
    return {
      ...existing,
      hooks: {
        ...hooks,
        SessionStart: [
          { command: `${bin} hook start --agent cursor` },
        ],
        PreToolUse: [
          { matcher: ".*", command: `${bin} hook pre-tool --agent cursor` },
        ],
        PostToolUse: [
          { matcher: ".*", command: `${bin} hook post-tool --agent cursor` },
        ],
        Stop: [
          { command: `${bin} hook stop --agent cursor` },
        ],
      },
    };
  });

  // 2. Install / update .cursor/mcp.json
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

  // 3. Install .cursor/rules/traceeval.mdc (project workspace mode only)
  let createdRulePath: string | undefined;
  if (!options.global) {
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }
    const ruleContent = `---
description: TraceEval regression evaluation rules for Cursor Agent
globs: ["**/*"]
alwaysApply: true
---
# TraceEval Quality & Regression Guidelines
- Keep tool steps focused and minimal to conserve token budget.
- After substantial modifications, run test verification: \`traceeval test\`.
- Use the TraceEval MCP server tools (\`list_traces\`, \`compare_traces\`, \`get_golden_baseline\`) to check previous runs.
`;
    backupAndWriteFile(rulePath, ruleContent);
    createdRulePath = rulePath;
  }

  return {
    hooksPath,
    mcpPath,
    rulePath: createdRulePath,
    backupPath: hooksUpdate.backupPath,
  };
}

/**
 * Parses Cursor agent events into standardized TraceEvent format.
 */
export function parseCursorHookPayload(
  hookType: string,
  rawPayload: string | Record<string, unknown>,
  sessionOrOptions?: string | ParseCursorOptions
): TraceEvent {
  const options: ParseCursorOptions =
    typeof sessionOrOptions === "string"
      ? { sessionId: sessionOrOptions }
      : sessionOrOptions || {};

  const parsed = safeJsonParse<CursorHookPayload>(rawPayload, {});

  const sessionId = resolveSessionId({
    explicitId: options.sessionId,
    payload: parsed,
    baseDir: options.baseDir,
  });

  const eventId = createEventId("cursor");
  const timestamp = new Date().toISOString();
  const normalized = normalizeHookType(hookType || (parsed.action as string) || "");

  let eventType: TraceEvent["type"] = "custom";
  const data: Record<string, unknown> = truncatePayload({ ...parsed }) as Record<string, unknown>;

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
    case "toolexecute": {
      eventType = "tool_call_start";
      const tool = parsed.action || parsed.tool || parsed.tool_name || parsed.toolName || parsed.command || "unknown";
      data.toolName = tool;
      data.input = parsed.input ?? parsed.args ?? parsed.parameters ?? (parsed.action && parsed.command ? parsed.command : undefined);
      break;
    }

    case "posttool":
    case "posttooluse":
    case "toolcomplete": {
      eventType = "tool_call";
      const tool = parsed.action || parsed.tool || parsed.tool_name || parsed.toolName || parsed.command || "unknown";
      data.toolName = tool;
      data.input = parsed.input ?? parsed.args ?? parsed.parameters ?? (parsed.action && parsed.command ? parsed.command : undefined);
      data.output = parsed.output ?? parsed.result;
      data.durationMs = parsed.duration_ms ?? parsed.durationMs;
      data.status = parsed.error ? "error" : parsed.status || "success";
      break;
    }

    case "file":
    case "filechange":
      eventType = "file_change";
      data.path = parsed.path || parsed.file || "unknown";
      data.changeType = parsed.status || "modified";
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
    agent: "cursor",
    data,
  };
}
