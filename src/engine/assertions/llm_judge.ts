import {
  LLMJudgeAssertionSchema,
  AssertionResult,
  TraceSession,
} from "../../types/index.js";
import { z } from "zod";
import { getDistinctToolCalls } from "./utils.js";
import { StorageManager } from "../../storage/index.js";

export type LLMJudgeConfig = z.infer<typeof LLMJudgeAssertionSchema>;

export interface JudgeEvaluationOutput {
  score: number;
  reasoning: string;
  passed: boolean;
}

/**
 * Builds a structured text prompt summarizing the agent trajectory for LLM evaluation.
 */
function buildTrajectoryContext(session: TraceSession): string {
  const lines: string[] = [];

  if (session.prompt) {
    lines.push(`User Prompt: "${session.prompt}"`);
  }
  if (session.command) {
    lines.push(`Agent Command: ${session.command}`);
  }

  const distinctCalls = getDistinctToolCalls(session.events);
  lines.push(`Total Steps Taken: ${distinctCalls.length}`);

  if (distinctCalls.length > 0) {
    lines.push("Tool Call Sequence:");
    for (const [idx, call] of distinctCalls.entries()) {
      let inputSummary = "";
      if (call.data?.input) {
        if (typeof call.data.input === "string") {
          inputSummary = call.data.input.slice(0, 150);
        } else if (typeof call.data.input === "object") {
          inputSummary = JSON.stringify(call.data.input).slice(0, 150);
        }
      }
      lines.push(`  ${idx + 1}. [${call.toolName}] ${inputSummary}`);
    }
  }

  // Extract thoughts or final messages if available
  const thoughts = session.events
    .filter((e) => e.type === "agent_thought")
    .map((e) => String(e.data?.thought || e.data?.message || ""))
    .filter(Boolean);

  if (thoughts.length > 0) {
    lines.push(`Agent Thoughts:\n${thoughts.slice(-2).join("\n")}`);
  }

  return lines.join("\n");
}

/**
 * Executes judge inference via Ollama or OpenAI-compatible endpoint,
 * or returns deterministic mock response if in test environment.
 */
export async function executeJudgeInference(
  judgePrompt: string,
  trajectoryContext: string,
  criteria: string,
  options: {
    provider?: "ollama" | "openai" | "mock";
    model?: string;
    endpoint?: string;
    apiKey?: string;
    threshold?: number;
  }
): Promise<JudgeEvaluationOutput> {
  const provider =
    options.provider ||
    (process.env.TRACEEVAL_MOCK_JUDGE === "1"
      ? "mock"
      : (process.env.TRACEEVAL_JUDGE_PROVIDER as "ollama" | "openai") || "ollama");

  const threshold = options.threshold ?? 0.7;

  // 1. Mock provider (used for fast, deterministic unit and integration tests)
  if (provider === "mock" || process.env.TRACEEVAL_MOCK_JUDGE === "1") {
    const mockScoreEnv = process.env.TRACEEVAL_MOCK_JUDGE_SCORE;
    const score = mockScoreEnv !== undefined ? parseFloat(mockScoreEnv) : 0.85;
    const passed = score >= threshold;
    return {
      score,
      reasoning: passed
        ? "Mock evaluation: Agent followed instructions and satisfied evaluation criteria."
        : "Mock evaluation: Agent trajectory failed to meet expected quality criteria.",
      passed,
    };
  }

  const systemInstruction = `You are an impartial AI judge evaluating coding agent trajectories against specific quality criteria.
Evaluate the provided trajectory and criteria.
Respond ONLY with a valid JSON object matching this schema:
{
  "score": <float between 0.0 and 1.0>,
  "reasoning": "<concise explanation in 1-2 sentences>",
  "passed": <boolean>
}`;

  const userContent = `Evaluation Task: ${judgePrompt}
Specific Criteria: ${criteria}

Agent Trajectory Context:
${trajectoryContext}`;

  // 2. Ollama Provider
  if (provider === "ollama") {
    const endpoint =
      options.endpoint ||
      process.env.OLLAMA_HOST ||
      process.env.TRACEEVAL_JUDGE_ENDPOINT ||
      "http://localhost:11434";
    const model = options.model || process.env.TRACEEVAL_JUDGE_MODEL || "llama3";

    const url = `${endpoint.replace(/\/$/, "")}/api/generate`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: `${systemInstruction}\n\n${userContent}`,
          stream: false,
          format: "json",
        }),
      });

      if (!resp.ok) {
        throw new Error(`Ollama request failed with HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = (await resp.json()) as { response?: string };
      const parsed = JSON.parse(json.response || "{}") as {
        score?: number;
        reasoning?: string;
        passed?: boolean;
      };

      const score = typeof parsed.score === "number" ? parsed.score : 0.5;
      const reasoning = parsed.reasoning || "Evaluation completed.";
      return {
        score,
        reasoning,
        passed: score >= threshold,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama judge connection failed: ${msg}`);
    }
  }

  // 3. OpenAI-compatible Provider
  if (provider === "openai") {
    const endpoint =
      options.endpoint ||
      process.env.OPENAI_BASE_URL ||
      process.env.TRACEEVAL_JUDGE_ENDPOINT ||
      "https://api.openai.com/v1";
    const apiKey =
      options.apiKey ||
      process.env.OPENAI_API_KEY ||
      process.env.TRACEEVAL_JUDGE_API_KEY ||
      "";
    const model = options.model || process.env.TRACEEVAL_JUDGE_MODEL || "gpt-4o-mini";

    const url = `${endpoint.replace(/\/$/, "")}/chat/completions`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });

      if (!resp.ok) {
        throw new Error(`OpenAI judge request failed with HTTP ${resp.status}`);
      }

      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content) as {
        score?: number;
        reasoning?: string;
        passed?: boolean;
      };

      const score = typeof parsed.score === "number" ? parsed.score : 0.5;
      const reasoning = parsed.reasoning || "Evaluation completed.";
      return {
        score,
        reasoning,
        passed: score >= threshold,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`OpenAI judge connection failed: ${msg}`);
    }
  }

  throw new Error(`Unsupported LLM judge provider: ${provider}`);
}

