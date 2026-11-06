import { AssertionConfig, AssertionResult, TraceSession } from "../../types/index.js";
import { StorageManager } from "../../storage/index.js";
import { checkFileContains } from "./file_contains.js";
import { checkFileExists } from "./file_exists.js";
import { checkTestsPass } from "./tests_pass.js";
import { checkMaxSteps } from "./max_steps.js";
import { checkToolCalled } from "./tool_called.js";
import { checkNoDangerousCommands } from "./no_dangerous_commands.js";
import { checkCostUnder } from "./cost_under.js";
import { checkLLMJudge } from "./llm_judge.js";

export * from "./file_contains.js";
export * from "./file_exists.js";
export * from "./tests_pass.js";
export * from "./max_steps.js";
export * from "./tool_called.js";
export * from "./no_dangerous_commands.js";
export * from "./cost_under.js";
export * from "./llm_judge.js";

export interface AssertionContext {
  workspaceDir: string;
  traceSession?: TraceSession | null;
  enableJudge?: boolean;
  storage?: StorageManager;
}

export async function evaluateAssertion(
  assertion: AssertionConfig,
  context: AssertionContext
): Promise<AssertionResult> {
  const startTime = Date.now();
  let result: AssertionResult;

  switch (assertion.type) {
    case "file_contains":
      result = checkFileContains(assertion, context.workspaceDir);
      break;

    case "file_exists":
      result = checkFileExists(assertion, context.workspaceDir);
      break;

    case "tests_pass":
      result = await checkTestsPass(assertion, context.workspaceDir);
      break;

    case "max_steps":
      result = checkMaxSteps(assertion, context.traceSession);
      break;

    case "tool_called":
      result = checkToolCalled(assertion, context.traceSession);
      break;

    case "no_dangerous_commands":
      result = checkNoDangerousCommands(assertion, context.traceSession);
      break;

    case "cost_under":
      result = checkCostUnder(assertion, context.traceSession);
      break;

    case "llm_judge":
      result = await checkLLMJudge(assertion, {
        traceSession: context.traceSession,
        enableJudge: context.enableJudge,
        storage: context.storage,
      });
      break;

    default: {
      const assertionType = (assertion as { type: string }).type;
      result = {
        assertion,
        passed: false,
        message: `Unknown assertion type: ${assertionType}`,
        expected: "Valid assertion type",
        actual: assertionType,
      };
    }
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
