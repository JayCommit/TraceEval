import { describe, it, expect } from "vitest";
import {
  analyzeSemanticDiff,
  extractDeclarations,
  detectLanguage,
} from "../src/viewer/semantic.js";
import { renderDiffHtml, extractDiffFromEvent } from "../src/viewer/diff.js";
import { TraceEvent } from "../src/types/index.js";

describe("AST-Aware Semantic Diff Analyzer", () => {
  it("should detect language accurately from filename", () => {
    expect(detectLanguage("src/auth.ts")).toBe("typescript");
    expect(detectLanguage("components/App.tsx")).toBe("typescript");
    expect(detectLanguage("server.mjs")).toBe("javascript");
    expect(detectLanguage("model.py")).toBe("python");
    expect(detectLanguage("main.go")).toBe("go");
    expect(detectLanguage("main.rs")).toBe("rust");
    expect(detectLanguage("unknown.txt")).toBe("unknown");
  });

  it("should extract function, method, and class declarations from TypeScript", () => {
    const code = `
export class AuthService {
  private secret: string;

  public async verifyToken(token: string): Promise<boolean> {
    if (!token) return false;
    return true;
  }
}

export function generateToken(userId: string): string {
  const prefix = "usr_";
  return prefix + userId;
}
    `.trim();

    const decls = extractDeclarations(code, "typescript");
    expect(decls.length).toBeGreaterThanOrEqual(2);

    const authClass = decls.find((d) => d.name === "AuthService");
    expect(authClass).toBeDefined();
    expect(authClass?.kind).toBe("class");

    const genToken = decls.find((d) => d.name === "generateToken");
    expect(genToken).toBeDefined();
    expect(genToken?.kind).toBe("function");
    expect(genToken?.params).toBe("userId: string");
  });

  it("should extract function and class declarations from Python", () => {
    const code = `
class DataPipeline:
    def process_records(self, records, debug=False):
        total = 0
        for r in records:
            total += r.val
        return total

def calculate_average(items):
    return sum(items) / len(items)
    `.trim();

    const decls = extractDeclarations(code, "python");
    expect(decls.length).toBeGreaterThanOrEqual(2);

    const pipeClass = decls.find((d) => d.name === "DataPipeline");
    expect(pipeClass).toBeDefined();

    const calcAvg = decls.find((d) => d.name === "calculate_average");
    expect(calcAvg).toBeDefined();
    expect(calcAvg?.params).toBe("items");
  });

  it("should detect function signature changes in TypeScript", () => {
    const oldCode = `
function calculateDiscount(price: number): number {
  return price * 0.1;
}
    `.trim();

    const newCode = `
function calculateDiscount(price: number, loyaltyTier: string = "bronze"): number {
  const rate = loyaltyTier === "gold" ? 0.2 : 0.1;
  return price * rate;
}
    `.trim();

    const report = analyzeSemanticDiff(oldCode, newCode, "src/pricing.ts");
    expect(report.hasStructuralChanges).toBe(true);
    expect(report.signatureChanges.length).toBe(1);
    expect(report.signatureChanges[0].name).toBe("calculateDiscount");
    expect(report.signatureChanges[0].oldParams).toBe("price: number");
    expect(report.signatureChanges[0].newParams).toContain("loyaltyTier: string");
    expect(report.summary.some((s) => s.includes("Signature changed"))).toBe(true);
  });

  it("should detect moved code blocks and functions", () => {
    const oldCode = `
function helperA() {
  return 1;
}

function processTask() {
  const a = helperA();
  return a + 10;
}

function helperB() {
  return 2;
}
    `.trim();

    // Reorder: helperB moved above processTask, helperA moved to bottom
    const newCode = `
function helperB() {
  return 2;
}

function processTask() {
  const a = helperA();
  return a + 10;
}

function helperA() {
  return 1;
}
    `.trim();

    const report = analyzeSemanticDiff(oldCode, newCode, "src/tasks.ts");
    expect(report.hasStructuralChanges).toBe(true);
    expect(report.movedBlocks.length).toBeGreaterThan(0);
    expect(report.summary.some((s) => s.includes("Moved"))).toBe(true);
  });

  it("should detect renamed identifiers within a function scope", () => {
    const oldCode = `
function computeStats(items) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.price;
  }
  return subtotal;
}
    `.trim();

    const newCode = `
function computeStats(items) {
  let aggregate = 0;
  for (const item of items) {
    aggregate += item.price;
  }
  return aggregate;
}
    `.trim();

    const report = analyzeSemanticDiff(oldCode, newCode, "src/stats.ts");
    expect(report.hasStructuralChanges).toBe(true);
    expect(report.renamedIdentifiers.length).toBe(1);
    expect(report.renamedIdentifiers[0].oldName).toBe("subtotal");
    expect(report.renamedIdentifiers[0].newName).toBe("aggregate");
    expect(report.renamedIdentifiers[0].count).toBe(3);
  });

  it("should detect added and removed declarations", () => {
    const oldCode = `
function legacyLogin() {
  return false;
}
    `.trim();

    const newCode = `
function modernOAuthLogin() {
  return true;
}
    `.trim();

    const report = analyzeSemanticDiff(oldCode, newCode, "src/auth.ts");
    expect(report.hasStructuralChanges).toBe(true);
    expect(report.addedDeclarations.some((d) => d.name === "modernOAuthLogin")).toBe(true);
    expect(report.removedDeclarations.some((d) => d.name === "legacyLogin")).toBe(true);
  });

  it("should cleanly fall back with hasStructuralChanges: false on plain text or identical code", () => {
    const plain = "Hello world\nThis is a plain text file\nNo code here.";
    const report = analyzeSemanticDiff(plain, plain, "notes.txt");
    expect(report.hasStructuralChanges).toBe(false);
    expect(report.movedBlocks.length).toBe(0);
    expect(report.signatureChanges.length).toBe(0);
  });

  it("should render AST Structural Changes banner in renderDiffHtml", () => {
    const oldCode = `function foo(x: number) {\n  return x;\n}`;
    const newCode = `function foo(x: number, y: string = "") {\n  return x;\n}`;

    const event: TraceEvent = {
      id: "evt-semantic-test-1",
      sessionId: "sess-sem-1",
      timestamp: new Date().toISOString(),
      type: "file_change",
      agent: "claude-code",
      data: {
        path: "src/calc.ts",
        before: oldCode,
        after: newCode,
      },
    };

    const parsed = extractDiffFromEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.semanticReport).toBeDefined();
    expect(parsed?.semanticReport?.hasStructuralChanges).toBe(true);

    const html = renderDiffHtml(parsed!);
    expect(html).toContain("diff-semantic-banner");
    expect(html).toContain("AST Structural Changes");
    expect(html).toContain("pill-sig");
    expect(html).toContain("Signature: foo");
  });
});
