// ============================================================
// Keddy — MCP Server (stdio entrypoint)
//
// Thin wrapper: initializes DB, creates server, connects stdio.
// All tool definitions live in tools.ts for reuse by agent.ts.
// ============================================================

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initDb } from "../db/index.js";
import { createKeddyMcpServer } from "./tools.js";

async function main() {
  initDb();
  const server = createKeddyMcpServer({ agentTools: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[keddy-mcp] Error:", err);
  process.exit(1);
});
