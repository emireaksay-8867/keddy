import type { LLMProvider } from "./providers.js";
import type { ParsedExchange } from "../types.js";
import type { ExtractedSegment } from "../capture/segments.js";

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

    const prompts = segExchanges
      .map((e) => e.user_prompt.substring(0, 100))
      .join("\n");

    const prompt = `Summarize this "${segment.segment_type}" coding segment in 1-2 sentences. User prompts:\n${prompts}\nFiles: ${segment.files_touched.join(", ") || "none"}\nReply with ONLY the summary.`;

    try {
      const summary = await provider.complete(prompt, model);
      summaries.set(i, summary.trim());
    } catch {
      // Skip failed summaries
    }
  }

  return summaries;
}
