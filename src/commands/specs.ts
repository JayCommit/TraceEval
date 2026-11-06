import path from "node:path";
import pc from "picocolors";
import { getProjectTestSpecs } from "../engine/specs.js";

export interface SpecsOptions {
  validate?: boolean;
  json?: boolean;
}

export function runSpecs(
  targetPath?: string,
  options: SpecsOptions = {}
): void {
  const cwd = process.cwd();
  const testDir = targetPath || path.join(cwd, ".traceeval", "tests");

  const mappings = getProjectTestSpecs(testDir, cwd);

  if (options.json) {
    console.log(JSON.stringify(mappings, null, 2));
    if (options.validate && mappings.some((m) => m.validation && !m.validation.valid)) {
      process.exit(1);
    }
    return;
  }

  console.log("");
  console.log(pc.bold(pc.cyan("TraceEval Spec Links")));
  console.log(pc.dim("Tying agent evaluation tests directly to AGENTS.md / CLAUDE.md specs"));
  console.log(pc.dim("─".repeat(75)));

  if (mappings.length === 0) {
    console.log(pc.yellow(`No tests found in ${testDir}`));
    return;
  }

  let brokenCount = 0;
  let linkedCount = 0;

  for (const m of mappings) {
    const testHeader = pc.bold(m.testName);
    const fileHint = pc.dim(`(${m.testFile})`);

    if (!m.spec) {
      console.log(`  ${pc.dim("•")} ${testHeader} ${fileHint}`);
      console.log(`    ${pc.dim("Spec:")} ${pc.dim("None linked (add `spec: AGENTS.md#Heading` to YAML)")}`);
    } else {
      linkedCount++;
      const val = m.validation;
      if (val && val.valid) {
        console.log(`  ${pc.green("✓")} ${testHeader} ${fileHint}`);
        console.log(`    ${pc.dim("Spec:")}    ${pc.cyan(m.spec)}`);
        if (val.snippet) {
          console.log(`    ${pc.dim("Content:")} ${pc.dim(`"${val.snippet}"`)}`);
        }
      } else {
        brokenCount++;
        console.log(`  ${pc.red("✗")} ${testHeader} ${fileHint}`);
        console.log(`    ${pc.dim("Spec:")}    ${pc.red(m.spec)}`);
        console.log(`    ${pc.red("Error:")}   ${val?.error || "Invalid spec link"}`);
      }
    }
    console.log("");
  }

  console.log(pc.dim("─".repeat(75)));
  console.log(
    `Summary: ${pc.bold(String(mappings.length))} tests total | ${pc.green(String(linkedCount))} linked to specs | ${brokenCount > 0 ? pc.red(String(brokenCount) + " broken") : pc.green("0 broken")}`
  );
  console.log("");

  if (options.validate && brokenCount > 0) {
    console.error(pc.red(`Error: Found ${brokenCount} broken spec reference(s).`));
    process.exit(1);
  }
}
