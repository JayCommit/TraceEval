import pc from "picocolors";
import path from "node:path";
import { SuiteResult, TestResult } from "../types/index.js";

export interface TerminalReporterOptions {
  cwd?: string;
  ci?: boolean;
}

function formatBlock(label: string, text: string, colorFn: (s: string) => string): string[] {
  const lines = text.split("\n");
  if (lines.length === 1) {
    return [`      ${pc.dim(label)} ${colorFn(lines[0])}`];
  }
  return [
    `      ${pc.dim(label)} ${colorFn(lines[0])}`,
    ...lines.slice(1).map((l) => `               ${colorFn(l)}`),
  ];
}

/**
 * Clean standard formatting for CI environments without interactive clutter.
 */
function formatCiTerminalReport(suite: SuiteResult, cwd: string): string {
  const lines: string[] = [];

  lines.push("============================================================");
  lines.push("TraceEval CI Test Report");
  lines.push("============================================================");

  for (const test of suite.results) {
    const isRegression = test.regressionDiff?.isRegression;
    let statusTag = "[PASS]";
    if (isRegression) {
      statusTag = "[REGRESSION]";
    } else if (test.status !== "passed") {
      statusTag = "[FAIL]";
    }

    lines.push("");
    lines.push(`${statusTag} ${test.testName} (${test.durationMs}ms)`);

    if (test.filePath) {
      const displayPath = path.isAbsolute(test.filePath)
        ? path.relative(cwd, test.filePath)
        : test.filePath;
      lines.push(`  file: ${displayPath}`);
    }
    if (test.traceSessionId) {
      lines.push(`  trace: ${test.traceSessionId}`);
    }
    if (test.goldenBaseline) {
      lines.push(
        `  golden: ${test.goldenBaseline.traceSessionId} (${test.goldenBaseline.stepCount} steps, ${test.goldenBaseline.durationMs}ms)`
      );
    }
    if (test.multiRun) {
      const mr = test.multiRun;
      lines.push(
        `  multi-run: ${mr.passed}/${mr.runs} passed (${(mr.successRate * 100).toFixed(1)}%) [min: ${(mr.minSuccessThreshold * 100).toFixed(1)}%]`
      );
      if (mr.averageSteps !== undefined) {
        lines.push(`  avg steps: ${mr.averageSteps}`);
      }
      if (mr.averageCost !== undefined) {
        lines.push(`  avg cost: $${mr.averageCost.toFixed(4)}`);
      }
    }
    if (test.cost !== undefined && !test.multiRun) {
      lines.push(`  cost: $${test.cost.toFixed(4)}${test.tokens ? ` (${test.tokens} tokens)` : ""}`);
    }
    if (test.error && (!isRegression || !test.error.startsWith("Regression detected"))) {
      lines.push(`  Error: ${test.error}`);
    }

    if (test.regressionDiff) {
      const rd = test.regressionDiff;
      const stepSign = rd.stepDelta > 0 ? `+${rd.stepDelta}` : `${rd.stepDelta}`;
      const stepPct = `${rd.stepPercentDelta >= 0 ? "+" : ""}${rd.stepPercentDelta.toFixed(1)}%`;
      lines.push(
        `  Baseline Comparison: steps ${rd.baseline?.stepCount ?? "?"} -> ${rd.current?.stepCount ?? "?"} (${stepSign} [${stepPct}])`
      );

      if (rd.durationDelta !== undefined && rd.baseline?.durationMs !== undefined) {
        const durSign = rd.durationDelta >= 0 ? `+${rd.durationDelta}ms` : `${rd.durationDelta}ms`;
        const durPct =
          rd.durationPercentDelta !== undefined
            ? ` [${rd.durationPercentDelta >= 0 ? "+" : ""}${rd.durationPercentDelta.toFixed(1)}%]`
            : "";
        const currDur = rd.current?.durationMs ?? test.durationMs;
        lines.push(`  Duration drift: ${rd.baseline.durationMs}ms -> ${currDur}ms (${durSign}${durPct})`);
      }

      if (rd.costDelta !== undefined && rd.baseline) {
        const costSign =
          rd.costDelta >= 0 ? `+$${rd.costDelta.toFixed(4)}` : `-$${Math.abs(rd.costDelta).toFixed(4)}`;
        const costPct =
          rd.costPercentDelta !== undefined
            ? ` [${rd.costPercentDelta >= 0 ? "+" : ""}${rd.costPercentDelta.toFixed(1)}%]`
            : "";
        lines.push(`  Cost drift: ${costSign}${costPct}`);
      }

      // Tool usage delta
      const toolDeltaParts: string[] = [];
      if (rd.toolDeltas) {
        for (const [tool, d] of Object.entries(rd.toolDeltas)) {
          if (d.delta !== 0) {
            const sign = d.delta > 0 ? `+${d.delta}` : `${d.delta}`;
            const callWord = Math.abs(d.delta) === 1 ? "call" : "calls";
            toolDeltaParts.push(`${sign} ${tool} ${callWord}`);
          }
        }
      }
      const newOmitted: string[] = [];
      if (rd.toolsAdded && rd.toolsAdded.length > 0) {
        newOmitted.push(`new: [${rd.toolsAdded.join(", ")}]`);
      }
      if (rd.toolsRemoved && rd.toolsRemoved.length > 0) {
        newOmitted.push(`omitted: [${rd.toolsRemoved.join(", ")}]`);
      }

      if (toolDeltaParts.length > 0 || newOmitted.length > 0) {
        let deltaText = toolDeltaParts.length > 0 ? toolDeltaParts.join(", ") : "no count change";
        if (newOmitted.length > 0) {
          deltaText += ` (${newOmitted.join("; ")})`;
        }
        lines.push(`  Tool usage delta: ${deltaText}`);
      }

      if (rd.isRegression) {
        lines.push("");
        lines.push("  [⚠ REGRESSION DETECTED]");
        for (const reason of rd.regressionReasons) {
          lines.push(`    - ${reason}`);
        }
        lines.push("");
      } else {
        lines.push("  [OK] No regression detected against golden run");
      }
    }

    // Assertions
    for (const a of test.assertionResults) {
      const aTag = a.passed ? "[PASS]" : "[FAIL]";
      lines.push(`  ${aTag} [${a.assertion.type}] ${a.message}`);
      if (!a.passed) {
        if (a.expected !== undefined) {
          lines.push(`         Expected: ${String(a.expected)}`);
        }
        if (a.actual !== undefined) {
          lines.push(`         Actual:   ${String(a.actual)}`);
        }
      }
    }
  }

  lines.push("");
  lines.push("------------------------------------------------------------");
  const hasRegressions = suite.results.some((t) => t.regressionDiff?.isRegression);
  const hasAssertionFailures = suite.results.some(
    (t) =>
      t.assertionResults.some((a) => !a.passed) ||
      (t.status === "failed" && !t.regressionDiff?.isRegression)
  );

  let statusText = "ALL TESTS PASSED";
  if (suite.failed > 0 || hasRegressions) {
    if (hasRegressions && !hasAssertionFailures) {
      statusText = "REGRESSION DETECTED";
    } else {
      statusText = "TESTS FAILED";
    }
  }

  lines.push(`Summary:  ${suite.passed} passed, ${suite.failed} failed, ${suite.total} total (${suite.durationMs}ms)`);
  lines.push(`Status:   ${statusText}`);
  lines.push("============================================================");
  lines.push("");

  return lines.join("\n");
}

