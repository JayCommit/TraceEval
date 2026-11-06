# Changelog

All notable changes to TraceEval will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2026-11-06

### Multi-Agent Live Arena & Intra-Line Token-Level Diff Highlighting

#### ⚔️ Multi-Agent Live Arena
- **Simultaneous Multi-Agent Live Trajectory View**: Added the ability to inspect multiple agent sessions side-by-side in real-time (e.g. Claude Code vs Cursor executing the same or competing tasks).
- **Dedicated `traceeval arena` CLI Command**:
  - `traceeval arena [sessionIds...]` automatically launches the real-time SSE streaming viewer server in Arena mode.
  - Automatically selects the two most recent runs if no specific session IDs are passed.
  - Accepts variadic arguments: `traceeval arena session-claude session-cursor` or `traceeval view session-1 session-2 --serve`.
- **Dynamic Head-to-Head Scoreboard**: Top-level comparison scoreboard calculating:
  - Step counts, runtime durations, dollar costs, total tokens, and files touched per agent.
  - Direct Head-to-Head Delta comparison highlighting efficiency differences and runtime speed advantages.
- **Independent Multi-Pane Columns**:
  - CSS Grid multi-column layout with agent-specific color branding (Claude, Cursor, OpenAI/ChatGPT, Grok, Grok Bot, Antigravity, OpenCode).
  - Per-pane status badges, live event counts, step counters, and independent search filters.
- **Real-Time Multi-Session SSE Streaming**: Server-Sent Events stream updates tagged with `sessionId`, appending new tool calls, diff cards, and step counts to the corresponding agent pane live without page refreshes.
- **Interactive Browser Controls**:
  - In-browser "Add Agent to Arena" dropdown populated from recent workspace traces to dynamically pin additional agents.
  - Pane unpin controls (`✕`) to remove agents on the fly.
  - Quick-switch "Compare in Arena" selector in single-session view allowing instant side-by-side transitions via `?sessions=id1,id2`.
- **Graceful Single-Session Fallback**: Automatically degrades to standard full-width single-session inspection when only one session is active.
- **Offline Static Arena Export**: `traceeval arena [sessionIds...] -o arena.html` exports self-contained offline arena reports for sharing and CI artifacts.

#### 🔍 Intra-Line / Token-Level Diff Highlighting
- **Word & Character-Level Diff Highlighting**: Changed lines now highlight the exact modified words and tokens within lines, rather than just highlighting full lines (`computeIntraLineDiff` in `src/viewer/diff.ts`).
- **Zero-Dependency LCS Token Differ**:
  - Tokenizes lines preserving all whitespace and delimiters.
  - Computes Longest Common Subsequence on changed middle tokens while preserving common prefixes and suffixes.
  - Prevents noisy whole-line highlighting when two lines share minimal similarity.
- **Split & Unified View Parity**: Integrated across both Side-by-Side Split View and Unified Diff View.
- **High-Contrast Dark Theme Aesthetics**: Styled with `.diff-word-del` and `.diff-word-add` high-contrast badges matching GitHub and VS Code diff editors.
- **Truncation & Line Number Preservation**: Preserves exact unified diff hunk line numbering and large-diff safety guards (> 300 lines).
- **Full Offline & Live Support**: Operates identically in static HTML exports and live SSE streaming mode.

#### 🛠 Architecture & Performance Polish
- **Shared Stylesheet Extraction**: Extracted `src/viewer/styles.ts` (`VIEWER_CSS`), eliminating hundreds of lines of duplicated CSS between single and arena views.
- **Traces Directory Watcher**: Added directory watching on `.traceeval/traces` so newly started agent sessions are detected and streamed live without restarting the viewer server.
- **REST API Endpoint (`/api/sessions`)**: Added `/api/sessions` returning recent session metadata to power dynamic UI selectors.
- **Expanded Test Suite**: Added 11 new unit and integration tests across intra-line diff highlights, multi-agent arena layout, dynamic query parameter switching, and CLI commands (181 tests passing across 24 test files).

---

## [0.0.4] - 2026-11-06

### Side-by-Side Diffs, Remote Streaming & Architecture Hardening

#### Side-by-Side File Diffs
- **Split View Layout**: Added a clean two-column side-by-side diff view with deletions on the left and additions on the right, aligned line-by-line with accurate hunk line numbering.
- **Instant Split/Unified Toggle**: Added a pill toggle button group in the diff header allowing users to switch between Split view (default) and Unified view without page reloads.
- **Large Diff Truncation Protection**: Preserved truncation markers across both split and unified views for diffs exceeding 300 lines to ensure browser responsiveness.
- **Full Offline & Live Support**: Functions identically in standalone static HTML exports and live SSE streaming mode.

#### Remote & Multi-Host Live Streaming
- **Configurable Host Binding (`--host`)**: Added `--host <host>` and `-H` option (plus `TRACEEVAL_HOST` environment variable) allowing the viewer server to bind to `0.0.0.0` for remote dev setups (Tailscale, LAN, cloud instances, Docker).
- **Safe Localhost Default**: Default host remains strictly `127.0.0.1` (localhost only) to protect private agent traces and avoid unintended network exposure.
- **Optional Access Token Authentication (`--token`)**: Added lightweight zero-dependency token authentication (`--token <secret>` or `TRACEEVAL_TOKEN`), requiring `?token=<secret>` or `Authorization: Bearer <secret>` when exposed remotely.
- **Remote Development Documentation**: Documented best practices including SSH port forwarding (`ssh -L 4242:localhost:4242 user@remote-box`) and security notes.

#### Bug Fixes & Reliability Improvements
- **Multi-Run Golden Update Integrity**: Fixed an edge case where intermediate passing runs would bless a golden baseline even when the multi-run suite ultimately failed to meet the required pass threshold (`passThresholdMet === false`). Blessing is now strictly deferred until threshold verification succeeds.
- **Cross-Agent Lifecycle Hook Parity**:
  - Added missing `file_change` parsing support across Claude, OpenAI / ChatGPT, Antigravity, and Grok Bot.
  - Added missing `session_start` and `session_end` alias normalization in Claude Code hooks.
  - Added `UserPrompt` lifecycle registration to Antigravity configuration.
- **Terminal Golden Diff Cost Alignment**: Fixed a visual bug in `printGoldenDiffView` where the literal string `"Current"` was printed under the CURRENT column instead of the numeric cost value.
- **Accurate Tool Call Deduplication**: Improved `getDistinctToolCalls` to ensure uncompleted/interrupted tool calls (status: "started") without `toolUseId` are preserved and counted accurately rather than dropped.
- **Payload Truncation Boundary Safety**: Hardened `truncatePayload` with minimum limit guards to prevent negative slicing anomalies in edge cases.
- **Expanded Test Suite**: Added 13 new unit and integration tests across split diffs, remote viewer authentication, and multi-run golden integrity (180 tests passing across 24 test files).

---

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
