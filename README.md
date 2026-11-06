# TraceEval 🔍

> **pytest + git blame for AI coding agents.**  
> *Stop shipping agent regressions. Catch them before they cost you tokens and time.*

[![npm version](https://img.shields.io/badge/npm-v0.0.3-blue.svg)](https://www.npmjs.com/package/traceeval)
[![Tests](https://img.shields.io/badge/tests-167%20passing-brightgreen.svg)](https://github.com/JayCommit/TraceEval)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-blue)](https://www.typescriptlang.org/)

---

## Why TraceEval?

AI coding agents generate code rapidly, but verification is mostly manual. A single prompt edit or model upgrade can quietly cause agents to take 3x more steps, call unauthorized tools, or burn unnecessary tokens.

- **Local-first & private**: Runs 100% locally on your machine or in CI. No mandatory cloud observability platforms or token leaks.
- **Token-efficient by design**: Zero-token deterministic assertions, automatic payload truncation, and compact MCP responses that protect agent context windows.
- **Real-time live streaming**: Stream live agent tool execution into the browser with zero-dependency Server-Sent Events (SSE).
- **Visual file diffs**: Unified, syntax-styled line diffs for code edits directly in static and live viewers.
- **Regression-first ("git blame" for agents)**: Compares current runs against known-good golden baselines to catch step inflation, tool deviations, and cost drift.
- **First-class agent support**: One-command hook injection for Cursor, Grok, Grok Bot, OpenAI / ChatGPT app, Antigravity, Claude Code, and OpenCode.

---

## 🤖 Supported Agents

| Agent | Install Command | Config Files | Description |
| :--- | :--- | :--- | :--- |
| **Cursor** | `traceeval install cursor` | `.cursor/hooks.json`, `.cursor/mcp.json`, `.cursor/rules/traceeval.mdc` | Configures tool hooks, MCP server, and workspace agent rules. |
| **Grok** | `traceeval install grok` | `.grok/hooks.json`, `.grok/config.json` | Captures tool invocations and token usage metrics. |
| **Grok Bot** | `traceeval install grok-bot` | `.grok-bot/plugins/traceeval.js`, `.grok-bot/config.json` | Bot middleware adapter for automated CI and PR bots. |
| **OpenAI / ChatGPT** | `traceeval install openai` | `.openai/hooks.json`, `.openai/config.json`, `.openai/mcp.json` | Integrates with ChatGPT Desktop App and OpenAI SDK/CLI tools. |
| **Antigravity** | `traceeval install antigravity` | `.agents/hooks.json` | Native Antigravity lifecycle hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`). |
| **Claude Code** | `traceeval install claude` | `.claude/settings.json` | Native Claude Code lifecycle hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`). |
| **OpenCode** | `traceeval install opencode` | `.opencode/plugins/traceeval.js`, `.opencode/config.json` | Plugin capturing tool execution and file modifications. |

---

## ⚡ Quickstart (< 5 Minutes)

### 1. Install TraceEval

```bash
# Global install (recommended)
npm install -g traceeval

# Or verify via npx
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
traceeval install cursor        # or: grok, grok-bot, openai, antigravity, claude, opencode
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

## 🖥 Real-Time Live Viewer & Visual File Diffs

### 1. Live SSE Trace Viewer
Stream live agent execution directly to your browser as tools run in real-time, with zero external dependencies:
```bash
traceeval view --latest --serve
```
- Real-time Server-Sent Events (SSE) updates the timeline dynamically without page refreshes.
- Live status indicator pulses in the header.
- Interactive category filters (tool calls, file changes, prompts) and live payload search.

### 2. Visual Code Diff Viewer
Whenever file edits (`edit_file`, `str_replace_editor`, `write_file`, or `file_change`) are executed, TraceEval displays a clear, syntax-styled unified diff:
- Color-coded line additions (`+`) and deletions (`-`).
- Addition and deletion count badges (`+12 -3`).
- Automatic diff truncation for large files to keep inspection fast and responsive.
- Available in both static HTML exports and the real-time live viewer.

```bash
# Export self-contained static HTML report:
traceeval view --latest --output ./reports/trace.html
```

---

## 💰 Token Efficiency & Cost Reduction

TraceEval is engineered to prevent token waste:

1. **Deterministic Assertions First**: Prefer `file_contains`, `tests_pass`, `max_steps`, and `cost_under` for instant, 0-token evaluations.
2. **Intelligent Payload Truncation**: Automatically bounds large tool outputs (e.g. giant logs or diffs) to prevent context explosion while preserving diagnostics. User-configurable via `--truncate <chars>` or `TRACEEVAL_MAX_PAYLOAD`.
3. **Token-Aware MCP Server**: `get_trace` provides compact tool outputs by default (`maxOutputLength: 1000`) so AI agents introspecting past runs don't blow their context window.
4. **Lean Trajectory Summaries**: LLM-as-a-judge (`--judge`) consolidates intermediate steps and uses a 50% tighter system prompt.
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
| `traceeval traces diff <id1> <id2>` | Side-by-side trajectory differencer with structured metric alignment |
| `traceeval view --latest --serve` | Starts local real-time SSE streaming viewer on port 4242 |
| `traceeval specs --validate` | Verifies linked `AGENTS.md` spec headings and fails if broken |
| `traceeval mcp` | Starts Model Context Protocol server over stdio for agent queries |

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
