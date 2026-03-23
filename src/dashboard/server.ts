import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { sessionsRoutes } from "./routes/sessions.js";
import { plansRoutes } from "./routes/plans.js";
import { statsRoutes } from "./routes/stats.js";
import { configRoutes } from "./routes/config.js";
import { projectsRoutes } from "./routes/projects.js";
import { analyzeRoutes } from "./routes/analyze.js";

const app = new Hono();

// CORS for dev
app.use("/api/*", cors());

// API routes
app.route("/api/sessions", sessionsRoutes);
app.route("/api", plansRoutes);
app.route("/api", statsRoutes);
app.route("/api", configRoutes);
app.route("/api", projectsRoutes);
app.route("/api", analyzeRoutes);

// Static files — resolve from dist root (works even when bundled into cli/index.js)
const distRoot = join(__dirname, "..");
const publicDir = join(distRoot, "dashboard", "public");

app.use(
  "/*",
  serveStatic({ root: publicDir }),
);

// SPA fallback
app.get("*", (c) => {
  const indexPath = join(publicDir, "index.html");
  if (existsSync(indexPath)) {
    return c.html(readFileSync(indexPath, "utf8"));
  }
  return c.text("Keddy Dashboard — build frontend with: npm run build:dashboard", 200);
});

export function startServer(port: number = 3737) {
  return serve({
    fetch: app.fetch,
    port,
  });
}
