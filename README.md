# TraceEval 🔍

> **pytest + git blame for AI coding agents.**  
> *Stop shipping agent regressions. Catch them before they cost you tokens and time.*

[![npm version](https://img.shields.io/badge/npm-v0.0.1-blue.svg)](https://www.npmjs.com/package/traceeval)
[![Tests](https://img.shields.io/badge/tests-129%20passing-brightgreen.svg)](https://github.com/JayCommit/TraceEval)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-blue)](https://www.typescriptlang.org/)

---

## Why TraceEval?

AI coding agents (Claude Code, OpenCode, Codex CLI) generate code rapidly, but verification is mostly manual. A single prompt edit or model upgrade can quietly cause agents to take 3x more steps, call unauthorized tools, or write broken code.

- **Local-first & private**: Runs 100% locally on your machine or in CI. No mandatory cloud observability platforms or token leaks.
- **Regression-first ("git blame" for agents)**: Compares current runs against known-good golden baselines to catch step inflation, tool deviations, and cost drift.
- **Trajectory validation, not just output diffs**: Validates both the final codebase state and the path taken (tool calls, safety boundaries, step budgets).
- **Zero-to-low instrumentation**: Native background hooks for Claude Code and plugins for OpenCode. Zero changes to your application code.

---

## ⚡ Quickstart (< 10 Minutes)

### 1. Install TraceEval

```bash
# Global install (recommended)
npm install -g traceeval

# Or run via npx
npx traceeval --version
```

### 2. Initialize your project

Run `traceeval init` in your project root:

```bash
traceeval init
```

This creates:
- `.traceeval/` — local trace storage and configuration
- `.traceeval/tests/hello-world.yaml` — a starter declarative test

### 3. Connect your coding agent

Install background recording hooks:

```bash
# For Claude Code (writes to .claude/settings.json):
traceeval install claude

# For OpenCode (writes to .opencode/plugins/):
traceeval install opencode
```

Claude Code and OpenCode will now automatically stream session events, tool calls, and file modifications directly to `.traceeval/traces` in the background with zero latency.

### 4. Run the evaluation suite

```bash
traceeval test
```

```text
TraceEval — AI Coding Agent Regression Test Results
────────────────────────────────────────────────────────────
✔ PASS Hello World Greeting Edit (42ms)
  file: .traceeval/tests/hello-world.yaml
  trace: test-1793925826633-bee6546a
  ✓ [file_exists] Greeting file must exist
  ✓ [file_contains] Greeting function must return 'Hello, TraceEval!'
  ✓ [file_contains] No TODO placeholders should remain
  ✓ [max_steps] Agent should finish within 10 steps

────────────────────────────────────────────────────────────
Tests:    1 passed, 1 total
Duration: 42ms
Status:   ALL TESTS PASSED
```

### 5. Bless the run as a golden baseline

```bash
traceeval test --update-golden
```

TraceEval saves the baseline fingerprint (step count, duration, tool call breakdown, touched files) to `.traceeval/golden/`. Future runs will now be validated against this golden baseline.

---

## 🏆 Golden Runs & Regression Testing

Define regression budgets directly in your test YAML (`.traceeval/tests/auth-refactor.yaml`):

```yaml
name: "Refactor Authentication Logic"
spec: "AGENTS.md#Authentication Rules"

setup:
  files:
    src/auth.ts: |
      export function verifyToken(token: string): boolean {
        // TODO: implement verification
        return false;
      }

run:
  command: "claude -p 'Implement verifyToken in src/auth.ts'"

# Catch regressions against the blessed golden run
regression:
  max_step_increase: 1        # Flag if agent takes > 1 extra step
  allowed_tools:
    - "Edit"
    - "ReadFile"
  disallowed_tools:
    - "Bash"                  # Forbid arbitrary shell execution for this task
  max_duration_increase: "50%"

assertions:
  - type: "file_exists"
    path: "src/auth.ts"

  - type: "file_contains"
    path: "src/auth.ts"
    not_contains: "TODO"

  - type: "no_dangerous_commands"
```

If an agent change causes step drift or uses a forbidden tool, TraceEval flags the regression and fails with exit code 1:

```text
✖ FAIL Refactor Authentication Logic (1.2s)
  file: .traceeval/tests/auth-refactor.yaml
  trace: session-1793925826841-f64a6b
  baseline: 2 steps (saved 2026-11-06)

  ┌────────────────────────────────────────────────────────┐
  │ ⚠ REGRESSION DETECTED                                  │
  │ • Step count increased by 2 steps (+100%, limit: 1)   │
  │ • Disallowed tool called: Bash                         │
  └────────────────────────────────────────────────────────┘

  ✓ [file_exists] File 'src/auth.ts' exists
  ✓ [file_contains] No TODO placeholders remain
  ✓ [no_dangerous_commands] No dangerous commands executed
```

To view or re-bless the baseline standard:
```bash
# Compare two runs side-by-side:
traceeval traces diff session-1 session-2

# Compare a run against a golden baseline:
traceeval traces diff session-1 --golden "Refactor Authentication Logic"

# Bless new run after an intentional prompt change:
traceeval update-golden "Refactor Authentication Logic"
```

---

## 🛠 Core Commands

| Command | Description |
| :--- | :--- |
| `traceeval init` | Initializes `.traceeval/` config and starter tests |
| `traceeval install claude` | Injects zero-friction recording hooks into `.claude/settings.json` |
| `traceeval install opencode` | Installs TraceEval plugin for OpenCode |
| `traceeval record -- <cmd...>` | Explicitly runs and records any agent command in a bounded session |
| `traceeval test` | Runs all YAML test specs in `.traceeval/tests/` |
| `traceeval test --update-golden` | Runs tests and blesses passing runs as golden baselines |
| `traceeval test --runs 5 --min-success 80%` | Statistical multi-run evaluation for non-deterministic agents |
| `traceeval test --ci` | Strict CI mode with non-zero exit code and `$GITHUB_STEP_SUMMARY` export |
| `traceeval update-golden [test]` | Blesses the latest run as the golden baseline standard |
| `traceeval golden list` | Lists all registered golden baselines and step counts |
| `traceeval traces list` | Lists recent recorded execution traces |
| `traceeval traces show <id>` | Shows chronological event timeline, tool inputs/outputs, and files touched |
| `traceeval traces diff <id1> <id2>` | Side-by-side trajectory differencer (steps, tools, duration, files) |
| `traceeval view --latest --serve` | Starts local offline HTML viewer on port 4242 |
| `traceeval specs --validate` | Verifies linked `AGENTS.md` spec headings and fails if broken |
| `traceeval mcp` | Starts Model Context Protocol server over stdio for agent queries |

---

## 🖥 HTML Viewer, Specs & MCP

### 1. Offline HTML Trace Viewer
TraceEval includes a self-contained, offline HTML viewer with zero external CDN dependencies:
```bash
# Serve viewer for the latest session:
traceeval view --latest --serve

# Export static HTML file:
traceeval view --latest --output ./reports/trace.html
```
Features interactive category filters (tool calls, file changes, prompts), live payload search, and side-by-side golden diff banners.

### 2. Spec-Aware Testing (`AGENTS.md` Linking)
Link tests directly to requirements in `AGENTS.md` or `CLAUDE.md`:
```yaml
spec: "AGENTS.md#Authentication Rules"
```
Validate that linked documentation sections still exist in CI:
```bash
traceeval specs --validate
```

### 3. Model Context Protocol (MCP) Server
Allows agents to query historical traces, inspect golden standards, and avoid past errors:
```bash
traceeval mcp
```
Configure in Claude Code (`~/.claude/settings.json`) or Cursor (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "traceeval": {
      "command": "traceeval",
      "args": ["mcp"]
    }
  }
}
```

---

## 📦 Supported Assertions

- `file_contains`: Substring or regex pattern matching with `not_contains` support.
- `file_exists`: File presence or absence verification (`should_exist: boolean`).
- `tests_pass`: Runs test command (`npm test`, `pytest`) and verifies exit code 0.
- `max_steps`: Trajectory budget ensuring total tool calls do not exceed a ceiling.
- `tool_called`: Enforces that specific tools (`Edit`, `Bash`, `ReadFile`) were called.
- `no_dangerous_commands`: Guards against destructive shell commands (`rm -rf /`, `mkfs`, fork bombs, `curl | bash`).
- `cost_under`: Enforces dollar cost and token limits (`max_cost_usd`, `max_tokens`).
- `llm_judge`: Optional LLM-as-a-judge (opt-in via `--judge`) supporting local Ollama and remote OpenAI-compatible models.

---

## 🤖 CI & GitHub Actions

Use the turnkey composite action in `.github/workflows/agent-eval.yml`:

```yaml
name: Agent Regression Testing
on: [push, pull_request]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci && npm run build
      - name: Run TraceEval
        uses: ./
        with:
          test-path: .traceeval/tests
          comment-pr: true
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Or run directly in any CI runner:
```bash
npx traceeval test --ci --markdown --output .traceeval/report.md
```

---

## 💻 Installation Options

```bash
# 1. Global install via npm:
npm install -g traceeval

# 2. Run on-demand via npx:
npx traceeval <command>

# 3. From source:
git clone https://github.com/JayCommit/TraceEval.git
cd TraceEval
npm install
npm run build
```

*(Requires Node.js >= 22.0.0 for built-in `node:sqlite` support with zero native addons).*

---

## 🤝 Contributing

Contributions are warmly welcomed! See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, code organization, and PR guidelines.

---

## 📄 License

[Apache License 2.0](LICENSE) © TraceEval Contributors
