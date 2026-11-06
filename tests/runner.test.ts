import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TestRunner } from "../src/engine/runner.js";
import { StorageManager } from "../src/storage/index.js";
import { LoadedTestCase } from "../src/engine/loader.js";

describe("TestRunner End-to-End", () => {
  let tmpDir: string;
  let storage: StorageManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-runner-test-"));
    storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should run setup, execute command, and verify assertions", async () => {
    const loadedTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "sample-eval.yaml"),
      testCase: {
        name: "Greeting Function Generation",
        setup: {
          files: {
            "src/greet.ts": "export function greet() { return 'TODO'; }",
          },
        },
        run: {
          // Simulated agent execution that replaces TODO with 'Hello, World!'
          command: `node -e "const fs = require('fs'); fs.writeFileSync('src/greet.ts', 'export function greet() { return \\'Hello, World!\\'; }');"`,
        },
        assertions: [
          {
            type: "file_exists",
            path: "src/greet.ts",
          },
          {
            type: "file_contains",
            path: "src/greet.ts",
            pattern: "Hello, World!",
          },
          {
            type: "file_contains",
            path: "src/greet.ts",
            not_contains: "TODO",
          },
        ],
      },
    };

    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
    });

    const result = await runner.runTest(loadedTest);

    expect(result.status).toBe("passed");
    expect(result.assertionResults).toHaveLength(3);
    expect(result.assertionResults.every((a) => a.passed)).toBe(true);

    const editedContent = fs.readFileSync(path.join(tmpDir, "src/greet.ts"), "utf-8");
    expect(editedContent).toContain("Hello, World!");
  });

  it("should report failure when assertions fail", async () => {
    const loadedTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "failing-eval.yaml"),
      testCase: {
        name: "Expected Failure Test",
        setup: {
          files: {
            "output.txt": "unexpected contents",
          },
        },
        assertions: [
          {
            type: "file_contains",
            path: "output.txt",
            pattern: "expected specific string",
          },
        ],
      },
    };

    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
    });

    const result = await runner.runTest(loadedTest);

    expect(result.status).toBe("failed");
    expect(result.assertionResults[0].passed).toBe(false);
  });

  it("should block setup file paths that escape workspace directory (path traversal guard)", async () => {
    const maliciousTest: LoadedTestCase = {
      filePath: path.join(tmpDir, "traversal-eval.yaml"),
      testCase: {
        name: "Malicious Traversal Test",
        setup: {
          files: {
            "../../escaped.txt": "should never be written",
          },
        },
        assertions: [],
      },
    };

    const runner = new TestRunner({
      workspaceDir: tmpDir,
      storage,
    });

    const result = await runner.runTest(maliciousTest);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("escapes workspace directory");
  });
});
