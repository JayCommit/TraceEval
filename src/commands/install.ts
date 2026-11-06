import pc from "picocolors";
import { installClaudeHooks } from "../hooks/claude.js";
import { installOpenCodePlugin } from "../hooks/opencode.js";

export interface InstallOptions {
  global?: boolean;
}

export function runInstall(agent = "claude", options: InstallOptions = {}): void {
  const normalizedAgent = agent.toLowerCase();

  if (
    normalizedAgent !== "claude" &&
    normalizedAgent !== "claude-code" &&
    normalizedAgent !== "opencode"
  ) {
    console.error(
      pc.red(`Error: Agent '${agent}' is not supported. Supported agents: 'claude', 'opencode'`)
    );
    process.exit(1);
  }

  if (normalizedAgent === "opencode") {
    try {
      const { configPath, pluginPath, backupPath } = installOpenCodePlugin({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ OpenCode TraceEval plugin installed successfully!")));
      console.log("");
      console.log(`Plugin file: ${pc.cyan(pluginPath)}`);
      console.log(`Config file: ${pc.cyan(configPath)}`);
      if (backupPath) {
        console.log(`Backup saved to: ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log("Registered OpenCode lifecycle hooks:");
      console.log(`  • ${pc.bold("onSessionStart")} ➜ traceeval hook start`);
      console.log(`  • ${pc.bold("onToolExecute")}  ➜ traceeval hook pre-tool`);
      console.log(`  • ${pc.bold("onToolComplete")} ➜ traceeval hook post-tool`);
      console.log(`  • ${pc.bold("onFileChange")}   ➜ traceeval hook file`);
      console.log(`  • ${pc.bold("onSessionEnd")}   ➜ traceeval hook stop`);
      console.log("");
      console.log(pc.dim("All OpenCode interactions in this project will now automatically stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install OpenCode plugin: ${message}`));
      process.exit(1);
    }
  }

  try {
    const { configPath, backupPath } = installClaudeHooks({
      global: options.global,
      cwd: process.cwd(),
    });

    console.log(pc.bold(pc.green("✔ Claude Code recording hooks installed successfully!")));
    console.log("");
    console.log(`Config file: ${pc.cyan(configPath)}`);
    if (backupPath) {
      console.log(`Backup saved to: ${pc.dim(backupPath)}`);
    }
    console.log("");
    console.log("Registered hooks:");
    console.log(`  • ${pc.bold("UserPromptSubmit")} ➜ traceeval hook prompt`);
    console.log(`  • ${pc.bold("PreToolUse")}       ➜ traceeval hook pre-tool`);
    console.log(`  • ${pc.bold("PostToolUse")}      ➜ traceeval hook post-tool`);
    console.log(`  • ${pc.bold("Stop")}             ➜ traceeval hook stop`);
    console.log("");
    console.log(pc.dim("All Claude Code interactions in this project will now automatically stream to .traceeval/traces!"));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`Failed to install Claude hooks: ${message}`));
    process.exit(1);
  }
}
