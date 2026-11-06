# Changelog

All notable changes to TraceEval will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
