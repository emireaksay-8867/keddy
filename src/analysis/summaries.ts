import type { LLMProvider } from "./providers.js";
import type { ParsedExchange } from "../types.js";
import type { ExtractedSegment } from "../capture/segments.js";

function stripNoise(text: string): string {
  return text
    .replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/g, "")
    .replace(/\[Request interrupted by user[^\]]*\]/g, "")
    .replace(/\[Image:[^\]]*\]/g, "")
    .trim();
}

export async function generateSegmentSummaries(
  provider: LLMProvider,
  exchanges: ParsedExchange[],
  segments: ExtractedSegment[],
  model: string,
): Promise<Map<number, string>> {
  const summaries = new Map<number, string>();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segExchanges = exchanges.filter(
      (e) =>
        e.index >= segment.exchange_index_start &&
        e.index <= segment.exchange_index_end,
    );

    if (segExchanges.length === 0) continue;

    // Build context from cleaned user prompts and key assistant actions
    const userPrompts = segExchanges
      .map(e => stripNoise(e.user_prompt))
      .filter(p => p.length > 10)
      .slice(0, 5)
      .map(p => p.substring(0, 180));

    const assistantActions = segExchanges
      .map(e => stripNoise(e.assistant_response))
      .filter(p => p.length > 10)
      .slice(0, 3)
      .map(p => p.substring(0, 100));

    const topFiles = segment.files_touched
      .slice(0, 5)
      .map(f => f.split("/").pop())
      .filter(Boolean)
      .join(", ");

    const topTools = Object.entries(segment.tool_counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name)
      .join(", ");

    const prompt = `Summarize this coding segment in ONE short sentence (12-25 words max).

Type: ${segment.segment_type}
User said:
${userPrompts.map(p => `- "${p}"`).join("\n")}

Claude did:
${assistantActions.map(p => `- ${p}`).join("\n")}

Files: ${topFiles || "none"}
Tools: ${topTools || "none"}

FORMAT: Start with past-tense verb. Examples:
- "Implemented SQLite schema with FTS5 search and migration system"
- "Debugged timeline card rendering and fixed scroll position preservation"
- "Discussed npm publishing strategy and open-source project configuration"
- "Explored dashboard UI patterns and sidebar navigation design"
- "Refactored segment classifier to add querying and reviewing types"

RULES:
- ONE sentence, 12-25 words, no period at the end
- Start with: Built, Implemented, Fixed, Debugged, Discussed, Explored, Added, Refactored, Configured, Tested, Reviewed, Deployed
- Name the specific feature/component/file, not generic descriptions
- NEVER start with "The user" or "This segment"
- NEVER refuse — use the user prompts to understand what happened`;

    try {
      const summary = await provider.complete(prompt, model);
      let cleaned = summary.trim()
        .replace(/^["']|["']$/g, "")
        .replace(/^summary:\s*/i, "")
        .replace(/^[-•]\s*/, "")
        .replace(/\.$/, "")
        .split("\n")[0];
      // Reject refusals
      if (cleaned.toLowerCase().includes("cannot provide") || cleaned.toLowerCase().includes("i cannot") || cleaned.toLowerCase().includes("i'm unable")) continue;
      // Reject if too long (model didn't follow instructions)
      if (cleaned.length > 200) cleaned = cleaned.substring(0, 200);
      summaries.set(i, cleaned);
    } catch {
      // Skip failed summaries
    }
  }

  return summaries;
}
