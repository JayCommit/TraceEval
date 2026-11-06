import pc from "picocolors";
import { installClaudeHooks } from "../hooks/claude.js";
import { installOpenCodePlugin } from "../hooks/opencode.js";
import { installCursorIntegration } from "../hooks/cursor.js";
import { installGrokHooks } from "../hooks/grok.js";
import { installGrokBotHooks } from "../hooks/grok_bot.js";
import { installOpenAIHooks } from "../hooks/openai.js";
import { installAntigravityHooks } from "../hooks/antigravity.js";

export interface InstallOptions {
  global?: boolean;
}

export const SUPPORTED_AGENTS = [
  "cursor",
  "grok",
  "grok-bot",
  "openai",
  "antigravity",
  "claude",
  "opencode",
] as const;

export function runInstall(agent = "claude", options: InstallOptions = {}): void {
  const normalizedAgent = agent.toLowerCase().trim();

  // 1. Cursor
  if (normalizedAgent === "cursor") {
    try {
      const { hooksPath, mcpPath, rulePath, backupPath } = installCursorIntegration({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ Cursor TraceEval integration installed successfully!")));
      console.log("");
      console.log(`Hooks config: ${pc.cyan(hooksPath)}`);
      console.log(`MCP server:   ${pc.cyan(mcpPath)}`);
      if (rulePath) {
        console.log(`Agent rule:   ${pc.cyan(rulePath)}`);
      }
      if (backupPath) {
        console.log(`Backup saved: ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log(pc.dim("Cursor agent execution traces will automatically stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install Cursor integration: ${message}`));
      process.exit(1);
    }
  }

  // 2. Grok
  if (normalizedAgent === "grok") {
    try {
      const { hooksPath, configPath, backupPath } = installGrokHooks({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ Grok TraceEval recording hooks installed successfully!")));
      console.log("");
      console.log(`Hooks file:  ${pc.cyan(hooksPath)}`);
      console.log(`Config file: ${pc.cyan(configPath)}`);
      if (backupPath) {
        console.log(`Backup saved: ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log(pc.dim("Grok tool calls and token metrics will automatically stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install Grok hooks: ${message}`));
      process.exit(1);
    }
  }

  // 3. Grok Bot
  if (normalizedAgent === "grok-bot" || normalizedAgent === "grokbot") {
    try {
      const { configPath, pluginPath, backupPath } = installGrokBotHooks({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ Grok Bot TraceEval adapter installed successfully!")));
      console.log("");
      console.log(`Plugin adapter: ${pc.cyan(pluginPath)}`);
      console.log(`Config file:    ${pc.cyan(configPath)}`);
      if (backupPath) {
        console.log(`Backup saved:   ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log(pc.dim("Grok Bot automated events will stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install Grok Bot adapter: ${message}`));
      process.exit(1);
    }
  }

  // 4. OpenAI / ChatGPT App
  if (normalizedAgent === "openai" || normalizedAgent === "chatgpt") {
    try {
      const { hooksPath, configPath, mcpPath, backupPath } = installOpenAIHooks({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ OpenAI / ChatGPT TraceEval integration installed successfully!")));
      console.log("");
      console.log(`Hooks file:  ${pc.cyan(hooksPath)}`);
      console.log(`MCP server:  ${pc.cyan(mcpPath)}`);
      console.log(`Config file: ${pc.cyan(configPath)}`);
      if (backupPath) {
        console.log(`Backup saved: ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log(pc.dim("OpenAI and ChatGPT tool execution traces will stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install OpenAI integration: ${message}`));
      process.exit(1);
    }
  }

  // 5. Antigravity
  if (normalizedAgent === "antigravity" || normalizedAgent === "agy") {
    try {
      const { configPath, backupPath } = installAntigravityHooks({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ Antigravity TraceEval hooks installed successfully!")));
      console.log("");
      console.log(`Hooks file: ${pc.cyan(configPath)}`);
      if (backupPath) {
        console.log(`Backup saved: ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log("Registered Antigravity lifecycle events in .agents/hooks.json:");
      console.log(`  • ${pc.bold("SessionStart")} ➜ traceeval hook start --agent antigravity`);
      console.log(`  • ${pc.bold("PreToolUse")}   ➜ traceeval hook pre-tool --agent antigravity`);
      console.log(`  • ${pc.bold("PostToolUse")}  ➜ traceeval hook post-tool --agent antigravity`);
      console.log(`  • ${pc.bold("Stop")}         ➜ traceeval hook stop --agent antigravity`);
      console.log("");
      console.log(pc.dim("Antigravity agent trajectories will automatically stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install Antigravity hooks: ${message}`));
      process.exit(1);
    }
  }

  // 6. OpenCode
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
        console.log(`Backup saved: ${pc.dim(backupPath)}`);
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

  // 7. Claude / Claude Code (default)
  if (normalizedAgent === "claude" || normalizedAgent === "claude-code") {
    try {
      const { configPath, backupPath } = installClaudeHooks({
        global: options.global,
        cwd: process.cwd(),
      });

      console.log(pc.bold(pc.green("✔ Claude Code recording hooks installed successfully!")));
      console.log("");
      console.log(`Config file: ${pc.cyan(configPath)}`);
      if (backupPath) {
        console.log(`Backup saved: ${pc.dim(backupPath)}`);
      }
      console.log("");
      console.log("Registered hooks:");
      console.log(`  • ${pc.bold("UserPromptSubmit")} ➜ traceeval hook prompt`);
      console.log(`  • ${pc.bold("PreToolUse")}       ➜ traceeval hook pre-tool`);
      console.log(`  • ${pc.bold("PostToolUse")}      ➜ traceeval hook post-tool`);
      console.log(`  • ${pc.bold("Stop")}             ➜ traceeval hook stop`);
      console.log("");
      console.log(pc.dim("All Claude Code interactions in this project will now automatically stream to .traceeval/traces!"));
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`Failed to install Claude hooks: ${message}`));
      process.exit(1);
    }
  }

  console.error(
    pc.red(
      `Error: Agent '${agent}' is not supported.\nSupported agents: ${SUPPORTED_AGENTS.map((a) => `'${a}'`).join(", ")}`
    )
  );
  process.exit(1);
}
