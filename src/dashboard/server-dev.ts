/**
 * Dev-only entry point for the Keddy API server.
 * Used by `npm run dev` to start the Hono backend alongside Vite.
 */
import { initDb } from "../db/index.js";
import { startServer } from "./server.js";

initDb();
const port = parseInt(process.env.KEDDY_PORT || "3737", 10);
startServer(port);
console.log(`Keddy API server running at http://localhost:${port}`);
