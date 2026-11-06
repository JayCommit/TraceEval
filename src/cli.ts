#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runInstall } from "./commands/install.js";
import { runRecord } from "./commands/record.js";
import { runTestCommand } from "./commands/test.js";
import { runHook } from "./commands/hook.js";
import { runTracesList, runTracesShow, runTracesDiff } from "./commands/traces.js";
import { runView } from "./commands/view.js";
import { runSpecs } from "./commands/specs.js";
import { runMcpServer } from "./commands/mcp.js";
import {
  runUpdateGolden,
  runGoldenList,
  runGoldenShow,
  runGoldenRemove,
} from "./commands/golden.js";

const program = new Command();

program
  .name("traceeval")
  .description("TraceEval — Local-first evaluation and regression testing for AI coding agents")
  .version("0.0.4")
  .enablePositionalOptions();

// Command: init
program
  .command("init")
  .description("Initialize TraceEval configuration and starter tests in current directory")
  .option("-f, --force", "Overwrite existing configuration and tests", false)
  .action((options) => {
    runInit({ force: options.force });
  });

// Command: install
program
  .command("install [agent]")
  .description("Install recording hooks into agent configuration (cursor, grok, grok-bot, openai, antigravity, claude, opencode)")
  .option("-g, --global", "Install globally into user home directory settings", false)
  .action((agent = "claude", options) => {
    runInstall(agent, { global: options.global });
  });

// Command: record
program
  .command("record")
  .argument("[cmd...]", "Command and arguments to execute and record")
  .description("Record an agent execution session and save its trace")
  .option("-s, --session <id>", "Custom session ID")
  .option("-a, --agent <name>", "Agent name (e.g., claude-code)", "claude-code")
  .option("-p, --prompt <prompt>", "User prompt provided to the agent")
  .passThroughOptions()
  .action((cmdArgs, options) => {
    // Collect args after "--" if present, otherwise use cmdArgs
    const rawArgs = process.argv.slice(2);
    const dashDashIndex = rawArgs.indexOf("--");
    const commandToRun =
      dashDashIndex !== -1
        ? rawArgs.slice(dashDashIndex + 1)
        : (Array.isArray(cmdArgs) && cmdArgs.length > 0 ? cmdArgs : []);

    runRecord(commandToRun, {
      session: options.session,
      agent: options.agent,
      prompt: options.prompt,
    });
  });

// Command: hook
program
  .command("hook [type]")
  .description("Internal hook endpoint called by agent hooks (stdin piped)")
  .option("-s, --session <id>", "Session ID")
  .option("-a, --agent <name>", "Agent name (cursor, grok, grok-bot, openai, antigravity, claude, opencode)")
  .option("-t, --tool <name>", "Tool name")
  .option("-d, --data <json>", "Additional JSON data")
  .option("--truncate <number>", "Max characters per payload field before truncation", (v) => parseInt(v, 10))
  .option("--debug", "Enable debug logging for hook execution", false)
  .action(async (type = "custom", options) => {
    try {
      await runHook(type, {
        session: options.session,
        agent: options.agent,
        tool: options.tool,
        data: options.data,
        truncate: options.truncate,
        debug: options.debug,
      });
    } catch (err) {
      if (options.debug || process.env.TRACEEVAL_DEBUG === "1" || process.env.DEBUG) {
        console.error("[traceeval:hook:fatal]", err);
      }
    } finally {
      process.exitCode = 0;
    }
  });

