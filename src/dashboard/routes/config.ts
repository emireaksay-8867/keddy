import { Hono } from "hono";
import { loadConfig, saveConfig } from "../../cli/config.js";

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
  const merged = { ...current, ...body };
  saveConfig(merged);
  return c.json({ ok: true, config: merged });
});
