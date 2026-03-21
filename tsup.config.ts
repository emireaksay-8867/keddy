import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "capture/handler": "src/capture/handler.ts",
    "mcp/server": "src/mcp/server.ts",
    "dashboard/server": "src/dashboard/server.ts",
  },
  format: ["cjs"],
  target: "node18",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  external: ["better-sqlite3"],
  banner: {
    js: "#!/usr/bin/env node",
  },
  esbuildOptions(options) {
    // Only add shebang to CLI entry
    options.banner = undefined;
  },
  onSuccess: async () => {
    // Add shebang only to CLI entry
    const fs = await import("fs");
    const cliPath = "dist/cli/index.js";
    if (fs.existsSync(cliPath)) {
      const content = fs.readFileSync(cliPath, "utf8");
      if (!content.startsWith("#!/usr/bin/env node")) {
        fs.writeFileSync(cliPath, `#!/usr/bin/env node\n${content}`);
      }
    }
  },
});
