import {
  CostUnderAssertionSchema,
  AssertionResult,
  TraceSession,
} from "../../types/index.js";
import { z } from "zod";

export type CostUnderConfig = z.infer<typeof CostUnderAssertionSchema>;

export interface ExtractedCostAndTokens {
  cost: number;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Extracts total cost and tokens from session metadata or aggregates from trace events.
 */
export function extractCostAndTokens(session: TraceSession): ExtractedCostAndTokens {
  let cost = 0;
  let tokens = 0;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let costFoundInMetadata = false;
  let tokensFoundInMetadata = false;

  // 1. Inspect session.metadata first
  if (session.metadata) {
    if (typeof session.metadata.cost === "number") {
      cost = session.metadata.cost;
      costFoundInMetadata = true;
    } else if (typeof session.metadata.totalCost === "number") {
      cost = session.metadata.totalCost;
      costFoundInMetadata = true;
    } else if (typeof session.metadata.costUsd === "number") {
      cost = session.metadata.costUsd;
      costFoundInMetadata = true;
    } else if (typeof session.metadata.cost_usd === "number") {
      cost = session.metadata.cost_usd;
      costFoundInMetadata = true;
    }

    if (typeof session.metadata.tokens === "number") {
      tokens = session.metadata.tokens;
      tokensFoundInMetadata = true;
    } else if (session.metadata.tokens && typeof session.metadata.tokens === "object") {
      const tokObj = session.metadata.tokens as {
        total?: number;
        input?: number;
        output?: number;
      };
      if (typeof tokObj.input === "number") inputTokens = tokObj.input;
      if (typeof tokObj.output === "number") outputTokens = tokObj.output;
      if (typeof tokObj.total === "number") {
        tokens = tokObj.total;
        tokensFoundInMetadata = true;
      } else if (tokObj.input !== undefined || tokObj.output !== undefined) {
        tokens = (tokObj.input || 0) + (tokObj.output || 0);
        tokensFoundInMetadata = true;
      }
    } else if (typeof session.metadata.totalTokens === "number") {
      tokens = session.metadata.totalTokens;
      tokensFoundInMetadata = true;
    } else if (typeof session.metadata.total_tokens === "number") {
      tokens = session.metadata.total_tokens;
      tokensFoundInMetadata = true;
    }
  }

  // 2. Aggregate from trace events if not provided in metadata
  if (!costFoundInMetadata || !tokensFoundInMetadata) {
    let eventCost = 0;
    let eventTokens = 0;
    let eventInputTokens = 0;
    let eventOutputTokens = 0;

    for (const evt of session.events || []) {
      const data = evt.data;
      if (!data) continue;

      if (!costFoundInMetadata) {
        if (typeof data.cost === "number") eventCost += data.cost;
        else if (typeof data.costUsd === "number") eventCost += data.costUsd;
        else if (typeof data.cost_usd === "number") eventCost += data.cost_usd;
      }

      if (!tokensFoundInMetadata) {
        if (typeof data.tokens === "number") {
          eventTokens += data.tokens;
        } else if (data.tokens && typeof data.tokens === "object") {
          const t = data.tokens as { total?: number; input?: number; output?: number };
          if (typeof t.total === "number") {
            eventTokens += t.total;
          } else {
            const inTok = t.input || 0;
            const outTok = t.output || 0;
            eventInputTokens += inTok;
            eventOutputTokens += outTok;
            eventTokens += inTok + outTok;
          }
        } else if (typeof data.totalTokens === "number") {
          eventTokens += data.totalTokens;
        } else if (typeof data.total_tokens === "number") {
          eventTokens += data.total_tokens;
        } else if (data.usage && typeof data.usage === "object") {
          const u = data.usage as {
            total_tokens?: number;
            prompt_tokens?: number;
            completion_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
          };
          const inTok = u.prompt_tokens ?? u.input_tokens ?? 0;
          const outTok = u.completion_tokens ?? u.output_tokens ?? 0;
          eventInputTokens += inTok;
          eventOutputTokens += outTok;
          if (typeof u.total_tokens === "number") {
            eventTokens += u.total_tokens;
          } else {
            eventTokens += inTok + outTok;
          }
        }
      }
    }

    if (!costFoundInMetadata) {
      cost = Math.round(eventCost * 10000) / 10000;
    }
    if (!tokensFoundInMetadata) {
      tokens = eventTokens;
      if (eventInputTokens > 0) inputTokens = eventInputTokens;
      if (eventOutputTokens > 0) outputTokens = eventOutputTokens;
    }
  }

  return { cost, tokens, inputTokens, outputTokens };
}

/**
 * Evaluates the `cost_under` assertion against recorded trace session cost and tokens.
 */
export function checkCostUnder(
  config: CostUnderConfig,
  traceSession?: TraceSession | null
): AssertionResult {
  if (!traceSession) {
    const expectedParts: string[] = [];
    if (config.max_cost_usd !== undefined) expectedParts.push(`cost <= $${config.max_cost_usd}`);
    if (config.max_tokens !== undefined) expectedParts.push(`tokens <= ${config.max_tokens}`);

    return {
      assertion: config,
      passed: false,
      message: config.message || "No trace session found to evaluate cost_under",
      expected: expectedParts.length > 0 ? expectedParts.join(" and ") : "Cost/tokens within budget",
      actual: "No trace session",
    };
  }

  const { cost, tokens } = extractCostAndTokens(traceSession);

  const failures: string[] = [];
  const expectedParts: string[] = [];
  const actualParts: string[] = [];

  if (config.max_cost_usd !== undefined) {
    expectedParts.push(`cost <= $${config.max_cost_usd}`);
    actualParts.push(`cost: $${cost.toFixed(4)}`);
    if (cost > config.max_cost_usd) {
      failures.push(
        `Actual cost $${cost.toFixed(4)} exceeded maximum allowed cost of $${config.max_cost_usd}`
      );
    }
  }

  if (config.max_tokens !== undefined) {
    expectedParts.push(`tokens <= ${config.max_tokens}`);
    actualParts.push(`tokens: ${tokens}`);
    if (tokens > config.max_tokens) {
      failures.push(
        `Actual tokens (${tokens}) exceeded maximum allowed tokens of ${config.max_tokens}`
      );
    }
  }

  const passed = failures.length === 0;
  const expectedStr =
    expectedParts.length > 0 ? expectedParts.join(", ") : "Cost and token usage within limits";
  const actualStr =
    actualParts.length > 0 ? actualParts.join(", ") : `cost: $${cost.toFixed(4)}, tokens: ${tokens}`;

  let defaultMessage: string;
  if (passed) {
    defaultMessage = `Cost and token usage within budget (${actualStr})`;
  } else {
    defaultMessage = failures.join("; ");
  }

  return {
    assertion: config,
    passed,
    message: config.message || defaultMessage,
    expected: expectedStr,
    actual: actualStr,
  };
}
