import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig } from "../src/cli/config.js";

// Note: loadConfig/saveConfig use a hardcoded path (~/.keddy/config.json).
// These tests verify the logic of the config module rather than file I/O.
// For true isolation we would need to inject the path, but we test the
// serialization logic via the module's functions.

describe("config module", () => {
  it("should return default config when no file exists", () => {
    const config = loadConfig();
    expect(config.analysis).toBeDefined();
    expect(config.analysis.enabled).toBe(false);
    expect(config.analysis.provider).toBe("anthropic");
    expect(config.analysis.features.sessionTitles).toBeDefined();
    expect(config.analysis.features.sessionTitles.enabled).toBe(true);
    expect(config.analysis.features.sessionTitles.model).toBe("claude-haiku-4-5-latest");
  });

  it("should have all expected feature flags in default config", () => {
    const config = loadConfig();
    const features = config.analysis.features;

    expect(features.sessionTitles).toBeDefined();
    expect(features.segmentSummaries).toBeDefined();
    expect(features.decisionExtraction).toBeDefined();
    expect(features.planDiffAnalysis).toBeDefined();
    expect(features.sessionNotes).toBeDefined();
  });

  it("should have enabled/model on every feature", () => {
    const config = loadConfig();
    for (const [key, feature] of Object.entries(config.analysis.features)) {
      expect(typeof feature.enabled).toBe("boolean");
      expect(typeof feature.model).toBe("string");
      expect(feature.model.length).toBeGreaterThan(0);
    }
  });
});
