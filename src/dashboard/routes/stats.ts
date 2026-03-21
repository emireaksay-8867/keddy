import { Hono } from "hono";
import { getStats } from "../../db/queries.js";

export const statsRoutes = new Hono();

// GET /api/stats
statsRoutes.get("/stats", (c) => {
  const stats = getStats();
  return c.json(stats);
});
