import { execSync } from "node:child_process";
import { TestsPassAssertionSchema, AssertionResult } from "../../types/index.js";
import { z } from "zod";

type TestsPassConfig = z.infer<typeof TestsPassAssertionSchema>;

export async function checkTestsPass(
  config: TestsPassConfig,
  workspaceDir: string
): Promise<AssertionResult> {
  const timeoutMs = config.timeout_ms || 60000;

  try {
    const stdout = execSync(config.command, {
      cwd: workspaceDir,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return {
      assertion: config,
      passed: true,
      message:
        config.message || `Test command passed: '${config.command}'`,
      expected: "Exit code 0",
      actual: stdout.slice(0, 300) || "Exit code 0",
    };
  } catch (error: any) {
    const stderr = error.stderr?.toString() || "";
    const stdout = error.stdout?.toString() || "";
    const combinedOutput = (stderr + (stderr && stdout ? "\n" : "") + stdout).trim();

    return {
      assertion: config,
      passed: false,
      message:
        config.message ||
        `Test command failed with exit code ${error.status ?? "error"}: '${config.command}'`,
      expected: "Exit code 0",
      actual: combinedOutput.slice(0, 500) || error.message || `Exit code ${error.status}`,
    };
  }
}
