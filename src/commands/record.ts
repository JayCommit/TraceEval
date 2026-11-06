import { spawn, ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import { TraceEvent } from "../types/index.js";
import { SessionProcessRegistry } from "../engine/control.js";

export interface RecordOptions {
  session?: string;
  agent?: string;
  prompt?: string;
}

export async function runRecord(commandArgs: string[], options: RecordOptions = {}): Promise<void> {
  if (!commandArgs || commandArgs.length === 0) {
    console.log(pc.yellow("No command provided to record."));
    console.log("");
    console.log("Usage: " + pc.cyan("traceeval record [options] -- <command...>"));
    console.log("");
    console.log("Examples:");
    console.log(`  ${pc.dim("# Record a Claude Code run:")}`);
    console.log(`  ${pc.cyan("traceeval record -- claude -p 'Fix bug in auth.ts'")}`);
    console.log("");
    console.log(`  ${pc.dim("# Record an arbitrary script:")}`);
    console.log(`  ${pc.cyan("traceeval record -- npm run agent")}`);
    return;
  }

  const sessionId =
    options.session ||
    `session-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const agent = options.agent || "claude-code";
  const fullCommand = commandArgs.join(" ");

  const storage = new StorageManager();

  console.log(pc.bold(pc.cyan("TraceEval Recording Session Started")));
  console.log(`  Session ID: ${pc.green(sessionId)}`);
  console.log(`  Agent:      ${agent}`);
  console.log(`  Command:    ${pc.dim(fullCommand)}`);
  console.log(pc.dim("─".repeat(60)));

  const startTime = new Date().toISOString();
  const startTs = Date.now();

  // Record session start
  storage.upsertSession({
    id: sessionId,
    agent,
    command: fullCommand,
    prompt: options.prompt,
    startTime,
    status: "active",
  });

  const startEvent: TraceEvent = {
    id: `evt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    sessionId,
    timestamp: startTime,
    type: "session_start",
    agent,
    data: {
      command: fullCommand,
      prompt: options.prompt,
    },
  };
  storage.recordEvent(startEvent);

  if (options.prompt) {
    const promptEvent: TraceEvent = {
      id: `evt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      timestamp: new Date().toISOString(),
      type: "user_prompt",
      agent,
      data: {
        prompt: options.prompt,
      },
    };
    storage.recordEvent(promptEvent);
  }

  // Execute command with injected session ID
  const [cmd, ...args] = commandArgs;

  let exitCode = 0;
  try {
    exitCode = await new Promise<number>((resolve) => {
      const child: ChildProcess = spawn(cmd, args, {
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          TRACEEVAL_SESSION_ID: sessionId,
        },
      });

      if (child.pid) {
        SessionProcessRegistry.register(sessionId, {
          pid: child.pid,
          process: child,
          agent,
        });
      }

      child.on("close", (code) => {
        SessionProcessRegistry.unregister(sessionId);
        resolve(code ?? 0);
      });

      child.on("error", () => {
        SessionProcessRegistry.unregister(sessionId);
        resolve(1);
      });
    });
  } catch {
    SessionProcessRegistry.unregister(sessionId);
    exitCode = 1;
  }

  const durationMs = Date.now() - startTs;
  const endTime = new Date().toISOString();
  const status = exitCode === 0 ? "completed" : "error";

  // Record session end
  const endEvent: TraceEvent = {
    id: `evt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    sessionId,
    timestamp: endTime,
    type: "session_end",
    agent,
    data: {
      exitCode,
      durationMs,
    },
  };
  storage.recordEvent(endEvent);

  storage.upsertSession({
    id: sessionId,
    endTime,
    durationMs,
    status,
  });

  const session = storage.getSession(sessionId);
  const eventCount = session?.events.length || 0;

  console.log(pc.dim("─".repeat(60)));
  console.log(pc.bold(pc.green("✔ Trace recording finished")));
  console.log(`  Duration:    ${durationMs}ms`);
  console.log(`  Events:      ${eventCount} events recorded`);
  console.log(`  Trace log:   ${pc.dim(`.traceeval/traces/${sessionId}.jsonl`)}`);
  console.log("");
  console.log(`To evaluate this trace, run:`);
  console.log(`  ${pc.cyan(`traceeval test --session ${sessionId}`)}`);
  console.log("");

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
