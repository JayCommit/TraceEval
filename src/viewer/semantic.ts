/**
 * AST-Aware Semantic Diff Analyzer for TraceEval.
 *
 * Provides lightweight, zero-dependency syntax analysis for recognizing
 * structural code changes:
 *  - Moved blocks and reordered functions
 *  - Function/method signature and parameter modifications
 *  - Renamed identifiers within modified scopes
 *  - Added and removed declarations
 *
 * Supports TypeScript/JavaScript, Python, and C-like languages with
 * automatic fallback to standard token-level diffing.
 */

export interface CodeDeclaration {
  name: string;
  kind: "function" | "method" | "class" | "interface" | "type" | "block";
  signature: string;
  params: string;
  startLine: number;
  endLine: number;
  body: string;
  normalizedBody: string;
  identifiers: string[];
}

export interface MovedBlock {
  name: string;
  kind: string;
  oldStartLine: number;
  oldEndLine: number;
  newStartLine: number;
  newEndLine: number;
  similarity: number;
}

export interface SignatureChange {
  name: string;
  kind: string;
  oldSig: string;
  newSig: string;
  oldParams: string;
  newParams: string;
  line: number;
}

export interface RenamedIdentifier {
  oldName: string;
  newName: string;
  count: number;
  scope?: string;
}

export interface SemanticDiffReport {
  hasStructuralChanges: boolean;
  language: string;
  movedBlocks: MovedBlock[];
  signatureChanges: SignatureChange[];
  renamedIdentifiers: RenamedIdentifier[];
  addedDeclarations: { name: string; kind: string; line: number }[];
  removedDeclarations: { name: string; kind: string; line: number }[];
  summary: string[];
}

// Common reserved keywords to ignore when checking identifier renames
const RESERVED_KEYWORDS = new Set([
  "function", "const", "let", "var", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "default", "try", "catch",
  "finally", "throw", "new", "typeof", "instanceof", "in", "of", "void",
  "delete", "yield", "await", "async", "import", "export", "from", "as",
  "class", "extends", "super", "this", "null", "undefined", "true", "false",
  "def", "self", "cls", "elif", "except", "pass", "lambda", "with", "raise",
  "is", "not", "and", "or", "global", "nonlocal", "type", "interface", "public",
  "private", "protected", "readonly", "static", "abstract", "implements",
  "string", "number", "boolean", "any", "unknown", "never", "int", "float",
  "str", "list", "dict", "set", "tuple", "bool", "None", "True", "False",
]);

/**
 * Detects programming language from filename extension.
 */
export function detectLanguage(filename = ""): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
    case "pyw":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "c":
    case "cpp":
    case "cc":
    case "h":
    case "hpp":
      return "c_cpp";
    default:
      return "unknown";
  }
}

/**
 * Normalizes code body whitespace for structural similarity comparison.
 */
