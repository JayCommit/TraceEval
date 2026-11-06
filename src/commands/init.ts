import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import yaml from "yaml";

export interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export function runInit(options: InitOptions = {}): void {
  const cwd = options.cwd || process.cwd();
  const traceevalDir = path.join(cwd, ".traceeval");
  const testsDir = path.join(traceevalDir, "tests");
  const tracesDir = path.join(traceevalDir, "traces");

  fs.mkdirSync(testsDir, { recursive: true });
  fs.mkdirSync(tracesDir, { recursive: true });

  // 1. Create a config file
  const configPath = path.join(traceevalDir, "config.json");
  if (!fs.existsSync(configPath) || options.force) {
    const configContent = {
      version: "1.0",
      defaultAgent: "claude-code",
      testDir: ".traceeval/tests",
      storage: {
        mode: "dual", // sqlite + jsonl
        tracesDir: ".traceeval/traces",
        dbPath: ".traceeval/traces.db",
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2), "utf-8");
  }

  // 2. Create a starter hello-world test case
  const sampleTestPath = path.join(testsDir, "hello-world.yaml");
  if (!fs.existsSync(sampleTestPath) || options.force) {
    const sampleTest = {
      name: "Hello World Greeting Edit",
      description: "Assert that the agent implements getGreeting returning 'Hello, TraceEval!'",
      tags: ["hello-world", "smoke"],
      setup: {
        files: {
          "src/greeting.ts": 'export function getGreeting(): string {\n  // TODO: implement greeting\n  return "TODO";\n}\n',
        },
      },
      run: {
        command: 'node -e "require(\'fs\').writeFileSync(\'src/greeting.ts\', \'export function getGreeting(): string {\\n  return \\\"Hello, TraceEval!\\\";\\n}\\n\')"',
      },
      assertions: [
        {
          type: "file_exists",
          path: "src/greeting.ts",
          message: "Greeting file must exist",
        },
        {
          type: "file_contains",
          path: "src/greeting.ts",
          pattern: "Hello, TraceEval!",
          message: "Greeting function must return 'Hello, TraceEval!'",
        },
        {
          type: "file_contains",
          path: "src/greeting.ts",
          not_contains: "TODO",
          message: "No TODO placeholders should remain",
        },
        {
          type: "max_steps",
          max: 10,
          message: "Agent should finish within 10 steps",
        },
      ],
    };
    fs.writeFileSync(sampleTestPath, yaml.stringify(sampleTest), "utf-8");
  }

  console.log(pc.bold(pc.green("✔ TraceEval initialized successfully!")));
  console.log("");
  console.log("Created structure:");
  console.log(`  ${pc.cyan(".traceeval/")}`);
  console.log(`  ├── config.json`);
  console.log(`  ├── traces/              ${pc.dim("(local JSONL trace event logs)")}`);
  console.log(`  └── tests/`);
  console.log(`      └── hello-world.yaml ${pc.dim("(starter test spec)")}`);
  console.log("");
  console.log(pc.bold("Next steps:"));
  console.log(`  1. Run the sample test:   ${pc.cyan("traceeval test")}`);
  console.log(`  2. Install Claude hooks:  ${pc.cyan("traceeval install claude")}`);
  console.log(`  3. Record a live agent:   ${pc.cyan("traceeval record -- claude -p 'your prompt'")}`);
  console.log("");
}
