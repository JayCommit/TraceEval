import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveAgentCommand, runBenchmark } from "../src/commands/bench.js";
import { StorageManager } from "../src/storage/index.js";

describe("Automated Multi-Agent Benchmark Launching", () => {
  let tmpDir: string;
  let testSpecPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-bench-test-"));

    // Create a sample test spec with setup files and assertions
    testSpecPath = path.join(tmpDir, "sample-task.yaml");
    const testYaml = `
name: "Benchmark Greeting Task"
setup:
  files:
    src/greeting.txt: "placeholder"
run:
  prompt: "Write Hello World into src/greeting.txt"
assertions:
  - type: "file_exists"
    path: "src/greeting.txt"
  - type: "file_contains"
    path: "src/greeting.txt"
    pattern: "Hello World"
    `.trim();

    fs.writeFileSync(testSpecPath, testYaml, "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should resolve agent commands for all supported agents", () => {
    const prompt = "Implement feature X";

    expect(resolveAgentCommand("claude", prompt)).toContain('claude -p "Implement feature X"');
    expect(resolveAgentCommand("cursor", prompt)).toContain('cursor --prompt "Implement feature X"');
    expect(resolveAgentCommand("grok", prompt)).toContain('grok run "Implement feature X"');
    expect(resolveAgentCommand("grok-bot", prompt)).toContain('grok-bot run "Implement feature X"');
    expect(resolveAgentCommand("openai", prompt)).toContain('openai run "Implement feature X"');
    expect(resolveAgentCommand("antigravity", prompt)).toContain('agy run "Implement feature X"');
    expect(resolveAgentCommand("opencode", prompt)).toContain('opencode run "Implement feature X"');

    // Custom template
    const template = "node runner.js --agent {agent} --msg '{prompt}'";
    expect(resolveAgentCommand("cursor", prompt, { cmdTemplate: template })).toBe(
      "node runner.js --agent cursor --msg 'Implement feature X'"
    );

    // Custom per-agent map
    const custom = { claude: "anthropic-cli '{prompt}'" };
    expect(resolveAgentCommand("claude", prompt, { customCommands: custom })).toBe(
      "anthropic-cli 'Implement feature X'"
    );
  });

  it("should execute automated benchmark in isolated workspaces with assertions and trace recording", async () => {
    const outputPath = path.join(tmpDir, "arena-report.html");

    // Command that writes the expected string to greeting.txt
    const mockCmd = 'node -e "require(\'fs\').writeFileSync(\'src/greeting.txt\', \'Hello World from \' + process.env.TRACEEVAL_AGENT);"';

    const runs = await runBenchmark({
      agents: ["claude", "cursor"],
      test: testSpecPath,
      cmd: mockCmd,
      workspace: tmpDir,
      serve: false,
      parallel: true,
      output: outputPath,
    });

    expect(runs.length).toBe(2);

    const claudeRun = runs.find((r) => r.agent === "claude");
    const cursorRun = runs.find((r) => r.agent === "cursor");

    expect(claudeRun).toBeDefined();
    expect(cursorRun).toBeDefined();

    // Workspaces must be separate and isolated
    expect(claudeRun?.workspaceDir).not.toBe(cursorRun?.workspaceDir);
    expect(fs.existsSync(claudeRun!.workspaceDir)).toBe(true);
    expect(fs.existsSync(cursorRun!.workspaceDir)).toBe(true);

    // Verify workspace contents reflect independent execution
    const claudeGreeting = fs.readFileSync(path.join(claudeRun!.workspaceDir, "src/greeting.txt"), "utf-8");
    const cursorGreeting = fs.readFileSync(path.join(cursorRun!.workspaceDir, "src/greeting.txt"), "utf-8");

    expect(claudeGreeting).toBe("Hello World from claude");
    expect(cursorGreeting).toBe("Hello World from cursor");

    // Both passed assertions
    expect(claudeRun?.allPassed).toBe(true);
    expect(cursorRun?.allPassed).toBe(true);

    // Static Arena HTML export generated
    expect(fs.existsSync(outputPath)).toBe(true);
    const html = fs.readFileSync(outputPath, "utf-8");
    expect(html).toContain("TraceEval ⚔️ Arena");
    expect(html).toContain(claudeRun!.sessionId);
    expect(html).toContain(cursorRun!.sessionId);
  });
});
