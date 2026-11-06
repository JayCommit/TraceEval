import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";
import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import { generateTraceHtml, renderEventCardHtml } from "../viewer/html.js";
import { compareWithGolden } from "../engine/differencer.js";
import { TraceEvent } from "../types/index.js";

export interface ViewOptions {
  latest?: boolean;
  output?: string;
  serve?: boolean;
  port?: number | string;
  golden?: string;
  openBrowser?: boolean;
}

/**
 * Creates an HTTP server supporting real-time Server-Sent Events (SSE) trace streaming.
 */
export function createViewerServer(
  storage: StorageManager,
  sessionId: string,
  options: { golden?: string } = {}
): { server: http.Server; close: () => void } {
  const clients = new Set<http.ServerResponse>();
  const sentEventIds = new Set<string>();

  const initialSession = storage.getSession(sessionId);
  if (initialSession) {
    for (const evt of initialSession.events) {
      sentEventIds.add(evt.id);
    }
  }

  const jsonlPath = storage.jsonl.getSessionFilePath(sessionId);

  // File watcher for new events streaming into JSONL
  const fileListener = () => {
    if (!fs.existsSync(jsonlPath)) return;
    try {
      const allEvents = storage.jsonl.readEvents(sessionId);
      for (const evt of allEvents) {
        if (!sentEventIds.has(evt.id)) {
          sentEventIds.add(evt.id);
          broadcastEvent(evt, sentEventIds.size);
        }
      }
    } catch {
      // Non-blocking file reading
    }
  };

  if (fs.existsSync(jsonlPath)) {
    fs.watchFile(jsonlPath, { interval: 200 }, fileListener);
  }

  function broadcastEvent(evt: TraceEvent, index: number): void {
    const cardHtml = renderEventCardHtml(evt, index);
    const payload = JSON.stringify({
      id: evt.id,
      sessionId: evt.sessionId,
      type: evt.type,
      timestamp: evt.timestamp,
      data: evt.data,
      html: cardHtml,
    });

    const sseMessage = `event: trace_event\ndata: ${payload}\n\n`;
    for (const client of clients) {
      try {
        client.write(sseMessage);
      } catch {
        clients.delete(client);
      }
    }
  }

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url || "/", "http://localhost");
    const pathname = urlObj.pathname;

    // 1. SSE Stream endpoint: /events
    if (pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": connected\n\n");
      clients.add(res);

      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    // 2. REST API endpoint: /api/session
    if (pathname === "/api/session") {
      const current = storage.getSession(sessionId);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(current));
      return;
    }

    // 3. Main HTML view: /
    const session = storage.getSession(sessionId) || initialSession;
    if (!session) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Session not found");
      return;
    }

    let golden = null;
    let diff = null;
    const goldenName = options.golden || (session.metadata?.testName as string);
    if (goldenName) {
      golden = storage.getGolden(goldenName);
      if (golden) {
        diff = compareWithGolden(session, golden);
      }
    }

    const sessionsList = storage.listSessions(10);
    const htmlContent = generateTraceHtml(session, {
      golden,
      diff,
      sessionsList,
      isLive: true,
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlContent);
  });

  return {
    server,
    close: () => {
      if (fs.existsSync(jsonlPath)) {
        try {
          fs.unwatchFile(jsonlPath, fileListener);
        } catch {
          // Ignore
        }
      }
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // Ignore
        }
      }
      clients.clear();
      server.close();
    },
  };
}

export async function runView(
  sessionId?: string,
  options: ViewOptions = {}
): Promise<void> {
  const storage = new StorageManager();

  let targetId = sessionId;
  if (!targetId || options.latest) {
    const latest = storage.getLatestSession();
    if (!latest) {
      console.log(pc.yellow("No recorded traces found. Record a session first with:"));
      console.log(`  ${pc.cyan("traceeval record -- <command>")}`);
      return;
    }
    targetId = latest.id;
  }

  const session = storage.getSession(targetId);
  if (!session) {
    console.error(pc.red(`Trace session '${targetId}' not found.`));
    process.exit(1);
  }

  // Check for golden baseline
  let golden = null;
  let diff = null;
  const goldenName = options.golden || (session.metadata?.testName as string);
  if (goldenName) {
    golden = storage.getGolden(goldenName);
    if (golden) {
      diff = compareWithGolden(session, golden);
    }
  }

  // Determine output mode
  if (options.serve) {
    const port = Number(options.port) || 4242;
    const { server } = createViewerServer(storage, targetId, { golden: options.golden });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log("");
      console.log(pc.bold(pc.cyan("TraceEval HTML Viewer Live (Real-Time SSE Stream)")));
      console.log(pc.dim("─".repeat(55)));
      console.log(`  Session: ${pc.green(targetId)}`);
      console.log(`  URL:     ${pc.bold(pc.underline(pc.cyan(url)))}`);
      console.log(`  Status:  ${pc.green("Streaming live events without page refreshes")}`);
      console.log(pc.dim("─".repeat(55)));
      console.log(pc.dim("Press Ctrl+C to stop the server."));

      if (options.openBrowser !== false) {
        const openCmd = process.platform === "darwin" ? "open" : (process.platform === "win32" ? "start" : "xdg-open");
        exec(`${openCmd} "${url}"`, () => {});
      }
    });
  } else {
    // Write to static file
    const sessionsList = storage.listSessions(10);
    const htmlContent = generateTraceHtml(session, {
      golden,
      diff,
      sessionsList,
      isLive: false,
    });

    const outputPath = options.output
      ? path.resolve(process.cwd(), options.output)
      : path.resolve(process.cwd(), ".traceeval", `trace-${targetId}.html`);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, htmlContent, "utf-8");

    console.log("");
    console.log(pc.bold(pc.green("✔ Trace HTML Viewer generated:")));
    console.log(`  File:    ${pc.cyan(outputPath)}`);
    console.log(`  Session: ${pc.dim(targetId)}`);
    console.log("");
    console.log(`Open in browser:`);
    console.log(`  ${pc.dim(`open "${outputPath}"`)} or stream live with ${pc.cyan(`traceeval view ${targetId} --serve`)}`);
    console.log("");
  }
}
