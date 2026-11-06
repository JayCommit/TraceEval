import readline from "node:readline";
import path from "node:path";
import { StorageManager } from "../storage/index.js";
import { compareTraces, compareWithGolden } from "../engine/differencer.js";
import { getProjectTestSpecs } from "../engine/specs.js";

export class McpServer {
  private storage: StorageManager;
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
    this.storage = new StorageManager({
      baseDir: path.join(this.workspaceDir, ".traceeval"),
    });
  }

  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const request = JSON.parse(trimmed);
        const response = await this.handleMessage(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: `Parse error: ${errorMsg}` },
          }) + "\n"
        );
      }
    });

    // Handle close
    rl.on("close", () => {
      this.storage.close();
      process.exit(0);
    });
  }

  private async handleMessage(msg: Record<string, any>): Promise<Record<string, any> | null> {
    const { id, method, params } = msg;

    // Handle notifications (no response needed)
    if (!id && method) {
      return null;
    }

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "traceeval-mcp",
              version: "0.0.1",
            },
            capabilities: {
              tools: {},
            },
          },
        };

      case "ping":
        return {
          jsonrpc: "2.0",
          id,
          result: {},
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "list_traces",
                description: "List recent recorded agent execution traces in the workspace with step counts and timestamps",
                inputSchema: {
                  type: "object",
                  properties: {
                    limit: { type: "number", description: "Maximum number of traces to return (default: 15)" },
                  },
                },
              },
              {
                name: "get_trace",
                description: "Get detailed event trajectory, tool calls, and metrics for a specific trace session ID",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId: { type: "string", description: "The session ID of the trace (or 'latest')" },
                  },
                  required: ["sessionId"],
                },
              },
              {
                name: "list_golden_baselines",
                description: "List all known-good golden baselines for regression tests",
                inputSchema: {
                  type: "object",
                  properties: {},
                },
              },
              {
                name: "get_golden_baseline",
                description: "Get details, step budget, and tool call breakdown for a specific golden baseline",
                inputSchema: {
                  type: "object",
                  properties: {
                    testName: { type: "string", description: "The name of the test" },
                  },
                  required: ["testName"],
                },
              },
              {
                name: "compare_traces",
                description: "Compare two trace sessions or compare a trace against a golden baseline to inspect tool drift and step inflation",
                inputSchema: {
                  type: "object",
                  properties: {
                    sessionId1: { type: "string", description: "Session ID of the current run" },
                    sessionId2: { type: "string", description: "Session ID of the second run (optional if goldenTest is given)" },
                    goldenTest: { type: "string", description: "Name of the golden baseline to compare against" },
                  },
                  required: ["sessionId1"],
                },
              },
              {
                name: "list_specs",
                description: "List all evaluation tests and their linked AGENTS.md / CLAUDE.md spec sections",
                inputSchema: {
                  type: "object",
                  properties: {},
                },
              },
            ],
          },
        };

      case "tools/call": {
        const toolName = params?.name;
        const args = params?.arguments || {};
        const toolResult = await this.executeTool(toolName, args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2),
              },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  }

  private async executeTool(name: string, args: Record<string, any>): Promise<unknown> {
    switch (name) {
      case "list_traces": {
        const limit = Number(args.limit) || 15;
        const sessions = this.storage.listSessions(limit);
        return {
          count: sessions.length,
          sessions,
        };
      }

      case "get_trace": {
        const sid = args.sessionId === "latest"
          ? this.storage.getLatestSession()?.id
          : args.sessionId;

        if (!sid) {
          return { error: "No trace session found" };
        }

        const session = this.storage.getSession(sid);
        if (!session) {
          return { error: `Trace session '${sid}' not found` };
        }

        const toolCalls = session.events
          .filter((e) => e.type === "tool_call" || e.type === "tool_call_start")
          .map((e) => ({
            type: e.type,
            tool: e.data?.toolName || e.data?.tool,
            input: e.data?.input,
            output: e.data?.output,
            status: e.data?.status,
            durationMs: e.data?.durationMs,
          }));

        return {
          id: session.id,
          agent: session.agent,
          status: session.status,
          startTime: session.startTime,
          endTime: session.endTime,
          durationMs: session.durationMs,
          command: session.command,
          prompt: session.prompt,
          stepCount: toolCalls.length,
          toolCalls,
        };
      }

      case "list_golden_baselines": {
        const goldens = this.storage.listGoldens();
        return {
          count: goldens.length,
          baselines: goldens,
        };
      }

      case "get_golden_baseline": {
        const golden = this.storage.getGolden(args.testName);
        if (!golden) {
          return { error: `Golden baseline '${args.testName}' not found` };
        }
        return golden;
      }

      case "compare_traces": {
        const s1 = this.storage.getSession(args.sessionId1);
        if (!s1) {
          return { error: `Session '${args.sessionId1}' not found` };
        }

        if (args.goldenTest) {
          const golden = this.storage.getGolden(args.goldenTest);
          if (!golden) {
            return { error: `Golden baseline '${args.goldenTest}' not found` };
          }
          const diff = compareWithGolden(s1, golden);
          return {
            comparison: "golden",
            currentSessionId: s1.id,
            goldenTest: args.goldenTest,
            diff,
          };
        }

        if (args.sessionId2) {
          const s2 = this.storage.getSession(args.sessionId2);
          if (!s2) {
            return { error: `Session '${args.sessionId2}' not found` };
          }
          const diff = compareTraces(s1, s2);
          return {
            comparison: "two_traces",
            session1: s1.id,
            session2: s2.id,
            diff,
          };
        }

        return { error: "Either sessionId2 or goldenTest must be provided" };
      }

      case "list_specs": {
        const mappings = getProjectTestSpecs(undefined, this.workspaceDir);
        return {
          count: mappings.length,
          specs: mappings,
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}
