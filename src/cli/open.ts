import { initDb, closeDb } from "../db/index.js";
import { exec } from "node:child_process";

const PORT = 3737;

export async function runOpen(): Promise<void> {
  initDb();

  const { startServer } = await import("../dashboard/server.js");
  startServer(PORT);

  const url = `http://localhost:${PORT}`;
  console.log(`Keddy dashboard running at ${url}`);

  // Open browser (macOS: open, Linux: xdg-open, Windows: start)
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`, () => {});

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    closeDb();
    process.exit(0);
  });
}
