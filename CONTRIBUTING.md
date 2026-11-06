# Contributing to TraceEval

Thank you for your interest in contributing to TraceEval — the open-source "pytest + git blame" for AI coding agents!

## Principles

1. **Local-First & Privacy-Respecting**: Traces stay on the machine. No mandatory cloud dependencies.
2. **Minimal & Zero Native Addons**: Use Node.js built-ins (`node:sqlite`, `node:http`) to avoid heavy C++ compilation toolchain issues.
3. **Strict TypeScript Quality**: 100% strict ESM (`NodeNext`), zero loose `any` types, zero compiler warnings.
4. **Deterministic First**: Prioritize fast, deterministic verification over non-deterministic or slow cloud calls.

---

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/JayCommit/TraceEval.git
   cd TraceEval
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   *(Requires Node.js >= 22.0.0)*

3. **Build the CLI**:
   ```bash
   npm run build
   ```

4. **Run the test suite**:
   ```bash
   npm test
   ```

---

## Code Organization

- `src/types/`: Zod schemas and TypeScript interfaces (events, sessions, tests, goldens, assertions).
- `src/storage/`: Dual storage engine (`jsonl.ts`, `sqlite.ts`, `golden.ts`, `index.ts`).
- `src/hooks/`: Agent adapters (`claude.ts`, `opencode.ts`, `session.ts`).
- `src/engine/`: Assertions (`assertions/`), YAML loader (`loader.ts`), test runner (`runner.ts`), differencing engine (`differencer.ts`), spec validator (`specs.ts`).
- `src/reporters/`: Terminal reporter (`terminal.ts`) and GitHub Markdown reporter (`markdown.ts`).
- `src/viewer/`: Offline HTML trace viewer (`html.ts`).
- `src/mcp/`: Model Context Protocol server (`server.ts`).
- `src/commands/`: CLI command implementations (`init`, `install`, `record`, `hook`, `test`, `golden`, `traces`, `view`, `specs`, `mcp`).

---

## Adding an Assertion

To add a new assertion primitive:
1. Define its schema in `src/types/index.ts` and add it to `AssertionSchema`.
2. Implement the checker function in `src/engine/assertions/<name>.ts`.
3. Wire the checker into `evaluateAssertion` in `src/engine/assertions/index.ts`.
4. Export the checker in `src/index.ts`.
5. Add unit tests in `tests/assertions.test.ts`.

---

## Pull Request Guidelines

- Ensure `npm run build` and `npm test` pass cleanly.
- Keep commits descriptive and atomic.
- Update documentation in `README.md` and `AGENTS.md` when introducing new commands or assertions.