/**
 * Formats suite result into terminal report with optional CI mode.
 */
export function formatTerminalReport(
  suite: SuiteResult,
  optionsOrCwd: string | TerminalReporterOptions = process.cwd()
): string {
  const options: TerminalReporterOptions =
    typeof optionsOrCwd === "string" ? { cwd: optionsOrCwd } : optionsOrCwd;
  const cwd = options.cwd ?? process.cwd();
  const isCi = Boolean(options.ci);

  if (isCi) {
    return formatCiTerminalReport(suite, cwd);
  }

  const lines: string[] = [];

  lines.push("");
  lines.push(
    pc.bold(pc.cyan("TraceEval")) +
      pc.dim(` — AI Coding Agent Regression Test Results`)
  );
  lines.push(pc.dim("─".repeat(60)));

  for (const test of suite.results) {
    const isRegression = test.regressionDiff?.isRegression;
    let statusIcon: string;
    if (isRegression) {
      statusIcon = pc.yellow(pc.bold("⚠ REGRESSION"));
    } else if (test.status === "passed") {
      statusIcon = pc.green("✔ PASS");
    } else {
      statusIcon = pc.red("✖ FAIL");
    }

    const testHeader = `${statusIcon} ${pc.bold(test.testName)} ${pc.dim(`(${test.durationMs}ms)`)}`;
    lines.push(testHeader);

    if (test.filePath) {
      const displayPath = path.isAbsolute(test.filePath)
        ? path.relative(cwd, test.filePath)
        : test.filePath;
      lines.push(pc.dim(`  file: ${displayPath}`));
    }
    if (test.traceSessionId) {
      lines.push(pc.dim(`  trace: ${test.traceSessionId}`));
    }
    if (test.goldenBaseline) {
      lines.push(
        pc.dim(
          `  golden: ${test.goldenBaseline.traceSessionId} (${test.goldenBaseline.stepCount} steps, ${test.goldenBaseline.durationMs}ms)`
        )
      );
    }
    if (test.multiRun) {
      const mr = test.multiRun;
      const ratePct = `${(mr.successRate * 100).toFixed(1)}%`;
      const threshPct = `${(mr.minSuccessThreshold * 100).toFixed(1)}%`;
      const rateColor = mr.passThresholdMet ? pc.green : pc.red;
      lines.push(
        `  ${pc.bold("Multi-Run:")} ${rateColor(`${mr.passed}/${mr.runs} passed (${ratePct})`)} ${pc.dim(`[threshold: >=${threshPct}]`)}`
      );
      const metricsParts: string[] = [];
      if (mr.averageSteps !== undefined) metricsParts.push(`Avg Steps: ${mr.averageSteps}`);
      if (mr.averageDurationMs !== undefined) metricsParts.push(`Avg Duration: ${mr.averageDurationMs}ms`);
      if (mr.averageCost !== undefined) metricsParts.push(`Avg Cost: $${mr.averageCost.toFixed(4)}`);
      if (mr.averageTokens !== undefined) metricsParts.push(`Avg Tokens: ${mr.averageTokens}`);
      if (metricsParts.length > 0) {
        lines.push(`  ${pc.dim(metricsParts.join(" • "))}`);
      }

      const runBadges = mr.individualRuns
        .map((r) => {
          const badge = r.status === "passed" ? pc.green(`R${r.runIndex}:✔`) : pc.red(`R${r.runIndex}:✗`);
          const details: string[] = [];
          if (r.stepCount !== undefined) details.push(`${r.stepCount}s`);
          details.push(`${r.durationMs}ms`);
          return `${badge}${pc.dim(`(${details.join(",")})`)}`;
        })
        .join(" ");
      lines.push(`  ${pc.dim("Runs:")} ${runBadges}`);
    } else if (test.cost !== undefined) {
      const costStr = `$${test.cost.toFixed(4)}`;
      const tokStr = test.tokens ? `, ${test.tokens} tokens` : "";
      lines.push(pc.dim(`  metrics: ${costStr}${tokStr}`));
    }
    if (test.error && (!isRegression || !test.error.startsWith("Regression detected"))) {
      lines.push(`  ${pc.red("Error:")} ${test.error}`);
    }

    if (test.regressionDiff) {
      const rd = test.regressionDiff;
      const stepSign = rd.stepDelta > 0 ? `+${rd.stepDelta}` : `${rd.stepDelta}`;
      const stepPct = `${rd.stepPercentDelta >= 0 ? "+" : ""}${rd.stepPercentDelta.toFixed(1)}%`;
      const stepColor = rd.stepDelta > 0 ? (rd.isRegression ? pc.red : pc.yellow) : pc.green;

      lines.push(
        `  ${pc.bold("Baseline Comparison:")} steps ${rd.baseline?.stepCount ?? "?"} -> ${rd.current?.stepCount ?? "?"} (${stepColor(`${stepSign} [${stepPct}]`)})`
      );

      // Duration drift
      if (rd.durationDelta !== undefined && rd.baseline?.durationMs !== undefined) {
        const durSign = rd.durationDelta >= 0 ? `+${rd.durationDelta}ms` : `${rd.durationDelta}ms`;
        const durPct =
          rd.durationPercentDelta !== undefined
            ? ` [${rd.durationPercentDelta >= 0 ? "+" : ""}${rd.durationPercentDelta.toFixed(1)}%]`
            : "";
        const durColor = rd.durationDelta > 0 ? pc.yellow : pc.green;
        const currDur = rd.current?.durationMs ?? test.durationMs;
        lines.push(`  ${pc.dim("Duration drift:")} ${rd.baseline.durationMs}ms -> ${currDur}ms (${durColor(`${durSign}${durPct}`)})`);
      }

      // Cost drift
      if (rd.costDelta !== undefined) {
        const costSign =
          rd.costDelta >= 0 ? `+$${rd.costDelta.toFixed(4)}` : `-$${Math.abs(rd.costDelta).toFixed(4)}`;
        const costPct =
          rd.costPercentDelta !== undefined
            ? ` [${rd.costPercentDelta >= 0 ? "+" : ""}${rd.costPercentDelta.toFixed(1)}%]`
            : "";
        const costColor = rd.costDelta > 0 ? pc.yellow : pc.green;
        lines.push(`  ${pc.dim("Cost drift:")} ${costColor(`${costSign}${costPct}`)}`);
      }

      // Tool usage delta (e.g., +2 Bash calls, -1 Edit call, new/omitted tools)
      const toolDeltaParts: string[] = [];
      if (rd.toolDeltas) {
        for (const [tool, d] of Object.entries(rd.toolDeltas)) {
          if (d.delta !== 0) {
            const sign = d.delta > 0 ? `+${d.delta}` : `${d.delta}`;
            const callWord = Math.abs(d.delta) === 1 ? "call" : "calls";
            toolDeltaParts.push(`${sign} ${tool} ${callWord}`);
          }
        }
      }
      const newOmittedParts: string[] = [];
      if (rd.toolsAdded && rd.toolsAdded.length > 0) {
        newOmittedParts.push(`new: [${rd.toolsAdded.join(", ")}]`);
      }
      if (rd.toolsRemoved && rd.toolsRemoved.length > 0) {
        newOmittedParts.push(`omitted: [${rd.toolsRemoved.join(", ")}]`);
      }

      if (toolDeltaParts.length > 0 || newOmittedParts.length > 0) {
        let toolDeltaStr = toolDeltaParts.length > 0 ? toolDeltaParts.join(", ") : "no count change";
        if (newOmittedParts.length > 0) {
          toolDeltaStr += ` (${newOmittedParts.join("; ")})`;
        }
        lines.push(`  ${pc.bold("Tool usage delta:")} ${toolDeltaStr}`);
      }

      // Prominent regression callout
      if (rd.isRegression) {
        lines.push("");
        lines.push(`  ${pc.bold(pc.yellow("╔════════════════════════════════════════════════════════════╗"))}`);
        lines.push(`  ${pc.bold(pc.yellow("║ ⚠ REGRESSION DETECTED                                      ║"))}`);
        lines.push(`  ${pc.bold(pc.yellow("╚════════════════════════════════════════════════════════════╝"))}`);
        for (const reason of rd.regressionReasons) {
          lines.push(`  ${pc.yellow("▶")} ${pc.bold(pc.red(reason))}`);
        }
        lines.push("");
      } else {
        lines.push(`  ${pc.green("✓ No regression detected against golden run")}`);
      }
    }

    // Assertion details
    for (const a of test.assertionResults) {
      const aIcon = a.passed ? pc.green("  ✓") : pc.red("  ✗");
      const aType = pc.dim(`[${a.assertion.type}]`);
      lines.push(`${aIcon} ${aType} ${a.message}`);

      if (!a.passed) {
        if (a.expected !== undefined) {
          lines.push(...formatBlock("Expected:", String(a.expected), pc.green));
        }
        if (a.actual !== undefined) {
          lines.push(...formatBlock("Actual:  ", String(a.actual), pc.red));
        }
      }
    }
    lines.push("");
  }

  lines.push(pc.dim("─".repeat(60)));
  const summaryParts: string[] = [];
  if (suite.passed > 0) {
    summaryParts.push(pc.green(pc.bold(`${suite.passed} passed`)));
  }
  if (suite.failed > 0) {
    summaryParts.push(pc.red(pc.bold(`${suite.failed} failed`)));
  }
  summaryParts.push(`${suite.total} total`);

  lines.push(`Tests:    ${summaryParts.join(", ")}`);
  lines.push(`Duration: ${suite.durationMs}ms`);

  if (suite.efficiency) {
    const eff = suite.efficiency;
    const parts: string[] = [];
    if (eff.averageStepsPerTask !== undefined) parts.push(`${eff.averageStepsPerTask} steps/task`);
    if (eff.averageCostPerTask !== undefined) parts.push(`$${eff.averageCostPerTask.toFixed(4)}/task`);
    if (eff.totalCost !== undefined) parts.push(`total cost: $${eff.totalCost.toFixed(4)}`);
    if (eff.totalTokens !== undefined) parts.push(`tokens: ${eff.totalTokens.toLocaleString()}`);
    if (parts.length > 0) {
      lines.push(`Metrics:  ${parts.join(" • ")}`);
    }
  }

  const hasRegressions = suite.results.some((t) => t.regressionDiff?.isRegression);
  const hasAssertionFailures = suite.results.some(
    (t) =>
      t.assertionResults.some((a) => !a.passed) ||
      (t.status === "failed" && !t.regressionDiff?.isRegression)
  );

  let statusText: string;
  if (suite.failed === 0) {
    statusText = pc.bold(pc.green("ALL TESTS PASSED"));
  } else if (hasRegressions && !hasAssertionFailures) {
    statusText = pc.bold(pc.yellow("REGRESSION DETECTED"));
  } else {
    statusText = pc.bold(pc.red("TESTS FAILED"));
  }

  lines.push(`Status:   ${statusText}`);
  lines.push("");

  return lines.join("\n");
}
