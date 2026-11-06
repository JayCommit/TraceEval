import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("CLI Integration Tests", () => {
  let tmpDir: string;
  const cliPath = path.resolve(__dirname, "../dist/cli.js");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize, install claude hooks, run hello-world test and record traces", () => {
    // 1. init
    const initOutput = execSync(`node "${cliPath}" init`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(initOutput).toContain("TraceEval initialized successfully!");
    expect(fs.existsSync(path.join(tmpDir, ".traceeval/config.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".traceeval/tests/hello-world.yaml"))
    ).toBe(true);

    // 2. install claude
    const installOutput = execSync(`node "${cliPath}" install claude`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(installOutput).toContain("Claude Code recording hooks installed successfully!");
    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(true);

    // 3. test
    const testOutput = execSync(`node "${cliPath}" test`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(testOutput).toContain("ALL TESTS PASSED");
    expect(testOutput).toContain("Hello World Greeting Edit");

    // 4. markdown test report
    const mdOutput = execSync(`node "${cliPath}" test --markdown`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(mdOutput).toContain("# TraceEval Test Report");
    expect(mdOutput).toContain("🟢 ALL PASSED");

    // 5. record
    const recordOutput = execSync(
      `node "${cliPath}" record -s cli-test-session -- echo "testing-cli"`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
      }
    );
    expect(recordOutput).toContain("Trace recording finished");

    // 6. traces list
    const listOutput = execSync(`node "${cliPath}" traces list`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(listOutput).toContain("cli-test-session");

    // 7. traces show
    const showOutput = execSync(
      `node "${cliPath}" traces show cli-test-session`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
      }
    );
    expect(showOutput).toContain("Trace Session: cli-test-session");
    expect(showOutput).toContain("[session_start]");
    expect(showOutput).toContain("[session_end]");
  });

  it("should record simulated agent with hooks and assert on file state and trajectory", () => {
    // 1. Initialize
    execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });

    // 2. Create simulated agent script that performs an edit and invokes lifecycle hooks
    const agentScript = `
      const fs = require('fs');
      const { execSync } = require('child_process');
      const cli = ${JSON.stringify(cliPath)};

      // PreToolUse hook
      execSync(\`node "\${cli}" hook pre-tool --data "{\\\\"tool_name\\\\":\\\\"Edit\\\\",\\\\"tool_use_id\\\\":\\\\"tu_42\\\\",\\\\"tool_input\\\\":{\\\\"file\\\\":\\\\"src/greeting.ts\\\\"}}"\`, { stdio: 'inherit' });

      // Action: modify file
      fs.mkdirSync('src', { recursive: true });
      fs.writeFileSync('src/greeting.ts', 'export function getGreeting(): string {\\n  return "Hello, TraceEval!";\\n}\\n');

      // PostToolUse hook
      execSync(\`node "\${cli}" hook post-tool --data "{\\\\"tool_name\\\\":\\\\"Edit\\\\",\\\\"tool_use_id\\\\":\\\\"tu_42\\\\",\\\\"tool_result\\\\":\\\\"File updated successfully\\\\"}"\`, { stdio: 'inherit' });

      // Stop hook
      execSync(\`node "\${cli}" hook stop --data "{\\\\"reason\\\\":\\\\"end_turn\\\\"}"\`, { stdio: 'inherit' });
    `;
    fs.writeFileSync(path.join(tmpDir, "sim-agent.js"), agentScript);

    // 3. Record agent execution
    const sessionId = "agent-e2e-trajectory-session";
    const recordOutput = execSync(
      `node "${cliPath}" record -s "${sessionId}" --prompt "Update greeting" -- node sim-agent.js`,
      { cwd: tmpDir, encoding: "utf-8" }
    );
    expect(recordOutput).toContain("Trace recording finished");

    // 4. Create custom test spec checking file presence, content, and trajectory assertions
    const specYaml = `
name: "E2E Trajectory & State Spec"
description: "Verify agent file edit and tool efficiency"
assertions:
  - type: "file_exists"
    path: "src/greeting.ts"
  - type: "file_contains"
    path: "src/greeting.ts"
    pattern: "Hello, TraceEval!"
  - type: "file_contains"
    path: "src/greeting.ts"
    not_contains: "TODO"
  - type: "max_steps"
    max: 5
  - type: "tool_called"
    tool: "Edit"
    min: 1
    max: 2
`;
    fs.writeFileSync(path.join(tmpDir, ".traceeval", "tests", "trajectory.yaml"), specYaml);

    // 5. Evaluate assertions against the recorded session without re-running agent
    const testOutput = execSync(
      `node "${cliPath}" test --skip-run --session "${sessionId}"`,
      { cwd: tmpDir, encoding: "utf-8" }
    );

    expect(testOutput).toContain("ALL TESTS PASSED");
    expect(testOutput).toContain("E2E Trajectory & State Spec");
    expect(testOutput).toContain("[tool_called]");
    expect(testOutput).toContain("[max_steps]");
  });

  it("should fail gracefully with exit code 1 and rich diagnostic diffs when assertions fail", () => {
    execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });

    // Create a spec with failing assertions
    const failingSpec = `
name: "Failing Diagnostics Test"
setup:
  files:
    "src/broken.ts": |
      export function broken() {
        // TODO: broken logic
        return "incorrect";
      }
run:
  command: "echo 'simulated no-op'"
assertions:
  - type: "file_exists"
    path: "src/does-not-exist.ts"
    message: "Missing file must exist"
  - type: "file_contains"
    path: "src/broken.ts"
    pattern: "expected string"
    message: "File must contain expected string"
  - type: "file_contains"
    path: "src/broken.ts"
    not_contains: "TODO"
    message: "No TODO comments allowed"
`;
    fs.writeFileSync(path.join(tmpDir, ".traceeval", "tests", "failing.yaml"), failingSpec);

    // Run test and expect non-zero exit code
    let failureOutput = "";
    try {
      execSync(`node "${cliPath}" test "${path.join(tmpDir, ".traceeval/tests/failing.yaml")}"`, {
        cwd: tmpDir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: any) {
      failureOutput = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
    }

    const cleanOutput = failureOutput.replace(/\u001b\[[0-9;]*m/g, "");
    expect(cleanOutput).toContain("TESTS FAILED");
    expect(cleanOutput).toContain("[file_exists] Missing file must exist");
    expect(cleanOutput).toContain("Expected: File 'src/does-not-exist.ts' to exist");
    expect(cleanOutput).toContain("Actual:   File does not exist: src/does-not-exist.ts");
    expect(cleanOutput).toContain("[file_contains] File must contain expected string");
    expect(cleanOutput).toContain("[file_contains] No TODO comments allowed");
    expect(cleanOutput).toContain("line 2: \"// TODO: broken logic\"");
  });

  it("should support --json output format and --output file flag", () => {
    execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });

    // Run test with --json
    const jsonOutput = execSync(`node "${cliPath}" test --json`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.total).toBe(1);
    expect(parsed.passed).toBe(1);
    expect(parsed.results[0].status).toBe("passed");

    // Run test with --output report.json
    execSync(`node "${cliPath}" test --output ./out/report.json`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(fs.existsSync(path.join(tmpDir, "out/report.json"))).toBe(true);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, "out/report.json"), "utf-8"));
    expect(saved.total).toBe(1);
  });

  it("should support --runs and --min-success statistical flags and traces diff in CLI", () => {
    execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });

    // Run hello-world test across 2 runs with --min-success 0.8
    const multiRunOutput = execSync(`node "${cliPath}" test --runs 2 --min-success 0.8`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(multiRunOutput).toContain("Multi-Run:");
    expect(multiRunOutput).toContain("2/2 passed (100.0%)");
    expect(multiRunOutput).toContain("ALL TESTS PASSED");

    // Record two sessions to diff
    execSync(`node "${cliPath}" record -s sess-1 -- echo "one"`, { cwd: tmpDir });
    execSync(`node "${cliPath}" record -s sess-2 -- echo "two"`, { cwd: tmpDir });

    const diffOutput = execSync(`node "${cliPath}" traces diff sess-1 sess-2`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(diffOutput).toContain("Trace Comparison: sess-1 (A) vs sess-2 (B)");
    expect(diffOutput).toContain("Step Count:");
    expect(diffOutput).toContain("Duration:");
  });

  it("should support traceeval view and traceeval specs CLI commands", () => {
    execSync(`node "${cliPath}" init`, { cwd: tmpDir, encoding: "utf-8" });
    execSync(`node "${cliPath}" record -s view-cli-sess -- echo "hello view"`, { cwd: tmpDir });

    // Test traceeval view --latest --output ./view.html
    const viewOutput = execSync(`node "${cliPath}" view --latest --output ./view.html`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(viewOutput).toContain("Trace HTML Viewer generated");
    expect(fs.existsSync(path.join(tmpDir, "view.html"))).toBe(true);
    const html = fs.readFileSync(path.join(tmpDir, "view.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("view-cli-sess");

    // Test traceeval specs
    const specsOutput = execSync(`node "${cliPath}" specs`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(specsOutput).toContain("TraceEval Spec Links");
    expect(specsOutput).toContain("Hello World Greeting Edit");

    // Test traceeval specs --json
    const specsJson = execSync(`node "${cliPath}" specs --json`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    const parsedSpecs = JSON.parse(specsJson);
    expect(Array.isArray(parsedSpecs)).toBe(true);
    expect(parsedSpecs.length).toBeGreaterThan(0);

    // Test Multi-Agent Arena CLI: traceeval view <sess1> <sess2> -o ./arena.html
    execSync(`node "${cliPath}" record -s arena-sess-1 -- echo "agent 1"`, { cwd: tmpDir });
    execSync(`node "${cliPath}" record -s arena-sess-2 -- echo "agent 2"`, { cwd: tmpDir });

    const arenaViewOutput = execSync(`node "${cliPath}" view arena-sess-1 arena-sess-2 -o ./arena.html`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(arenaViewOutput).toContain("Multi-Agent Arena HTML Viewer generated");
    expect(fs.existsSync(path.join(tmpDir, "arena.html"))).toBe(true);
    const arenaHtml = fs.readFileSync(path.join(tmpDir, "arena.html"), "utf-8");
    expect(arenaHtml).toContain("TraceEval ⚔️ Arena");
    expect(arenaHtml).toContain("arena-sess-1");
    expect(arenaHtml).toContain("arena-sess-2");

    // Test traceeval arena -o ./arena-auto.html
    const arenaAutoOutput = execSync(`node "${cliPath}" arena -o ./arena-auto.html`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(arenaAutoOutput).toContain("Multi-Agent Arena HTML Viewer generated");
    expect(fs.existsSync(path.join(tmpDir, "arena-auto.html"))).toBe(true);

    // Test CLI version
    const versionOutput = execSync(`node "${cliPath}" --version`, {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(versionOutput).toBe("0.0.5");
  });
});
