import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, saveConfig } from "../../cli/config.js";
import { getDb } from "../../db/index.js";

export const configRoutes = new Hono();

// GET /api/config
configRoutes.get("/config", (c) => {
  const config = loadConfig();
  return c.json(config);
});

// PUT /api/config
configRoutes.put("/config", async (c) => {
  const body = await c.req.json();
  const current = loadConfig();
  const merged = {
    ...current,
    ...body,
    analysis: { ...current.analysis, ...(body.analysis ?? {}) },
    notes: { ...current.notes, ...(body.notes ?? {}) },
  };
  saveConfig(merged);
  return c.json({ ok: true, config: merged });
});

// GET /api/system — version, hooks, db path, links
configRoutes.get("/system", (c) => {
  // Version
  const version = "0.1.0";

  // Hook status (same pattern as cli/status.ts)
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let hooksInstalled = false;
  const hookDetails: Record<string, boolean> = {
    SessionStart: false,
    Stop: false,
    PostCompact: false,
    SessionEnd: false,
  };
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const hooks = settings.hooks || {};
      hookDetails.SessionStart = !!hooks.SessionStart?.length;
      hookDetails.Stop = !!hooks.Stop?.length;
      hookDetails.PostCompact = !!hooks.PostCompact?.length;
      hookDetails.SessionEnd = !!hooks.SessionEnd?.length;
      hooksInstalled = hookDetails.SessionStart && hookDetails.Stop && hookDetails.SessionEnd;
    } catch { /* ignore */ }
  }

  const dbPath = join(homedir(), ".keddy", "keddy.db");

  return c.json({
    version,
    hooksInstalled,
    hookDetails,
    dbPath,
    github: "https://github.com/emireaksay-8867/keddy",
    npm: "https://www.npmjs.com/package/keddy",
  });
});

// DELETE /api/data — clear all session data
configRoutes.delete("/data", (c) => {
  const db = getDb();
  const tables = [
    "tool_calls", "decisions", "session_links", "session_notes",
    "daily_notes", "milestones", "segments", "plans",
    "compaction_events", "exchanges", "sessions",
  ];
  for (const table of tables) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* ignore */ }
  }
  db.exec("VACUUM");
  return c.json({ ok: true });
});
