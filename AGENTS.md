# TraceEval — Product Vision & Architecture Guidelines

> **"Stop shipping agent regressions. Catch them before they cost you tokens and time."**

TraceEval is the **"pytest + git blame" for AI coding agents** (Claude Code, OpenCode, Codex CLI, etc.).

## 1. Core Problem & Product Vision
AI coding agents are exploding, but reliability is the bottleneck. Generation is cheap; verification is expensive and mostly manual. Developers need a fast, local, low-friction way to answer:
> *"Did this change to my prompt, AGENTS.md, model, or tools break something that used to work?"*

### Key Product Pillars
- **Local-first & Privacy-Respecting**: Everything runs locally on machine or in CI. No mandatory cloud dependencies.
- **Zero-to-Low Instrumentation**: Native hook injection for Claude Code, plugins for OpenCode, CLI recording wrapper.
- **Regression-First**: Compare against previous known-good (golden) runs, not only absolute scores.
- **Spec-Aware**: Tests tied to `AGENTS.md` sections, issue descriptions, or simple YAML/Markdown specs.
- **Trajectory Validation**: Check tool calls, file edits, step sequence, efficiency, and cost in addition to final diffs.
- **Make Evaluation Routine**: Seamless integration into developer workflow and CI pipelines.

---

## 2. 4-Phase Roadmap

### Phase 1: Foundation & Hello World (Completed & Hardened)
- [x] Full project skeleton, TypeScript config, package.json, CLI skeleton (`traceeval`).
- [x] Core data models for traces, tests, results (Zod + TypeScript).
- [x] Claude Code hook installer (`traceeval install claude`) + recording hooks.
- [x] Trace storage: Dual JSONL event streaming + SQLite (`node:sqlite`).
- [x] Basic YAML test loader and deterministic assertions (`file_contains`, `file_exists`, `tests_pass`, `max_steps`, `tool_called`).
- [x] `traceeval init`, `traceeval install claude`, `traceeval record`, `traceeval test`, `traceeval traces` commands.
- [x] Hello-world flow with example YAML test.
- [x] Unit & integration test suite (49 tests passing, 100% strict TypeScript, zero loose `any` types).

### Phase 1 Hardening Status
Phase 1 core infrastructure was hardened with defense-in-depth across three critical areas:

1. **Hook Reliability & Session Correlation**:
   - **Fail-Safe Invariants**: Agent hooks (`traceeval hook [type]`) are completely non-blocking and wrapped in fail-safe boundaries with exit code 0 guarantees, ensuring hook execution never crashes, interrupts, or delays the host agent.
   - **Hierarchical Session Correlation**: Resolves session IDs systematically across:
     1. Explicit CLI argument (`--session <id>`).
     2. Hook payload extraction (inspecting `session_id`, `sessionId`, `conversation_id`, and nested `session`, `context`, `event` objects).
     3. Process environment variable (`TRACEEVAL_SESSION_ID`).
     4. Active session tracking file (`.traceeval/.active_session`) with configurable TTL (default 30 min) and auto-touch refresh.
     5. Automatic timestamped fallback generation (`session-<timestamp>-<hash>`).
   - **Non-Blocking Stdin Reader**: Piped stdin times out gracefully (default 500ms) with unref'd timer to prevent zombie processes if stdin never signals EOF.

2. **Storage Robustness (Dual-Write, SQLite Quarantine & Auto-Healing)**:
   - **Resilient Dual-Write**: Traces are immediately appended to local JSONL streams (`.traceeval/traces/<sessionId>.jsonl`), followed by secondary indexing in SQLite (`.traceeval/traces.db`).
   - **Corrupted SQLite Auto-Quarantine**: If the SQLite database becomes corrupted or malformed, it is automatically moved to `.traceeval/traces.db.corrupt.<timestamp>` and a fresh database is initialized without failing the active write.
   - **JSONL Fallback & Auto-Healing**: If SQLite is absent, wiped, or missing entries, `StorageManager` falls back to the JSONL log stream and automatically reconciles/heals missing session and event records into SQLite on query.
   - **Concurrency Pragmas**: Node v22 `node:sqlite` configured with WAL mode (`PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA synchronous = NORMAL`) to eliminate locked-database contention during rapid parallel tool invocations.

