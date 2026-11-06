import { McpServer } from "../mcp/server.js";

export function runMcpServer(): void {
  const server = new McpServer(process.cwd());
  server.start();
}
