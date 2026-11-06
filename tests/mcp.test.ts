import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { McpServer } from "../src/mcp/server.js";
import { StorageManager } from "../src/storage/index.js";

describe("Model Context Protocol (MCP) Server", () => {
  let tmpDir: string;
  let server: McpServer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traceeval-mcp-test-"));
    const storage = new StorageManager({ baseDir: path.join(tmpDir, ".traceeval") });

    // Seed test session
    storage.upsertSession({
      id: "mcp-session-1",
      agent: "claude-code",
      command: "claude -p 'refactor'",
      status: "completed",
    });

    storage.recordEvent({
      id: "evt-mcp-1",
      sessionId: "mcp-session-1",
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agent: "claude-code",
      data: {
        toolName: "Edit",
        input: { path: "src/main.ts" },
        status: "success",
      },
    });

    storage.close();
    server = new McpServer(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should respond to initialize handshake with protocol and capabilities", async () => {
    // Access private handleMessage via any for test invocation
    const response = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "test-client" } },
    });

    expect(response).not.toBeNull();
    expect(response.id).toBe(1);
    expect(response.result.serverInfo.name).toBe("traceeval-mcp");
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.capabilities.tools).toBeDefined();
  });

  it("should list available tools under tools/list", async () => {
    const response = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(response.id).toBe(2);
    const tools = response.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain("list_traces");
    expect(toolNames).toContain("get_trace");
    expect(toolNames).toContain("list_golden_baselines");
    expect(toolNames).toContain("compare_traces");
    expect(toolNames).toContain("list_specs");
  });

  it("should execute tools via tools/call", async () => {
    // 1. list_traces
    const listTracesRes = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "list_traces",
        arguments: { limit: 5 },
      },
    });

    expect(listTracesRes.result.content[0].type).toBe("text");
    const parsedList = JSON.parse(listTracesRes.result.content[0].text);
    expect(parsedList.sessions).toBeDefined();

    // 2. get_trace
    const getTraceRes = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_trace",
        arguments: { sessionId: "mcp-session-1" },
      },
    });

    const parsedTrace = JSON.parse(getTraceRes.result.content[0].text);
    expect(parsedTrace.id).toBe("mcp-session-1");
    expect(parsedTrace.toolCalls).toHaveLength(1);
    expect(parsedTrace.toolCalls[0].tool).toBe("Edit");
  });

  it("should return method not found for unknown methods", async () => {
    const response = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 99,
      method: "nonexistent_method",
    });

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32601);
  });

  it("should handle tool execution errors gracefully", async () => {
    // 1. Unknown tool
    const unknownToolRes = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "invalid_tool", arguments: {} },
    });
    const parsedUnknown = JSON.parse(unknownToolRes.result.content[0].text);
    expect(parsedUnknown.error).toContain("Unknown tool: invalid_tool");

    // 2. Non-existent trace
    const nonexistentTraceRes = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "get_trace", arguments: { sessionId: "missing-id" } },
    });
    const parsedTrace = JSON.parse(nonexistentTraceRes.result.content[0].text);
    expect(parsedTrace.error).toContain("Trace session 'missing-id' not found");

    // 3. Non-existent golden baseline
    const missingGoldenRes = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_golden_baseline", arguments: { testName: "missing-test" } },
    });
    const parsedGolden = JSON.parse(missingGoldenRes.result.content[0].text);
    expect(parsedGolden.error).toContain("Golden baseline 'missing-test' not found");

    // 4. Compare traces missing second target
    const compareRes = await (server as any).handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "compare_traces", arguments: { sessionId1: "mcp-session-1" } },
    });
    const parsedCompare = JSON.parse(compareRes.result.content[0].text);
    expect(parsedCompare.error).toContain("Either sessionId2 or goldenTest must be provided");
  });
});
