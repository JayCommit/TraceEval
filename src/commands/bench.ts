import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn, execSync, ChildProcess } from "node:child_process";
import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import { loadTestFile } from "../engine/loader.js";
import { evaluateAssertion } from "../engine/assertions/index.js";
import { SessionProcessRegistry } from "../engine/control.js";
import { createViewerServer } from "./view.js";
import { generateArenaHtml } from "../viewer/html.js";
import { TraceEvent, TraceSession, AssertionResult } from "../types/index.js";

export interface BenchmarkOptions {
  agents?: string[] | string;
  prompt?: string;
  test?: string;
  workspace?: string;
  timeout?: number | string;
  parallel?: boolean;
  serve?: boolean;
  openBrowser?: boolean;
  port?: number | string;
  host?: string;
  token?: string;
  output?: string;
  cmd?: string;
  commands?: Record<string, string> | string;
}

export interface AgentBenchmarkRun {
  agent: string;
  sessionId: string;
  workspaceDir: string;
  command: string;
  status: "completed" | "error" | "aborted" | "active";
  durationMs: number;
  stepCount: number;
  filesTouched: number;
  assertionResults?: AssertionResult[];
  allPassed?: boolean;
}

/**
 * Resolves standard command line invocation for supported agents.
 */
export function resolveAgentCommand(
  agent: string,
  prompt: string,
  options: {
    cmdTemplate?: string;
    customCommands?: Record<string, string>;
  } = {}
): string {
  const normAgent = agent.toLowerCase().trim();

  // 1. Explicit per-agent command overrides
  if (options.customCommands && options.customCommands[normAgent]) {
    return options.customCommands[normAgent].replace(/\{prompt\}/g, prompt);
  }

  // 2. Generic command template
  if (options.cmdTemplate) {
    return options.cmdTemplate
      .replace(/\{agent\}/g, normAgent)
      .replace(/\{prompt\}/g, prompt);
  }

  // 3. Default agent CLI conventions
  const safePrompt = prompt.replace(/"/g, '\\"');
  switch (normAgent) {
    case "claude":
    case "claude-code":
      return `claude -p "${safePrompt}"`;
    case "cursor":
      return `cursor --prompt "${safePrompt}"`;
    case "grok":
      return `grok run "${safePrompt}"`;
    case "grok-bot":
    case "grokbot":
      return `grok-bot run "${safePrompt}"`;
    case "openai":
    case "chatgpt":
      return `openai run "${safePrompt}"`;
    case "antigravity":
    case "agy":
      return `agy run "${safePrompt}"`;
    case "opencode":
      return `opencode run "${safePrompt}"`;
    default:
      return `${normAgent} run "${safePrompt}"`;
  }
}

/**
 * Copies source directory to destination, skipping internal cache and version control directories.
 */
function copyWorkspaceFiles(srcDir: string, destDir: string): void {
  const IGNORED = new Set([
    ".git",
    "node_modules",
    ".traceeval",
    "dist",
    ".cache",
    ".tmp",
    ".idea",
    ".vscode",
  ]);

  const copyRecursive = (currentSrc: string, currentDest: string) => {
    if (!fs.existsSync(currentDest)) {
      fs.mkdirSync(currentDest, { recursive: true });
    }

    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);

      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  };

  copyRecursive(srcDir, destDir);
}

/**
 * Automates multi-agent benchmark launching in isolated workspaces.
 */
