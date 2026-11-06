import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { formatTerminalReport } from "../src/reporters/terminal.js";
import { formatMarkdownReport } from "../src/reporters/markdown.js";
import { SuiteResult, TestResult } from "../src/types/index.js";

describe("Reporters & Regression Output", () => {
  let tmpDir: string;
  const cliPath = path.resolve(__dirname, "../dist/cli.js");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-reporters-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Terminal Reporter", () => {
    it("should format clean passing suite in normal and CI mode", () => {
      const suite: SuiteResult = {
        total: 1,
        passed: 1,
        failed: 0,
        durationMs: 150,
        results: [
          {
            testName: "Greeting Test",
            filePath: "tests/greeting.yaml",
            status: "passed",
            durationMs: 150,
            traceSessionId: "sess-clean-01",
            assertionResults: [
              {
                assertion: { type: "file_contains", path: "src/greet.ts", pattern: "Hello" },
                passed: true,
                message: "Pattern 'Hello' found in src/greet.ts",
              },
              {
                assertion: { type: "max_steps", max: 5 },
                passed: true,
                message: "Step count (3) did not exceed max 5",
              },
            ],
          },
        ],
      };

      // Normal terminal output
      const termOutput = formatTerminalReport(suite, tmpDir);
      expect(termOutput).toContain("TraceEval");
      expect(termOutput).toContain("Greeting Test");
      expect(termOutput).toContain("file_contains");
      expect(termOutput).toContain("ALL TESTS PASSED");

      // CI mode terminal output
      const ciOutput = formatTerminalReport(suite, { cwd: tmpDir, ci: true });
      expect(ciOutput).toContain("TraceEval CI Test Report");
      expect(ciOutput).toContain("[PASS] Greeting Test");
      expect(ciOutput).toContain("[PASS] [file_contains] Pattern 'Hello' found in src/greet.ts");
      expect(ciOutput).toContain("Status:   ALL TESTS PASSED");
    });

    it("should clearly highlight regression breaches, baseline comparisons, tool deltas, and prominent callouts", () => {
      const suite: SuiteResult = {
        total: 1,
        passed: 0,
        failed: 1,
        durationMs: 1400,
        results: [
          {
            testName: "Complex Refactor",
            filePath: "tests/refactor.yaml",
            status: "failed",
            durationMs: 1400,
            traceSessionId: "sess-reg-01",
            goldenBaseline: {
              testName: "Complex Refactor",
              createdAt: "2026-11-01T00:00:00.000Z",
              traceSessionId: "golden-sess-01",
              stepCount: 10,
              toolCallBreakdown: { Bash: 3, Edit: 4 },
              filesTouched: ["src/index.ts"],
              durationMs: 1000,
              cost: 0.015,
            },
            regressionDiff: {
              stepDelta: 5,
              stepPercentDelta: 50.0,
              toolDeltas: {
                Bash: { baseline: 3, current: 5, delta: 2 },
                Edit: { baseline: 4, current: 3, delta: -1 },
                WebSearch: { baseline: 0, current: 1, delta: 1 },
              },
              toolsAdded: ["WebSearch"],
              toolsRemoved: [],
              durationDelta: 400,
              durationPercentDelta: 40.0,
              costDelta: 0.005,
              costPercentDelta: 33.3,
              isRegression: true,
              regressionReasons: [
                "Step count increased by 50.0% (+5 steps: 10 -> 15), exceeding threshold of 20%",
                "Disallowed tool 'WebSearch' was invoked (1 time(s))",
              ],
              baseline: {
                sessionId: "golden-sess-01",
                stepCount: 10,
                durationMs: 1000,
                toolCallBreakdown: { Bash: 3, Edit: 4 },
              },
              current: {
                sessionId: "sess-reg-01",
                stepCount: 15,
                durationMs: 1400,
                toolCallBreakdown: { Bash: 5, Edit: 3, WebSearch: 1 },
              },
            },
            assertionResults: [
              {
                assertion: { type: "file_contains", path: "src/index.ts" },
                passed: true,
                message: "Expected content exists",
              },
            ],
          },
        ],
      };

      // Normal mode
      const termOutput = formatTerminalReport(suite, tmpDir);
      const cleanTerm = termOutput.replace(/\u001b\[[0-9;]*m/g, "");
      expect(cleanTerm).toContain("⚠ REGRESSION");
      expect(cleanTerm).toContain("Baseline Comparison:");
      expect(cleanTerm).toContain("steps 10 -> 15 (+5 [+50.0%])");
      expect(cleanTerm).toContain("Duration drift:");
      expect(cleanTerm).toContain("1000ms -> 1400ms (+400ms [+40.0%])");
      expect(cleanTerm).toContain("Cost drift:");
      expect(cleanTerm).toContain("+$0.0050 [+33.3%]");
      expect(cleanTerm).toContain("Tool usage delta:");
      expect(cleanTerm).toContain("+2 Bash calls, -1 Edit call, +1 WebSearch call");
      expect(cleanTerm).toContain("new: [WebSearch]");
      expect(cleanTerm).toContain("⚠ REGRESSION DETECTED");
      expect(cleanTerm).toContain("Step count increased by 50.0%");
      expect(cleanTerm).toContain("Disallowed tool 'WebSearch' was invoked");
      expect(cleanTerm).toContain("Status:   REGRESSION DETECTED");

      // CI mode
      const ciOutput = formatTerminalReport(suite, { cwd: tmpDir, ci: true });
      expect(ciOutput).toContain("[REGRESSION] Complex Refactor");
      expect(ciOutput).toContain("Baseline Comparison: steps 10 -> 15 (+5 [+50.0%])");
      expect(ciOutput).toContain("Tool usage delta: +2 Bash calls, -1 Edit call, +1 WebSearch call (new: [WebSearch])");
      expect(ciOutput).toContain("[⚠ REGRESSION DETECTED]");
      expect(ciOutput).toContain("- Step count increased by 50.0%");
      expect(ciOutput).toContain("- Disallowed tool 'WebSearch' was invoked");
      expect(ciOutput).toContain("Status:   REGRESSION DETECTED");
    });

    it("should format assertion failure output with expected and actual diffs", () => {
      const suite: SuiteResult = {
        total: 1,
        passed: 0,
        failed: 1,
        durationMs: 80,
        results: [
          {
            testName: "State Check",
            status: "failed",
            durationMs: 80,
            assertionResults: [
              {
                assertion: { type: "max_steps", max: 4 },
                passed: false,
                message: "Step count (6) exceeded maximum allowed (4)",
                expected: 4,
                actual: 6,
              },
            ],
          },
        ],
      };

      const termOutput = formatTerminalReport(suite, tmpDir);
      expect(termOutput).toContain("Expected:");
      expect(termOutput).toContain("Actual:");
      expect(termOutput).toContain("TESTS FAILED");

      const ciOutput = formatTerminalReport(suite, { cwd: tmpDir, ci: true });
      expect(ciOutput).toContain("[FAIL] State Check");
      expect(ciOutput).toContain("[FAIL] [max_steps] Step count (6) exceeded maximum allowed (4)");
      expect(ciOutput).toContain("Expected: 4");
      expect(ciOutput).toContain("Actual:   6");
      expect(ciOutput).toContain("Status:   TESTS FAILED");
    });
  });

  describe("Markdown Reporter", () => {
    it("should render green all-passed status badge, table, and collapsible assertions", () => {
      const suite: SuiteResult = {
        total: 1,
        passed: 1,
        failed: 0,
        durationMs: 250,
        results: [
          {
            testName: "Passing Test",
            status: "passed",
            durationMs: 250,
            assertionResults: [
              {
                assertion: { type: "file_exists", path: "dist/index.js" },
                passed: true,
                message: "File dist/index.js exists",
              },
            ],
          },
        ],
      };

      const md = formatMarkdownReport(suite);
      expect(md).toContain("# TraceEval Test Report");
      expect(md).toContain("🟢 ALL PASSED");
      expect(md).toContain("| Test Name | Status | Baseline Steps | Current Steps | Drift (%) | Tool Changes | Duration |");
      expect(md).toContain("| **Passing Test** | ✅ Passed | - | - | - | - | 250ms |");
      expect(md).toContain("<details>");
      expect(md).toContain("<summary>Assertion Breakdown</summary>");
      expect(md).toContain("File dist/index.js exists");
      expect(md).toContain("npx traceeval update-golden <test-name>");
    });

    it("should render yellow regression status badge, summary table, and dedicated regression section", () => {
      const suite: SuiteResult = {
        total: 1,
        passed: 0,
        failed: 1,
        durationMs: 950,
        results: [
          {
            testName: "Refactoring Performance",
            status: "failed",
            durationMs: 950,
            traceSessionId: "session-curr-123",
            goldenBaseline: {
              testName: "Refactoring Performance",
              createdAt: "2026-11-01T00:00:00.000Z",
              traceSessionId: "golden-sess-789",
              stepCount: 8,
              toolCallBreakdown: { Bash: 2, Edit: 3 },
              filesTouched: ["src/app.ts"],
              durationMs: 800,
            },
            regressionDiff: {
              stepDelta: 4,
              stepPercentDelta: 50.0,
              toolDeltas: {
                Bash: { baseline: 2, current: 4, delta: 2 },
                Edit: { baseline: 3, current: 2, delta: -1 },
              },
              toolsAdded: [],
              toolsRemoved: [],
              durationDelta: 150,
              durationPercentDelta: 18.75,
              isRegression: true,
              regressionReasons: [
                "Step count increased by 50.0% (+4 steps: 8 -> 12), exceeding threshold of 20%",
              ],
              baseline: {
                sessionId: "golden-sess-789",
                stepCount: 8,
                durationMs: 800,
                toolCallBreakdown: { Bash: 2, Edit: 3 },
              },
              current: {
                sessionId: "session-curr-123",
                stepCount: 12,
                durationMs: 950,
                toolCallBreakdown: { Bash: 4, Edit: 2 },
              },
            },
            assertionResults: [
              {
                assertion: { type: "file_contains", path: "src/app.ts" },
                passed: true,
                message: "Refactored app exports exist",
              },
            ],
          },
        ],
      };

      const md = formatMarkdownReport(suite);
      expect(md).toContain("🟡 REGRESSION DETECTED");
      expect(md).toContain("| **Refactoring Performance** | 🟡 Regression | 8 | 12 | +50.0% | +2 Bash, -1 Edit | 950ms |");
      expect(md).toContain("## ⚠️ Regression Details");
      expect(md).toContain("### ⚠️ Refactoring Performance");
      expect(md).toContain("Breached Thresholds");
      expect(md).toContain("Step count increased by 50.0%");
      expect(md).toContain("Trajectory & Metric Diffs");
      expect(md).toContain("- **Steps:** 8 → 12 (+4, +50.0%)");
      expect(md).toContain("- **Tool Call Deltas:**");
      expect(md).toContain("`Bash`: 2 baseline → 4 current (+2)");
      expect(md).toContain("`Edit`: 3 baseline → 2 current (-1)");
      expect(md).toContain("<details>");
      expect(md).toContain("<summary>Assertion Breakdown</summary>");
      expect(md).toContain("To bless the current run as the new golden standard:");
      expect(md).toContain("npx traceeval update-golden <test-name>");
    });

    it("should render red tests-failed badge when assertions fail", () => {
      const suite: SuiteResult = {
        total: 1,
        passed: 0,
        failed: 1,
        durationMs: 120,
        results: [
          {
            testName: "Broken Feature",
            status: "failed",
            durationMs: 120,
            assertionResults: [
              {
                assertion: { type: "file_contains", path: "src/main.ts", pattern: "export const ok = true;" },
                passed: false,
                message: "Pattern not found in src/main.ts",
              },
            ],
          },
        ],
      };

      const md = formatMarkdownReport(suite);
      expect(md).toContain("🔴 TESTS FAILED");
      expect(md).toContain("| **Broken Feature** | ❌ Failed | - | - | - | - | 120ms |");
    });
  });

  describe("CLI --ci Flag & GitHub Step Summary Integration", () => {
    it("should execute test command with --ci flag and write to GITHUB_STEP_SUMMARY when set", () => {
      // 1. Initialize project
      execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });

      // 2. Set up a GITHUB_STEP_SUMMARY destination
      const summaryFile = path.join(tmpDir, "github_step_summary.md");

      // 3. Run test command with --ci flag
      const output = execSync(`node "${cliPath}" test --ci`, {
        cwd: tmpDir,
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summaryFile,
        },
        encoding: "utf-8",
      });

      expect(output).toContain("TraceEval CI Test Report");
      expect(output).toContain("Status:   ALL TESTS PASSED");

      // Verify step summary file was written
      expect(fs.existsSync(summaryFile)).toBe(true);
      const summaryContent = fs.readFileSync(summaryFile, "utf-8");
      expect(summaryContent).toContain("# TraceEval Test Report");
      expect(summaryContent).toContain("🟢 ALL PASSED");
      expect(summaryContent).toContain("| Test Name | Status | Baseline Steps | Current Steps | Drift (%) | Tool Changes | Duration |");
    });
  });
});