// Command: test
program
  .command("test [path]")
  .description("Run declarative YAML test suite against workspace state and traces")
  .option("-s, --session <id>", "Evaluate assertions against specific trace session")
  .option("--skip-run", "Skip executing agent run.command; evaluate against current state", false)
  .option("-u, --update-golden", "Update/create golden baseline for passing runs", false)
  .option("-m, --markdown", "Output report formatted as GitHub Markdown", false)
  .option("-j, --json", "Output report formatted as JSON", false)
  .option("-o, --output <file>", "Save report to output file path")
  .option("--ci", "Run in CI mode with non-zero exit on failure and GitHub annotations", false)
  .option("-r, --runs <number>", "Number of execution runs for statistical evaluation", (v) => parseInt(v, 10), 1)
  .option("--min-success <threshold>", "Minimum success rate threshold for multi-run mode (e.g. 0.8 or 80%)")
  .option("--judge", "Enable optional LLM-as-a-judge assertions", false)
  .action(async (targetPath, options) => {
    await runTestCommand(targetPath, {
      session: options.session,
      skipRun: options.skipRun,
      updateGolden: options.updateGolden,
      markdown: options.markdown,
      json: options.json,
      output: options.output,
      ci: options.ci,
      runs: options.runs,
      minSuccess: options.minSuccess,
      judge: options.judge,
    });
  });

// Command: update-golden
program
  .command("update-golden [test-name]")
  .description("Bless a test run trace as the new golden standard baseline")
  .option("-s, --session <id>", "Trace session ID to bless as golden baseline")
  .action(async (testName, options) => {
    await runUpdateGolden(testName, { session: options.session });
  });

// Command: golden
const goldenCmd = program
  .command("golden")
  .description("Manage recorded golden baseline standards");

goldenCmd
  .command("list", { isDefault: true })
  .description("List all registered golden baselines")
  .action(() => {
    runGoldenList();
  });

goldenCmd
  .command("show <test-name>")
  .description("Display golden baseline details for a test")
  .action((testName) => {
    runGoldenShow(testName);
  });

goldenCmd
  .command("remove <test-name>")
  .description("Delete golden baseline for a test")
  .action((testName) => {
    runGoldenRemove(testName);
  });

// Command: traces
const tracesCmd = program
  .command("traces")
  .description("Inspect and list recorded agent traces");

tracesCmd
  .command("list", { isDefault: true })
  .description("List recent recorded trace sessions")
  .action(() => {
    runTracesList();
  });

tracesCmd
  .command("show <sessionId>")
  .description("Show event timeline for a trace session")
  .action((sessionId) => {
    runTracesShow(sessionId);
  });

tracesCmd
  .command("diff <target1> [target2]")
  .description("Compare two trace sessions or compare a session against a golden baseline")
  .option("-g, --golden <test-name>", "Golden baseline test name to compare target1 against")
  .action((target1, target2, options) => {
    runTracesDiff(target1, target2, { golden: options.golden });
  });

// Command: view
program
  .command("view [sessionId]")
  .description("View interactive HTML trace timeline, side-by-side file diffs, and real-time live events")
  .option("-l, --latest", "View the most recent session")
  .option("-o, --output <file>", "Save HTML to specific file path")
  .option("-s, --serve", "Serve viewer via local HTTP server with real-time SSE streaming")
  .option("-H, --host <host>", "Host address to bind server (default: '127.0.0.1'; use '0.0.0.0' for remote/network access)")
  .option("-p, --port <number>", "Port for local HTTP server", "4242")
  .option("--token <secret>", "Optional access token for remote authentication")
  .option("-g, --golden <test-name>", "Golden baseline test name to compare against")
  .option("--no-open", "Do not automatically launch browser window on serve")
  .action(async (sessionId, options) => {
    await runView(sessionId, {
      latest: options.latest,
      output: options.output,
      serve: options.serve,
      host: options.host,
      port: options.port,
      token: options.token,
      golden: options.golden,
      openBrowser: options.open,
    });
  });

// Command: specs
program
  .command("specs [path]")
  .description("List tests and their linked AGENTS.md / CLAUDE.md spec sections")
  .option("-v, --validate", "Exit with code 1 if any linked spec heading is missing or broken", false)
  .option("-j, --json", "Output spec linkages as JSON", false)
  .action((targetPath, options) => {
    runSpecs(targetPath, {
      validate: options.validate,
      json: options.json,
    });
  });

// Command: mcp
program
  .command("mcp")
  .description("Start Model Context Protocol (MCP) server over stdio for agent trace queries")
  .action(() => {
    runMcpServer();
  });

program.parse(process.argv);
