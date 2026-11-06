import fs from "node:fs";
import path from "node:path";
import { loadTestsFromPath } from "./loader.js";

export interface SpecReference {
  raw: string;
  filePath: string;
  heading?: string;
}

export interface SpecValidationResult {
  valid: boolean;
  raw: string;
  filePath: string;
  heading?: string;
  error?: string;
  snippet?: string;
}

export interface TestSpecMapping {
  testName: string;
  testFile: string;
  spec?: string;
  validation?: SpecValidationResult;
}

export function parseSpecReference(specString: string): SpecReference {
  const hashIdx = specString.indexOf("#");
  if (hashIdx === -1) {
    return {
      raw: specString,
      filePath: specString.trim(),
    };
  }

  return {
    raw: specString,
    filePath: specString.slice(0, hashIdx).trim(),
    heading: specString.slice(hashIdx + 1).trim(),
  };
}

export function validateSpecReference(
  specString: string,
  workspaceDir: string = process.cwd()
): SpecValidationResult {
  const parsed = parseSpecReference(specString);
  const targetPath = path.isAbsolute(parsed.filePath)
    ? parsed.filePath
    : path.resolve(workspaceDir, parsed.filePath);

  if (!fs.existsSync(targetPath)) {
    return {
      valid: false,
      raw: specString,
      filePath: parsed.filePath,
      heading: parsed.heading,
      error: `Spec file not found: ${parsed.filePath}`,
    };
  }

  const content = fs.readFileSync(targetPath, "utf-8");

  if (!parsed.heading) {
    // Just file reference, file exists
    return {
      valid: true,
      raw: specString,
      filePath: parsed.filePath,
      snippet: content.slice(0, 150) + "...",
    };
  }

  // Heading search in markdown
  const targetHeading = parsed.heading.toLowerCase().replace(/^[#\s]+/, "").trim();
  const lines = content.split("\n");
  let foundLineIdx = -1;
  let headingLevel = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#")) {
      const match = line.match(/^(#+)\s+(.+)$/);
      if (match) {
        const hashes = match[1];
        const title = match[2].trim().toLowerCase();
        if (title === targetHeading || title.includes(targetHeading)) {
          foundLineIdx = i;
          headingLevel = hashes.length;
          break;
        }
      }
    }
  }

  if (foundLineIdx === -1) {
    return {
      valid: false,
      raw: specString,
      filePath: parsed.filePath,
      heading: parsed.heading,
      error: `Section heading "${parsed.heading}" not found in ${parsed.filePath}`,
    };
  }

  // Extract snippet until next heading of equal or higher level
  const snippetLines: string[] = [];
  for (let j = foundLineIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    const match = l.trim().match(/^(#+)\s+/);
    if (match && match[1].length <= headingLevel) {
      break;
    }
    if (l.trim().length > 0) {
      snippetLines.push(l.trim());
    }
    if (snippetLines.length >= 4) break;
  }

  const snippet = snippetLines.join(" ").slice(0, 200);

  return {
    valid: true,
    raw: specString,
    filePath: parsed.filePath,
    heading: parsed.heading,
    snippet: snippet ? `${snippet}...` : undefined,
  };
}

export function getProjectTestSpecs(
  testPath: string = path.join(process.cwd(), ".traceeval", "tests"),
  workspaceDir: string = process.cwd()
): TestSpecMapping[] {
  const tests = loadTestsFromPath(testPath);
  const mappings: TestSpecMapping[] = [];

  for (const t of tests) {
    const spec = t.testCase.spec;
    const mapping: TestSpecMapping = {
      testName: t.testCase.name,
      testFile: path.relative(workspaceDir, t.filePath),
      spec,
    };

    if (spec) {
      mapping.validation = validateSpecReference(spec, workspaceDir);
    }

    mappings.push(mapping);
  }

  return mappings;
}
