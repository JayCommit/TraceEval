import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import {
  compareTraces,
  extractSessionMetrics,
  compareWithGolden,
} from "../engine/differencer.js";
import { getDistinctToolCalls } from "../engine/assertions/utils.js";

export function runTracesList(): void {
  const storage = new StorageManager();
  const sessions = storage.listSessions(20);

  if (sessions.length === 0) {
    console.log(pc.yellow("No recorded traces found in this project."));
    console.log(
      `Run ${pc.cyan("traceeval record -- <command>")} or install hooks with ${pc.cyan("traceeval install claude")}`
    );
    return;
  }

  console.log("");
  console.log(pc.bold(pc.cyan("Recorded Agent Traces")));
  console.log(pc.dim("─".repeat(70)));
  console.log(
    pc.bold(
      `  ${"SESSION ID".padEnd(28)} ${"STATUS".padEnd(12)} ${"EVENTS".padEnd(8)} ${"STARTED"}`
    )
  );
  console.log(pc.dim("─".repeat(70)));

  for (const s of sessions) {
    const statusColor =
      s.status === "completed"
        ? pc.green(s.status.padEnd(12))
        : s.status === "active"
        ? pc.cyan(s.status.padEnd(12))
        : pc.red(s.status.padEnd(12));

    const startTimeFormatted = new Date(s.startTime).toLocaleString();
    console.log(
      `  ${s.id.padEnd(28)} ${statusColor} ${String(s.eventCount).padEnd(8)} ${pc.dim(startTimeFormatted)}`
    );
    if (s.command) {
      console.log(`  ${pc.dim(`└─ cmd: ${s.command}`)}`);
    }
  }
  console.log(pc.dim("─".repeat(70)));
  console.log(`View trace details: ${pc.cyan("traceeval traces show <sessionId>")}`);
  console.log(`Compare traces:     ${pc.cyan("traceeval traces diff <sessionId1> <sessionId2>")}`);
  console.log("");
}

export function runTracesShow(sessionId: string): void {
  const storage = new StorageManager();
  const session = storage.getSession(sessionId);

  if (!session) {
    console.error(pc.red(`Trace session '${sessionId}' not found.`));
    process.exit(1);
  }

  const metrics = extractSessionMetrics(session);
  const distinctCalls = getDistinctToolCalls(session.events);

  console.log("");
  console.log(pc.bold(pc.cyan(`Trace Session: ${session.id}`)));
  console.log(pc.dim("─".repeat(70)));
  console.log(`  Agent:      ${session.agent}`);
  console.log(`  Status:     ${session.status === "completed" ? pc.green("completed") : pc.yellow(session.status)}`);
  console.log(`  Started:    ${session.startTime}`);
  if (session.endTime) console.log(`  Ended:      ${session.endTime}`);
  console.log(`  Duration:   ${metrics.durationMs}ms`);
  if (session.command) console.log(`  Command:    ${session.command}`);
  if (session.prompt) console.log(`  Prompt:     "${session.prompt}"`);

  if (metrics.cost !== undefined || metrics.tokens?.total !== undefined) {
    const costStr = metrics.cost !== undefined ? `$${metrics.cost.toFixed(4)}` : "N/A";
    const tokStr = metrics.tokens?.total !== undefined ? `${metrics.tokens.total.toLocaleString()} tokens` : "N/A";
    console.log(`  Metrics:    Cost: ${costStr} • Tokens: ${tokStr}`);
  }

  if (metrics.filesTouched.length > 0) {
    console.log(`  Files:      ${metrics.filesTouched.join(", ")}`);
  }

  const toolSummary = Object.entries(metrics.toolCallBreakdown)
    .map(([t, count]) => `${t}: ${count}`)
    .join(", ");
  if (toolSummary) {
    console.log(`  Tools:      ${toolSummary} (${metrics.stepCount} distinct steps)`);
  }

  console.log(pc.dim("─".repeat(70)));
  console.log(pc.bold(`Timeline (${session.events.length} events, ${distinctCalls.length} tool calls):`));

  for (const [idx, evt] of session.events.entries()) {
    const time = evt.timestamp.split("T")[1]?.slice(0, 8) || evt.timestamp;
    const typeLabel = `[${evt.type}]`.padEnd(18);

    let summary = "";
    if (evt.type === "tool_call" || evt.type === "tool_call_start") {
      const tool = evt.data.toolName || evt.data.tool || evt.data.name || "unknown";
      summary = `Tool: ${pc.bold(String(tool))}`;

      let inputStr = "";
      if (evt.data.input) {
        if (typeof evt.data.input === "string") {
          inputStr = evt.data.input;
        } else if (typeof evt.data.input === "object") {
          const inObj = evt.data.input as Record<string, unknown>;
          if (inObj.command) inputStr = `cmd="${inObj.command}"`;
          else if (inObj.path) inputStr = `path="${inObj.path}"`;
          else if (inObj.file) inputStr = `file="${inObj.file}"`;
          else inputStr = JSON.stringify(inObj);
        }
      } else if (evt.data.command) {
        inputStr = `cmd="${evt.data.command}"`;
      }

      if (inputStr) {
        const truncated = inputStr.length > 60 ? `${inputStr.slice(0, 57)}...` : inputStr;
        summary += ` ${pc.dim(truncated)}`;
      }

      if (evt.data.status) {
        const st = String(evt.data.status);
        summary += ` (${st === "success" ? pc.green(st) : pc.red(st)})`;
      }
    } else if (evt.type === "file_change") {
      const filePath = evt.data.path || evt.data.file || "unknown file";
      const changeType = evt.data.changeType || "modified";
      summary = `File ${changeType}: ${pc.bold(String(filePath))}`;
    } else if (evt.type === "user_prompt") {
      summary = `User Prompt: "${String(evt.data.prompt || "").slice(0, 50)}..."`;
    } else if (evt.type === "agent_thought") {
      const thought = String(evt.data.thought || evt.data.message || "");
      summary = `Thought: ${pc.italic(thought.slice(0, 60))}...`;
    } else if (evt.type === "session_start") {
      summary = `Session started`;
    } else if (evt.type === "session_end") {
      summary = `Session completed (${evt.data.durationMs ?? 0}ms)`;
    } else if (evt.type === "custom") {
      summary = `${evt.data.assertionType || "custom"}: ${JSON.stringify(evt.data).slice(0, 60)}`;
    }

    console.log(
      `  ${pc.dim(String(idx + 1).padStart(2))}  ${pc.dim(time)}  ${pc.cyan(typeLabel)}  ${summary}`
    );
  }
  console.log("");
}

