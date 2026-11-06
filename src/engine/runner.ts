import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import {
  TestResult,
  SuiteResult,
  AssertionResult,
  TraceSession,
  RegressionDiff,
  MultiRunResult,
  MultiRunIndividualResult,
  SuiteEfficiencyMetrics,
} from "../types/index.js";
import { StorageManager } from "../storage/index.js";
import { evaluateAssertion } from "./assertions/index.js";
import { LoadedTestCase } from "./loader.js";
import {
  compareWithGolden,
  extractSessionMetrics,
  parseSuccessThreshold,
} from "./differencer.js";

export interface RunnerOptions {
  workspaceDir?: string;
  storage?: StorageManager;
  sessionId?: string;
  skipRun?: boolean; // Evaluate assertions directly without executing testCase.run
  updateGolden?: boolean; // Update/create golden baseline for passing tests
  runs?: number; // Number of execution runs for statistical evaluation
  minSuccess?: number | string; // Success rate threshold (e.g. 0.8 or "80%")
  enableJudge?: boolean; // Opt-in flag to enable LLM-as-a-judge assertions
}

export class TestRunner {
  private workspaceDir: string;
  private storage: StorageManager;
  private explicitSessionId?: string;
  private skipRun: boolean;
  private updateGolden: boolean;
  private runs: number;
  private minSuccess: number | string;
  private enableJudge: boolean;

  constructor(options: RunnerOptions = {}) {
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.storage =
      options.storage ||
      new StorageManager({ baseDir: path.join(this.workspaceDir, ".traceeval") });
    this.explicitSessionId = options.sessionId;
    this.skipRun = options.skipRun ?? false;
    this.updateGolden = options.updateGolden ?? false;
    this.runs = options.runs && options.runs > 0 ? Math.floor(options.runs) : 1;
    this.minSuccess = options.minSuccess ?? 1.0;
    this.enableJudge =
      options.enableJudge ??
      (process.env.TRACEEVAL_ENABLE_JUDGE === "true" ||
        process.env.TRACEEVAL_ENABLE_JUDGE === "1");
  }

  async runTest(loaded: LoadedTestCase): Promise<TestResult> {
    if (this.runs > 1) {
      return this.runMultiTest(loaded);
    }
    return this.executeSingleTest(loaded);
  }

