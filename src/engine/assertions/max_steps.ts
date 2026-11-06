import { MaxStepsAssertionSchema, AssertionResult, TraceSession } from "../../types/index.js";
import { z } from "zod";
import { getDistinctToolCalls } from "./utils.js";

type MaxStepsConfig = z.infer<typeof MaxStepsAssertionSchema>;

export function checkMaxSteps(
  config: MaxStepsConfig,
  traceSession?: TraceSession | null
): AssertionResult {
  if (!traceSession) {
    return {
      assertion: config,
      passed: false,
      message: config.message
        ? `${config.message} (No recorded trace session found to evaluate trajectory steps)`
        : "No recorded trace session found to evaluate trajectory steps",
      expected: `<= ${config.max} steps`,
      actual: "No trace session",
    };
  }

  // Count distinct tool call instances in trace (deduplicating paired pre/post tool hooks)
  const distinctCalls = getDistinctToolCalls(traceSession.events);
  const stepCount = distinctCalls.length;
  const passed = stepCount <= config.max;

  // Build breakdown of called tools for clear diagnostic failure context
  const toolCounts: Record<string, number> = {};
  for (const call of distinctCalls) {
    toolCounts[call.toolName] = (toolCounts[call.toolName] || 0) + 1;
  }
  const summaryList = Object.entries(toolCounts)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");

  return {
    assertion: config,
    passed,
    message:
      config.message ||
      (passed
        ? `Trajectory efficiency passed: ${stepCount} steps (limit: ${config.max})`
        : `Trajectory exceeded maximum step budget: took ${stepCount} steps (limit: ${config.max})`),
    expected: `<= ${config.max} steps`,
    actual: `${stepCount} steps${!passed && summaryList ? ` (${summaryList})` : ""}`,
  };
}
