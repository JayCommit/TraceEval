import { SuiteResult } from "../types/index.js";

export function formatMarkdownReport(suite: SuiteResult): string {
  const lines: string[] = [];

  const hasRegressions = suite.results.some((t) => t.regressionDiff?.isRegression);
  const hasAssertionFailures = suite.results.some(
    (t) =>
      t.assertionResults.some((a) => !a.passed) ||
      (t.status === "failed" && !t.regressionDiff?.isRegression)
  );

  let statusBadge = "🟢 ALL PASSED";
  if (suite.failed > 0 || hasRegressions) {
    if (hasRegressions && !hasAssertionFailures) {
      statusBadge = "🟡 REGRESSION DETECTED";
    } else {
      statusBadge = "🔴 TESTS FAILED";
    }
  }

  lines.push(`# TraceEval Test Report`);
  lines.push("");
  lines.push(`**Status:** ${statusBadge} | **Tests:** ${suite.passed}/${suite.total} passed | **Duration:** ${suite.durationMs}ms`);
  lines.push("");

  // Surface Efficiency Metrics if available
  if (suite.efficiency && (suite.efficiency.totalCost !== undefined || suite.efficiency.averageStepsPerTask !== undefined)) {
    const eff = suite.efficiency;
    lines.push(`### 📊 Efficiency & Cost Overview`);
    const metricsItems: string[] = [];
    if (eff.averageStepsPerTask !== undefined) metricsItems.push(`- **Avg Steps / Task:** \`${eff.averageStepsPerTask}\``);
    if (eff.averageCostPerTask !== undefined) metricsItems.push(`- **Avg Cost / Task:** \`$${eff.averageCostPerTask.toFixed(4)}\``);
    if (eff.totalCost !== undefined) metricsItems.push(`- **Total Cost:** \`$${eff.totalCost.toFixed(4)}\``);
    if (eff.totalTokens !== undefined) metricsItems.push(`- **Total Tokens:** \`${eff.totalTokens.toLocaleString()}\``);
    lines.push(metricsItems.join("\n"));
    lines.push("");
  }

  // Multi-Run Summary table if any tests ran multi-run
  const hasMultiRun = suite.results.some((t) => t.multiRun);
  if (hasMultiRun) {
    lines.push(`### 🔁 Statistical Multi-Run Results`);
    lines.push(`| Test Name | Status | Runs | Passed | Success Rate | Min Threshold | Avg Steps | Avg Cost |`);
    lines.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
    for (const test of suite.results) {
      if (test.multiRun) {
        const mr = test.multiRun;
        const icon = mr.passThresholdMet ? "✅" : "❌";
        const rateStr = `${(mr.successRate * 100).toFixed(1)}%`;
        const threshStr = `${(mr.minSuccessThreshold * 100).toFixed(1)}%`;
        const avgStepsStr = mr.averageSteps !== undefined ? String(mr.averageSteps) : "-";
        const avgCostStr = mr.averageCost !== undefined ? `$${mr.averageCost.toFixed(4)}` : "-";
        lines.push(
          `| **${test.testName}** | ${icon} | ${mr.runs} | ${mr.passed} | ${rateStr} | >=${threshStr} | ${avgStepsStr} | ${avgCostStr} |`
        );
      }
    }
    lines.push("");
  }

  // Summary Table comparing each test
  lines.push(`| Test Name | Status | Baseline Steps | Current Steps | Drift (%) | Tool Changes | Duration |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);

  for (const test of suite.results) {
    const isRegression = test.regressionDiff?.isRegression;
    let statusText = "✅ Passed";
    if (isRegression) {
      statusText = "🟡 Regression";
    } else if (test.status !== "passed") {
      statusText = "❌ Failed";
    }

    const baselineSteps =
      test.regressionDiff?.baseline?.stepCount ?? test.goldenBaseline?.stepCount;
    const baselineStepsStr = baselineSteps !== undefined ? String(baselineSteps) : "-";

    const currentSteps = test.regressionDiff?.current?.stepCount;
    const currentStepsStr = currentSteps !== undefined ? String(currentSteps) : "-";

    let driftPctStr = "-";
    if (test.regressionDiff) {
      const pct = test.regressionDiff.stepPercentDelta;
      driftPctStr = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }

    let toolChangesStr = "-";
    if (test.regressionDiff) {
      const toolChanges: string[] = [];
      if (test.regressionDiff.toolDeltas) {
        for (const [tool, d] of Object.entries(test.regressionDiff.toolDeltas)) {
          if (d.delta !== 0) {
            toolChanges.push(`${d.delta > 0 ? "+" : ""}${d.delta} ${tool}`);
          }
        }
      }
      toolChangesStr = toolChanges.length > 0 ? toolChanges.join(", ") : "None";
    }

    lines.push(
      `| **${test.testName}** | ${statusText} | ${baselineStepsStr} | ${currentStepsStr} | ${driftPctStr} | ${toolChangesStr} | ${test.durationMs}ms |`
    );
  }

  lines.push("");

  // Dedicated Regression Details section
  const regressedTests = suite.results.filter(
    (t) => t.regressionDiff && t.regressionDiff.isRegression
  );

  if (regressedTests.length > 0) {
    lines.push(`## ⚠️ Regression Details`);
    lines.push("");
    for (const test of regressedTests) {
      const rd = test.regressionDiff!;
      lines.push(`### ⚠️ ${test.testName}`);
      if (test.filePath) lines.push(`- **Spec File:** \`${test.filePath}\``);
      if (test.traceSessionId) lines.push(`- **Current Trace:** \`${test.traceSessionId}\``);
      if (rd.baseline?.sessionId) lines.push(`- **Golden Baseline:** \`${rd.baseline.sessionId}\``);
      lines.push("");

      lines.push(`#### Breached Thresholds`);
      for (const reason of rd.regressionReasons) {
        lines.push(`- ⚠️ **${reason}**`);
      }
      lines.push("");

      lines.push(`#### Trajectory & Metric Diffs`);
      const stepSign = rd.stepDelta > 0 ? `+${rd.stepDelta}` : `${rd.stepDelta}`;
      const stepPct = `${rd.stepPercentDelta >= 0 ? "+" : ""}${rd.stepPercentDelta.toFixed(1)}%`;
      lines.push(
        `- **Steps:** ${rd.baseline?.stepCount ?? "?"} → ${rd.current?.stepCount ?? "?"} (${stepSign}, ${stepPct})`
      );

      if (rd.durationDelta !== undefined && rd.baseline?.durationMs !== undefined) {
        const durSign = rd.durationDelta >= 0 ? `+${rd.durationDelta}ms` : `${rd.durationDelta}ms`;
        const durPct =
          rd.durationPercentDelta !== undefined
            ? ` (${rd.durationPercentDelta >= 0 ? "+" : ""}${rd.durationPercentDelta.toFixed(1)}%)`
            : "";
        const currDur = rd.current?.durationMs ?? test.durationMs;
        lines.push(
          `- **Duration:** ${rd.baseline.durationMs}ms → ${currDur}ms (${durSign}${durPct})`
        );
      }

      if (rd.costDelta !== undefined) {
        const costSign =
          rd.costDelta >= 0 ? `+$${rd.costDelta.toFixed(4)}` : `-$${Math.abs(rd.costDelta).toFixed(4)}`;
        const costPct =
          rd.costPercentDelta !== undefined
            ? ` (${rd.costPercentDelta >= 0 ? "+" : ""}${rd.costPercentDelta.toFixed(1)}%)`
            : "";
        lines.push(`- **Cost Drift:** ${costSign}${costPct}`);
      }

      const toolDeltaEntries = Object.entries(rd.toolDeltas || {}).filter(
        ([_, d]) => d.delta !== 0
      );
      if (toolDeltaEntries.length > 0) {
        lines.push(`- **Tool Call Deltas:**`);
        for (const [tool, d] of toolDeltaEntries) {
          const sign = d.delta > 0 ? `+${d.delta}` : `${d.delta}`;
          lines.push(`  - \`${tool}\`: ${d.baseline} baseline → ${d.current} current (${sign})`);
        }
      }

      if (rd.toolsAdded && rd.toolsAdded.length > 0) {
        lines.push(`- **New Tools:** \`${rd.toolsAdded.join("`, `")}\``);
      }
      if (rd.toolsRemoved && rd.toolsRemoved.length > 0) {
        lines.push(`- **Omitted Tools:** \`${rd.toolsRemoved.join("`, `")}\``);
      }
      lines.push("");
    }
  }

  // Collapsible Assertion Breakdown
  lines.push("<details>");
  lines.push("<summary>Assertion Breakdown</summary>");
  lines.push("");

  for (const test of suite.results) {
    const passedCount = test.assertionResults.filter((a) => a.passed).length;
    const totalCount = test.assertionResults.length;
    lines.push(`### ${test.testName} (${passedCount}/${totalCount} assertions passed)`);
    lines.push("");

    if (test.assertionResults.length === 0) {
      lines.push(`_No assertions evaluated._`);
    } else {
      lines.push(`| Assertion | Result | Message |`);
      lines.push(`| :--- | :--- | :--- |`);
      for (const a of test.assertionResults) {
        const icon = a.passed ? "✅ Pass" : "❌ Fail";
        lines.push(`| \`${a.assertion.type}\` | ${icon} | ${a.message} |`);
      }
    }
    lines.push("");
  }

  lines.push("</details>");
  lines.push("");

  // Instructions at the bottom
  lines.push("---");
  lines.push("");
  lines.push(
    `> 💡 **Golden Baselines:** To bless the current run as the new golden standard:\n> \`\`\`bash\n> npx traceeval update-golden <test-name>\n> \`\`\``
  );
  lines.push("");

  return lines.join("\n");
}