  /**
   * Executes a single test run iteration.
   */
  async executeSingleTest(loaded: LoadedTestCase, runIndex?: number): Promise<TestResult> {
    const { testCase, filePath } = loaded;
    const startTime = Date.now();
    let currentSessionId = this.explicitSessionId;
    let executionError: string | undefined;

    try {
      // 1. Run Setup if specified (only when not skipping agent execution)
      if (testCase.setup && !this.skipRun) {
        if (testCase.setup.files) {
          const resolvedWorkspace = path.resolve(this.workspaceDir);
          for (const [relPath, content] of Object.entries(testCase.setup.files)) {
            const destPath = path.resolve(this.workspaceDir, relPath);
            if (!destPath.startsWith(resolvedWorkspace + path.sep) && destPath !== resolvedWorkspace) {
              throw new Error(`Security error: Setup file path '${relPath}' escapes workspace directory`);
            }
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, content, "utf-8");
          }
        }
        if (testCase.setup.command) {
          execSync(testCase.setup.command, {
            cwd: this.workspaceDir,
            stdio: "ignore",
          });
        }
      }

      // 2. Execute Run command if specified and not skipped
      if (testCase.run?.command && !this.skipRun) {
        const runTag = runIndex ? `-r${runIndex}` : "";
        currentSessionId = `test-${Date.now()}-${crypto.randomBytes(3).toString("hex")}${runTag}`;
        const startTimeIso = new Date().toISOString();

        this.storage.upsertSession({
          id: currentSessionId,
          agent: testCase.run.agent || "claude-code",
          command: testCase.run.command,
          prompt: testCase.run.prompt,
          startTime: startTimeIso,
          status: "active",
        });

        const runEnv = {
          ...process.env,
          TRACEEVAL_SESSION_ID: currentSessionId,
        };

        try {
          execSync(testCase.run.command, {
            cwd: this.workspaceDir,
            env: runEnv,
            timeout: testCase.run.timeout_ms || 120000,
            stdio: "pipe",
          });

          this.storage.upsertSession({
            id: currentSessionId,
            endTime: new Date().toISOString(),
            status: "completed",
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          executionError = `Agent run command failed: ${message}`;
          this.storage.upsertSession({
            id: currentSessionId,
            endTime: new Date().toISOString(),
            status: "error",
          });
        }
      }

      // 3. Resolve trace session
      let traceSession: TraceSession | null = null;
      if (currentSessionId) {
        traceSession = this.storage.getSession(currentSessionId);
      } else {
        traceSession = this.storage.getLatestSession();
      }

      // 4. Evaluate assertions
      const assertionResults: AssertionResult[] = [];
      let allPassed = true;

      for (const assertion of testCase.assertions) {
        const result = await evaluateAssertion(assertion, {
          workspaceDir: this.workspaceDir,
          traceSession,
          enableJudge: this.enableJudge,
          storage: this.storage,
        });
        assertionResults.push(result);
        if (!result.passed) {
          allPassed = false;
        }
      }

      // 5. Evaluate regression against golden baseline if exists
      let goldenBaseline = this.storage.getGolden(testCase.name);
      let regressionDiff: RegressionDiff | undefined;

      if (goldenBaseline && traceSession) {
        regressionDiff = compareWithGolden(
          traceSession,
          goldenBaseline,
          testCase.regression
        );

        if (regressionDiff.isRegression && !this.updateGolden) {
          allPassed = false;
          const regressionMsg = `Regression detected against golden run (${goldenBaseline.traceSessionId}): ${regressionDiff.regressionReasons.join("; ")}`;
          if (executionError) {
            executionError += `\n${regressionMsg}`;
          } else {
            executionError = regressionMsg;
          }
        }
      }

      // 6. If updateGolden is enabled and assertions passed, bless the new golden baseline
      if (this.updateGolden && allPassed && !executionError && traceSession) {
        goldenBaseline = this.storage.saveGolden(testCase.name, traceSession);
      }

      const totalDuration = Date.now() - startTime;

      let stepCount: number | undefined;
      let cost: number | undefined;
      let tokens: number | undefined;

      if (traceSession) {
        const metrics = extractSessionMetrics(traceSession);
        stepCount = metrics.stepCount;
        cost = metrics.cost;
        tokens = metrics.tokens?.total;
      }

      return {
        testName: testCase.name,
        filePath,
        status: allPassed && !executionError ? "passed" : "failed",
        durationMs: totalDuration,
        assertionResults,
        traceSessionId: traceSession?.id,
        error: executionError,
        goldenBaseline: goldenBaseline ?? undefined,
        regressionDiff,
        stepCount,
        cost,
        tokens,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        testName: testCase.name,
        filePath,
        status: "failed",
        durationMs: Date.now() - startTime,
        assertionResults: [],
        traceSessionId: currentSessionId,
        error: message,
      };
    }
  }

  /**
   * Executes a test repeatedly across `this.runs` iterations and statistically aggregates the outcome.
   */
  private async runMultiTest(loaded: LoadedTestCase): Promise<TestResult> {
    const { testCase, filePath } = loaded;
    const startTime = Date.now();
    const individualRuns: MultiRunIndividualResult[] = [];
    const singleResults: TestResult[] = [];

    for (let i = 0; i < this.runs; i++) {
      const single = await this.executeSingleTest(loaded, i + 1);
      singleResults.push(single);

      individualRuns.push({
        runIndex: i + 1,
        status: single.status,
        traceSessionId: single.traceSessionId,
        durationMs: single.durationMs,
        stepCount: single.stepCount,
        cost: single.cost,
        tokens: single.tokens,
        error: single.error,
      });
    }

    const passedCount = singleResults.filter((r) => r.status === "passed").length;
    const failedCount = this.runs - passedCount;
    const successRate = passedCount / this.runs;
    const minSuccessThreshold = parseSuccessThreshold(this.minSuccess, 1.0);
    const passThresholdMet = successRate >= minSuccessThreshold;

    const validSteps = individualRuns
      .map((r) => r.stepCount)
      .filter((s): s is number => typeof s === "number");
    const averageSteps =
      validSteps.length > 0
        ? Math.round((validSteps.reduce((a, b) => a + b, 0) / validSteps.length) * 10) / 10
        : undefined;

    const validCosts = individualRuns
      .map((r) => r.cost)
      .filter((c): c is number => typeof c === "number");
    const averageCost =
      validCosts.length > 0
        ? Math.round((validCosts.reduce((a, b) => a + b, 0) / validCosts.length) * 10000) / 10000
        : undefined;

    const validTokens = individualRuns
      .map((r) => r.tokens)
      .filter((t): t is number => typeof t === "number");
    const averageTokens =
      validTokens.length > 0
        ? Math.round(validTokens.reduce((a, b) => a + b, 0) / validTokens.length)
        : undefined;

    const averageDurationMs = Math.round(
      individualRuns.reduce((a, b) => a + b.durationMs, 0) / this.runs
    );

    const multiRun: MultiRunResult = {
      runs: this.runs,
      passed: passedCount,
      failed: failedCount,
      successRate,
      minSuccessThreshold,
      passThresholdMet,
      averageSteps,
      averageDurationMs,
      averageCost,
      averageTokens,
      individualRuns,
    };

    const representativeRun =
      singleResults.find((r) => r.status === "passed") ||
      singleResults[singleResults.length - 1];

    let errorMessage: string | undefined;
    if (!passThresholdMet) {
      const ratePct = (successRate * 100).toFixed(1);
      const threshPct = (minSuccessThreshold * 100).toFixed(1);
      errorMessage = `Statistical evaluation failed: Success rate ${ratePct}% (${passedCount}/${this.runs}) fell below required threshold of ${threshPct}%`;
    }

    return {
      testName: testCase.name,
      filePath,
      status: passThresholdMet ? "passed" : "failed",
      durationMs: Date.now() - startTime,
      assertionResults: representativeRun?.assertionResults || [],
      traceSessionId: representativeRun?.traceSessionId,
      error: errorMessage || representativeRun?.error,
      goldenBaseline: representativeRun?.goldenBaseline,
      regressionDiff: representativeRun?.regressionDiff,
      multiRun,
      stepCount: averageSteps,
      cost: averageCost,
      tokens: averageTokens,
    };
  }

  async runSuite(tests: LoadedTestCase[]): Promise<SuiteResult> {
    const startTime = Date.now();
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      const res = await this.runTest(test);
      results.push(res);
      if (res.status === "passed") {
        passed++;
      } else {
        failed++;
      }
    }

    // Aggregate efficiency and cost metrics
    let totalCost = 0;
    let totalTokens = 0;
    let totalSteps = 0;
    let costCount = 0;
    let tokenCount = 0;
    let stepCount = 0;

    let successfulTasksCost = 0;
    let successfulTasksSteps = 0;
    let successfulCostCount = 0;
    let successfulStepCount = 0;

    for (const r of results) {
      if (r.cost !== undefined) {
        totalCost += r.cost;
        costCount++;
        if (r.status === "passed") {
          successfulTasksCost += r.cost;
          successfulCostCount++;
        }
      }
      if (r.tokens !== undefined) {
        totalTokens += r.tokens;
        tokenCount++;
      }
      if (r.stepCount !== undefined) {
        totalSteps += r.stepCount;
        stepCount++;
        if (r.status === "passed") {
          successfulTasksSteps += r.stepCount;
          successfulStepCount++;
        }
      }
    }

    const efficiency: SuiteEfficiencyMetrics = {
      averageStepsPerTask:
        stepCount > 0 ? Math.round((totalSteps / stepCount) * 10) / 10 : undefined,
      averageCostPerTask:
        costCount > 0 ? Math.round((totalCost / costCount) * 10000) / 10000 : undefined,
      averageTokensPerTask:
        tokenCount > 0 ? Math.round(totalTokens / tokenCount) : undefined,
      averageDurationPerTask:
        results.length > 0
          ? Math.round(results.reduce((a, b) => a + b.durationMs, 0) / results.length)
          : undefined,
      totalCost: costCount > 0 ? Math.round(totalCost * 10000) / 10000 : undefined,
      totalTokens: tokenCount > 0 ? totalTokens : undefined,
      successfulTaskCost:
        successfulCostCount > 0
          ? Math.round((successfulTasksCost / successfulCostCount) * 10000) / 10000
          : undefined,
      successfulTaskSteps:
        successfulStepCount > 0
          ? Math.round((successfulTasksSteps / successfulStepCount) * 10) / 10
          : undefined,
    };

    const multiRunSummary =
      this.runs > 1
        ? {
            runs: this.runs,
            minSuccessThreshold: parseSuccessThreshold(this.minSuccess, 1.0),
            overallSuccessRate: results.length > 0 ? passed / results.length : 1.0,
          }
        : undefined;

    return {
      total: tests.length,
      passed,
      failed,
      durationMs: Date.now() - startTime,
      results,
      efficiency,
      multiRun: multiRunSummary,
    };
  }
}
