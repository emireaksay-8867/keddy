import { initDb, closeDb } from "../db/index.js";

const PORT = 3737;

export async function runOpen(): Promise<void> {
  // Start dashboard server
  initDb();

  const { startServer } = await import("../dashboard/server.js");
  const server = startServer(PORT);

  console.log(`Keddy dashboard running at http://localhost:${PORT}`);

  // Open browser
  try {
    const open = await import("open");
    await open.default(`http://localhost:${PORT}`);
  } catch {
    console.log(`Open http://localhost:${PORT} in your browser`);
  }

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    closeDb();
    process.exit(0);
  });
}