export function runTracesDiff(
  target1: string,
  target2?: string,
  options: { golden?: string } = {}
): void {
  const storage = new StorageManager();

  // Mode A: Compare target1 with a golden baseline
  const goldenName = options.golden || (target2 && storage.getGolden(target2) ? target2 : undefined);
  if (goldenName) {
    const session = storage.getSession(target1);
    if (!session) {
      console.error(pc.red(`Trace session '${target1}' not found.`));
      process.exit(1);
    }
    const golden = storage.getGolden(goldenName);
    if (!golden) {
      console.error(pc.red(`Golden baseline '${goldenName}' not found.`));
      process.exit(1);
    }

    const diff = compareWithGolden(session, golden);
    printGoldenDiffView(session.id, goldenName, golden, diff);
    return;
  }

  // Mode B: Compare two trace sessions
  if (!target2) {
    console.error(pc.yellow("Please provide a second session ID or --golden <test-name> to compare against."));
    console.log(`Example: ${pc.cyan("traceeval traces diff <sessionId1> <sessionId2>")}`);
    console.log(`Example: ${pc.cyan("traceeval traces diff <sessionId1> --golden <test-name>")}`);
    process.exit(1);
  }

  const sessionA = storage.getSession(target1);
  if (!sessionA) {
    console.error(pc.red(`Trace session A '${target1}' not found.`));
    process.exit(1);
  }

  const sessionB = storage.getSession(target2);
  if (!sessionB) {
    console.error(pc.red(`Trace session B '${target2}' not found.`));
    process.exit(1);
  }

  const diffResult = compareTraces(sessionA, sessionB);
  printTracesDiffView(diffResult);
}

function printGoldenDiffView(
  sessionId: string,
  goldenName: string,
  golden: ReturnType<StorageManager["getGolden"]> & object,
  diff: ReturnType<typeof compareWithGolden>
): void {
  console.log("");
  console.log(pc.bold(pc.cyan(`Trace Comparison: ${sessionId} vs Golden Baseline (${goldenName})`)));
  console.log(pc.dim("─".repeat(70)));
  console.log(
    pc.bold(`  ${"METRIC".padEnd(16)} ${"GOLDEN".padEnd(14)} ${"CURRENT".padEnd(14)} ${"DELTA"}`)
  );
  console.log(pc.dim("─".repeat(70)));

  const stepSign = diff.stepDelta > 0 ? `+${diff.stepDelta}` : `${diff.stepDelta}`;
  const stepColor = diff.stepDelta > 0 ? pc.yellow : pc.green;
  const stepPct = `[${diff.stepPercentDelta >= 0 ? "+" : ""}${diff.stepPercentDelta.toFixed(1)}%]`;
  console.log(
    `  ${"Steps".padEnd(16)} ${String(golden.stepCount).padEnd(14)} ${String(diff.current?.stepCount ?? "?").padEnd(14)} ${stepColor(`${stepSign} ${stepPct}`)}`
  );

  if (diff.durationDelta !== undefined && golden.durationMs) {
    const durSign = diff.durationDelta >= 0 ? `+${diff.durationDelta}ms` : `${diff.durationDelta}ms`;
    const durColor = diff.durationDelta > 0 ? pc.yellow : pc.green;
    console.log(
      `  ${"Duration".padEnd(16)} ${`${golden.durationMs}ms`.padEnd(14)} ${`${diff.current?.durationMs ?? "?"}ms`.padEnd(14)} ${durColor(durSign)}`
    );
  }

  if (diff.costDelta !== undefined) {
    const costSign = diff.costDelta >= 0 ? `+$${diff.costDelta.toFixed(4)}` : `-$${Math.abs(diff.costDelta).toFixed(4)}`;
    console.log(
      `  ${"Cost".padEnd(16)} ${`$${(golden.cost ?? 0).toFixed(4)}`.padEnd(14)} ${"Current".padEnd(14)} ${costSign}`
    );
  }

  console.log(pc.dim("─".repeat(70)));
  console.log(pc.bold("Tool Invocations Delta:"));
  for (const [tool, d] of Object.entries(diff.toolDeltas || {})) {
    const deltaStr = d.delta > 0 ? pc.yellow(`+${d.delta}`) : d.delta < 0 ? pc.cyan(`${d.delta}`) : pc.dim("0");
    console.log(`  • ${tool.padEnd(20)} Golden: ${String(d.baseline).padStart(3)} | Current: ${String(d.current).padStart(3)} | Delta: ${deltaStr}`);
  }

  if (diff.isRegression) {
    console.log(pc.dim("─".repeat(70)));
    console.log(pc.red(pc.bold("⚠ Regression Warnings:")));
    for (const reason of diff.regressionReasons) {
      console.log(`  ${pc.red("•")} ${reason}`);
    }
  }
  console.log("");
}

