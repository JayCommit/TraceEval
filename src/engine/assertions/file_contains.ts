import fs from "node:fs";
import path from "node:path";
import { FileContainsAssertionSchema, AssertionResult } from "../../types/index.js";
import { z } from "zod";

type FileContainsConfig = z.infer<typeof FileContainsAssertionSchema>;

export function checkFileContains(
  config: FileContainsConfig,
  workspaceDir: string
): AssertionResult {
  const filePath = path.isAbsolute(config.path)
    ? config.path
    : path.join(workspaceDir, config.path);

  if (!fs.existsSync(filePath)) {
    return {
      assertion: config,
      passed: false,
      message: config.message
        ? `${config.message} (File not found: ${config.path})`
        : `File not found: ${config.path}`,
      expected: `File ${config.path} to exist and contain content`,
      actual: "File does not exist",
    };
  }

  const content = fs.readFileSync(filePath, "utf-8");

  // Check positive pattern match
  if (config.pattern) {
    const matched = content.includes(config.pattern);
    if (!matched) {
      const preview =
        content.trim().length === 0
          ? "(file is empty)"
          : content.length > 300
          ? content.slice(0, 300) + "..."
          : content;

      return {
        assertion: config,
        passed: false,
        message:
          config.message ||
          `File '${config.path}' does not contain expected pattern: "${config.pattern}"`,
        expected: config.pattern,
        actual: preview,
      };
    }
  }

  // Check negative match (must not contain)
  if (config.not_contains) {
    const foundForbidden = content.includes(config.not_contains);
    if (foundForbidden) {
      const lines = content.split("\n");
      const lineIdx = lines.findIndex((l) => l.includes(config.not_contains!));
      const lineNum = lineIdx >= 0 ? lineIdx + 1 : undefined;
      const snippet = lineIdx >= 0 ? lines[lineIdx].trim() : "";
      const locInfo = lineNum ? ` (line ${lineNum}: "${snippet}")` : "";

      return {
        assertion: config,
        passed: false,
        message:
          config.message ||
          `File '${config.path}' contains forbidden pattern: "${config.not_contains}"`,
        expected: `Pattern "${config.not_contains}" NOT to be present`,
        actual: `Pattern "${config.not_contains}" was found in ${config.path}${locInfo}`,
      };
    }
  }

  return {
    assertion: config,
    passed: true,
    message:
      config.message ||
      `File '${config.path}' contains expected content`,
    expected: config.pattern,
    actual: "Matched",
  };
}
