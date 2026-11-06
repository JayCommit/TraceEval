import { ToolCalledAssertionSchema, AssertionResult, TraceSession } from "../../types/index.js";
import { z } from "zod";
import { getDistinctToolCalls } from "./utils.js";

type ToolCalledConfig = z.infer<typeof ToolCalledAssertionSchema>;

export function checkToolCalled(
  config: ToolCalledConfig,
  traceSession?: TraceSession | null
): AssertionResult {
  if (!traceSession) {
    return {
      assertion: config,
      passed: false,
      message: config.message
        ? `${config.message} (No recorded trace session found to verify tool '${config.tool}')`
        : `No recorded trace session found to verify tool '${config.tool}'`,
      expected: `Tool '${config.tool}' called`,
      actual: "No trace session",
    };
  }

  const distinctCalls = getDistinctToolCalls(traceSession.events);
  const targetName = config.tool.toLowerCase();
  const matchingCalls = distinctCalls.filter(
    (c) => c.toolName.toLowerCase() === targetName
  );

  const count = matchingCalls.length;
  const minRequired = config.min ?? 1;
  const maxAllowed = config.max;

  let passed = count >= minRequired;
  if (maxAllowed !== undefined && count > maxAllowed) {
    passed = false;
  }

  let expectedStr: string;
  if (maxAllowed !== undefined) {
    if (minRequired === maxAllowed) {
      expectedStr = `exactly ${minRequired} call${minRequired === 1 ? "" : "s"}`;
    } else if (minRequired === 0) {
      expectedStr = `at most ${maxAllowed} call${maxAllowed === 1 ? "" : "s"}`;
    } else {
      expectedStr = `between ${minRequired} and ${maxAllowed} calls`;
    }
  } else {
    expectedStr = `at least ${minRequired} call${minRequired === 1 ? "" : "s"}`;
  }

  // Summary of other tools called in the session (helpful context when target tool is missing)
  const allToolsCalled = Array.from(new Set(distinctCalls.map((c) => c.toolName)));
  const toolsContext =
    allToolsCalled.length > 0
      ? ` (invoked tools: ${allToolsCalled.join(", ")})`
      : " (no tools invoked)";

  let defaultMessage: string;
  if (passed) {
    defaultMessage = `Tool '${config.tool}' called ${count} times (expected ${expectedStr})`;
  } else if (count < minRequired) {
    defaultMessage = `Expected tool '${config.tool}' to be called at least ${minRequired} time(s), but called ${count} time(s)`;
  } else {
    defaultMessage = `Tool '${config.tool}' exceeded maximum call limit of ${maxAllowed} (called ${count} times)`;
  }

  return {
    assertion: config,
    passed,
    message: config.message || defaultMessage,
    expected: expectedStr,
    actual: passed
      ? `${count} calls`
      : count < minRequired
      ? `${count} calls${toolsContext}`
      : `${count} calls`,
  };
}
