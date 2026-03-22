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

// Summary format stored in DB: "Short Label|||Full summary sentence"
// The UI splits on ||| to get both parts

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

    // Build context
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

    const prompt = `Analyze this "${segment.segment_type}" coding segment and provide TWO things:

1. LABEL: A short topic label (2-4 words) for what this segment is about. Like a tab title.
2. SUMMARY: One sentence (15-25 words) describing what happened.

User said:
${userPrompts.map(p => `- "${p}"`).join("\n")}

Claude did:
${assistantActions.map(p => `- ${p}`).join("\n")}

Files: ${topFiles || "none"}
Tools: ${topTools || "none"}

Reply in EXACTLY this format (two lines):
LABEL: [2-4 word topic]
SUMMARY: [one sentence, past tense verb]

Examples:
LABEL: Dashboard Timeline UI
SUMMARY: Built timeline view with segment cards, milestone badges, and sort controls

LABEL: SQLite Schema Setup
SUMMARY: Implemented database schema with FTS5 search, migrations, and prepared statements

LABEL: Git Push & Deploy
SUMMARY: Committed changes and pushed to remote with CI/CD pipeline verification

RULES:
- LABEL must be 2-4 words, a noun phrase describing the topic (NOT starting with a verb)
- SUMMARY must start with past-tense verb: Built, Fixed, Discussed, Explored, Debugged, etc.
- Name specific features/components, not generic descriptions
- NEVER start with "The user" or "A user"`;

    try {
      const result = await provider.complete(prompt, model);
      const lines = result.trim().split("\n").filter(l => l.trim());

      let label = "";
      let summary = "";

      for (const line of lines) {
        const labelMatch = line.match(/^LABEL:\s*(.+)/i);
        const summaryMatch = line.match(/^SUMMARY:\s*(.+)/i);
        if (labelMatch) label = labelMatch[1].trim().replace(/^["']|["']$/g, "");
        if (summaryMatch) summary = summaryMatch[1].trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");
      }

      // Fallback: if parsing failed, use the whole response as summary
      if (!summary && result.trim().length > 10) {
        summary = result.trim().split("\n")[0].replace(/^["']|["']$/g, "").replace(/\.$/, "");
      }

      // Reject refusals
      const combined = (label + summary).toLowerCase();
      if (combined.includes("cannot provide") || combined.includes("i cannot") || combined.includes("i'm unable")) continue;

      // Cap lengths
      if (label.length > 40) label = label.substring(0, 40);
      if (summary.length > 200) summary = summary.substring(0, 200);

      // Store as "label|||summary" format
      const stored = label ? `${label}|||${summary}` : summary;
      summaries.set(i, stored);
    } catch {
      // Skip failed
    }
  }

  return summaries;
}
