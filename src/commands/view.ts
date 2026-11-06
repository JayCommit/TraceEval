import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import { generateTraceHtml, generateArenaHtml, renderEventCardHtml } from "../viewer/html.js";
import { compareWithGolden } from "../engine/differencer.js";
import { TraceEvent, TraceSession } from "../types/index.js";
import { computeWebSocketAccept, TraceWebSocketClient } from "../viewer/websocket.js";
import {
  pauseSession,
  resumeSession,
  abortSession,
  injectPrompt,
} from "../engine/control.js";

export interface ViewOptions {
  latest?: boolean;
  output?: string;
  serve?: boolean;
  host?: string;
  port?: number | string;
  token?: string;
  golden?: string;
  openBrowser?: boolean;
  sessions?: string[];
  arena?: boolean;
}

/**
 * Creates an HTTP server supporting real-time Server-Sent Events (SSE) trace streaming
 * for both single agent inspection and multi-agent live arena views.
 */
export function createViewerServer(
  storage: StorageManager,
  sessionIdOrIds: string | string[],
  options: { golden?: string; token?: string } = {}
): { server: http.Server; close: () => void } {
  const clients = new Set<http.ServerResponse>();
  const wsClients = new Set<TraceWebSocketClient>();
  const sentEventIds = new Set<string>();

  const targetIds: string[] = Array.isArray(sessionIdOrIds)
    ? sessionIdOrIds.map((s) => s.trim()).filter(Boolean)
    : [sessionIdOrIds.trim()];

  // Track initial sessions
  const initialSessions: Record<string, TraceSession> = {};
  for (const id of targetIds) {
    const s = storage.getSession(id);
    if (s) {
      initialSessions[id] = s;
      for (const evt of s.events) {
        sentEventIds.add(evt.id);
      }
    }
  }

  // Watch individual session JSONL files
  const watchedFiles = new Map<string, () => void>();

  const watchSessionFile = (sid: string) => {
    const jsonlPath = storage.jsonl.getSessionFilePath(sid);
    if (watchedFiles.has(jsonlPath)) return;

    const listener = () => {
      if (!fs.existsSync(jsonlPath)) return;
      try {
        const allEvents = storage.jsonl.readEvents(sid);
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
      fs.watchFile(jsonlPath, { interval: 200 }, listener);
      watchedFiles.set(jsonlPath, listener);
    }
  };

  for (const id of targetIds) {
    watchSessionFile(id);
  }

  // Also watch traces directory for newly created sessions
  let dirWatcher: fs.FSWatcher | null = null;
  const tracesDir = path.join(storage.baseDir, "traces");
  if (fs.existsSync(tracesDir)) {
    try {
      dirWatcher = fs.watch(tracesDir, (eventType, filename) => {
        if (filename && filename.endsWith(".jsonl")) {
          const sid = filename.slice(0, -6);
          watchSessionFile(sid);
        }
      });
    } catch {
      // Ignore directory watch errors
    }
  }

  function broadcastEvent(evt: TraceEvent, index: number): void {
    const cardHtml = renderEventCardHtml(evt, index);
    const payload = JSON.stringify({
      id: evt.id,
      sessionId: evt.sessionId,
      agent: evt.agent,
      type: evt.type,
      timestamp: evt.timestamp,
      data: evt.data,
      html: cardHtml,
    });

    // 1. Server-Sent Events stream broadcast
    const sseMessage = `event: trace_event\ndata: ${payload}\n\n`;
    for (const client of clients) {
      try {
        client.write(sseMessage);
      } catch {
        clients.delete(client);
      }
    }

    // 2. WebSocket bidirectional stream broadcast
    const wsMessage = JSON.stringify({
      event: "trace_event",
      data: {
        id: evt.id,
        sessionId: evt.sessionId,
        agent: evt.agent,
        type: evt.type,
        timestamp: evt.timestamp,
        data: evt.data,
        html: cardHtml,
      },
    });
    for (const ws of wsClients) {
      if (!ws.isAlive || ws.socket.destroyed) {
        wsClients.delete(ws);
        continue;
      }
      try {
        ws.send(wsMessage);
      } catch {
        wsClients.delete(ws);
      }
    }
  }

  function handleControlAction(
    action: string,
    targetSessionId: string,
    message?: string
  ): { success: boolean; action: string; sessionId: string; status?: string; error?: string } {
    const rawSid = targetSessionId || targetIds[0] || "session";
    const sid = rawSid.replace(/[^a-zA-Z0-9_-]/g, "_");
    const s = storage.getSession(sid);
    const agent = s?.agent || "agent";

    if (action === "pause") {
      const res = pauseSession(sid, storage.baseDir);
      const pauseEvt: TraceEvent = {
        id: `evt-ctrl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId: sid,
        timestamp: new Date().toISOString(),
        type: "session_pause",
        agent,
        data: { action: "pause", source: "viewer_control" },
      };
      storage.recordEvent(pauseEvt);
      storage.upsertSession({ id: sid, status: "paused" });
      return { success: res.success, action: "pause", sessionId: sid, status: "paused", error: res.error };
    } else if (action === "resume") {
      const res = resumeSession(sid, storage.baseDir);
      const resumeEvt: TraceEvent = {
        id: `evt-ctrl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId: sid,
        timestamp: new Date().toISOString(),
        type: "session_resume",
        agent,
        data: { action: "resume", source: "viewer_control" },
      };
      storage.recordEvent(resumeEvt);
      storage.upsertSession({ id: sid, status: "active" });
      return { success: res.success, action: "resume", sessionId: sid, status: "active", error: res.error };
    } else if (action === "abort") {
      const res = abortSession(sid, storage.baseDir);
      storage.upsertSession({
        id: sid,
        status: "aborted",
        endTime: new Date().toISOString(),
      });
      const abortEvt: TraceEvent = {
        id: `evt-ctrl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId: sid,
        timestamp: new Date().toISOString(),
        type: "session_abort",
        agent,
        data: { action: "abort", source: "viewer_control" },
      };
      storage.recordEvent(abortEvt);
      return { success: res.success, action: "abort", sessionId: sid, status: "aborted", error: res.error };
    } else if (action === "inject") {
      const promptText = (message || "").trim();
      const res = injectPrompt(sid, promptText, storage.baseDir);
      const promptEvt: TraceEvent = {
        id: `evt-ctrl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId: sid,
        timestamp: new Date().toISOString(),
        type: "injected_prompt",
        agent,
        data: { prompt: promptText, source: "viewer_control" },
      };
      storage.recordEvent(promptEvt);
      return { success: res.success, action: "inject", sessionId: sid, error: res.error };
    }

    return { success: false, action, sessionId: sid, error: `Unknown action '${action}'` };
  }

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url || "/", "http://localhost");
    const pathname = urlObj.pathname;

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    // Optional token authentication check (opt-in for remote exposure)
    const requiredToken = options.token || process.env.TRACEEVAL_TOKEN;
    if (requiredToken) {
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
      const queryToken = urlObj.searchParams.get("token");

      if (queryToken !== requiredToken && bearerToken !== requiredToken) {
        res.writeHead(401, {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(
          `<!DOCTYPE html><html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0d1117; color: #f85149; padding: 48px; text-align: center;">` +
          `<h2>🔒 401 Unauthorized</h2>` +
          `<p style="color: #c9d1d9; margin-top: 12px;">A valid access token is required to inspect this trace session.</p>` +
          `<p style="color: #8b949e; font-size: 13px; margin-top: 8px;">Append <code>?token=&lt;your-token&gt;</code> to the URL or provide an Authorization header.</p>` +
          `</body></html>`
        );
        return;
      }
    }

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

    // 2. REST API endpoint: /api/control (bidirectional pause/resume/abort/inject)
    if (pathname === "/api/control" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const result = handleControlAction(parsed.action, parsed.sessionId, parsed.message);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ success: false, error: "Invalid JSON control request" }));
        }
      });
      return;
    }

    // 3. REST API endpoint: /api/sessions (list available sessions)
    if (pathname === "/api/sessions") {
      const allSessions = storage.listSessions(50);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(allSessions));
      return;
    }

    // 4. REST API endpoint: /api/session (specific session data)
    if (pathname === "/api/session") {
      const requestedId = urlObj.searchParams.get("id") || targetIds[0];
      const current = storage.getSession(requestedId);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(current || null));
      return;
    }

    // 4. Main HTML view: /
    // Check if multiple sessions are requested via ?sessions=id1,id2
    const querySessions = urlObj.searchParams
      .get("sessions")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const activeIds = querySessions && querySessions.length > 0 ? querySessions : targetIds;

    // Ensure watchers for active sessions
    for (const sid of activeIds) {
      watchSessionFile(sid);
    }

    const activeSessions: TraceSession[] = [];
    for (const sid of activeIds) {
      const s = storage.getSession(sid) || initialSessions[sid];
      if (s) activeSessions.push(s);
    }

    if (activeSessions.length === 0) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Session(s) not found");
      return;
    }

    const sessionsList = storage.listSessions(20);

    // Multi-Agent Arena Mode
    if (activeSessions.length > 1) {
      const htmlContent = generateArenaHtml(activeSessions, {
        sessionsList,
        isLive: true,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
      return;
    }

    // Single-Session View
    const singleSession = activeSessions[0];
    let golden = null;
    let diff = null;
    const goldenName = options.golden || (singleSession.metadata?.testName as string);
    if (goldenName) {
      golden = storage.getGolden(goldenName);
      if (golden) {
        diff = compareWithGolden(singleSession, golden);
      }
    }

    const htmlContent = generateTraceHtml(singleSession, {
      golden,
      diff,
      sessionsList,
      isLive: true,
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(htmlContent);
  });

  // Handle bidirectional WebSocket upgrades on /ws or /events
  server.on("upgrade", (req, socket, head) => {
    const urlObj = new URL(req.url || "/", "http://localhost");
    const pathname = urlObj.pathname;

    if (pathname !== "/ws" && pathname !== "/events") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // Token auth check
    const requiredToken = options.token || process.env.TRACEEVAL_TOKEN;
    if (requiredToken) {
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
      const queryToken = urlObj.searchParams.get("token");

      if (queryToken !== requiredToken && bearerToken !== requiredToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    const secKey = req.headers["sec-websocket-key"] as string | undefined;
    if (!secKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const acceptKey = computeWebSocketAccept(secKey);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );

    const wsClient = new TraceWebSocketClient(socket);
    wsClients.add(wsClient);

    wsClient.on("error", () => {
      wsClients.delete(wsClient);
    });

    wsClient.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg && msg.action && msg.sessionId) {
          const result = handleControlAction(msg.action, msg.sessionId, msg.message);
          wsClient.send(JSON.stringify({ type: "control_ack", ...result }));
        }
      } catch {
        // Ignore
      }
    });

    wsClient.on("close", () => {
      wsClients.delete(wsClient);
    });
  });

  return {
    server,
    close: () => {
      for (const [filePath, listener] of watchedFiles) {
        try {
          fs.unwatchFile(filePath, listener);
        } catch {
          // Ignore
        }
      }
      watchedFiles.clear();

      if (dirWatcher) {
        try {
          dirWatcher.close();
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

      for (const ws of wsClients) {
        try {
          ws.close();
        } catch {
          // Ignore
        }
      }
      wsClients.clear();

      server.close();
    },
  };
}

export async function runView(
  sessionIdOrIds?: string | string[],
  options: ViewOptions = {}
): Promise<void> {
  const storage = new StorageManager();

  let targetIds: string[] = [];
  if (Array.isArray(sessionIdOrIds)) {
    targetIds = sessionIdOrIds.map((s) => s.trim()).filter(Boolean);
  } else if (typeof sessionIdOrIds === "string" && sessionIdOrIds.trim().length > 0) {
    targetIds = sessionIdOrIds.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (options.sessions && options.sessions.length > 0) {
    for (const s of options.sessions) {
      targetIds.push(...s.split(",").map((x) => x.trim()).filter(Boolean));
    }
  }
  targetIds = Array.from(new Set(targetIds));

  // If arena mode requested but fewer than 2 sessions specified, grab recent 2 sessions
  if (options.arena && targetIds.length < 2) {
    const recent = storage.listSessions(2);
    targetIds = recent.map((s) => s.id);
    if (targetIds.length === 0) {
      console.log(pc.yellow("No recorded traces found. Record a session first with:"));
      console.log(`  ${pc.cyan("traceeval record -- <command>")}`);
      return;
    }
  }

  if (targetIds.length === 0 || options.latest) {
    const latest = storage.getLatestSession();
    if (!latest) {
      console.log(pc.yellow("No recorded traces found. Record a session first with:"));
      console.log(`  ${pc.cyan("traceeval record -- <command>")}`);
      return;
    }
    targetIds = [latest.id];
  }

  // Load and validate sessions
  const sessions: TraceSession[] = [];
  for (const id of targetIds) {
    const s = storage.getSession(id);
    if (!s) {
      console.error(pc.red(`Trace session '${id}' not found.`));
      process.exit(1);
    }
    sessions.push(s);
  }

  // Determine output mode
  if (options.serve) {
    const host = options.host || process.env.TRACEEVAL_HOST || "127.0.0.1";
    const port = Number(options.port || process.env.TRACEEVAL_PORT) || 4242;
    const token = options.token || process.env.TRACEEVAL_TOKEN;

    const { server } = createViewerServer(storage, targetIds, {
      golden: options.golden,
      token,
    });

    server.listen(port, host, () => {
      const isAllInterfaces = host === "0.0.0.0" || host === "::";
      const displayHost = isAllInterfaces ? "localhost" : host;
      const tokenParam = token ? `token=${encodeURIComponent(token)}` : "";
      const sessionsParam = sessions.length > 1 ? `sessions=${sessions.map((s) => s.id).join(",")}` : "";
      const queryParts = [sessionsParam, tokenParam].filter(Boolean).join("&");
      const queryStr = queryParts ? `?${queryParts}` : "";
      const localUrl = `http://${displayHost}:${port}/${queryStr}`;

      console.log("");
      if (sessions.length > 1) {
        console.log(pc.bold(pc.cyan("TraceEval Multi-Agent Live Arena ⚔️ (Real-Time SSE Stream)")));
        console.log(pc.dim("─".repeat(65)));
        console.log(`  Agents:     ${sessions.map((s) => `${pc.bold(s.agent)} (${pc.dim(s.id)})`).join(" vs ")}`);
        console.log(`  Arena URL:  ${pc.bold(pc.underline(pc.cyan(localUrl)))}`);
      } else {
        console.log(pc.bold(pc.cyan("TraceEval HTML Viewer Live (Real-Time SSE Stream)")));
        console.log(pc.dim("─".repeat(60)));
        console.log(`  Session:    ${pc.green(sessions[0].id)} (${sessions[0].agent})`);
        console.log(`  URL:        ${pc.bold(pc.underline(pc.cyan(localUrl)))}`);
      }
      console.log(`  Bound Host: ${pc.yellow(host)} (port ${port})`);
      if (isAllInterfaces) {
        console.log(`  Remote:     ${pc.green("Enabled (accessible across LAN / Tailscale / network)")}`);
        console.log(`  Security:   ${token ? pc.green("Protected by access token") : pc.yellow("Unauthenticated (opt-in bind to all interfaces)")}`);
      } else {
        console.log(`  Security:   ${pc.green("Localhost only (safe)")}`);
        console.log(`  Remote dev: ${pc.dim(`SSH port forwarding: ssh -L ${port}:localhost:${port} user@host`)}`);
      }
      console.log(`  Status:     ${pc.green("Streaming live events without page refreshes")}`);
      console.log(pc.dim("─".repeat(60)));
      console.log(pc.dim("Press Ctrl+C to stop the server."));

      if (options.openBrowser !== false && !isAllInterfaces) {
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
            ? "start"
            : "xdg-open";
        exec(`${openCmd} "${localUrl}"`, () => {});
      }
    });
  } else {
    // Write to static file
    const sessionsList = storage.listSessions(20);
    let htmlContent: string;
    let defaultFileName: string;

    if (sessions.length > 1) {
      htmlContent = generateArenaHtml(sessions, {
        sessionsList,
        isLive: false,
      });
      defaultFileName = `arena-${sessions.map((s) => s.id).join("-vs-")}.html`;
    } else {
      let golden = null;
      let diff = null;
      const goldenName = options.golden || (sessions[0].metadata?.testName as string);
      if (goldenName) {
        golden = storage.getGolden(goldenName);
        if (golden) {
          diff = compareWithGolden(sessions[0], golden);
        }
      }
      htmlContent = generateTraceHtml(sessions[0], {
        golden,
        diff,
        sessionsList,
        isLive: false,
      });
      defaultFileName = `trace-${sessions[0].id}.html`;
    }

    const outputPath = options.output
      ? path.resolve(process.cwd(), options.output)
      : path.resolve(process.cwd(), ".traceeval", defaultFileName);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, htmlContent, "utf-8");

    console.log("");
    if (sessions.length > 1) {
      console.log(pc.bold(pc.green("✔ Multi-Agent Arena HTML Viewer generated:")));
      console.log(`  File:    ${pc.cyan(outputPath)}`);
      console.log(`  Agents:  ${sessions.map((s) => `${s.agent} (${s.id})`).join(" vs ")}`);
    } else {
      console.log(pc.bold(pc.green("✔ Trace HTML Viewer generated:")));
      console.log(`  File:    ${pc.cyan(outputPath)}`);
      console.log(`  Session: ${pc.dim(sessions[0].id)}`);
    }
    console.log("");
    console.log(`Open in browser:`);
    console.log(
      `  ${pc.dim(`open "${outputPath}"`)} or stream live with ${pc.cyan(
        `traceeval view ${sessions.map((s) => s.id).join(" ")} --serve`
      )}`
    );
    console.log("");
  }
}
