#!/usr/bin/env node

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "init": {
      const { runInit } = await import("./init.js");
      await runInit();
      break;
    }
    case "open": {
      const { runOpen } = await import("./open.js");
      await runOpen();
      break;
    }
    case "status": {
      const { runStatus } = await import("./status.js");
      await runStatus();
      break;
    }
    case "config": {
      const { runConfig } = await import("./config.js");
      await runConfig(process.argv.slice(3));
      break;
    }
    case "import": {
      const { runImport } = await import("./import.js");
      const force = process.argv.includes("--force") || process.argv.includes("-f");
      await runImport(force);
      break;
    }
    case "reimport": {
      const { runImport } = await import("./import.js");
      await runImport(true);
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log("keddy v0.1.0");
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
keddy — Session intelligence for Claude Code

Usage:
  keddy init       Initialize Keddy (DB, hooks, MCP)
  keddy open       Open the dashboard in browser
  keddy status     Show hook status and stats
  keddy config     Read/write configuration
  keddy import     Import historical sessions
  keddy version    Show version
  keddy help       Show this help

Documentation: https://github.com/emireaksay-8867/keddy
`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
