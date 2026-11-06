import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  GoldenStorage,
  testNameToSlug,
  extractFilesTouched,
} from "../src/storage/golden.js";
import { StorageManager } from "../src/storage/index.js";
import {
  compareWithGolden,
  parseThreshold,
  extractSessionMetrics,
} from "../src/engine/differencer.js";
import { TestRunner } from "../src/engine/runner.js";
import { LoadedTestCase } from "../src/engine/loader.js";
import { TraceSession, GoldenBaseline } from "../src/types/index.js";

describe("Golden Run Storage & Comparison Engine", () => {
  let tmpDir: string;
  const cliPath = path.resolve(__dirname, "../dist/cli.js");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-golden-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Slugification & File Helpers", () => {
    it("should correctly convert various test names and paths to slugs", () => {
      expect(testNameToSlug("Greeting Function Generation")).toBe(
        "greeting-function-generation"
      );
      expect(testNameToSlug("hello-world.yaml")).toBe("hello-world");
      expect(testNameToSlug(".traceeval/tests/sample-eval.yml")).toBe(
        "sample-eval"
      );
      expect(testNameToSlug("Feature: Fast Search [v2.0]!")).toBe(
        "feature-fast-search-v2-0"
      );
      expect(testNameToSlug("")).toBe("unnamed-test");
    });

    it("should extract touched files from tool calls and file changes", () => {
      const mockSession: TraceSession = {
        id: "sess-extract",
        agent: "claude-code",
        startTime: new Date().toISOString(),
        status: "completed",
        events: [
          {
            id: "1",
            sessionId: "sess-extract",
            timestamp: new Date().toISOString(),
            type: "file_change",
            agent: "claude-code",
            data: { path: "src/index.ts" },
          },
          {
            id: "2",
            sessionId: "sess-extract",
            timestamp: new Date().toISOString(),
            type: "tool_call",
            agent: "claude-code",
            data: {
              toolName: "Edit",
              input: { file_path: "src/utils.ts" },
            },
          },
          {
            id: "3",
            sessionId: "sess-extract",
            timestamp: new Date().toISOString(),
            type: "tool_call",
            agent: "claude-code",
            data: {
              toolName: "ReadFile",
              input: { path: "package.json" },
            },
          },
        ],
      };

      const files = extractFilesTouched(mockSession);
      expect(files).toEqual(["package.json", "src/index.ts", "src/utils.ts"]);
    });
  });

  describe("GoldenStorage CRUD Operations", () => {
    let storage: StorageManager;
    let goldenDir: string;

    beforeEach(() => {
      goldenDir = path.join(tmpDir, ".traceeval", "golden");
      storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
    });

    afterEach(() => {
      storage.close();
    });

    it("should save a golden baseline and retrieve it correctly", () => {
      const traceSession: TraceSession = {
        id: "sess-golden-1",
        agent: "claude-code",
        startTime: "2026-11-06T00:00:00.000Z",
        endTime: "2026-11-06T00:00:05.000Z",
        durationMs: 5000,
        status: "completed",
        events: [
          {
            id: "1",
            sessionId: "sess-golden-1",
            timestamp: "2026-11-06T00:00:01.000Z",
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Edit", tool_input: { file_path: "src/main.ts" } },
          },
          {
            id: "2",
            sessionId: "sess-golden-1",
            timestamp: "2026-11-06T00:00:02.000Z",
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Bash", tool_input: { command: "npm test" } },
          },
        ],
        metadata: {
          cost: 0.015,
          tokens: { input: 100, output: 50, total: 150 },
        },
      };

      const saved = storage.saveGolden("My Sample Test", traceSession);
      expect(saved.testName).toBe("My Sample Test");
      expect(saved.stepCount).toBe(2);
      expect(saved.toolCallBreakdown).toEqual({ Edit: 1, Bash: 1 });
      expect(saved.filesTouched).toContain("src/main.ts");
      expect(saved.durationMs).toBe(5000);
      expect(saved.cost).toBe(0.015);
      expect(saved.tokens?.total).toBe(150);

      // Verify file exists on disk
      const filePath = path.join(goldenDir, "my-sample-test.json");
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify retrieval by slug and original name
      const retrieved = storage.getGolden("My Sample Test");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.traceSessionId).toBe("sess-golden-1");
      expect(retrieved?.stepCount).toBe(2);

      const retrievedBySlug = storage.getGolden("my-sample-test");
      expect(retrievedBySlug?.traceSessionId).toBe("sess-golden-1");
    });

    it("should list all saved golden baselines and remove them", () => {
      const sessA: TraceSession = {
        id: "sess-a",
        agent: "claude-code",
        startTime: new Date().toISOString(),
        status: "completed",
        events: [],
      };
      const sessB: TraceSession = {
        id: "sess-b",
        agent: "claude-code",
        startTime: new Date().toISOString(),
        status: "completed",
        events: [],
      };

      storage.saveGolden("Alpha Test", sessA);
      storage.saveGolden("Beta Test", sessB);

      const list = storage.listGoldens();
      expect(list).toHaveLength(2);
      expect(list.map((g) => g.testName)).toContain("Alpha Test");
      expect(list.map((g) => g.testName)).toContain("Beta Test");

      const removed = storage.removeGolden("Alpha Test");
      expect(removed).toBe(true);

      const listAfter = storage.listGoldens();
      expect(listAfter).toHaveLength(1);
      expect(listAfter[0].testName).toBe("Beta Test");
      expect(storage.getGolden("Alpha Test")).toBeNull();
    });
  });

  describe("Threshold Parsing", () => {
    it("should parse various percentage and numeric formats", () => {
      expect(parseThreshold("20%")).toEqual({ isPercent: true, value: 20 });
      expect(parseThreshold("50.5%")).toEqual({ isPercent: true, value: 50.5 });
      expect(parseThreshold(3)).toEqual({ isPercent: false, value: 3 });
      expect(parseThreshold("5")).toEqual({ isPercent: false, value: 5 });
      expect(parseThreshold(undefined)).toBeNull();
      expect(parseThreshold("invalid")).toBeNull();
    });
  });

  describe("Golden Run Comparison Differencer", () => {
    const baseline: GoldenBaseline = {
      testName: "Greeting Generation",
      createdAt: "2026-11-06T00:00:00.000Z",
      traceSessionId: "golden-sess-1",
      stepCount: 4,
      toolCallBreakdown: {
        Edit: 2,
        Bash: 2,
      },
      filesTouched: ["src/greet.ts"],
      durationMs: 4000,
      cost: 0.02,
    };

    it("should detect no regression when current run is identical or improved", () => {
      const currentSession: TraceSession = {
        id: "current-sess-1",
        agent: "claude-code",
        startTime: "2026-11-06T00:00:00.000Z",
        endTime: "2026-11-06T00:00:04.000Z",
        durationMs: 4000,
        status: "completed",
        events: [
          {
            id: "1",
            sessionId: "current-sess-1",
            timestamp: "",
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Edit" },
          },
          {
            id: "2",
            sessionId: "current-sess-1",
            timestamp: "",
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Edit" },
          },
          {
            id: "3",
            sessionId: "current-sess-1",
            timestamp: "",
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Bash" },
          },
          {
            id: "4",
            sessionId: "current-sess-1",
            timestamp: "",
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Bash" },
          },
        ],
      };

      const diff = compareWithGolden(currentSession, baseline);

      expect(diff.isRegression).toBe(false);
      expect(diff.stepDelta).toBe(0);
      expect(diff.stepPercentDelta).toBe(0);
      expect(diff.toolsAdded).toEqual([]);
      expect(diff.toolsRemoved).toEqual([]);
      expect(diff.regressionReasons).toEqual([]);
    });

    it("should flag regression when steps increase beyond percentage threshold", () => {
      // Golden is 4 steps. 6 steps is +2 (+50% increase), exceeding default 20%
      const currentSession: TraceSession = {
        id: "current-sess-regressed",
        agent: "claude-code",
        startTime: "",
        durationMs: 4500,
        status: "completed",
        events: [
          { id: "1", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "2", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "3", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
          { id: "4", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
          { id: "5", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
          { id: "6", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "ReadFile" } },
        ],
      };

      const diff = compareWithGolden(currentSession, baseline, {
        max_step_increase: "20%",
      });

      expect(diff.isRegression).toBe(true);
      expect(diff.stepDelta).toBe(2);
      expect(diff.stepPercentDelta).toBe(50);
      expect(diff.toolsAdded).toContain("ReadFile");
      expect(diff.regressionReasons.length).toBeGreaterThan(0);
      expect(diff.regressionReasons[0]).toContain("Step count increased by 50.0%");
    });

    it("should support absolute step increase threshold", () => {
      const currentSession: TraceSession = {
        id: "current-sess-absolute",
        agent: "claude-code",
        startTime: "",
        durationMs: 4000,
        status: "completed",
        events: [
          { id: "1", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "2", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "3", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
          { id: "4", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
          { id: "5", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
        ],
      };

      // 5 steps vs 4 steps = delta 1
      const diffAllowed = compareWithGolden(currentSession, baseline, {
        max_step_increase: 2,
      });
      expect(diffAllowed.isRegression).toBe(false);

      const diffBreached = compareWithGolden(currentSession, baseline, {
        max_step_increase: 0,
      });
      expect(diffBreached.isRegression).toBe(true);
      expect(diffBreached.regressionReasons[0]).toContain("exceeding max allowed increase of 0 step(s)");
    });

    it("should enforce allowed_tools and disallowed_tools", () => {
      const currentSession: TraceSession = {
        id: "current-tools-test",
        agent: "claude-code",
        startTime: "",
        durationMs: 4000,
        status: "completed",
        events: [
          { id: "1", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "2", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Curl" } },
        ],
      };

      // Test allowed_tools breach
      const diffAllowed = compareWithGolden(currentSession, baseline, {
        allowed_tools: ["Edit", "Bash"],
      });
      expect(diffAllowed.isRegression).toBe(true);
      expect(diffAllowed.regressionReasons.some((r) => r.includes("Tool 'Curl' is not in allowed_tools list"))).toBe(true);

      // Test disallowed_tools breach
      const diffDisallowed = compareWithGolden(currentSession, baseline, {
        disallowed_tools: ["Curl"],
      });
      expect(diffDisallowed.isRegression).toBe(true);
      expect(diffDisallowed.regressionReasons.some((r) => r.includes("Disallowed tool 'Curl' was invoked"))).toBe(true);
    });

    it("should enforce duration and cost regression thresholds", () => {
      const currentSession: TraceSession = {
        id: "current-cost-dur",
        agent: "claude-code",
        startTime: "",
        durationMs: 8000, // +100% vs baseline 4000
        status: "completed",
        metadata: { cost: 0.05 }, // +150% vs baseline 0.02
        events: [
          { id: "1", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "2", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
          { id: "3", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Edit" } },
          { id: "4", sessionId: "", timestamp: "", type: "tool_call", agent: "", data: { toolName: "Bash" } },
        ],
      };

      const diff = compareWithGolden(currentSession, baseline, {
        max_duration_increase: "50%",
        max_cost_increase: "50%",
      });

      expect(diff.isRegression).toBe(true);
      expect(diff.regressionReasons.some((r) => r.includes("Duration increased by 100.0%"))).toBe(true);
      expect(diff.regressionReasons.some((r) => r.includes("Cost increased by 150.0%"))).toBe(true);
    });
  });

  describe("Runner Integration with Golden Evaluation", () => {
    let storage: StorageManager;

    beforeEach(() => {
      storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
    });

    afterEach(() => {
      storage.close();
    });

    it("should update golden baseline on initial pass when updateGolden is enabled", async () => {
      // Manually create file for assertion since skipRun: true skips setup
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src/out.txt"), "created");

      const loadedTest: LoadedTestCase = {
        filePath: path.join(tmpDir, "sample.yaml"),
        testCase: {
          name: "Initial Golden Setup Test",
          assertions: [
            {
              type: "file_exists",
              path: "src/out.txt",
            },
          ],
        },
      };

      // Record a session in storage first
      const sessionId = "sess-initial-golden";
      storage.upsertSession({
        id: sessionId,
        status: "completed",
        startTime: new Date().toISOString(),
      });
      storage.recordEvent({
        id: "evt-1",
        sessionId,
        timestamp: new Date().toISOString(),
        type: "tool_call",
        agent: "claude-code",
        data: { toolName: "Edit" },
      });

      const runner = new TestRunner({
        workspaceDir: tmpDir,
        storage,
        sessionId,
        skipRun: true,
        updateGolden: true,
      });

      const result = await runner.runTest(loadedTest);
      expect(result.status).toBe("passed");
      expect(result.goldenBaseline).toBeDefined();
      expect(result.goldenBaseline?.stepCount).toBe(1);

      // Verify stored in storage
      const stored = storage.getGolden("Initial Golden Setup Test");
      expect(stored).not.toBeNull();
      expect(stored?.stepCount).toBe(1);
    });

    it("should fail test execution if regression is detected against stored golden", async () => {
      const testName = "Regression Detection Test";
      // 1. Manually bless a 1-step golden run
      const goldenSession: TraceSession = {
        id: "sess-golden-good",
        agent: "claude-code",
        startTime: new Date().toISOString(),
        status: "completed",
        events: [
          {
            id: "1",
            sessionId: "sess-golden-good",
            timestamp: new Date().toISOString(),
            type: "tool_call",
            agent: "claude-code",
            data: { toolName: "Edit" },
          },
        ],
      };
      storage.saveGolden(testName, goldenSession);

      // 2. Simulate current run with 3 steps (+200% increase)
      const currentSessionId = "sess-current-regressed";
      storage.upsertSession({
        id: currentSessionId,
        status: "completed",
        startTime: new Date().toISOString(),
      });
      for (let i = 0; i < 3; i++) {
        storage.recordEvent({
          id: `evt-${i}`,
          sessionId: currentSessionId,
          timestamp: new Date().toISOString(),
          type: "tool_call",
          agent: "claude-code",
          data: { toolName: "Edit" },
        });
      }

      const loadedTest: LoadedTestCase = {
        filePath: path.join(tmpDir, "regression.yaml"),
        testCase: {
          name: testName,
          assertions: [],
          regression: {
            max_step_increase: "20%",
          },
        },
      };

      const runner = new TestRunner({
        workspaceDir: tmpDir,
        storage,
        sessionId: currentSessionId,
        skipRun: true,
        updateGolden: false,
      });

      const result = await runner.runTest(loadedTest);
      expect(result.status).toBe("failed");
      expect(result.regressionDiff?.isRegression).toBe(true);
      expect(result.error).toContain("Regression detected against golden run");
      expect(result.error).toContain("Step count increased by 200.0%");
    });
  });

  describe("CLI Commands: update-golden and test --update-golden", () => {
    it("should create golden baseline via CLI test --update-golden and list it", () => {
      // 1. Init
      execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });

      // 2. Run test --update-golden
      const testOutput = execSync(`node "${cliPath}" test --update-golden`, {
        cwd: tmpDir,
        encoding: "utf-8",
      });
      expect(testOutput).toContain("ALL TESTS PASSED");

      // Verify golden file created
      const goldenDir = path.join(tmpDir, ".traceeval", "golden");
      expect(fs.existsSync(goldenDir)).toBe(true);
      const files = fs.readdirSync(goldenDir);
      expect(files.length).toBeGreaterThan(0);

      // 3. List goldens via CLI
      const listOutput = execSync(`node "${cliPath}" golden list`, {
        cwd: tmpDir,
        encoding: "utf-8",
      });
      expect(listOutput).toContain("TraceEval Golden Baselines:");
      expect(listOutput).toContain("Hello World Greeting Edit");

      // 4. Update golden directly via update-golden command
      const updateOutput = execSync(`node "${cliPath}" update-golden "Hello World"`, {
        cwd: tmpDir,
        encoding: "utf-8",
      });
      expect(updateOutput).toContain("Golden baseline saved");
    });
  });
});
