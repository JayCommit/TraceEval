import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TestRunner } from "../src/engine/runner.js";
import { StorageManager } from "../src/storage/index.js";
import { LoadedTestCase } from "../src/engine/loader.js";
import { parseSuccessThreshold } from "../src/engine/differencer.js";

describe("Statistical Multi-Run Mode & Threshold Evaluation", () => {
  let tmpDir: string;
  let storage: StorageManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-multirun-test-"));
    storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("parseSuccessThreshold helper", () => {
    it("should parse floats, percentages, and integers correctly", () => {
      expect(parseSuccessThreshold(0.8)).toBe(0.8);
      expect(parseSuccessThreshold("0.8")).toBe(0.8);
      expect(parseSuccessThreshold("80%")).toBe(0.8);
      expect(parseSuccessThreshold(80)).toBe(0.8);
      expect(parseSuccessThreshold("67%")).toBe(0.67);
      expect(parseSuccessThreshold(undefined)).toBe(1.0);
      expect(parseSuccessThreshold("100%")).toBe(1.0);
    });
  });

  it("should pass multi-run when success rate meets min-success threshold", async () => {
    // Counter file to simulate flaky agent: passes 4 out of 5 runs (80% success)
    const counterFile = path.join(tmpDir, "counter.txt");
    fs.writeFileSync(counterFile, "0", "utf-8");

    const loadedTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "flaky-test.yaml"),
      testCase: {
        name: "Flaky Agent Test Passing Threshold",
        run: {
          // Script that passes runs 1, 2, 3, 4, fails run 5
          command: `node -e "const fs = require('fs'); const n = parseInt(fs.readFileSync('${counterFile}', 'utf-8'), 10) + 1; fs.writeFileSync('${counterFile}', String(n)); fs.writeFileSync('out.txt', n === 5 ? 'fail' : 'pass');"`,
        },
        assertions: [
          {
            type: "file_contains",
            path: "out.txt",
            pattern: "pass",
          },
        ],
      },
    };

    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
      runs: 5,
      minSuccess: 0.8, // Requires 80% pass (4/5)
    });

    const result = await runner.runTest(loadedTest);

    expect(result.status).toBe("passed");
    expect(result.multiRun).toBeDefined();
    expect(result.multiRun?.runs).toBe(5);
    expect(result.multiRun?.passed).toBe(4);
    expect(result.multiRun?.failed).toBe(1);
    expect(result.multiRun?.successRate).toBe(0.8);
    expect(result.multiRun?.passThresholdMet).toBe(true);
    expect(result.multiRun?.individualRuns).toHaveLength(5);

    // Verify all individual run traces were persisted
    for (const run of result.multiRun!.individualRuns) {
      expect(run.traceSessionId).toBeDefined();
      const sess = storage.getSession(run.traceSessionId!);
      expect(sess).not.toBeNull();
    }
  });

  it("should fail multi-run when success rate falls below min-success threshold", async () => {
    const counterFile = path.join(tmpDir, "counter-fail.txt");
    fs.writeFileSync(counterFile, "0", "utf-8");

    const loadedTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "flaky-test-failing.yaml"),
      testCase: {
        name: "Flaky Agent Test Failing Threshold",
        run: {
          // Passes 2 out of 5 runs (40% success)
          command: `node -e "const fs = require('fs'); const n = parseInt(fs.readFileSync('${counterFile}', 'utf-8'), 10) + 1; fs.writeFileSync('${counterFile}', String(n)); fs.writeFileSync('out.txt', n <= 2 ? 'pass' : 'fail');"`,
        },
        assertions: [
          {
            type: "file_contains",
            path: "out.txt",
            pattern: "pass",
          },
        ],
      },
    };

    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
      runs: 5,
      minSuccess: "80%", // Requires 80% (4/5)
    });

    const result = await runner.runTest(loadedTest);

    expect(result.status).toBe("failed");
    expect(result.multiRun).toBeDefined();
    expect(result.multiRun?.passed).toBe(2);
    expect(result.multiRun?.failed).toBe(3);
    expect(result.multiRun?.successRate).toBe(0.4);
    expect(result.multiRun?.passThresholdMet).toBe(false);
    expect(result.error).toContain("fell below required threshold of 80.0%");
  });

  it("should aggregate efficiency and cost metrics across runs in suite", async () => {
    const loadedTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "metrics-test.yaml"),
      testCase: {
        name: "Deterministic Task",
        run: {
          command: `node -e "const fs = require('fs'); fs.writeFileSync('out.txt', 'done');"`,
        },
        assertions: [
          {
            type: "file_exists",
            path: "out.txt",
          },
        ],
      },
    };

    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
      runs: 3,
      minSuccess: 1.0,
    });

    const suite = await runner.runSuite([loadedTest]);

    expect(suite.passed).toBe(1);
    expect(suite.multiRun?.runs).toBe(3);
    expect(suite.multiRun?.overallSuccessRate).toBe(1.0);
    expect(suite.efficiency).toBeDefined();
    expect(suite.efficiency?.averageDurationPerTask).toBeGreaterThanOrEqual(0);
  });

  it("should support updating and comparing golden baselines across multi-run execution", async () => {
    const loadedTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "golden-multirun.yaml"),
      testCase: {
        name: "Golden Multi-Run Task",
        run: {
          command: `node -e "const fs = require('fs'); fs.writeFileSync('golden-out.txt', 'pass');"`,
        },
        assertions: [
          {
            type: "file_exists",
            path: "golden-out.txt",
          },
        ],
      },
    };

    // 1. Run multi-run with updateGolden = true to establish baseline
    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
      runs: 2,
      minSuccess: 1.0,
      updateGolden: true,
    });

    const result = await runner.runTest(loadedTest);
    expect(result.status).toBe("passed");

    // Verify golden baseline was created
    const savedGolden = storage.getGolden("Golden Multi-Run Task");
    expect(savedGolden).not.toBeNull();
    expect(savedGolden?.testName).toBe("Golden Multi-Run Task");

    // 2. Re-run without updateGolden to verify it compares against golden baseline
    const evalRunner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
      runs: 2,
      minSuccess: 1.0,
    });

    const evalResult = await evalRunner.runTest(loadedTest);
    expect(evalResult.status).toBe("passed");
    expect(evalResult.goldenBaseline).toBeDefined();
    expect(evalResult.goldenBaseline?.testName).toBe("Golden Multi-Run Task");
  });
});
