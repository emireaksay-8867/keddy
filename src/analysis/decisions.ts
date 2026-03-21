import type { LLMProvider } from "./providers.js";
import type { ParsedExchange } from "../types.js";

interface ExtractedDecision {
  exchange_index: number;
  decision_text: string;
  context: string;
  alternatives: string[];
}

export async function extractDecisions(
  provider: LLMProvider,
  exchanges: ParsedExchange[],
  model: string,
): Promise<ExtractedDecision[]> {
  // Process in chunks of 10 exchanges
  const decisions: ExtractedDecision[] = [];
  const chunkSize = 10;

  for (let i = 0; i < exchanges.length; i += chunkSize) {
    const chunk = exchanges.slice(i, i + chunkSize);
    const context = chunk
      .map(
        (e) =>
          `[${e.index}] User: ${e.user_prompt.substring(0, 150)}\nAssistant: ${e.assistant_response.substring(0, 150)}`,
      )
      .join("\n---\n");

    const prompt = `Analyze this coding conversation and extract key technical decisions. For each decision, provide the exchange index, the decision made, context, and alternatives considered.

Conversation:
${context}

Reply in JSON format: [{"exchange_index": N, "decision_text": "...", "context": "...", "alternatives": ["..."]}]
Only include actual decisions, not routine actions. Return [] if none found.`;

    try {
      const result = await provider.complete(prompt, model);
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        decisions.push(...parsed);
      }
    } catch {
      // Skip failed chunks
    }
  }

  return decisions;
}
