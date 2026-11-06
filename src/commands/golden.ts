import path from "node:path";
import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import { loadTestsFromPath, LoadedTestCase } from "../engine/loader.js";
import { TestRunner } from "../engine/runner.js";

export interface UpdateGoldenOptions {
  session?: string;
  workspace?: string;
}

export async function runUpdateGolden(
  testName?: string,
  options: UpdateGoldenOptions = {}
): Promise<void> {
  const cwd = options.workspace || process.cwd();
  const storage = new StorageManager({ baseDir: path.join(cwd, ".traceeval") });

  // Mode 1: Bless specific session ID directly
  if (options.session) {
    const session = storage.getSession(options.session);
    if (!session) {
      console.error(pc.red(`Error: Trace session '${options.session}' not found.`));
      process.exit(1);
    }

    if (session.status === "error" || session.status === "aborted") {
      console.error(
        pc.red(`Error: Cannot bless session '${options.session}' because its status is '${session.status}'. Golden baselines require successful runs.`)
      );
      process.exit(1);
    }

    const name = testName || `test-${options.session}`;
    const golden = storage.saveGolden(name, session);
    console.log(
      `${pc.green("✔ Blessed golden run for:")} ${pc.bold(name)} ${pc.dim(`(session: ${session.id}, steps: ${golden.stepCount}, duration: ${golden.durationMs}ms)`)}`
    );
    return;
  }

  // Discover tests in .traceeval/tests
  const testDir = path.join(cwd, ".traceeval", "tests");
  const loadedTests = loadTestsFromPath(testDir);

  if (loadedTests.length === 0) {
    // If no tests discovered, check if latest session exists
    const latest = storage.getLatestSession();
    if (!latest) {
      console.error(pc.yellow("No test suites or recorded trace sessions found."));
      console.log(`Run ${pc.cyan("traceeval test")} or ${pc.cyan("traceeval record")} first.`);
      process.exit(1);
    }

    if (latest.status === "error" || latest.status === "aborted") {
      console.error(
        pc.red(`Error: Latest session '${latest.id}' cannot be blessed as golden because its status is '${latest.status}'.`)
      );
      process.exit(1);
    }

    const name = testName || "default";
    const golden = storage.saveGolden(name, latest);
    console.log(
      `${pc.green("✔ Blessed latest session as golden run for:")} ${pc.bold(name)} ${pc.dim(`(session: ${latest.id}, steps: ${golden.stepCount})`)}`
    );
    return;
  }

  // Filter matching tests
  let targetTests = loadedTests;
  if (testName) {
    const query = testName.toLowerCase();
    targetTests = loadedTests.filter(
      (t) =>
        t.testCase.name.toLowerCase() === query ||
        t.testCase.name.toLowerCase().includes(query) ||
        path.basename(t.filePath).toLowerCase().includes(query)
    );

    if (targetTests.length === 0) {
      // If no matching test case found in YAML, check if latest session can be used
      const latest = storage.getLatestSession();
      if (latest) {
        if (latest.status === "error" || latest.status === "aborted") {
          console.error(
            pc.red(`Error: Latest session '${latest.id}' cannot be blessed as golden because its status is '${latest.status}'.`)
          );
          process.exit(1);
        }
        const golden = storage.saveGolden(testName, latest);
        console.log(
          `${pc.green("✔ Blessed latest session as golden run for:")} ${pc.bold(testName)} ${pc.dim(`(session: ${latest.id}, steps: ${golden.stepCount})`)}`
        );
        return;
      }

      console.error(pc.red(`Error: No test matching '${testName}' found in ${testDir}.`));
      process.exit(1);
    }
  }

  console.log(pc.bold(`Updating golden baselines for ${targetTests.length} test(s)...`));

  const runner = new TestRunner({
    workspaceDir: cwd,
    storage,
    updateGolden: true,
  });

  const suiteResult = await runner.runSuite(targetTests);

  for (const result of suiteResult.results) {
    if (result.status === "passed") {
      console.log(
        `${pc.green("✔ Golden baseline saved:")} ${pc.bold(result.testName)} ${pc.dim(`(trace: ${result.traceSessionId})`)}`
      );
    } else {
      console.error(
        `${pc.red("✖ Cannot bless failing test:")} ${pc.bold(result.testName)} - ${result.error || "Assertions failed"}`
      );
    }
  }

  if (suiteResult.failed > 0) {
    process.exit(1);
  }
}

export function runGoldenList(options: { workspace?: string } = {}): void {
  const cwd = options.workspace || process.cwd();
  const storage = new StorageManager({ baseDir: path.join(cwd, ".traceeval") });
  const goldens = storage.listGoldens();

  if (goldens.length === 0) {
    console.log(pc.yellow("No golden baselines registered."));
    console.log(`Run ${pc.cyan("traceeval test --update-golden")} to capture baselines.`);
    return;
  }

  console.log("");
  console.log(pc.bold(pc.cyan("TraceEval Golden Baselines:")));
  console.log(pc.dim("─".repeat(70)));

  for (const g of goldens) {
    const tools = Object.entries(g.toolCallBreakdown)
      .map(([name, count]) => `${name}:${count}`)
      .join(", ") || "none";

    console.log(`${pc.bold(pc.white(g.testName))}`);
    console.log(`  ${pc.dim("Created:")}  ${new Date(g.createdAt).toLocaleString()}`);
    console.log(`  ${pc.dim("Trace:")}    ${g.traceSessionId}`);
    console.log(`  ${pc.dim("Steps:")}    ${g.stepCount} (tools: ${tools})`);
    console.log(`  ${pc.dim("Duration:")} ${g.durationMs}ms`);
    if (g.filesTouched.length > 0) {
      console.log(`  ${pc.dim("Files:")}    ${g.filesTouched.join(", ")}`);
    }
    if (g.cost !== undefined) {
      console.log(`  ${pc.dim("Cost:")}     $${g.cost}`);
    }
    console.log("");
  }
}

export function runGoldenShow(
  testName: string,
  options: { workspace?: string } = {}
): void {
  const cwd = options.workspace || process.cwd();
  const storage = new StorageManager({ baseDir: path.join(cwd, ".traceeval") });
  const golden = storage.getGolden(testName);

  if (!golden) {
    console.error(pc.red(`Error: Golden baseline for '${testName}' not found.`));
    process.exit(1);
  }

  console.log(JSON.stringify(golden, null, 2));
}

export function runGoldenRemove(
  testName: string,
  options: { workspace?: string } = {}
): void {
  const cwd = options.workspace || process.cwd();
  const storage = new StorageManager({ baseDir: path.join(cwd, ".traceeval") });
  const removed = storage.removeGolden(testName);

  if (removed) {
    console.log(`${pc.green("✔ Removed golden baseline for:")} ${pc.bold(testName)}`);
  } else {
    console.error(pc.red(`Error: Golden baseline for '${testName}' not found.`));
    process.exit(1);
  }
}
