import type { AnalysisConfig } from "../types.js";

// Available models for analysis features
export const ANALYSIS_MODELS = [
  { id: "haiku", label: "Haiku 4.5", description: "Fastest, cheapest — great for titles & summaries", apiId: "claude-haiku-4-5-20251001", tier: "fast" as const },
  { id: "sonnet", label: "Sonnet 4.6", description: "Balanced speed & intelligence", apiId: "claude-sonnet-4-6", tier: "smart" as const },
  { id: "opus", label: "Opus 4.6", description: "Most intelligent, 1M context", apiId: "claude-opus-4-6", tier: "powerful" as const },
];

// Map friendly config names to actual Anthropic API model IDs
const MODEL_ALIASES: Record<string, string> = Object.fromEntries([
  ...ANALYSIS_MODELS.map(m => [m.id, m.apiId]),
  ...ANALYSIS_MODELS.map(m => [m.apiId, m.apiId]),
  // Legacy aliases
  ["claude-haiku-4-5-latest", "claude-haiku-4-5-20251001"],
  ["claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  ["claude-sonnet-4-5-latest", "claude-sonnet-4-5-20250929"],
]);

function resolveModel(model: string): string {
  return MODEL_ALIASES[model] || model;
}

export interface LLMProvider {
  complete(prompt: string, model: string): Promise<string>;
}

class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private client: any = null;
  private initPromise: Promise<void> | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async ensureClient(): Promise<any> {
    if (this.client) return this.client;
    if (!this.initPromise) {
      this.initPromise = import("@anthropic-ai/sdk").then(mod => {
        this.client = new mod.default({ apiKey: this.apiKey });
      });
    }
    await this.initPromise;
    return this.client;
  }

  async complete(prompt: string, model: string, retries = 3): Promise<string> {
    const client = await this.ensureClient();
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await client.messages.create({
          model: resolveModel(model),
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });
        const block = response.content[0];
        return block.type === "text" ? block.text : "";
      } catch (err: any) {
        if (err?.status === 429 && attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error: ${err}`);
      }
    }
    throw new Error("Exhausted retries");
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async complete(prompt: string, model: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? "";
  }
}

export function createProvider(config: AnalysisConfig): LLMProvider | null {
  if (!config.apiKey) return null;

  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.apiKey);
    case "openai-compatible":
      return new OpenAICompatibleProvider(
        config.apiKey,
        config.baseUrl || "http://localhost:11434",
      );
    default:
      return null;
  }
}
