# Changelog

All notable changes to TraceEval will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-11-06

### Live Real-Time Viewer, Visual File Diffs & UX Polish

#### Real-Time Live Viewer (SSE)
- **Zero-Dependency Event Streaming**: Implemented native Server-Sent Events (SSE) server via Node's built-in `node:http` module in `createViewerServer`.
- **Dynamic DOM Updates**: Connected browsers stream new trace events in real time as tools execute, updating timeline cards, step counters, and status badges without page refreshes.
- **Pulsing Live Indicator**: Added visual status indicator (`LIVE` / `RECONNECTING` / `OFFLINE`) with pulsing green dot.
- **Graceful Offline Fallback**: Static file generation (`traceeval view --output <file>`) continues to operate standalone without network requests.
- **CLI Flags**: Added `--no-open` flag to `traceeval view` to support headless and CI server invocations.

#### Visual File Diff Engine
- **Unified Line-by-Line Diffing**: Pure TypeScript diff generator (`src/viewer/diff.ts`) computing additions and deletions using Longest Common Subsequence (LCS).
- **Multi-Source Extraction**: Automatically extracts diffs from `file_change` events (`before`/`after`, `diff`, `patch`) and file editing tool calls (`Edit`, `edit_file`, `str_replace_editor`, `write_file`).
- **Syntax-Styled UI**: Clean diff visualization with green addition gutters (`+`), red deletion gutters (`-`), file headers, and addition/deletion count badges.
- **Diff Truncation Protection**: Intelligently truncates diffs exceeding 300 lines to preserve viewer performance and responsiveness.

#### Usability & Quick Wins
- **Structured `traces diff` Terminal Output**: Redesigned terminal diff comparator with clean tabular alignment (`METRIC`, `SESSION A`, `SESSION B`, `DELTA`) and color-coded status deltas.
- **Configurable Payload Truncation**: Added `--truncate <number>` option in CLI and supported `TRACEEVAL_MAX_PAYLOAD` environment variable to give users direct control over event payload size boundaries.
- **Consistent Agent Installation**: Unified flags and descriptions across all 7 supported agents in `traceeval install`.
- **Expanded Test Suite**: Added 9 new unit and integration tests covering visual diff computation, truncation, SSE server streaming, and REST API endpoints (167 tests passing across 24 test files).

---

## [0.0.2] - 2026-11-06

### Token Optimization, Extended Agent Support & Quality Improvements

#### Token Usage & Efficiency
- **Intelligent Payload Truncation**: Added `truncatePayload` helper that safely truncates oversized tool outputs (> 8KB) while preserving diagnostic heads and tails, keeping trace storage compact and preventing agent context window explosion.
- **Token-Conscious MCP Trace Retrieval**: Added `maxOutputLength` option in `get_trace` MCP tool (defaulting to 1000 characters per tool output) to prevent massive tool outputs from exhausting agent context tokens.
- **Optimized LLM-as-a-Judge**: Streamlined `buildTrajectoryContext` to cap verbose tool call sequences (summarizing intermediate steps when exceeding 20 steps) and condensed system prompts by 50% for lower input token overhead.
- **Zero-Token Deterministic Assertions**: Re-emphasized deterministic assertions (`file_contains`, `tests_pass`, `max_steps`, `cost_under`) as the primary zero-cost evaluation method.

#### SMART & DRY Architecture
- **Consolidated Shared Hook Infrastructure**: Extracted `src/hooks/common.ts` providing unified event ID generation (`createEventId`), safe JSON parsing (`safeJsonParse`), non-destructive atomic config file updater (`updateJsonFile`), and hook normalization (`normalizeHookType`).
- **Unified Multi-Agent Hook Dispatcher**: Updated `src/commands/hook.ts` to automatically detect agent payloads and route lifecycle events cleanly to agent-specific parsers.

