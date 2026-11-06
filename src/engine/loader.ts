import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { TestCase, TestCaseSchema } from "../types/index.js";

export interface LoadedTestCase {
  filePath: string;
  testCase: TestCase;
}

export function loadTestFile(filePath: string): LoadedTestCase {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Test file not found: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf-8");
  const rawData = yaml.parse(content);

  const testCase = TestCaseSchema.parse(rawData);
  return {
    filePath: absolutePath,
    testCase,
  };
}

export function discoverTestFiles(targetPath: string): string[] {
  const absolutePath = path.resolve(process.cwd(), targetPath);

  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    if (absolutePath.endsWith(".yaml") || absolutePath.endsWith(".yml")) {
      return [absolutePath];
    }
    return [];
  }

  // If directory, recursively discover .yaml and .yml files
  const discovered: string[] = [];

  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        scan(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
      ) {
        discovered.push(fullPath);
      }
    }
  }

  scan(absolutePath);
  return discovered;
}

export function loadTestsFromPath(targetPath: string): LoadedTestCase[] {
  const files = discoverTestFiles(targetPath);
  const tests: LoadedTestCase[] = [];

  for (const file of files) {
    try {
      tests.push(loadTestFile(file));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: Failed to load test from ${file}: ${message}`);
    }
  }

  return tests;
}
