import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadTestFile, discoverTestFiles } from "../src/engine/loader.js";

describe("Test Loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-loader-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should load and parse valid YAML test case", () => {
    const yamlContent = `
name: "Test YAML Loader"
description: "Verifies test parsing"
tags: ["unit", "smoke"]
assertions:
  - type: "file_exists"
    path: "src/index.ts"
  - type: "max_steps"
    max: 5
`;
    const testFile = path.join(tmpDir, "test-case.yaml");
    fs.writeFileSync(testFile, yamlContent, "utf-8");

    const loaded = loadTestFile(testFile);
    expect(loaded.testCase.name).toBe("Test YAML Loader");
    expect(loaded.testCase.tags).toEqual(["unit", "smoke"]);
    expect(loaded.testCase.assertions).toHaveLength(2);
  });

  it("should discover test files recursively in a directory", () => {
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, "test1.yaml"), "name: 'T1'\nassertions: []");
    fs.writeFileSync(path.join(subDir, "test2.yml"), "name: 'T2'\nassertions: []");
    fs.writeFileSync(path.join(tmpDir, "ignore.txt"), "text");

    const discovered = discoverTestFiles(tmpDir);
    expect(discovered).toHaveLength(2);
    expect(discovered.some((f) => f.endsWith("test1.yaml"))).toBe(true);
    expect(discovered.some((f) => f.endsWith("test2.yml"))).toBe(true);
  });
});