/**
 * Evaluates the `llm_judge` assertion.
 * Strictly opt-in: skipped if not enabled via config or environment variable.
 */
export async function checkLLMJudge(
  config: LLMJudgeConfig,
  context: {
    traceSession?: TraceSession | null;
    enableJudge?: boolean;
    storage?: StorageManager;
  }
): Promise<AssertionResult> {
  const isOptedIn = Boolean(
    config.enabled ||
      context.enableJudge ||
      process.env.TRACEEVAL_ENABLE_JUDGE === "true" ||
      process.env.TRACEEVAL_ENABLE_JUDGE === "1" ||
      process.env.TRACEEVAL_MOCK_JUDGE === "1"
  );

  if (!isOptedIn) {
    return {
      assertion: config,
      passed: true,
      message:
        config.message ||
        "LLM judge skipped (opt-in required: run with --judge or TRACEEVAL_ENABLE_JUDGE=1)",
      expected: "Judge opt-in enabled",
      actual: "Skipped (opt-in required)",
    };
  }

  if (!context.traceSession) {
    return {
      assertion: config,
      passed: false,
      message: config.message || "No trace session found to evaluate LLM judge assertion",
      expected: "Active trace session",
      actual: "No trace session",
    };
  }

  const judgePrompt = config.judge || config.prompt || "Verify trajectory meets specifications";
  const criteria = config.criteria || judgePrompt;
  const threshold = config.threshold ?? 0.7;
  const trajectoryContext = buildTrajectoryContext(context.traceSession);

  try {
    const evaluation = await executeJudgeInference(
      judgePrompt,
      trajectoryContext,
      criteria,
      {
        provider: config.provider,
        model: config.model,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        threshold,
      }
    );

    // Record evaluation event into trace session for auditing
    if (context.storage && context.traceSession.id) {
      try {
        context.storage.recordEvent({
          id: `judge-${Date.now()}`,
          sessionId: context.traceSession.id,
          timestamp: new Date().toISOString(),
          type: "custom",
          agent: "llm-judge",
          data: {
            assertionType: "llm_judge",
            prompt: judgePrompt,
            score: evaluation.score,
            reasoning: evaluation.reasoning,
            passed: evaluation.passed,
          },
        });
      } catch {
        // Non-blocking trace write
      }
    }

    const providerLabel = config.provider || "ollama";
    return {
      assertion: config,
      passed: evaluation.passed,
      message:
        config.message ||
        `LLM Judge [${providerLabel}]: ${evaluation.reasoning} (score: ${evaluation.score.toFixed(2)}, threshold: ${threshold})`,
      expected: `score >= ${threshold}`,
      actual: `score ${evaluation.score.toFixed(2)} (${evaluation.reasoning})`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      assertion: config,
      passed: false,
      message: `LLM Judge evaluation failed: ${errorMsg}`,
      expected: `score >= ${threshold}`,
      actual: `Error: ${errorMsg}`,
    };
  }
}