#### Priority Agent Support
- **Cursor**:
  - Added native integration command `traceeval install cursor`.
  - Configures `.cursor/hooks.json` (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`), registers MCP server in `.cursor/mcp.json`, and writes `.cursor/rules/traceeval.mdc`.
  - Normalizes Cursor terminal executions and file edits into standard `TraceEvent` format.
- **Grok**:
  - Added `traceeval install grok` configuring `.grok/hooks.json` and `.grok/config.json`.
  - Added `parseGrokHookPayload` with automatic token usage extraction (`data.tokens`).
- **Grok Bot**:
  - Added `traceeval install grok-bot` (and alias `grokbot`).
  - Installs `.grok-bot/plugins/traceeval.js` bot middleware adapter to record automated bot actions and tool results.
- **OpenAI / ChatGPT App**:
  - Added `traceeval install openai` (and alias `chatgpt`).
  - Configures `.openai/hooks.json`, `.openai/config.json`, and `.openai/mcp.json`.
  - Normalizes OpenAI function calls (`tool_calls`), tool responses, and token usage into `TraceEvent`.
- **Antigravity**:
  - Added `traceeval install antigravity` (and alias `agy`).
  - Configures `.agents/hooks.json` (and `~/.gemini/config/hooks.json` when `--global`) registering `SessionStart`, `PreToolUse`, `PostToolUse`, and `Stop`.
  - Preserves any existing third-party hooks configured in the workspace.
- **Claude Code & OpenCode**:
  - Refactored to leverage shared hook utilities and safe payload truncation while maintaining backwards compatibility.

#### Test Coverage
- Expanded test suite from 129 to 158 tests passing across 22 test files, with dedicated test coverage for Cursor, Grok, Grok Bot, OpenAI, Antigravity, and token efficiency.

---

## [0.0.1] - 2026-11-06

### Initial Public Release — The "pytest + git blame" for AI Coding Agents

#### Core Capabilities
- **Local-First & Zero Native Addons**: Fast, privacy-respecting trace storage using streaming JSONL and Node's built-in `node:sqlite` with WAL mode pragmas and auto-quarantine self-healing.
- **Agent Hook Integrations**:
  - **Claude Code**: Zero-instrumentation lifecycle hooks for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` via `traceeval install claude`.
  - **OpenCode**: Plugin adapter supporting `onSessionStart`, `onToolExecute`, `onToolComplete`, `onFileChange`, and `onSessionEnd` via `traceeval install opencode`.
- **Golden Baseline & Regression Differencing**:
  - Save and bless known-good agent runs with `traceeval update-golden <test-name>` or `traceeval test --update-golden`.
  - Configurable drift limits in YAML specs: `max_step_increase`, `allowed_tools`, `disallowed_tools`, `max_duration_increase`, and `max_cost_increase`.
  - Side-by-side terminal comparator via `traceeval traces diff`.
- **Multi-Run Statistical Evaluation**:
  - Run tests multiple times with `--runs <N>` and `--min-success <threshold>` (e.g. `--runs 5 --min-success 80%`) to measure pass@k on non-deterministic models.
- **Assertion Engine**:
  - Deterministic assertions: `file_contains`, `file_exists`, `tests_pass`, `max_steps`, `tool_called`.
  - Extended safety assertions: `no_dangerous_commands` (destructive command blocking) and `cost_under` (dollar spend & token budgets).
  - Optional LLM-as-a-judge: `llm_judge` supporting local Ollama (`llama3`) and remote OpenAI-compatible endpoints with deterministic offline mock.
- **HTML Trace Viewer (`traceeval view`)**:
  - Zero-dependency, completely offline self-contained HTML report with timeline cards, event filters, input/output inspection, search, and golden comparison.
  - Built-in static HTTP server with `--serve`.
- **AGENTS.md Spec Linking (`traceeval specs`)**:
  - Connect YAML tests directly to `AGENTS.md` and `CLAUDE.md` headings with `spec: "AGENTS.md#Section"`.
  - CLI validator (`traceeval specs --validate`) ensuring headings are not broken or deleted.
- **Model Context Protocol (MCP) Server (`traceeval mcp`)**:
  - Exposes past execution traces, tool trajectories, golden baselines, and spec links over standard JSON-RPC 2.0 stdio for AI coding agents to introspect their own past runs.
- **CI & GitHub Actions**:
  - Turnkey GitHub Action (`action.yml`) with sticky PR commenting and `$GITHUB_STEP_SUMMARY` report generation.
  - Strict CI exit codes and `--ci` log mode.
