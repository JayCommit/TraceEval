import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseSpecReference,
  validateSpecReference,
  getProjectTestSpecs,
} from "../src/engine/specs.js";

describe("AGENTS.md Spec Helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-specs-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should parse spec references with and without section headings", () => {
    const parsed1 = parseSpecReference("AGENTS.md#Testing Rules");
    expect(parsed1.filePath).toBe("AGENTS.md");
    expect(parsed1.heading).toBe("Testing Rules");

    const parsed2 = parseSpecReference("docs/instructions.md");
    expect(parsed2.filePath).toBe("docs/instructions.md");
    expect(parsed2.heading).toBeUndefined();
  });

  it("should validate existing file and section heading in Markdown", () => {
    const mdContent = `# Project Guidelines

Here is an overview.

## Testing Rules
Agents must write unit tests before opening PRs.
Tests should be clean and deterministic.

## Coding Style
Use TypeScript strict mode.
`;
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), mdContent, "utf-8");

    const validResult = validateSpecReference("AGENTS.md#Testing Rules", tmpDir);
    expect(validResult.valid).toBe(true);
    expect(validResult.snippet).toContain("Agents must write unit tests");

    const partialHeadingResult = validateSpecReference("AGENTS.md#Coding Style", tmpDir);
    expect(partialHeadingResult.valid).toBe(true);
    expect(partialHeadingResult.snippet).toContain("TypeScript strict mode");
  });

  it("should detect missing files and missing headings", () => {
    const missingFileResult = validateSpecReference("NONEXISTENT.md#Rules", tmpDir);
    expect(missingFileResult.valid).toBe(false);
    expect(missingFileResult.error).toContain("Spec file not found");

    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Guidelines\nIntro text.", "utf-8");
    const missingHeadingResult = validateSpecReference("AGENTS.md#Missing Section", tmpDir);
    expect(missingHeadingResult.valid).toBe(false);
    expect(missingHeadingResult.error).toContain('heading "Missing Section" not found');
  });

  it("should list tests and their spec mappings across the project", () => {
    const testsDir = path.join(tmpDir, ".traceeval", "tests");
    fs.mkdirSync(testsDir, { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "AGENTS.md"),
      "# Core Rules\n\n## Greeting Behavior\nMust return Hello TraceEval.\n",
      "utf-8"
    );

    const testYaml = `
name: "Greeting Spec Test"
spec: "AGENTS.md#Greeting Behavior"
assertions:
  - type: "file_exists"
    path: "src/greet.ts"
`;
    fs.writeFileSync(path.join(testsDir, "greet.yaml"), testYaml, "utf-8");

    const mappings = getProjectTestSpecs(testsDir, tmpDir);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].testName).toBe("Greeting Spec Test");
    expect(mappings[0].spec).toBe("AGENTS.md#Greeting Behavior");
    expect(mappings[0].validation?.valid).toBe(true);
    expect(mappings[0].validation?.snippet).toContain("Must return Hello TraceEval");
  });

  it("should match headings with numbered prefixes and deep nesting", () => {
    const mdContent = `# Project Documentation
### 3.1 Advanced Safety Protocols (Strict Mode)
Never bypass file security boundaries.

#### Nested Deep Section
Deep content snippet.
`;
    fs.writeFileSync(path.join(tmpDir, "SPEC.md"), mdContent, "utf-8");

    // Match with number prefix
    const res1 = validateSpecReference("SPEC.md#3.1 Advanced Safety Protocols", tmpDir);
    expect(res1.valid).toBe(true);
    expect(res1.snippet).toContain("Never bypass file security boundaries");

    // Match deep section
    const res2 = validateSpecReference("SPEC.md#Nested Deep Section", tmpDir);
    expect(res2.valid).toBe(true);
    expect(res2.snippet).toContain("Deep content snippet");

    // Just file reference without hash
    const res3 = validateSpecReference("SPEC.md", tmpDir);
    expect(res3.valid).toBe(true);
    expect(res3.snippet).toBeDefined();
  });
});