function normalizeCodeBody(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "") // strip comments
    .replace(/#.*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenizes code into alphanumeric identifiers excluding language keywords.
 */
export function extractIdentifiers(code: string): string[] {
  const regex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
  const matches = code.match(regex) || [];
  return matches.filter((id) => !RESERVED_KEYWORDS.has(id) && id.length > 1);
}

/**
 * Computes token-level Jaccard similarity between two code snippets.
 */
function computeCodeSimilarity(strA: string, strB: string): number {
  if (strA === strB) return 1.0;
  if (!strA || !strB) return 0.0;

  const tokensA = new Set(extractIdentifiers(strA));
  const tokensB = new Set(extractIdentifiers(strB));

  if (tokensA.size === 0 && tokensB.size === 0) {
    return strA.trim() === strB.trim() ? 1.0 : 0.0;
  }

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extracts declarations from TypeScript/JavaScript and C-like source code.
 */
function extractBraceDeclarations(lines: string[]): CodeDeclaration[] {
  const decls: CodeDeclaration[] = [];
  const totalLines = lines.length;

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Function declaration: function foo(...) or export async function bar(...)
    const fnMatch = trimmed.match(
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s*\*|\s+)?([a-zA-Z0-9_$]+)?\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{?/
    );

    // 2. Variable function: const foo = (params) => or const foo = async function(...)
    const varFnMatch = trimmed.match(
      /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([a-zA-Z0-9_$]+))\s*(?::\s*[^=]+)?=>\s*\{?/
    );

    // 3. Class or Interface: class Foo or interface Bar or type Baz = {
    const classMatch = trimmed.match(
      /^(?:export\s+)?(?:abstract\s+)?(?:class|interface)\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?(?:\s+(?:extends|implements)[^{]+)?\s*\{?/
    );

    // 4. Class Method: foo(params): Type { or async foo(params) {
    const methodMatch = trimmed.match(
      /^(?:(?:public|private|protected|static|async)\s+)*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{/
    );

    let name = "";
    let kind: CodeDeclaration["kind"] = "function";
    let params = "";
    let signature = "";

    if (fnMatch) {
      name = fnMatch[1] || "anonymous";
      kind = "function";
      params = (fnMatch[2] || "").trim();
      signature = trimmed.replace(/\{[\s\S]*$/, "").trim();
    } else if (varFnMatch) {
      name = varFnMatch[1];
      kind = "function";
      params = (varFnMatch[2] || varFnMatch[3] || "").trim();
      signature = trimmed.replace(/\{[\s\S]*$/, "").trim();
    } else if (classMatch) {
      name = classMatch[1];
      kind = trimmed.includes("interface") ? "interface" : "class";
      params = "";
      signature = trimmed.replace(/\{[\s\S]*$/, "").trim();
    } else if (methodMatch && !trimmed.startsWith("if") && !trimmed.startsWith("switch") && !trimmed.startsWith("for") && !trimmed.startsWith("while")) {
      name = methodMatch[1];
      kind = "method";
      params = (methodMatch[2] || "").trim();
      signature = trimmed.replace(/\{[\s\S]*$/, "").trim();
    }

    if (!name || name === "if" || name === "for" || name === "while" || name === "switch" || name === "catch") {
      continue;
    }

    // Find the enclosing body braces
    let startLine = i + 1;
    let braceDepth = 0;
    let foundFirstBrace = false;
    let bodyLines: string[] = [];

    for (let j = i; j < totalLines; j++) {
      const curLine = lines[j];
      bodyLines.push(curLine);

      for (let c = 0; c < curLine.length; c++) {
        const ch = curLine[c];
        if (ch === "{") {
          braceDepth++;
          foundFirstBrace = true;
        } else if (ch === "}") {
          braceDepth--;
        }
      }

      if (foundFirstBrace && braceDepth <= 0) {
        const endLine = j + 1;
        const bodyText = bodyLines.join("\n");
        decls.push({
          name,
          kind,
          signature: signature || trimmed,
          params,
          startLine,
          endLine,
          body: bodyText,
          normalizedBody: normalizeCodeBody(bodyText),
          identifiers: extractIdentifiers(bodyText),
        });
        i = j; // skip parsed range
        break;
      }
    }
  }

  return decls;
}

/**
 * Extracts declarations from Python source code using indentation blocks.
 */
function extractPythonDeclarations(lines: string[]): CodeDeclaration[] {
  const decls: CodeDeclaration[] = [];
  const totalLines = lines.length;

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)(?:async\s+)?(def|class)\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]*)\))?/);
    if (!match) continue;

    const indent = match[1].length;
    const isDef = match[2] === "def";
    const name = match[3];
    const params = (match[4] || "").trim();
    const kind = isDef ? (indent > 0 ? "method" : "function") : "class";
    const signature = line.trim().replace(/:$/, "");

    const startLine = i + 1;
    const bodyLines: string[] = [line];
    let j = i + 1;

    while (j < totalLines) {
      const nextLine = lines[j];
      if (nextLine.trim().length === 0) {
        bodyLines.push(nextLine);
        j++;
        continue;
      }

      const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
      if (nextIndent <= indent) {
        break;
      }
      bodyLines.push(nextLine);
      j++;
    }

    const endLine = j;
    const bodyText = bodyLines.join("\n");

    decls.push({
      name,
      kind,
      signature,
      params,
      startLine,
      endLine,
      body: bodyText,
      normalizedBody: normalizeCodeBody(bodyText),
      identifiers: extractIdentifiers(bodyText),
    });

    i = j - 1;
  }

  return decls;
}

/**
 * Extracts code declarations based on language heuristics.
 */
export function extractDeclarations(code: string, language: string): CodeDeclaration[] {
  if (!code || !code.trim()) return [];
  const lines = code.split("\n");

  if (language === "python") {
    return extractPythonDeclarations(lines);
  }

  // TypeScript, JavaScript, Go, Rust, Java, C/C++ all share brace-based structures
  return extractBraceDeclarations(lines);
}

/**
 * Analyzes structural AST differences between old and new source code.
 */
export function analyzeSemanticDiff(
  oldContent: string,
  newContent: string,
  filename = "file"
): SemanticDiffReport {
  const language = detectLanguage(filename);

  // Performance safeguards: skip heavy analysis for very large files or unknown extensions
  if (
    oldContent.length > 250_000 ||
    newContent.length > 250_000 ||
    oldContent.split("\n").length > 2000 ||
    newContent.split("\n").length > 2000
  ) {
    return {
      hasStructuralChanges: false,
      language,
      movedBlocks: [],
      signatureChanges: [],
      renamedIdentifiers: [],
      addedDeclarations: [],
      removedDeclarations: [],
      summary: [],
    };
  }

  const oldDecls = extractDeclarations(oldContent, language);
  const newDecls = extractDeclarations(newContent, language);

  // Performance safeguard: avoid quadratic comparison explosion on massive declaration sets
  if (oldDecls.length > 150 || newDecls.length > 150) {
    return {
      hasStructuralChanges: false,
      language,
      movedBlocks: [],
      signatureChanges: [],
      renamedIdentifiers: [],
      addedDeclarations: [],
      removedDeclarations: [],
      summary: [`Semantic analysis skipped: declaration count exceeds limit (${Math.max(oldDecls.length, newDecls.length)} > 150)`],
    };
  }

  const movedBlocks: MovedBlock[] = [];
  const signatureChanges: SignatureChange[] = [];
  const renamedIdentifiers: RenamedIdentifier[] = [];
  const addedDeclarations: { name: string; kind: string; line: number }[] = [];
  const removedDeclarations: { name: string; kind: string; line: number }[] = [];
  const summary: string[] = [];

  const matchedOldIndices = new Set<number>();
  const matchedNewIndices = new Set<number>();

  // 1. Direct name match: check signature changes, line moves, and renamed identifiers
  for (let oIdx = 0; oIdx < oldDecls.length; oIdx++) {
    const o = oldDecls[oIdx];
    const nIdx = newDecls.findIndex((item, idx) => !matchedNewIndices.has(idx) && item.name === o.name && item.kind === o.kind);

    if (nIdx !== -1) {
      const n = newDecls[nIdx];
      matchedOldIndices.add(oIdx);
      matchedNewIndices.add(nIdx);

      // Signature change check
      if (o.params !== n.params || o.signature !== n.signature) {
        signatureChanges.push({
          name: o.name,
          kind: o.kind,
          oldSig: o.signature,
          newSig: n.signature,
          oldParams: o.params,
          newParams: n.params,
          line: n.startLine,
        });
        summary.push(`Signature changed: ${o.name}(${o.params}) → ${n.name}(${n.params})`);
      }

      // Moved block check (moved by more than 3 lines with high body similarity)
      const lineShift = Math.abs(o.startLine - n.startLine);
      const similarity = computeCodeSimilarity(o.body, n.body);

      if (lineShift > 3 && similarity >= 0.70) {
        movedBlocks.push({
          name: o.name,
          kind: o.kind,
          oldStartLine: o.startLine,
          oldEndLine: o.endLine,
          newStartLine: n.startLine,
          newEndLine: n.endLine,
          similarity,
        });
        summary.push(`Moved ${o.kind} '${o.name}' from lines ${o.startLine}–${o.endLine} to ${n.startLine}–${n.endLine}`);
      }

      // Renamed identifier check within the declaration scope
      if (similarity < 1.0) {
        const oldIdentCounts = new Map<string, number>();
        const newIdentCounts = new Map<string, number>();

        for (const id of o.identifiers) oldIdentCounts.set(id, (oldIdentCounts.get(id) || 0) + 1);
        for (const id of n.identifiers) newIdentCounts.set(id, (newIdentCounts.get(id) || 0) + 1);

        const oldDisappeared: string[] = [];
        const newAppeared: string[] = [];

        for (const [id] of oldIdentCounts) {
          if (!newIdentCounts.has(id)) oldDisappeared.push(id);
        }
        for (const [id] of newIdentCounts) {
          if (!oldIdentCounts.has(id)) newAppeared.push(id);
        }

        // If 1-to-1 identifier substitution or similar count within this block
        if (oldDisappeared.length === 1 && newAppeared.length === 1) {
          const oldName = oldDisappeared[0];
          const newName = newAppeared[0];
          const count = newIdentCounts.get(newName) || 1;
          renamedIdentifiers.push({
            oldName,
            newName,
            count,
            scope: o.name,
          });
          summary.push(`Renamed identifier in ${o.name}: '${oldName}' → '${newName}' (${count}x)`);
        }
      }
    }
  }

  // 2. Unmatched declarations: check for moved blocks with renamed functions
  for (let oIdx = 0; oIdx < oldDecls.length; oIdx++) {
    if (matchedOldIndices.has(oIdx)) continue;
    const o = oldDecls[oIdx];

    for (let nIdx = 0; nIdx < newDecls.length; nIdx++) {
      if (matchedNewIndices.has(nIdx)) continue;
      const n = newDecls[nIdx];

      const similarity = computeCodeSimilarity(o.body, n.body);
      if (similarity >= 0.85) {
        matchedOldIndices.add(oIdx);
        matchedNewIndices.add(nIdx);

        movedBlocks.push({
          name: `${o.name} → ${n.name}`,
          kind: o.kind,
          oldStartLine: o.startLine,
          oldEndLine: o.endLine,
          newStartLine: n.startLine,
          newEndLine: n.endLine,
          similarity,
        });
        summary.push(`Moved and renamed ${o.kind} '${o.name}' → '${n.name}' (lines ${o.startLine}–${o.endLine} to ${n.startLine}–${n.endLine})`);
        break;
      }
    }
  }

  // 3. Collect added and removed declarations
  for (let oIdx = 0; oIdx < oldDecls.length; oIdx++) {
    if (!matchedOldIndices.has(oIdx)) {
      const o = oldDecls[oIdx];
      removedDeclarations.push({ name: o.name, kind: o.kind, line: o.startLine });
      summary.push(`Removed ${o.kind}: ${o.name}`);
    }
  }

  for (let nIdx = 0; nIdx < newDecls.length; nIdx++) {
    if (!matchedNewIndices.has(nIdx)) {
      const n = newDecls[nIdx];
      addedDeclarations.push({ name: n.name, kind: n.kind, line: n.startLine });
      summary.push(`Added ${n.kind}: ${n.name}`);
    }
  }

  const hasStructuralChanges =
    movedBlocks.length > 0 ||
    signatureChanges.length > 0 ||
    renamedIdentifiers.length > 0 ||
    addedDeclarations.length > 0 ||
    removedDeclarations.length > 0;

  return {
    hasStructuralChanges,
    language,
    movedBlocks,
    signatureChanges,
    renamedIdentifiers,
    addedDeclarations,
    removedDeclarations,
    summary,
  };
}
