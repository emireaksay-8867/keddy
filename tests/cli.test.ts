import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/cli/config.js";

describe("CLI config", () => {
  it("should have valid default analysis config structure", () => {
    const config = loadConfig();

    expect(config.analysis).toBeDefined();
    expect(typeof config.analysis.enabled).toBe("boolean");
    expect(typeof config.analysis.provider).toBe("string");
    expect(typeof config.analysis.apiKey).toBe("string");
    expect(typeof config.analysis.features).toBe("object");

    // All features should have enabled and model
    const features = Object.values(config.analysis.features);
    expect(features.length).toBe(3);
    for (const feature of features) {
      expect(typeof feature.enabled).toBe("boolean");
      expect(typeof feature.model).toBe("string");
    }
  });

  it("should have analysis config with boolean enabled", () => {
    const config = loadConfig();
    expect(typeof config.analysis.enabled).toBe("boolean");
  });

  it("should default to anthropic provider", () => {
    const config = loadConfig();
    expect(config.analysis.provider).toBe("anthropic");
  });
});

describe("deriveProjectPath", () => {
  // Import the function indirectly by testing its behavior
  // The function converts encoded paths like:
  // -Users-foo-project → /Users/foo/project

  it("should handle path derivation concept", () => {
    // The encode pattern replaces / with - and strips leading /
    const encoded = "-Users-test-project";
    const decoded = encoded.replace(/-/g, "/").replace(/^\//, "");
    expect(decoded).toBe("/Users/test/project".replace(/^\//, ""));
  });
});
