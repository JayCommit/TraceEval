import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadTestsFromPath } from "../engine/loader.js";
import { TestRunner } from "../engine/runner.js";
import { formatTerminalReport } from "../reporters/terminal.js";
import { formatMarkdownReport } from "../reporters/markdown.js";

export interface TestOptions {
  session?: string;
  skipRun?: boolean;
  updateGolden?: boolean;
  markdown?: boolean;
  json?: boolean;
  output?: string;
  ci?: boolean;
  runs?: number;
  minSuccess?: number | string;
  judge?: boolean;
}

export async function runTestCommand(
  targetPath?: string,
  options: TestOptions = {}
): Promise<void> {
  const cwd = process.cwd();
  const testDir = targetPath || path.join(cwd, ".traceeval", "tests");

  const tests = loadTestsFromPath(testDir);

  if (tests.length === 0) {
    console.log(pc.yellow(`No tests found in: ${testDir}`));
    console.log(`Run ${pc.cyan("traceeval init")} to create a starter test suite.`);
    process.exit(1);
  }

  const runner = new TestRunner({
    workspaceDir: cwd,
    sessionId: options.session,
    skipRun: options.skipRun,
    updateGolden: options.updateGolden,
    runs: options.runs,
    minSuccess: options.minSuccess,
    enableJudge: options.judge,
  });

  const suiteResult = await runner.runSuite(tests);

  const isCi = Boolean(options.ci || process.env.CI || process.env.GITHUB_ACTIONS);

  if (options.json) {
    console.log(JSON.stringify(suiteResult, null, 2));
  } else if (options.markdown) {
    const md = formatMarkdownReport(suiteResult);
    console.log(md);
  } else {
    const termReport = formatTerminalReport(suiteResult, {
      cwd,
      ci: options.ci ?? isCi,
    });
    console.log(termReport);
  }

  // Write report to $GITHUB_STEP_SUMMARY if running in GitHub Actions or in CI
  const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
  if ((options.ci || process.env.GITHUB_ACTIONS) && githubStepSummary) {
    try {
      const mdReport = formatMarkdownReport(suiteResult);
      fs.appendFileSync(githubStepSummary, mdReport + "\n\n", "utf-8");
    } catch (err) {
      if (process.env.DEBUG || process.env.TRACEEVAL_DEBUG) {
        console.error(`Failed to write to GITHUB_STEP_SUMMARY: ${err}`);
      }
    }
  }

  if (options.output) {
    const outputPath = path.resolve(cwd, options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const content = options.output.endsWith(".json")
      ? JSON.stringify(suiteResult, null, 2)
      : formatMarkdownReport(suiteResult);
    fs.writeFileSync(outputPath, content, "utf-8");
    console.log(pc.dim(`Report saved to: ${outputPath}`));
  }

  if (suiteResult.failed > 0) {
    process.exit(1);
  }
}
