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
import { notesRoutes } from "./routes/notes.js";
import { dailyRoutes } from "./routes/daily.js";

const app = new Hono();

// Security: Host header validation — block DNS rebinding attacks
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
app.use("*", async (c, next) => {
  const host = c.req.header("host");
  if (host) {
    const hostname = host.replace(/:\d+$/, "");
    if (!ALLOWED_HOSTS.has(hostname)) {
      return c.text("Forbidden", 403);
    }
  }
  await next();
});

// Security: CORS — restrict to localhost origins only
app.use("/api/*", cors({
  origin: (origin) => {
    if (!origin) return origin; // same-origin requests
    try {
      const url = new URL(origin);
      if (ALLOWED_HOSTS.has(url.hostname)) return origin;
    } catch { /* invalid origin */ }
    return null;
  },
}));

// Security headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
});

// API routes
app.route("/api/sessions", sessionsRoutes);
app.route("/api", plansRoutes);
app.route("/api", statsRoutes);
app.route("/api", configRoutes);
app.route("/api", projectsRoutes);
app.route("/api", analyzeRoutes);
app.route("/api", notesRoutes);
app.route("/api/daily", dailyRoutes);

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
