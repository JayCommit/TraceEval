# TraceEval 🔍

> **pytest + git blame for AI coding agents.**  
> *Stop shipping agent regressions. Catch them before they cost you tokens and time.*

[![npm version](https://img.shields.io/badge/npm-v0.0.6-blue.svg)](https://www.npmjs.com/package/traceeval)
[![CI](https://github.com/JayCommit/TraceEval/actions/workflows/agent-eval.yml/badge.svg)](https://github.com/JayCommit/TraceEval/actions/workflows/agent-eval.yml)
[![Tests](https://img.shields.io/badge/tests-200%20passing-brightgreen.svg)](https://github.com/JayCommit/TraceEval)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ES2022-blue)](https://www.typescriptlang.org/)

TraceEval is a fast, local-first evaluation and regression testing framework for AI coding agents. When you tweak system prompts, modify `AGENTS.md`, switch models, or update tool schemas, TraceEval tells you immediately:
> *"Did this change cause my agent to loop indefinitely, take 3x more steps, call unauthorized tools, or burn extra tokens?"*

---

## Why TraceEval?

AI coding agents generate code rapidly, but verification is mostly manual. A minor prompt edit can silently double token costs or cause flaky tool loops.

- **Local-first & private**: Runs 100% on your machine or in CI. No mandatory cloud observability platforms, external accounts, or token telemetry leaks.
- **Regression-first ("git blame" for agents)**: Compares current agent runs against known-good **golden baselines** to detect step inflation, tool deviations, and cost drift.
- **Token-efficient by design**: Zero-token deterministic assertions (`file_contains`, `tests_pass`, `max_steps`, `cost_under`), automatic payload truncation, and compact MCP responses that protect agent context windows.
- **⚔️ Automated Multi-Agent Benchmarks**: Launch two or more coding agents simultaneously in isolated workspaces on the same prompt or test spec (`traceeval bench`), streaming live side-by-side with head-to-head scoreboards.
- **⚡ Bidirectional Live Viewer Controls**: Pause (`SIGSTOP`), resume (`SIGCONT`), abort (`SIGINT`/`SIGTERM`), or inject steering prompts directly into active agent runs from the web UI over RFC6455 WebSockets and REST API.
- **🧠 AST-Aware Semantic Diffing**: Syntax-aware structural code diffing detecting moved blocks, function signature modifications, and renamed identifiers across TypeScript/JavaScript, Python, and C-like languages with zero dependencies.
- **Split diffs with intra-line highlighting**: Real-time SSE/WebSocket streaming viewer with toggleable side-by-side/unified file diffs and token-level character/word highlighting inside modified lines.
- **Statistical multi-run testing**: Handles non-deterministic LLM behavior via `--runs N --min-success M%` thresholds.
- **Turnkey agent support**: One-command hook injection for Cursor, Grok, Grok Bot, OpenAI / ChatGPT app, Antigravity, Claude Code, and OpenCode.
- **MCP server included**: Built-in Model Context Protocol server enabling agents to query past traces and golden baselines directly.

---

## 🤖 Supported Agents

TraceEval integrates seamlessly with popular coding agents through native lifecycle hooks:

| Agent | Install Command | Config Location | Capabilities |
| :--- | :--- | :--- | :--- |
| **Cursor** | `traceeval install cursor` | `.cursor/hooks.json`, `.cursor/mcp.json` | Hooks tool calls, MCP server, and workspace agent rules (`.mdc`) |
| **Grok** | `traceeval install grok` | `.grok/hooks.json`, `.grok/config.json` | Captures tool invocations, bash commands, and token spend |
| **Grok Bot** | `traceeval install grok-bot` | `.grok-bot/plugins/traceeval.js` | Bot lifecycle plugin for automated CI and PR agents |
| **OpenAI / ChatGPT** | `traceeval install openai` | `.openai/hooks.json`, `.openai/mcp.json` | ChatGPT Desktop App, Assistant API runs, and OpenAI CLI tools |
| **Antigravity** | `traceeval install antigravity` | `.agents/hooks.json` | Native Antigravity lifecycle hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`) |
| **Claude Code** | `traceeval install claude` | `.claude/settings.json` | Native Claude Code hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) |
| **OpenCode** | `traceeval install opencode` | `.opencode/plugins/traceeval.js` | OpenCode plugin capturing tool execution and file modifications |

---

## ⚡ Quickstart (< 5 Minutes)

### 1. Install TraceEval

```bash
# Global install (recommended)
npm install -g traceeval

# Or run instantly via npx
npx traceeval --version
```

### 2. Initialize in your repository

```bash
traceeval init
```

This creates:
- `.traceeval/` — local SQLite index (`traces.db`) and dual JSONL stream storage
- `.traceeval/tests/hello-world.yaml` — a starter declarative test specification

### 3. Connect your coding agent

Install background recording hooks into your agent of choice:

```bash
traceeval install cursor        # or: grok, grok-bot, openai, antigravity, claude, opencode
```

Lifecycle hooks stream tool calls and session events directly to `.traceeval/traces` in the background with zero latency.

### 4. Run the test suite

```bash
traceeval test
```

```text
TraceEval — AI Coding Agent Regression Test Results
────────────────────────────────────────────────────────────
✔ PASS Hello World Greeting Edit (38ms)
  file: .traceeval/tests/hello-world.yaml
  trace: test-1793935826633-bee6546a
  ✓ [file_exists] Greeting file must exist
  ✓ [file_contains] Greeting function must return 'Hello, TraceEval!'
  ✓ [file_contains] No TODO placeholders should remain
  ✓ [max_steps] Agent should finish within 10 steps

────────────────────────────────────────────────────────────
Tests:    1 passed, 1 total
Duration: 38ms
Status:   ALL TESTS PASSED
```

### 5. Bless the run as a golden baseline

```bash
traceeval test --update-golden
```

TraceEval captures the baseline fingerprint (step count, tool breakdown, touched files, token spend, duration) to `.traceeval/golden/`. Future runs will be evaluated against this baseline.

---

## 🏆 Golden Baselines & Regression Testing

Define regression budgets in your test YAML (`.traceeval/tests/auth-refactor.yaml`):

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

# Enforce regression thresholds against the golden standard
regression:
  max_step_increase: 1          # Flag if agent takes > 1 extra step
  allowed_tools:
    - "Edit"
    - "ReadFile"
  disallowed_tools:
    - "Bash"                    # Forbid arbitrary shell execution for this task
  max_duration_increase: "50%"  # Allow at most 50% runtime drift
  max_cost_increase: "20%"      # Allow at most 20% token cost drift

assertions:
  - type: "file_exists"
    path: "src/auth.ts"

  - type: "file_contains"
    path: "src/auth.ts"
    not_contains: "TODO"

  - type: "no_dangerous_commands"
```

If an agent change breaches your regression budget or calls a disallowed tool, TraceEval flags the regression and exits with code `1`:

```text
✖ FAIL Refactor Authentication Logic (1.1s)
  file: .traceeval/tests/auth-refactor.yaml
  trace: session-1793935826841-f64a6b
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

Inspect the exact differences between any two runs in your terminal:

```bash
traceeval traces diff session-old session-new
traceeval traces diff session-new --golden "Refactor Authentication Logic"
```

---

## 🔁 Statistical Multi-Run Evaluation

LLMs are non-deterministic. A single test pass might be luck; a single failure might be transient.

Use `--runs N --min-success M` to evaluate agent consistency across repeated runs:

```bash
# Require at least 80% pass rate across 5 runs
traceeval test --runs 5 --min-success 80%

# Update golden baseline only when the multi-run threshold is satisfied
traceeval test --runs 5 --min-success 80% --update-golden
```

TraceEval records traces for each individual run, calculates the statistical pass rate, averages steps and costs, and fails CI only when the confidence bar is breached.

---

## ⚔️ Multi-Agent Live Arena & Automated Benchmarks

### 1. Automated Benchmark Launching (`traceeval bench`)
Automatically launch multiple AI coding agents simultaneously in isolated workspaces against the same prompt or test specification:

```bash
# Benchmark Claude Code vs Cursor against a prompt:
traceeval bench --agents claude,cursor --prompt "Add email validation logic in src/auth.ts"

# Benchmark against a declarative test specification in parallel:
traceeval bench --agents claude,cursor,antigravity --test .traceeval/tests/hello-world.yaml

# Or launch via the arena command:
traceeval arena --launch --agents claude,cursor --test .traceeval/tests/hello-world.yaml
```

- **Clean workspace isolation**: Provisions isolated workspaces (`.traceeval/workspaces/<agent>-<sessionId>`) with separate file trees and environment bindings (`TRACEEVAL_SESSION_ID`, `TRACEEVAL_WORKSPACE`) so agents never interfere.
- **Concurrent execution**: Runs agents in parallel, capturing steps, tokens, duration, and file changes simultaneously.
- **Automated test assertions**: When run with `--test <spec.yaml>`, runs all deterministic assertions (`file_exists`, `file_contains`, `tests_pass`) against each agent's resulting workspace.
- **Instant live Arena streaming**: Automatically opens the Multi-Agent Live Arena in your browser, streaming both trajectories side-by-side as tools execute.

### 2. Multi-Agent Live Arena Viewer
Inspect multiple agent runs side-by-side in real time:

```bash
# Compare your two most recent runs:
traceeval arena

# Compare specific agent sessions side-by-side:
traceeval arena session-claude session-cursor

# Or launch via view:
traceeval view session-claude session-cursor --serve
```

- **Head-to-head scoreboard**: Real-time scoreboard comparing step efficiency, duration speedup, dollar cost, total tokens, and files modified across all active agents.
- **Side-by-side agent columns**: Responsive CSS grid panes with agent-specific color branding (Claude, Cursor, OpenAI / ChatGPT, Grok, Grok Bot, Antigravity, OpenCode).
- **Synchronized live streaming**: Watch tool calls, file edits, and outputs stream into each agent pane in real time without refreshing.
- **Dynamic browser pinning**: Add new agents to the arena dynamically from recent workspace traces via the header dropdown, or unpin agents (`✕`) on the fly.
- **Offline export**: `traceeval arena session-1 session-2 -o arena.html` exports self-contained offline reports for sharing or PR reviews.

---

## 🖥 Real-Time Live Viewer, Semantic Diffing & Bidirectional Control

### 1. Bidirectional Agent Controls (Pause, Abort, Inject Prompt)
Steer and control running agents directly from the browser in real time:

- **⏸ Pause / ▶ Resume**: Freezes the active agent child process via POSIX `SIGSTOP` and unfreezes via `SIGCONT`.
- **⏹ Abort**: Safely stops rogue or looping agents via `SIGINT` / `SIGTERM` signals.
- **⚡ Prompt Injection**: Inject real-time steering messages or corrections directly into the active session via `stdin` and control queues.
- **Dual-Channel Protocol**: Uses RFC6455 WebSockets over `/ws` with automatic fallback to REST API (`POST /api/control`).
- **Safe & Authenticated**: Strictly local-only (`127.0.0.1`) by default, with `--token` authentication support for remote sessions.

### 2. AST-Aware Semantic Diffing & Intra-Line Highlighting
Upgrade code review beyond simple line deletions and additions:

- **🧠 AST Structural Insights**: Pure TypeScript syntax analyzer detecting:
  - **Moved Blocks (`⇄ Moved`)**: Functions, methods, or classes relocated or reordered within a file (lines $X..Y \to A..B$).
  - **Signature Modifications (`✎ Signature`)**: Parameter list, type, or return signature adjustments.
  - **Renamed Identifiers (`🔤 Renamed`)**: Variable or parameter renames tracked across declaration scopes (e.g. `subtotal` $\to$ `aggregate` $3\times$).
  - **Added / Removed Declarations (`✚ Added`, `✖ Removed`)**: New or deleted functions and classes.
- **Intra-line word highlighting**: Modified words and tokens inside changed lines are highlighted in high-contrast red (`.diff-word-del`) and green (`.diff-word-add`).
- **Split & Unified View Modes**: Seamless toggle between side-by-side Split View and Unified View.
- **Accurate line numbers**: Preserves exact hunk line numbering from unified diffs.
- **Performance safeguards**: Built-in truncation guards for diffs exceeding 300 lines or files over 2,000 lines.

```bash
# Export self-contained offline HTML report:
traceeval view --latest --output ./reports/trace.html
```

### 3. Remote Development & Multi-Host Streaming

When running agent evaluations on remote dev servers, cloud instances, or Docker containers:

#### Recommended: SSH Port Forwarding (Most Secure)
Keep the server on localhost and tunnel it through SSH:

```bash
# On your remote server:
traceeval view --latest --serve --port 4242

# On your local machine:
ssh -N -L 4242:localhost:4242 user@remote-box
# Then open http://localhost:4242 in your local browser
```

#### Opt-In: Bind to Network Interfaces (`--host 0.0.0.0`)
To expose the viewer over LAN, Tailscale, or private VPNs:

```bash
traceeval view --latest --serve --host 0.0.0.0 --port 4242
```

Optional lightweight token protection:
```bash
traceeval view --latest --serve --host 0.0.0.0 --token my-secret-token
# Access via: http://<ip>:4242/?token=my-secret-token
```

> [!IMPORTANT]
> **Security Note:** By default, TraceEval binds exclusively to `127.0.0.1` (localhost only). Binding to `0.0.0.0` exposes trace logs to any machine that can reach that IP and port. Only bind to `0.0.0.0` on trusted private networks or use `--token` / SSH port forwarding.

---

## 🧠 Model Context Protocol (MCP) Server

TraceEval includes a built-in JSON-RPC MCP server over stdio, allowing AI coding agents to introspect their own past runs and avoid repeating mistakes:

```bash
traceeval mcp
```

### MCP Tools Exposed
- `list_traces`: List recent trace sessions, tool counts, and timestamps.
- `get_trace`: Retrieve detailed event trajectories with token-efficient compact outputs.
- `list_golden_baselines`: List registered golden baselines and step targets.
- `get_golden_baseline`: Retrieve tool breakdowns and budgets for a specific test.
- `compare_traces`: Compare two runs or compare a run against a golden baseline.
- `list_specs`: List tests linked to `AGENTS.md` and preview requirement excerpts.

---

## 🛠 Core Commands

| Command | Description |
| :--- | :--- |
| `traceeval init` | Initializes `.traceeval/` storage and a starter test suite |
| `traceeval install <agent>` | Injects hooks for `cursor`, `grok`, `grok-bot`, `openai`, `antigravity`, `claude`, or `opencode` |
| `traceeval record -- <cmd...>` | Explicitly executes and records any agent command in a tracked session |
| `traceeval test [path]` | Runs declarative YAML test suite in `.traceeval/tests/` |
| `traceeval test --update-golden` | Runs tests and blesses passing runs as golden baselines |
| `traceeval test --runs 5 --min-success 80%` | Statistical multi-run evaluation for flaky or non-deterministic agents |
| `traceeval test --ci` | Strict CI mode with non-zero exit code and `$GITHUB_STEP_SUMMARY` export |
| `traceeval update-golden [test]` | Blesses an existing run trace as the new golden standard |
| `traceeval golden list` | Lists all registered golden baselines and step counts |
| `traceeval traces list` | Lists recent recorded execution traces |
| `traceeval traces show <id>` | Shows chronological event timeline, tool inputs/outputs, and files touched |
| `traceeval traces diff <id1> <id2>` | Side-by-side terminal trajectory differencer |
| `traceeval traces diff <id1> -g <test>` | Compares a trace session against its golden baseline |
| `traceeval view [sessionIds...] --serve` | Starts local real-time SSE streaming viewer with side-by-side diffs |
| `traceeval arena [sessionIds...]` | Launches Multi-Agent Live Arena; use `--launch` (`-l`) to benchmark multiple agents |
| `traceeval bench [options]` | Launches multiple agents automatically in isolated workspaces against a prompt or test |
| `traceeval specs --validate` | Verifies linked `AGENTS.md` spec headings and fails if broken |
| `traceeval mcp` | Starts Model Context Protocol server over stdio for agent queries |

---

## 📦 Supported Assertions

TraceEval includes 8 built-in assertions covering files, commands, step budgets, and costs:

- `file_contains`: Substring or regex pattern matching with `not_contains` support.
- `file_exists`: File presence or absence verification (`should_exist: boolean`).
- `tests_pass`: Runs workspace test commands (`npm test`, `pytest`) and checks exit code 0.
- `max_steps`: Trajectory budget ensuring total tool calls do not exceed a ceiling.
- `tool_called`: Enforces that specific tools (`Edit`, `Bash`, `ReadFile`) were invoked.
- `no_dangerous_commands`: Guards against destructive shell commands (`rm -rf /`, `mkfs`, fork bombs, `curl | bash`).
- `cost_under`: Enforces dollar cost and token usage budgets (`max_cost_usd`, `max_tokens`).
- `llm_judge`: Trajectory quality evaluation (opt-in via `--judge`) supporting local Ollama and remote OpenAI-compatible endpoints.

---

## 🤖 CI & GitHub Actions

Automate agent regression testing in your CI pipeline using the turnkey composite action (`.github/workflows/agent-eval.yml`):

```yaml
name: Agent Regression Testing
on: [push, pull_request]

jobs:
  evaluate-agents:
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

## 📦 Installation Options

### Global Install via npm
```bash
npm install -g traceeval
```

### Instant Execution via npx
```bash
npx traceeval test
npx traceeval view --latest --serve
```

### Install from Source
```bash
git clone https://github.com/JayCommit/TraceEval.git
cd TraceEval
npm install
npm run build
npm link
```

---

## Contributing & License

Contributions, bug reports, and agent adapters are welcome! Please check our [Contributing Guide](CONTRIBUTING.md) and [Changelog](CHANGELOG.md).

Licensed under [Apache 2.0](LICENSE).
