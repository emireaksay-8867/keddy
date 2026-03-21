import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { KeddyConfig } from "../types.js";

const CONFIG_PATH = join(homedir(), ".keddy", "config.json");

function getDefaultConfig(): KeddyConfig {
  return {
    analysis: {
      enabled: false,
      provider: "anthropic",
      apiKey: "",
      features: {
        sessionTitles: { enabled: true, model: "claude-haiku-4-5-20251001" },
        segmentSummaries: { enabled: true, model: "claude-haiku-4-5-20251001" },
        decisionExtraction: { enabled: false, model: "claude-haiku-4-5-20251001" },
        planDiffAnalysis: { enabled: false, model: "claude-sonnet-4-6" },
        sessionNotes: { enabled: false, model: "claude-sonnet-4-6" },
      },
    },
  };
}

export function loadConfig(): KeddyConfig {
  if (!existsSync(CONFIG_PATH)) return getDefaultConfig();
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...getDefaultConfig(), ...raw };
  } catch {
    return getDefaultConfig();
  }
}

export function saveConfig(config: KeddyConfig): void {
  mkdirSync(join(homedir(), ".keddy"), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current[parts[i]] !== "object" || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }

  // Try to parse value as boolean/number
  const key = parts[parts.length - 1];
  if (value === "true") current[key] = true;
  else if (value === "false") current[key] = false;
  else if (!isNaN(Number(value))) current[key] = Number(value);
  else current[key] = value;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export async function runConfig(args: string[]): Promise<void> {
  const config = loadConfig();

  if (args.length === 0) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const subcommand = args[0];

  if (subcommand === "set" && args.length >= 3) {
    const key = args[1];
    const value = args[2];
    setNestedValue(config as unknown as Record<string, unknown>, key, value);
    saveConfig(config);
    console.log(`Set ${key} = ${value}`);
    return;
  }

  if (subcommand === "get" && args.length >= 2) {
    const key = args[1];
    const value = getNestedValue(config as unknown as Record<string, unknown>, key);
    console.log(value !== undefined ? JSON.stringify(value) : "not set");
    return;
  }

  console.log("Usage:");
  console.log("  keddy config              Show all config");
  console.log("  keddy config get <key>    Get a value");
  console.log("  keddy config set <key> <value>  Set a value");
  console.log("\nExample:");
  console.log("  keddy config set analysis.apiKey sk-ant-...");
}
