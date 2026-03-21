import type { AnalysisConfig } from "../types.js";

// Map friendly model names to actual Anthropic API model IDs
const MODEL_ALIASES: Record<string, string> = {
  "claude-haiku-4-5-latest": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-latest": "claude-sonnet-4-5-20250514",
  "claude-opus-4-6": "claude-opus-4-6-20250610",
};

function resolveModel(model: string): string {
  return MODEL_ALIASES[model] || model;
}

export interface LLMProvider {
  complete(prompt: string, model: string): Promise<string>;
}

class AnthropicProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(prompt: string, model: string): Promise<string> {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: this.apiKey });
      const response = await client.messages.create({
        model: resolveModel(model),
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const block = response.content[0];
      return block.type === "text" ? block.text : "";
    } catch (err) {
      throw new Error(`Anthropic API error: ${err}`);
    }
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
