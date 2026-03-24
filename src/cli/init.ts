import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { initDb, closeDb } from "../db/index.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const KEDDY_DIR = join(homedir(), ".keddy");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

function getHandlerPath(): string {
  // Use the installed location
  return join(__dirname, "..", "capture", "handler.js");
}

function getMcpServerPath(): string {
  return join(__dirname, "..", "mcp", "server.js");
}

interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

function readSettings(): ClaudeSettings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettings): void {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function installHooks(): void {
  const settings = readSettings();
  const handlerPath = getHandlerPath();

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hooks = settings.hooks as Record<string, unknown[]>;

  // SessionStart (sync)
  const sessionStartHook = {
    type: "command",
    command: `node ${handlerPath} SessionStart`,
  };

  // Stop (async)
  const stopHook = {
    type: "command",
    command: `node ${handlerPath} Stop`,
    async: true,
  };

  // PostCompact (async)
  const postCompactHook = {
    type: "command",
    command: `node ${handlerPath} PostCompact`,
    async: true,
  };

  // SessionEnd (async)
  const sessionEndHook = {
    type: "command",
    command: `node ${handlerPath} SessionEnd`,
    async: true,
  };

  // Helper to check if keddy hook already exists
  function hasKeddyHook(hookArray: unknown[]): boolean {
    return hookArray.some((item) => {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        // Check direct hook
        if (typeof obj.command === "string" && obj.command.includes("handler.js")) return true;
        // Check nested hooks array
        if (Array.isArray(obj.hooks)) {
          return obj.hooks.some(
            (h: unknown) =>
              typeof h === "object" &&
              h !== null &&
              typeof (h as Record<string, unknown>).command === "string" &&
              ((h as Record<string, unknown>).command as string).includes("handler.js"),
          );
        }
      }
      return false;
    });
  }

  // Install each hook if not already present
  if (!hooks.SessionStart) hooks.SessionStart = [];
  if (!hasKeddyHook(hooks.SessionStart)) {
    hooks.SessionStart.push({ hooks: [sessionStartHook] });
  }

  if (!hooks.Stop) hooks.Stop = [];
  if (!hasKeddyHook(hooks.Stop)) {
    hooks.Stop.push({ hooks: [stopHook] });
  }

  if (!hooks.PostCompact) hooks.PostCompact = [];
  if (!hasKeddyHook(hooks.PostCompact)) {
    hooks.PostCompact.push({ matcher: ".*", hooks: [postCompactHook] });
  }

  if (!hooks.SessionEnd) hooks.SessionEnd = [];
  if (!hasKeddyHook(hooks.SessionEnd)) {
    hooks.SessionEnd.push({ matcher: ".*", hooks: [sessionEndHook] });
  }

  writeSettings(settings);
  console.log("  ✓ Hooks installed in ~/.claude/settings.json");
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function registerMcpProject(): void {
  const mcpConfigPath = join(process.cwd(), ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};

  if (existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
    } catch {
      // Start fresh
    }
  }

  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  const servers = mcpConfig.mcpServers as Record<string, unknown>;
  servers.keddy = {
    command: "node",
    args: [getMcpServerPath()],
  };

  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  console.log("  ✓ MCP server registered in .mcp.json (this project only)");
}

function registerMcpGlobal(): boolean {
  const serverPath = getMcpServerPath();
  try {
    // Remove first in case it already exists (claude mcp add fails on duplicates)
    try {
      execSync(`claude mcp remove keddy --scope user`, { stdio: "pipe" });
    } catch {
      // Not registered yet — that's fine
    }
    execSync(
      `claude mcp add keddy --scope user -- node ${serverPath}`,
      { stdio: "pipe" },
    );
    console.log("  ✓ MCP server registered globally (all projects)");
    return true;
  } catch (err) {
    // claude CLI might not be in PATH — fall back to manual ~/.claude.json edit
    const claudeJsonPath = join(homedir(), ".claude.json");
    let claudeJson: Record<string, unknown> = {};

    if (existsSync(claudeJsonPath)) {
      try {
        claudeJson = JSON.parse(readFileSync(claudeJsonPath, "utf8"));
      } catch {
        // Start fresh
      }
    }

    if (!claudeJson.mcpServers) {
      claudeJson.mcpServers = {};
    }

    const servers = claudeJson.mcpServers as Record<string, unknown>;
    servers.keddy = {
      type: "stdio",
      command: "node",
      args: [serverPath],
    };

    writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2));
    console.log("  ✓ MCP server registered globally in ~/.claude.json");
    return true;
  }
}

async function registerMcp(): Promise<void> {
  console.log("\n  MCP Server Scope:");
  console.log("    1) Global — available in all projects (recommended)");
  console.log("    2) Project — this project only (.mcp.json)");
  console.log("    3) Both — global + project fallback\n");

  const answer = await prompt("  Choose scope [1/2/3] (default: 1): ");
  const choice = answer || "1";

  switch (choice) {
    case "2":
      registerMcpProject();
      break;
    case "3":
      registerMcpGlobal();
      registerMcpProject();
      break;
    case "1":
    default:
      registerMcpGlobal();
      break;
  }
}

export async function runInit(): Promise<void> {
  console.log("Initializing Keddy...\n");

  // Check prerequisites
  if (!existsSync(CLAUDE_DIR)) {
    console.error("Error: ~/.claude not found. Is Claude Code installed?");
    process.exit(1);
  }

  // Create ~/.keddy directory
  mkdirSync(KEDDY_DIR, { recursive: true });
  console.log("  ✓ Created ~/.keddy/");

  // Initialize database
  const db = initDb();
  closeDb();
  console.log("  ✓ Database initialized at ~/.keddy/keddy.db");

  // Install hooks
  installHooks();

  // Register MCP
  await registerMcp();

  console.log("\nKeddy is ready! Start a Claude Code session to begin capturing.");
  console.log("Run 'keddy open' to view the dashboard.");
  console.log("Run 'keddy import' to import historical sessions.");
}
