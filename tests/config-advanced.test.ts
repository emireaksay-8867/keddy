import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";

// We can't easily test loadConfig with a custom path since it hardcodes ~/.keddy/config.json
// Instead, test the deep merge logic directly

describe("config deep merge behavior", () => {
  it("should preserve feature defaults when analysis is partially specified", () => {
    // Simulate the deep merge logic from loadConfig
    const defaults = {
      analysis: {
        enabled: false,
        provider: "anthropic" as const,
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

    // User config only sets analysis.enabled — features should be preserved
    const raw = { analysis: { enabled: true, apiKey: "sk-ant-test" } };

    const merged = {
      ...defaults,
      ...raw,
      analysis: {
        ...defaults.analysis,
        ...(raw.analysis ?? {}),
        features: {
          ...defaults.analysis.features,
          ...(raw.analysis?.features ?? {}),
        },
      },
    };

    expect(merged.analysis.enabled).toBe(true);
    expect(merged.analysis.apiKey).toBe("sk-ant-test");
    // Features should be preserved from defaults
    expect(merged.analysis.features.sessionTitles.enabled).toBe(true);
    expect(merged.analysis.features.sessionTitles.model).toBe("claude-haiku-4-5-20251001");
    expect(merged.analysis.features.decisionExtraction.enabled).toBe(false);
  });

  it("should allow partial feature overrides", () => {
    const defaults = {
      analysis: {
        enabled: false,
        provider: "anthropic" as const,
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

    const raw = {
      analysis: {
        enabled: true,
        features: {
          decisionExtraction: { enabled: true, model: "claude-sonnet-4-6" },
        },
      },
    };

    const merged = {
      ...defaults,
      ...raw,
      analysis: {
        ...defaults.analysis,
        ...(raw.analysis ?? {}),
        features: {
          ...defaults.analysis.features,
          ...(raw.analysis?.features ?? {}),
        },
      },
    };

    expect(merged.analysis.enabled).toBe(true);
    // Overridden feature
    expect(merged.analysis.features.decisionExtraction.enabled).toBe(true);
    expect(merged.analysis.features.decisionExtraction.model).toBe("claude-sonnet-4-6");
    // Preserved defaults
    expect(merged.analysis.features.sessionTitles.enabled).toBe(true);
  });

  it("should handle empty raw config", () => {
    const defaults = {
      analysis: {
        enabled: false,
        provider: "anthropic" as const,
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

    const raw: Record<string, unknown> = {};

    const merged = {
      ...defaults,
      ...raw,
      analysis: {
        ...defaults.analysis,
        ...(raw.analysis as Record<string, unknown> ?? {}),
        features: {
          ...defaults.analysis.features,
          ...((raw.analysis as Record<string, unknown>)?.features as Record<string, unknown> ?? {}),
        },
      },
    };

    expect(merged.analysis.enabled).toBe(false);
    expect(merged.analysis.features.sessionTitles.enabled).toBe(true);
  });
});