3. **End-to-End Test Suite & TypeScript Quality**:
   - 49 unit and integration tests across 6 test suites (`cli.test.ts`, `hooks.test.ts`, `storage.test.ts`, `runner.test.ts`, `assertions.test.ts`, `loader.test.ts`).
   - Clean public API exports in `src/index.ts` covering types, storage managers, hook parsers, session trackers, assertion evaluators, loaders, runners, and reporters.
   - Strict TypeScript configuration with zero `any` types, zero unused imports, and zero compiler warnings.

### Phase 2: Regression & CI (Completed & Hardened)
- [x] Structured storage format for golden traces (`.traceeval/golden/<test-name>.json`).
- [x] Baseline capture: step counts, tool breakdown, duration, cost/tokens, and file touchpoints.
- [x] Step drift assertion & thresholds: detect step count inflation (`max_step_increase: 20%` or absolute count).
- [x] Tool deviation detection: flag unauthorized or unexpected tool calls (`allowed_tools`, `disallowed_tools`).
- [x] Cost and duration drift evaluators (`max_cost_increase`, `max_duration_increase`).
- [x] Extended assertions: `no_dangerous_commands`, `cost_under`.
- [x] Golden Management CLI (`traceeval update-golden [test-name]`, `traceeval test --update-golden`, `traceeval golden list`, `traceeval golden show`, `traceeval golden remove`).
- [x] Rich terminal diff viewer & markdown generator with PR comment bot and step summary support.
- [x] GitHub Action (`action.yml`) with sticky PR commenting and CI exit code enforcement.
- [x] Comprehensive test coverage across golden persistence, differencing engine, CI runner, and assertions (93 tests passing).

### Phase 2 Implementation Summary
Phase 2 transformed TraceEval from a trace recorder into a true agent regression detection platform:

1. **Golden Baseline Storage & Differencing Engine**:
   - Stored in clean JSON snapshots (`.traceeval/golden/<test-name>.json`) with schema-enforced validation via Zod.
   - Captures comprehensive execution fingerprints: step count, tool call breakdown, touched files, runtime duration, token usage (input/output/total), and cost.
   - `compareWithGolden` calculates exact numerical and percentage deltas between current runs and baselines, identifying deviations instantly.

2. **Configurable Regression Thresholds**:
   - YAML test specs support fine-grained regression budgets:
     - `max_step_increase`: percentage (e.g. `20%`) or absolute step count delta (e.g. `2`).
     - `allowed_tools` & `disallowed_tools`: enforces strict tool whitelists or blacklists to prevent agent drift or unauthorized tool calls.
     - `max_cost_increase`: cost inflation limits in percentage or dollar amounts.
     - `max_duration_increase`: latency drift limits in percentage or milliseconds.

3. **Extended Assertion Surface**:
   - `no_dangerous_commands`: guards against destructive commands (`rm -rf /`, `mkfs`, `dd if=`, fork bombs, `curl | bash`, etc.) with customizable `forbidden_patterns` and `allowed_commands` exemptions.
   - `cost_under`: enforces token usage and dollar cost budgets (`max_cost_usd`, `max_tokens`) across trace sessions.

4. **Turnkey GitHub Action & Multi-Format Reporting**:
   - Turnkey GitHub Action (`JayCommit/TraceEval@v1`, `action.yml`) runs tests, produces Markdown summaries, appends to `$GITHUB_STEP_SUMMARY`, and posts/updates sticky PR comments.
   - Dual reporting architecture: Terminal reporter (`picocolors`) with rich side-by-side golden diffs + Markdown reporter for CI annotations.
   - Strict CI exit codes: returns `0` on clean runs and `1` on assertion or regression threshold breaches.

