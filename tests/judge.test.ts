import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkLLMJudge } from "../src/engine/assertions/llm_judge.js";
import { evaluateAssertion } from "../src/engine/assertions/index.js";
import { StorageManager } from "../src/storage/index.js";
import { TraceSession } from "../src/types/index.js";

describe("Optional LLM-as-a-Judge Assertion", () => {
  let tmpDir: string;
  let storage: StorageManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-judge-test-"));
    storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
    delete process.env.TRACEEVAL_ENABLE_JUDGE;
    delete process.env.TRACEEVAL_MOCK_JUDGE;
    delete process.env.TRACEEVAL_MOCK_JUDGE_SCORE;
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TRACEEVAL_ENABLE_JUDGE;
    delete process.env.TRACEEVAL_MOCK_JUDGE;
    delete process.env.TRACEEVAL_MOCK_JUDGE_SCORE;
  });

  const sampleSession: TraceSession = {
    id: "session-judge-test",
    agent: "claude-code",
    startTime: new Date().toISOString(),
    status: "completed",
    prompt: "Add a greeting function with docstring explanation",
    events: [
      {
        id: "1",
        sessionId: "session-judge-test",
        timestamp: new Date().toISOString(),
        type: "tool_call",
        agent: "claude-code",
        data: {
          toolName: "Edit",
          input: { path: "src/greet.ts", content: "/** Returns friendly greeting */\nexport function greet() {}" },
        },
      },
      {
        id: "2",
        sessionId: "session-judge-test",
        timestamp: new Date().toISOString(),
        type: "agent_thought",
        agent: "claude-code",
        data: { thought: "I added greeting with comprehensive docstring." },
      },
    ],
  };

  it("should be skipped cleanly when opt-in is not enabled", async () => {
    const res = await checkLLMJudge(
      {
        type: "llm_judge",
        judge: "The agent should have explained the change clearly",
      },
      { traceSession: sampleSession, enableJudge: false }
    );

    expect(res.passed).toBe(true);
    expect(res.actual).toContain("Skipped (opt-in required)");
    expect(res.message).toContain("opt-in required");
  });

  it("should execute and pass when opted-in and mock score satisfies threshold", async () => {
    process.env.TRACEEVAL_MOCK_JUDGE = "1";
    process.env.TRACEEVAL_MOCK_JUDGE_SCORE = "0.9";

    const res = await checkLLMJudge(
      {
        type: "llm_judge",
        judge: "The agent should have explained the change clearly",
        threshold: 0.7,
        enabled: true, // explicit test assertion opt-in
      },
      { traceSession: sampleSession, enableJudge: true, storage }
    );

    expect(res.passed).toBe(true);
    expect(res.expected).toBe("score >= 0.7");
    expect(res.actual).toContain("0.90");

    // Verify judge evaluation event was recorded into trace storage
    const recordedSession = storage.getSession(sampleSession.id);
    const judgeEvent = recordedSession?.events.find(
      (e) => e.agent === "llm-judge" && e.data.assertionType === "llm_judge"
    );
    expect(judgeEvent).toBeDefined();
    expect(judgeEvent?.data.score).toBe(0.9);
  });

  it("should fail when score falls below threshold", async () => {
    process.env.TRACEEVAL_MOCK_JUDGE = "1";
    process.env.TRACEEVAL_MOCK_JUDGE_SCORE = "0.45";

    const res = await checkLLMJudge(
      {
        type: "llm_judge",
        judge: "The agent should have explained the change clearly",
        threshold: 0.7,
        enabled: true,
      },
      { traceSession: sampleSession, enableJudge: true, storage }
    );

    expect(res.passed).toBe(false);
    expect(res.actual).toContain("0.45");
  });

  it("should integrate with evaluateAssertion", async () => {
    process.env.TRACEEVAL_ENABLE_JUDGE = "1";
    process.env.TRACEEVAL_MOCK_JUDGE = "1";
    process.env.TRACEEVAL_MOCK_JUDGE_SCORE = "0.8";

    const res = await evaluateAssertion(
      {
        type: "llm_judge",
        judge: "Check code style compliance",
        threshold: 0.75,
      },
      {
        workspaceDir: tmpDir,
        traceSession: sampleSession,
        enableJudge: true,
        storage,
      }
    );

    expect(res.passed).toBe(true);
    expect(res.actual).toContain("0.80");
  });
});
