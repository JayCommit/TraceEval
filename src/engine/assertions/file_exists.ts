import fs from "node:fs";
import path from "node:path";
import { FileExistsAssertionSchema, AssertionResult } from "../../types/index.js";
import { z } from "zod";

type FileExistsConfig = z.infer<typeof FileExistsAssertionSchema>;

export function checkFileExists(
  config: FileExistsConfig,
  workspaceDir: string
): AssertionResult {
  const filePath = path.isAbsolute(config.path)
    ? config.path
    : path.join(workspaceDir, config.path);

  const exists = fs.existsSync(filePath);
  const shouldExist = config.should_exist ?? true;
  const passed = exists === shouldExist;

  let defaultMessage: string;
  if (shouldExist) {
    defaultMessage = exists
      ? `File '${config.path}' exists`
      : `File '${config.path}' does not exist`;
  } else {
    defaultMessage = exists
      ? `File '${config.path}' should not exist (exists: true)`
      : `File '${config.path}' does not exist (as expected)`;
  }

  return {
    assertion: config,
    passed,
    message: config.message || defaultMessage,
    expected: shouldExist ? `File '${config.path}' to exist` : `File '${config.path}' NOT to exist`,
    actual: exists ? `File exists at: ${config.path}` : `File does not exist: ${config.path}`,
  };
}
