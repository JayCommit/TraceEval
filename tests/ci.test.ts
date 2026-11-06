import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { execSync } from "node:child_process";

describe("GitHub Action & CI Integration", () => {
  const rootDir = path.resolve(__dirname, "..");
  const actionPath = path.join(rootDir, "action.yml");
  const workflowPath = path.join(rootDir, ".github", "workflows", "agent-eval.yml");

  it("should have a valid action.yml with expected metadata", () => {
    expect(fs.existsSync(actionPath)).toBe(true);
    const content = fs.readFileSync(actionPath, "utf-8");
    const parsed = YAML.parse(content);

    expect(parsed).toBeDefined();
    expect(parsed.name).toBe("TraceEval AI Agent Regression Testing");
    expect(parsed.description).toBe(
      "Local-first evaluation and regression testing for AI coding agents"
    );
    expect(parsed.runs?.using).toBe("composite");
  });

  it("should declare all required inputs with correct defaults", () => {
    const content = fs.readFileSync(actionPath, "utf-8");
    const parsed = YAML.parse(content);
    const inputs = parsed.inputs;

    expect(inputs).toBeDefined();

    // test-path
    expect(inputs["test-path"]).toBeDefined();
    expect(inputs["test-path"].default).toBe(".traceeval/tests");

    // update-golden
    expect(inputs["update-golden"]).toBeDefined();
    expect(inputs["update-golden"].default).toBe("false");

    // github-token
    expect(inputs["github-token"]).toBeDefined();
    expect(inputs["github-token"].default).toBe("${{ github.token }}");

    // comment-pr
    expect(inputs["comment-pr"]).toBeDefined();
    expect(inputs["comment-pr"].default).toBe("true");

    // working-directory
    expect(inputs["working-directory"]).toBeDefined();
    expect(inputs["working-directory"].default).toBe(".");
  });

  it("should define composite steps for test execution, step summary, and PR comments", () => {
    const content = fs.readFileSync(actionPath, "utf-8");
    const parsed = YAML.parse(content);
    const steps = parsed.runs?.steps;

    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(3);

    // Step 1: Run traceeval test
    const runStep = steps.find((s: { id?: string }) => s.id === "run-traceeval");
    expect(runStep).toBeDefined();
    expect(runStep.run).toContain("traceeval test");
    expect(runStep.run).toContain("--ci");
    expect(runStep.run).toContain("--markdown");
    expect(runStep.run).toContain("--output .traceeval/report.md");

    // Step 2: Step summary
    const summaryStep = steps.find((s: { name?: string }) =>
      s.name?.toLowerCase().includes("summary")
    );
    expect(summaryStep).toBeDefined();
    expect(summaryStep.run).toContain("GITHUB_STEP_SUMMARY");

    // Step 3: PR comment
    const commentStep = steps.find((s: { name?: string }) =>
      s.name?.toLowerCase().includes("pr comment")
    );
    expect(commentStep).toBeDefined();
    expect(commentStep.run).toContain("<!-- traceeval-pr-report -->");

    // Step 4: Verify exit status
    const statusStep = steps.find((s: { name?: string }) =>
      s.name?.toLowerCase().includes("status")
    );
    expect(statusStep).toBeDefined();
    expect(statusStep.run).toContain("exit $EXIT_CODE");
  });

  it("should have a valid .github/workflows/agent-eval.yml workflow", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, "utf-8");
    const parsed = YAML.parse(content);

    expect(parsed).toBeDefined();
    expect(parsed.name).toBe("Agent Regression Testing");

    // Check triggers
    const triggers = parsed.on || parsed.triggers;
    expect(triggers.push).toBeDefined();
    expect(triggers.pull_request).toBeDefined();
    expect(triggers.workflow_dispatch).toBeDefined();

    // Check permissions
    expect(parsed.permissions?.["pull-requests"]).toBe("write");

    // Check jobs
    expect(parsed.jobs?.["evaluate-agents"]).toBeDefined();
    const steps = parsed.jobs["evaluate-agents"].steps;
    const actionStep = steps.find((s: { uses?: string }) => s.uses === "./");
    expect(actionStep).toBeDefined();
  });

  it("should recognize --ci option in CLI without error", () => {
    const cliPath = path.join(rootDir, "dist", "cli.js");
    // Ensure built
    execSync("npm run build", { cwd: rootDir, stdio: "ignore" });

    // Running --help should show --ci option
    const helpOutput = execSync(`node ${cliPath} test --help`, {
      encoding: "utf-8",
    });
    expect(helpOutput).toContain("--ci");
  });
});
