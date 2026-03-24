import { describe, it, expect } from "vitest";
import { createProvider } from "../src/analysis/providers.js";
import type { AnalysisConfig } from "../src/types.js";

describe("createProvider", () => {
  it("should return null when no API key is provided", () => {
    const config: AnalysisConfig = {
      enabled: true,
      provider: "anthropic",
      apiKey: "",
      features: {
        sessionTitles: { enabled: true, model: "claude-haiku-4-5-latest" },
        segmentSummaries: { enabled: true, model: "claude-haiku-4-5-latest" },
        decisionExtraction: { enabled: false, model: "claude-haiku-4-5-latest" },
      },
    };
    expect(createProvider(config)).toBeNull();
  });

  it("should create Anthropic provider when configured", () => {
    const config: AnalysisConfig = {
      enabled: true,
      provider: "anthropic",
      apiKey: "sk-ant-test-key",
      features: {
        sessionTitles: { enabled: true, model: "claude-haiku-4-5-latest" },
        segmentSummaries: { enabled: true, model: "claude-haiku-4-5-latest" },
        decisionExtraction: { enabled: false, model: "claude-haiku-4-5-latest" },
      },
    };
    const provider = createProvider(config);
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("complete");
  });

  it("should create OpenAI-compatible provider when configured", () => {
    const config: AnalysisConfig = {
      enabled: true,
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "http://localhost:11434",
      features: {
        sessionTitles: { enabled: true, model: "llama3" },
        segmentSummaries: { enabled: true, model: "llama3" },
        decisionExtraction: { enabled: false, model: "llama3" },
      },
    };
    const provider = createProvider(config);
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("complete");
  });

  it("should return null for unknown provider type", () => {
    const config: AnalysisConfig = {
      enabled: true,
      provider: "unknown" as "anthropic",
      apiKey: "key",
      features: {
        sessionTitles: { enabled: true, model: "test" },
        segmentSummaries: { enabled: true, model: "test" },
        decisionExtraction: { enabled: false, model: "test" },
      },
    };
    expect(createProvider(config)).toBeNull();
  });
});
