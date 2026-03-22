import type { LLMProvider } from "./providers.js";
import type { ParsedExchange } from "../types.js";

function stripNoise(text: string): string {
  return text
    .replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/g, "")
    .replace(/\[Request interrupted by user[^\]]*\]/g, "")
    .trim();
}

interface ExtractedDecision {
  exchange_index: number;
  decision_text: string;
  context: string;
  alternatives: string[];
}

function extractJSON(text: string): string {
  // Strip markdown code blocks if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Try to find raw JSON array
  const match = text.match(/\[[\s\S]*\]/);
  if (match) return match[0];
  return text.trim();
}

export async function extractDecisions(
  provider: LLMProvider,
  exchanges: ParsedExchange[],
  model: string,
): Promise<ExtractedDecision[]> {
  const decisions: ExtractedDecision[] = [];

  // Only process key exchanges — skip trivial ones, process in larger chunks
  const meaningful = exchanges.filter(e => {
    const text = stripNoise(e.user_prompt);
    return text.length > 20;
  });

  // Process in chunks of 15 for fewer API calls
  const chunkSize = 15;
  for (let i = 0; i < meaningful.length; i += chunkSize) {
    const chunk = meaningful.slice(i, i + chunkSize);
    const context = chunk
      .map(
        (e) =>
          `[${e.index}] User: ${stripNoise(e.user_prompt).substring(0, 200)}\nClaude: ${stripNoise(e.assistant_response).substring(0, 200)}`,
      )
      .join("\n---\n");

    const prompt = `Extract key technical decisions from this coding conversation. Only include real decisions where alternatives exist — not routine actions.

${context}

Return a JSON array. Each item: {"exchange_index": N, "decision_text": "what was decided", "context": "why", "alternatives": ["what else was considered"]}
Return [] if no real decisions. JSON only, no explanation.`;

    try {
      const result = await provider.complete(prompt, model);
      const jsonStr = extractJSON(result);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        for (const d of parsed) {
          if (typeof d.exchange_index === "number" && typeof d.decision_text === "string" && d.decision_text.length > 5) {
            decisions.push({
              exchange_index: d.exchange_index,
              decision_text: d.decision_text,
              context: d.context || "",
              alternatives: Array.isArray(d.alternatives) ? d.alternatives : [],
            });
          }
        }
      }
    } catch (e) {
      console.error("[AI] Decision chunk parse failed:", e);
    }
  }

  return decisions;
}
