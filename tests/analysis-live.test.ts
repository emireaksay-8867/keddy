import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createProvider } from "../src/analysis/providers.js";
import { generateTitle } from "../src/analysis/titles.js";
import type { AnalysisConfig, ParsedExchange } from "../src/types.js";

// Load .env
config();

const apiKey = process.env.ANTHROPIC_API_KEY;
const hasApiKey = !!apiKey && apiKey.startsWith("sk-ant-");

describe.skipIf(!hasApiKey)("AI Analysis — live API tests", () => {
  it("should generate a session title via Anthropic API", async () => {
    const analysisConfig: AnalysisConfig = {
      enabled: true,
      provider: "anthropic",
      apiKey: apiKey!,
      features: {
        sessionTitles: { enabled: true, model: "claude-haiku-4-5-latest" },
        segmentSummaries: { enabled: true, model: "claude-haiku-4-5-latest" },
        decisionExtraction: { enabled: false, model: "claude-haiku-4-5-latest" },
      },
    };

    const provider = createProvider(analysisConfig)!;
    expect(provider).not.toBeNull();

    const exchanges: ParsedExchange[] = [
      {
        index: 0,
        user_prompt: "Help me add authentication to my Express app using Passport.js",
        assistant_response: "I'll help you set up Passport.js authentication.",
        tool_calls: [],
        timestamp: "2024-01-01T00:00:00Z",
        is_interrupt: false,
        is_compact_summary: false,
      },
      {
        index: 1,
        user_prompt: "Now add Google OAuth strategy",
        assistant_response: "I've configured the Google OAuth2 strategy.",
        tool_calls: [
          { name: "Edit", input: { file_path: "/src/auth.ts" }, id: "t1" },
          { name: "Write", input: { file_path: "/src/strategies/google.ts" }, id: "t2" },
        ],
        timestamp: "2024-01-01T00:05:00Z",
        is_interrupt: false,
        is_compact_summary: false,
      },
    ];

    const title = await generateTitle(
      provider,
      exchanges,
      "claude-haiku-4-5-latest",
    );

    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(5);
    expect(title.length).toBeLessThanOrEqual(80);
    // Title should be relevant to authentication
    console.log(`Generated title: "${title}"`);
  }, 30000); // 30s timeout for API call

  it("should complete a raw prompt via the provider", async () => {
    const analysisConfig: AnalysisConfig = {
      enabled: true,
      provider: "anthropic",
      apiKey: apiKey!,
      features: {
        sessionTitles: { enabled: true, model: "claude-haiku-4-5-latest" },
        segmentSummaries: { enabled: true, model: "claude-haiku-4-5-latest" },
        decisionExtraction: { enabled: false, model: "claude-haiku-4-5-latest" },
      },
    };

    const provider = createProvider(analysisConfig)!;

    const result = await provider.complete(
      "Reply with exactly the word: KEDDY_TEST_OK",
      "claude-haiku-4-5-latest",
    );

    expect(result).toContain("KEDDY_TEST_OK");
  }, 15000);
});