### Phase 3: Traction Features (Completed & Hardened)
- [x] Statistical Multi-Run Evaluation: `--runs N --min-success M` execution mode accounting for LLM non-determinism and flaky agent trajectories.
- [x] Trace Inspection & Visual Diffing: enhanced timeline viewer (`traceeval traces show <id>`) and side-by-side comparator (`traceeval traces diff <id1> <id2>` and `--golden <test>`).
- [x] Optional LLM-as-a-Judge: trajectory quality and criteria evaluation supporting local Ollama and remote OpenAI-compatible endpoints with deterministic test mocking.
- [x] OpenCode Plugin Adapter: native plugin integration capturing tool calls, file changes, and sessions via `traceeval install opencode`.
- [x] Cost & Efficiency Tracking: token counts, dollar budgets, steps per task, and cost per task aggregated across single and multi-run suites.

### Phase 3 Implementation Summary
Phase 3 added the highest-value traction features to transform TraceEval into a comprehensive evaluation platform:

1. **Statistical Multi-Run Engine**:
   - Supports `--runs N --min-success P` (e.g., `--runs 5 --min-success 0.8` or `80%`).
   - Executes tests repeatedly, aggregates pass rates, average steps, average cost, and token counts.
   - Enforces statistical success thresholds, failing suites only when flaky runs breach the confidence bar.
   - Preserves individual run trace IDs so each iteration can be inspected independently.

2. **Advanced Trace Inspection & Differencing**:
   - Enhanced `traceeval traces show <sessionId>` displays rich timelines with tool inputs/outputs, file changes, agent thoughts, and cost/token metrics.
   - `traceeval traces diff <id1> <id2>` and `traceeval traces diff <id1> --golden <test>` compare two runs side-by-side:
     - Delta in steps, duration, cost, and tokens.
     - Tool calls added, removed, or changed.
     - Files touched, added, removed, or shared between runs.

3. **Optional LLM-as-a-Judge**:
   - Evaluates trajectory criteria that cannot be easily asserted deterministically (e.g., clarity of explanation, code style compliance, instruction nuance).
   - Strictly opt-in via `--judge`, `enabled: true`, or `TRACEEVAL_ENABLE_JUDGE=1`.
   - Supports local models (Ollama via `/api/generate`) and remote models (OpenAI-compatible via `/chat/completions`), plus offline mock provider for deterministic CI testing.
   - Caches and logs judge score and reasoning directly into the trace session events.

4. **Multi-Agent Extensibility (OpenCode Support)**:
   - Native OpenCode adapter (`src/hooks/opencode.ts`) and installation command (`traceeval install opencode`).
   - Normalizes OpenCode tool executions, file edits, and session events into TraceEval's standardized `TraceEvent` format.
   - Allows projects using OpenCode to record traces, run regression suites, and compare golden runs seamlessly.

5. **Cost & Efficiency Metrics**:
   - Aggregates suite-level steps per task, cost per task, total cost, and token volume across single and multi-run suites.
   - Displayed prominently across terminal and Markdown CI reports.

### Phase 4: Polish & Launch (Completed & Hardened for v0.0.1)
- [x] Lightweight Local Web Viewer: self-contained, offline HTML/web UI (`traceeval view`) to inspect trace timelines, event cards, filters, and golden diffs.
- [x] AGENTS.md Spec Helpers: `traceeval specs` helper and validator linking evaluation tests directly to Markdown spec headings (`spec: "AGENTS.md#Heading"`).
- [x] Model Context Protocol (MCP) Server: standard JSON-RPC stdio server (`traceeval mcp`) allowing agents to query past traces, inspect golden baselines, and diff runs.
- [x] Package Distribution & Release Polish: strict npm package configuration (`v0.0.1`), CHANGELOG.md, CONTRIBUTING.md, and turnkey installation paths.

### Phase 4 Implementation Summary
Phase 4 completed all release requirements for the initial public v0.0.1 release:

1. **Self-Contained Offline HTML Viewer (`src/viewer/html.ts`, `traceeval view`)**:
   - Zero-dependency, offline-first HTML generator embedding clean CSS and client-side JavaScript without any external CDNs.
   - Interactive features: category filtering (tool calls, file changes, user prompts), live payload search, collapsible execution cards with formatted inputs/outputs, and golden comparison overview.
   - Built-in static HTTP server mode (`traceeval view --serve --port 4242`).

