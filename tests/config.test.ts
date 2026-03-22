import { describe, it, expect } from "vitest";
import { loadConfig, saveConfig } from "../src/cli/config.js";

// Note: loadConfig/saveConfig use a hardcoded path (~/.keddy/config.json).
// These tests verify the structure of the config rather than testing defaults,
// since the config file may already exist with user settings.

describe("config module", () => {
  it("should return a valid config with analysis structure", () => {
    const config = loadConfig();
    expect(config.analysis).toBeDefined();
    expect(typeof config.analysis.enabled).toBe("boolean");
    expect(config.analysis.provider).toBe("anthropic");
    expect(config.analysis.features.sessionTitles).toBeDefined();
    expect(config.analysis.features.sessionTitles.enabled).toBe(true);
    // Model should be a valid string (either "haiku" or a legacy name)
    expect(typeof config.analysis.features.sessionTitles.model).toBe("string");
    expect(config.analysis.features.sessionTitles.model.length).toBeGreaterThan(0);
  });

  it("should have all expected feature flags in config", () => {
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
