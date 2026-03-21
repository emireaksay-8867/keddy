import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { initDb, closeDb } from "../db/index.js";
import { getStats } from "../db/queries.js";

export async function runStatus(): Promise<void> {
  console.log("Keddy Status\n");

  // Check hooks
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let hooksInstalled = false;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const hooks = settings.hooks || {};
      hooksInstalled =
        !!hooks.SessionStart?.length &&
        !!hooks.Stop?.length &&
        !!hooks.SessionEnd?.length;
    } catch {
      // ignore
    }
  }
  console.log(`  Hooks: ${hooksInstalled ? "✓ installed" : "✗ not installed"}`);

  // Check MCP
  const mcpPath = join(process.cwd(), ".mcp.json");
  let mcpRegistered = false;
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
      mcpRegistered = !!mcp.mcpServers?.keddy;
    } catch {
      // ignore
    }
  }
  console.log(`  MCP: ${mcpRegistered ? "✓ registered" : "✗ not registered"}`);

  // Check DB
  const dbPath = join(homedir(), ".keddy", "keddy.db");
  const dbExists = existsSync(dbPath);
  console.log(`  Database: ${dbExists ? "✓ exists" : "✗ not found"}`);

  if (dbExists) {
    try {
      initDb();
      const stats = getStats();
      console.log(`\n  Sessions: ${stats.total_sessions}`);
      console.log(`  Exchanges: ${stats.total_exchanges}`);
      console.log(`  Plans: ${stats.total_plans}`);
      console.log(`  Milestones: ${stats.total_milestones}`);
      console.log(`  Projects: ${stats.projects}`);
      console.log(`  DB Size: ${stats.db_size_mb} MB`);
      closeDb();
    } catch {
      console.log("  (could not read stats)");
    }
  }
}