function printTracesDiffView(diff: ReturnType<typeof compareTraces>): void {
  console.log("");
  console.log(pc.bold(pc.cyan(`Trace Comparison: ${diff.sessionA.id} (A) vs ${diff.sessionB.id} (B)`)));
  console.log(pc.dim("─".repeat(70)));
  console.log(
    pc.bold(`  ${"METRIC".padEnd(16)} ${"SESSION A".padEnd(14)} ${"SESSION B".padEnd(14)} ${"DELTA"}`)
  );
  console.log(pc.dim("─".repeat(70)));

  const stepSign = diff.stepDelta > 0 ? `+${diff.stepDelta}` : `${diff.stepDelta}`;
  const stepColor = diff.stepDelta > 0 ? pc.yellow : diff.stepDelta < 0 ? pc.green : pc.dim;
  const stepPct = `[${diff.stepPercentDelta >= 0 ? "+" : ""}${diff.stepPercentDelta.toFixed(1)}%]`;
  console.log(
    `  ${"Step Count:".padEnd(16)} ${String(diff.sessionA.stepCount).padEnd(14)} ${String(diff.sessionB.stepCount).padEnd(14)} ${stepColor(`${stepSign} ${stepPct}`)}`
  );

  const durSign = diff.durationDelta >= 0 ? `+${diff.durationDelta}ms` : `${diff.durationDelta}ms`;
  const durColor = diff.durationDelta > 0 ? pc.yellow : pc.green;
  console.log(
    `  ${"Duration:".padEnd(16)} ${`${diff.sessionA.durationMs}ms`.padEnd(14)} ${`${diff.sessionB.durationMs}ms`.padEnd(14)} ${durColor(durSign)}`
  );

  if (diff.costDelta !== undefined) {
    const costSign = diff.costDelta >= 0 ? `+$${diff.costDelta.toFixed(4)}` : `-$${Math.abs(diff.costDelta).toFixed(4)}`;
    console.log(
      `  ${"Cost".padEnd(16)} ${`$${(diff.sessionA.cost ?? 0).toFixed(4)}`.padEnd(14)} ${`$${(diff.sessionB.cost ?? 0).toFixed(4)}`.padEnd(14)} ${costSign}`
    );
  }

  console.log(pc.dim("─".repeat(70)));
  console.log(pc.bold("Tool Calls Comparison:"));
  for (const [tool, d] of Object.entries(diff.toolDeltas)) {
    const deltaStr = d.delta > 0 ? pc.yellow(`+${d.delta}`) : d.delta < 0 ? pc.cyan(`${d.delta}`) : pc.dim("0");
    console.log(
      `  • ${tool.padEnd(20)} A: ${String(d.baseline).padStart(3)} | B: ${String(d.current).padStart(3)} | Delta: ${deltaStr}`
    );
  }

  if (diff.toolsAdded.length > 0) {
    console.log(`  ${pc.yellow("Tools introduced in B:")} ${diff.toolsAdded.join(", ")}`);
  }
  if (diff.toolsRemoved.length > 0) {
    console.log(`  ${pc.dim("Tools omitted in B:")}    ${diff.toolsRemoved.join(", ")}`);
  }

  if (diff.filesTouchedA.length > 0 || diff.filesTouchedB.length > 0) {
    console.log(pc.dim("─".repeat(70)));
    console.log(pc.bold("Files Touched Comparison:"));
    if (diff.filesShared.length > 0) {
      console.log(`  • Shared:    ${diff.filesShared.join(", ")}`);
    }
    if (diff.filesAdded.length > 0) {
      console.log(`  • In B only: ${pc.yellow(diff.filesAdded.join(", "))}`);
    }
    if (diff.filesRemoved.length > 0) {
      console.log(`  • In A only: ${pc.dim(diff.filesRemoved.join(", "))}`);
    }
  }

  console.log("");
}
