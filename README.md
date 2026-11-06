# TraceEval 🔍

> **pytest + git blame for AI coding agents.**  
> *Stop shipping agent regressions. Catch them before they cost you tokens and time.*

[![npm version](https://img.shields.io/badge/npm-v0.0.2-blue.svg)](https://www.npmjs.com/package/traceeval)
[![Tests](https://img.shields.io/badge/tests-158%20passing-brightgreen.svg)](https://github.com/JayCommit/TraceEval)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-blue)](https://www.typescriptlang.org/)

---

## Why TraceEval?

AI coding agents generate code rapidly, but verification is mostly manual. A single prompt edit or model upgrade can quietly cause agents to take 3x more steps, call unauthorized tools, or burn unnecessary tokens.

- **Local-first & private**: Runs 100% locally on your machine or in CI. No mandatory cloud observability platforms or token leaks.
- **Token-efficient by design**: Zero-token deterministic assertions, automatic payload truncation, and compact MCP responses that protect agent context windows.
- **Regression-first ("git blame" for agents)**: Compares current runs against known-good golden baselines to catch step inflation, tool deviations, and cost drift.
- **Trajectory validation, not just output diffs**: Validates both final code state and the path taken (tool calls, safety boundaries, step budgets).
- **First-class agent support**: One-command hook injection for Cursor, Grok, Grok Bot, OpenAI / ChatGPT app, Antigravity, Claude Code, and OpenCode.

---

## ⚡ Quickstart (< 5 Minutes)

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

Install background recording hooks with a single command:

```bash
# Cursor
traceeval install cursor

# Grok (xAI)
traceeval install grok

# Grok Bot
traceeval install grok-bot

# OpenAI / ChatGPT Desktop
traceeval install openai

# Antigravity
traceeval install antigravity

# Claude Code
traceeval install claude

# OpenCode
traceeval install opencode
```

Lifecycle hooks stream tool calls and session events directly to `.traceeval/traces` in the background with zero latency.

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

TraceEval saves the baseline fingerprint (step count, duration, tool call breakdown, touched files, token spend) to `.traceeval/golden/`. Future runs will be evaluated against this golden standard.

---

## 🤖 Supported Agents

| Agent | Install Command | Target Config / Hooks | Notes |
| :--- | :--- | :--- | :--- |
| **Cursor** | `traceeval install cursor` | `.cursor/hooks.json`, `.cursor/mcp.json`, `.cursor/rules/traceeval.mdc` | Configures tool hooks, MCP server, and workspace agent rules. |
| **Grok** | `traceeval install grok` | `.grok/hooks.json`, `.grok/config.json` | Captures tool invocations and token usage metrics. |
| **Grok Bot** | `traceeval install grok-bot` | `.grok-bot/plugins/traceeval.js`, `.grok-bot/config.json` | Bot middleware adapter for automated CI / PR bots. |
| **OpenAI / ChatGPT** | `traceeval install openai` | `.openai/hooks.json`, `.openai/config.json`, `.openai/mcp.json` | Integrates with ChatGPT Desktop App and OpenAI SDK/CLI tools. |
| **Antigravity** | `traceeval install antigravity` | `.agents/hooks.json` | Native Antigravity lifecycle hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`). Preserves existing hooks. |
| **Claude Code** | `traceeval install claude` | `.claude/settings.json` | Native Claude Code hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`). |
| **OpenCode** | `traceeval install opencode` | `.opencode/plugins/traceeval.js`, `.opencode/config.json` | OpenCode plugin capturing tool execution and file modifications. |

---

## 💰 Token Efficiency & Cost Reduction

TraceEval is engineered to prevent token waste:

1. **Deterministic Assertions First**: Prefer `file_contains`, `tests_pass`, `max_steps`, and `cost_under` for instant, 0-token evaluations.
2. **Intelligent Payload Truncation**: Automatically bounds large tool outputs (e.g. giant logs or diffs) to prevent context explosion while preserving diagnostics.
3. **Token-Aware MCP Server**: `get_trace` provides compact tool outputs by default so AI agents introspecting past runs don't blow their context window.
4. **Lean Trajectory Summaries**: LLM-as-a-judge (`--judge`) summarizes large trajectories by consolidating intermediate steps and using a minimal system prompt.
5. **Cost & Token Drift Budgets**: Detect token inflation before merging with `cost_under` assertions and `max_cost_increase` golden limits.

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

If an agent change causes step drift or uses a forbidden tool, TraceEval flags the regression and exits with code 1:

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

---

## 🛠 Core Commands

| Command | Description |
| :--- | :--- |
| `traceeval init` | Initializes `.traceeval/` config and starter tests |
| `traceeval install <agent>` | Injects hooks for `cursor`, `grok`, `grok-bot`, `openai`, `antigravity`, `claude`, or `opencode` |
| `traceeval record -- <cmd...>` | Explicitly runs and records any agent command in a bounded session |
| `traceeval test` | Runs declarative YAML test suite in `.traceeval/tests/` |
| `traceeval test --update-golden` | Runs tests and blesses passing runs as golden baselines |
| `traceeval test --runs 5 --min-success 80%` | Statistical multi-run evaluation for non-deterministic agents |
| `traceeval test --ci` | Strict CI mode with non-zero exit code and `$GITHUB_STEP_SUMMARY` export |
| `traceeval update-golden [test]` | Blesses a test run as the new golden baseline standard |
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
traceeval view --latest --serve
```
Features interactive category filters (tool calls, file changes, prompts), live payload search, and side-by-side golden diff banners.

### 2. Spec-Aware Testing (`AGENTS.md` Linking)
Link tests directly to requirements in `AGENTS.md` or `CLAUDE.md`:
```yaml
spec: "AGENTS.md#Authentication Rules"
```
Validate linked documentation headings in CI:
```bash
traceeval specs --validate
```

### 3. Model Context Protocol (MCP) Server
Allows agents to query historical traces, inspect golden standards, and avoid past errors:
```bash
traceeval mcp
```
Configure in Cursor (`.cursor/mcp.json`), Claude Code (`~/.claude/settings.json`), or ChatGPT Desktop (`.openai/mcp.json`):
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
name: Agent Regression Suite
on: [push, pull_request]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: JayCommit/TraceEval@v1
        with:
          test_path: ".traceeval/tests"
          runs: 3
          min_success: "80%"
```

---

## License

Apache-2.0
