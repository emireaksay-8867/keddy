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

const app = new Hono();

// CORS for dev
app.use("/api/*", cors());

// API routes
app.route("/api/sessions", sessionsRoutes);
app.route("/api", plansRoutes);
app.route("/api", statsRoutes);
app.route("/api", configRoutes);
app.route("/api", projectsRoutes);

// Static files (built dashboard)
app.use(
  "/*",
  serveStatic({
    root: join(__dirname, "public"),
  }),
);

// SPA fallback
app.get("*", (c) => {
  const indexPath = join(__dirname, "public", "index.html");
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

// Direct execution (works in CJS bundled output)
if (typeof require !== "undefined" && require.main === module) {
  import("../db/index.js").then(({ initDb }) => {
    initDb();
    startServer();
    console.log("Keddy dashboard running at http://localhost:3737");
  });
}