export async function runBenchmark(options: BenchmarkOptions = {}): Promise<AgentBenchmarkRun[]> {
  const storage = new StorageManager();

  // Resolve target agents list
  let agentList: string[] = ["claude", "cursor"];
  if (Array.isArray(options.agents)) {
    agentList = options.agents.map((a) => a.trim()).filter(Boolean);
  } else if (typeof options.agents === "string" && options.agents.trim().length > 0) {
    agentList = options.agents.split(",").map((a) => a.trim()).filter(Boolean);
  }

  if (agentList.length < 2) {
    console.log(pc.yellow("Benchmark launching requires at least 2 agents to compare. Defaulting to 'claude,cursor'."));
    agentList = ["claude", "cursor"];
  }

  // Parse custom commands map if provided as JSON string
  let customCommands: Record<string, string> = {};
  if (typeof options.commands === "string") {
    try {
      customCommands = JSON.parse(options.commands);
    } catch {
      // Ignore JSON error
    }
  } else if (options.commands && typeof options.commands === "object") {
    customCommands = options.commands;
  }

  // Load test spec if specified
  let testCase: ReturnType<typeof loadTestFile>["testCase"] | null = null;
  let testPrompt: string | undefined;

  if (options.test) {
    const testPath = path.resolve(options.test);
    if (!fs.existsSync(testPath)) {
      console.error(pc.red(`Error: Test specification file not found: ${testPath}`));
      process.exit(1);
    }
    const loaded = loadTestFile(testPath);
    testCase = loaded.testCase;
    testPrompt = testCase.run?.prompt;
  }

  const effectivePrompt = options.prompt || testPrompt || "Implement requested changes according to repository specifications";
  const timeoutMs = typeof options.timeout === "number" ? options.timeout : (options.timeout ? parseInt(String(options.timeout), 10) : 120000);
  const isParallel = options.parallel !== false;

  console.log(pc.bold(pc.cyan("TraceEval ⚔️ Automated Multi-Agent Benchmark Launch")));
  console.log(`  Task Prompt: ${pc.green(`"${effectivePrompt.length > 70 ? effectivePrompt.slice(0, 67) + "..." : effectivePrompt}"`)}`);
  console.log(`  Agents:      ${agentList.map((a) => pc.bold(a)).join(" vs ")}`);
  console.log(`  Mode:        ${isParallel ? "Parallel" : "Sequential"} execution in isolated workspaces`);
  if (options.test) {
    console.log(`  Test Spec:   ${pc.dim(options.test)}`);
  }
  console.log(pc.dim("─".repeat(60)));

  // Setup isolated workspaces and session IDs for each agent
  const benchmarkRuns: AgentBenchmarkRun[] = [];
  const baseWorkspace = options.workspace || process.cwd();

  for (const agent of agentList) {
    const safeAgent = agent.replace(/[^a-zA-Z0-9_-]/g, "_") || "agent";
    const sessionId = `bench-${safeAgent}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const workspacesBase = path.resolve(storage.baseDir, "workspaces");
    const workspaceDir = path.resolve(workspacesBase, `${safeAgent}-${sessionId}`);
    if (!workspaceDir.startsWith(workspacesBase + path.sep)) {
      throw new Error(`Security error: Workspace directory escapes workspaces root`);
    }
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Populate isolated workspace
    if (testCase?.setup?.files) {
      const resolvedWorkspace = path.resolve(workspaceDir);
      for (const [relPath, content] of Object.entries(testCase.setup.files)) {
        const destPath = path.resolve(workspaceDir, relPath);
        if (!destPath.startsWith(resolvedWorkspace + path.sep) && destPath !== resolvedWorkspace) {
          throw new Error(`Security error: Setup file path '${relPath}' escapes workspace directory`);
        }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, content, "utf-8");
      }
    } else {
      // Copy workspace files
      copyWorkspaceFiles(baseWorkspace, workspaceDir);
    }

    if (testCase?.setup?.command) {
      try {
        execSync(testCase.setup.command, { cwd: workspaceDir, stdio: "ignore" });
      } catch {
        // Setup command error
      }
    }

    const command = resolveAgentCommand(agent, effectivePrompt, {
      cmdTemplate: options.cmd,
      customCommands,
    });

    // Record initial session
    const startTime = new Date().toISOString();
    storage.upsertSession({
      id: sessionId,
      agent,
      command,
      prompt: effectivePrompt,
      startTime,
      status: "active",
      metadata: {
        isBenchmark: true,
        testPath: options.test,
        workspaceDir,
      },
    });

    const startEvent: TraceEvent = {
      id: `evt-start-${sessionId}`,
      sessionId,
      timestamp: startTime,
      type: "session_start",
      agent,
      data: { command, prompt: effectivePrompt },
    };
    storage.recordEvent(startEvent);

    const promptEvent: TraceEvent = {
      id: `evt-prompt-${sessionId}`,
      sessionId,
      timestamp: new Date().toISOString(),
      type: "user_prompt",
      agent,
      data: { prompt: effectivePrompt },
    };
    storage.recordEvent(promptEvent);

    benchmarkRuns.push({
      agent,
      sessionId,
      workspaceDir,
      command,
      status: "active",
      durationMs: 0,
      stepCount: 0,
      filesTouched: 0,
    });
  }

  // Launch live Arena viewer if requested (default: true)
  let viewerClose: (() => void) | null = null;
  const sessionIds = benchmarkRuns.map((r) => r.sessionId);

  if (options.serve !== false) {
    const port = options.port || 4242;
    const host = options.host || "127.0.0.1";
    try {
      const viewer = createViewerServer(storage, sessionIds, {
        token: options.token,
      });
      viewerClose = viewer.close;

      await new Promise<void>((resolve) => {
        viewer.server.listen(Number(port), host, () => {
          const authParam = options.token ? `?token=${encodeURIComponent(options.token)}` : "";
          const arenaUrl = `http://${host}:${port}/?sessions=${sessionIds.join(",")}${authParam ? "&" + authParam.slice(1) : ""}`;
          console.log(pc.green(`✔ Live Arena streaming online: ${pc.bold(pc.cyan(arenaUrl))}`));
          resolve();
        });
      });
    } catch {
      // Continue if viewer server fails to bind (e.g. port taken in test)
    }
  }

  // Execute an individual agent in its isolated workspace
  const executeAgent = async (run: AgentBenchmarkRun): Promise<void> => {
    const startTs = Date.now();
    console.log(`  ${pc.cyan("▶")} Launching ${pc.bold(run.agent)} in ${pc.dim(path.basename(run.workspaceDir))}...`);

    const runEnv = {
      ...process.env,
      TRACEEVAL_SESSION_ID: run.sessionId,
      TRACEEVAL_AGENT: run.agent,
      TRACEEVAL_BASE_DIR: path.resolve(storage.baseDir),
      TRACEEVAL_WORKSPACE: run.workspaceDir,
    };

    let exitCode = 0;
    let stderrOutput = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const child: ChildProcess = spawn(run.command, {
          cwd: run.workspaceDir,
          env: runEnv,
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        if (child.pid) {
          SessionProcessRegistry.register(run.sessionId, {
            pid: child.pid,
            process: child,
            agent: run.agent,
          });
        }

        child.stderr?.on("data", (chunk: Buffer) => {
          stderrOutput += chunk.toString("utf-8");
          if (stderrOutput.length > 4096) {
            stderrOutput = stderrOutput.slice(-4096);
          }
        });

        const killTimer = setTimeout(() => {
          try {
            if (child && !child.killed) {
              child.kill("SIGTERM");
              setTimeout(() => {
                try {
                  if (child && !child.killed) child.kill("SIGKILL");
                } catch {}
              }, 1000).unref();
            }
          } catch {}
          reject(new Error(`Timeout reached (${timeoutMs}ms)`));
        }, timeoutMs);
        killTimer.unref();

        child.on("close", (code) => {
          clearTimeout(killTimer);
          SessionProcessRegistry.unregister(run.sessionId);
          exitCode = code ?? 0;
          resolve();
        });

        child.on("error", (err) => {
          clearTimeout(killTimer);
          SessionProcessRegistry.unregister(run.sessionId);
          reject(err);
        });
      });

      if (exitCode !== 0) {
        run.status = "error";
        const errDetails = stderrOutput.trim() || `Process exited with code ${exitCode}`;
        console.log(`  ${pc.red("✖")} ${run.agent} failed: ${errDetails}`);
      } else {
        run.status = "completed";
      }
    } catch (err: unknown) {
      run.status = "error";
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${pc.red("✖")} ${run.agent} execution failed: ${message}`);
    }

    run.durationMs = Date.now() - startTs;

    // Record session end
    const endEvent: TraceEvent = {
      id: `evt-end-${run.sessionId}`,
      sessionId: run.sessionId,
      timestamp: new Date().toISOString(),
      type: "session_end",
      agent: run.agent,
      data: {
        durationMs: run.durationMs,
        status: run.status,
      },
    };
    storage.recordEvent(endEvent);
    storage.upsertSession({
      id: run.sessionId,
      endTime: new Date().toISOString(),
      durationMs: run.durationMs,
      status: run.status === "completed" ? "completed" : "error",
    });

    // Evaluate assertions if test specification is present
    if (testCase?.assertions && testCase.assertions.length > 0) {
      const results: AssertionResult[] = [];
      let allPassed = true;

      const sessionObj = storage.getSession(run.sessionId);
      for (const assertion of testCase.assertions) {
        const evaluated = await evaluateAssertion(assertion, {
          workspaceDir: run.workspaceDir,
          storage,
          traceSession: sessionObj,
        });
        results.push(evaluated);
        if (!evaluated.passed) allPassed = false;
      }

      run.assertionResults = results;
      run.allPassed = allPassed;
    }

    // Retrieve metrics from stored session
    const fullSession = storage.getSession(run.sessionId);
    if (fullSession) {
      run.stepCount = fullSession.events.filter(
        (e) => e.type === "tool_call" || e.type === "tool_call_start"
      ).length;
      run.filesTouched = fullSession.events.filter(
        (e) => e.type === "file_change"
      ).length;
    }

    const statusBadge =
      run.status === "completed"
        ? (run.allPassed !== false ? pc.green("COMPLETED") : pc.yellow("FAILED ASSERTIONS"))
        : pc.red("ERROR");

    const isSuccess = run.status === "completed" && run.allPassed !== false;
    const icon = isSuccess ? pc.green("✔") : pc.red("✖");

    console.log(
      `  ${icon} ${pc.bold(run.agent)} finished in ${run.durationMs}ms [${statusBadge}] (${run.stepCount} steps, ${run.filesTouched} files)`
    );
  };

  // Run all agents
  if (isParallel) {
    await Promise.allSettled(benchmarkRuns.map((r) => executeAgent(r)));
  } else {
    for (const r of benchmarkRuns) {
      await executeAgent(r);
    }
  }

  // Print Comparison Scoreboard in Terminal
  console.log("");
  console.log(pc.bold(pc.cyan("⚔️ Multi-Agent Benchmark Head-to-Head Results")));
  console.log(pc.dim("─".repeat(70)));
  console.log(
    `  ${"AGENT".padEnd(16)} ${"STATUS".padEnd(14)} ${"STEPS".padEnd(10)} ${"DURATION".padEnd(12)} ${"ASSERTIONS"}`
  );
  console.log(pc.dim("─".repeat(70)));

  for (const r of benchmarkRuns) {
    const statusText =
      r.status === "completed"
        ? (r.allPassed !== false ? pc.green("PASSED") : pc.yellow("ASSERT FAIL"))
        : pc.red("ERROR");

    let assertText = pc.dim("N/A");
    if (r.assertionResults) {
      const passed = r.assertionResults.filter((a) => a.passed).length;
      const total = r.assertionResults.length;
      assertText = passed === total ? pc.green(`${passed}/${total} passed`) : pc.yellow(`${passed}/${total} passed`);
    }

    console.log(
      `  ${pc.bold(r.agent).padEnd(16)} ${statusText.padEnd(23)} ${String(r.stepCount).padEnd(10)} ${`${r.durationMs}ms`.padEnd(12)} ${assertText}`
    );
  }
  console.log(pc.dim("─".repeat(70)));

  // Export static report if requested
  if (options.output) {
    const activeSessions: TraceSession[] = [];
    for (const r of benchmarkRuns) {
      const s = storage.getSession(r.sessionId);
      if (s) activeSessions.push(s);
    }

    const html = generateArenaHtml(activeSessions, { isLive: false });
    const outPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, "utf-8");
    console.log(`✔ Static Arena benchmark report exported to: ${pc.cyan(outPath)}`);
  }

  // Close server if viewer was ephemeral
  if (viewerClose && (process.env.CI || process.env.VITEST)) {
    viewerClose();
  }

  return benchmarkRuns;
}
