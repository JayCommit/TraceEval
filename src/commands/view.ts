import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";
import pc from "picocolors";
import { StorageManager } from "../storage/index.js";
import { generateTraceHtml } from "../viewer/html.js";
import { compareWithGolden } from "../engine/differencer.js";

export interface ViewOptions {
  latest?: boolean;
  output?: string;
  serve?: boolean;
  port?: number | string;
  golden?: string;
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

  const sessionsList = storage.listSessions(10);
  const htmlContent = generateTraceHtml(session, {
    golden,
    diff,
    sessionsList,
  });

  // Determine output mode
  if (options.serve) {
    const port = Number(options.port) || 4242;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlContent);
    });

    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log("");
      console.log(pc.bold(pc.cyan("TraceEval HTML Viewer Live")));
      console.log(pc.dim("─".repeat(50)));
      console.log(`  Session: ${pc.green(targetId)}`);
      console.log(`  URL:     ${pc.bold(pc.underline(pc.cyan(url)))}`);
      console.log(pc.dim("─".repeat(50)));
      console.log(pc.dim("Press Ctrl+C to stop the server."));

      // Try opening browser automatically if display available
      const openCmd = process.platform === "darwin" ? "open" : (process.platform === "win32" ? "start" : "xdg-open");
      exec(`${openCmd} "${url}"`, () => {});
    });
  } else {
    // Write to static file
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
    console.log(`  ${pc.dim(`open "${outputPath}"`)} or run with ${pc.cyan(`traceeval view ${targetId} --serve`)}`);
    console.log("");
  }
}