2. **AGENTS.md Spec Linkage (`src/engine/specs.ts`, `traceeval specs`)**:
   - Tests declare spec links via `spec: "AGENTS.md#Heading"` or `spec: "CLAUDE.md#Rules"`.
   - `traceeval specs` lists all test spec linkages and previews extracted Markdown requirement snippets.
   - `--validate` flag enforces spec integrity, failing with exit code 1 if a referenced heading is modified or deleted.

3. **Model Context Protocol (MCP) Server (`src/mcp/server.ts`, `traceeval mcp`)**:
   - Implements standard MCP (JSON-RPC 2.0 over stdio) with zero external runtime dependencies.
   - Exposes 6 core tools: `list_traces`, `get_trace`, `list_golden_baselines`, `get_golden_baseline`, `compare_traces`, and `list_specs`.
   - Allows AI coding agents (Claude Code, Cursor, Windsurf) to introspect past trajectories and avoid repeating past errors.

4. **Release Polish & Packaging**:
   - Package metadata set to `0.0.1` with Node.js `>=22.0.0` engine enforcement.
   - Added `CHANGELOG.md` documenting all features across Phases 1–4.
   - Added `CONTRIBUTING.md` with development setup, architectural principles, and PR instructions.
   - 129/129 tests passing across 16 test suites.

---

## 5. Completed Roadmap & v0.0.6 Milestones (Zero Limitations)
All roadmap milestones and previous limitations are fully implemented, hardened, and tested as of v0.0.6:
- [x] **AST-Aware Semantic Diffing**: Syntax-aware structural analysis recognizing moved blocks, reordered functions, modified signatures/parameters, renamed identifiers, and added/removed declarations across TypeScript/JavaScript, Python, and C-like languages with zero dependencies.
- [x] **Bidirectional Live Viewer Control**: Full interactive browser control allowing users to pause (`SIGSTOP`), resume (`SIGCONT`), abort (`SIGINT`/`SIGTERM`), and inject steering prompts in real time over RFC6455 WebSockets and REST API with token authentication.
- [x] **Automated Multi-Agent Benchmark Launching (`traceeval bench` / `traceeval arena --launch`)**: Parallel/sequential execution of multiple coding agents (Cursor, Claude, Grok, Grok Bot, OpenAI/ChatGPT, Antigravity, OpenCode) in isolated workspaces against prompts or test specs with simultaneous live Arena streaming and head-to-head scoreboards.
- [x] **Zero Remaining Limitations**: All planned features and limitations are completely closed with 100% test coverage (200 passing tests across 27 test files).

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                      Capture Layer                     │
│  Claude Code Hooks / OpenCode Plugins / CLI Recorder   │
└──────────────────────────┬─────────────────────────────┘
                           │ Standardized Trace Events
                           ▼
┌────────────────────────────────────────────────────────┐
│                      Storage Layer                     │
│    JSONL Event Streams (.traceeval/traces/*.jsonl)     │
│    SQLite Index Database (.traceeval/traces.db)        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Evaluation Engine                    │
│  - YAML Test Loader (.traceeval/tests/*.yaml)          │
│  - Trajectory Checkers (steps, tool_called)           │
│  - State Checkers (file_contains, tests_pass)          │
│  - Golden Differencer (Phase 2)                        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                    Reporting & CI                      │
│      Terminal UI (picocolors) | Markdown Reports       │
│           CI Exit Codes (0 = pass, 1 = fail)           │
└────────────────────────────────────────────────────────┘
```

---

## 4. Coding Conventions & Principles
- **TypeScript First**: Strict mode, NodeNext ESM, strongly typed interfaces for all events.
- **Zero Heavy Native Addons**: Use Node v22+ built-in `node:sqlite` for SQLite storage; avoid node-gyp native compilation bugs.
- **Clean Separation of Concerns**:
  - `src/types/`: Pure types and schemas (Zod).
  - `src/storage/`: Trace persistence (JSONL, SQLite).
  - `src/hooks/`: Agent integration hooks (Claude Code, etc.).
  - `src/engine/`: Assertions, test loader, test runner.
  - `src/commands/`: CLI command implementations.
  - `src/reporters/`: Terminal and Markdown formatting.
- **CI Friendly**: Standard exit codes (0 on success, non-zero on failure), silent/json output flags where applicable.
