import type { LLMProvider } from "./providers.js";
import type { ParsedExchange } from "../types.js";

function stripNoise(text: string): string {
  return text
    .replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/g, "")
    .replace(/\[Request interrupted by user[^\]]*\]/g, "")
    .replace(/\[Image:[^\]]*\]/g, "")
    .trim();
}

export async function generateTitle(
  provider: LLMProvider,
  exchanges: ParsedExchange[],
  model: string,
  segmentSummaries?: string[],
): Promise<string> {
  if (exchanges.length === 0) return "Untitled Session";

  // Collect files touched
  const files = new Set<string>();
  for (const ex of exchanges) {
    for (const tc of ex.tool_calls) {
      if (typeof tc.input === "object" && tc.input !== null) {
        const inp = tc.input as Record<string, unknown>;
        if (typeof inp.file_path === "string") files.add(inp.file_path.split("/").pop() || "");
      }
    }
  }

  // If we have segment summaries, use them — they're the best context
  const summaryContext = segmentSummaries && segmentSummaries.length > 0
    ? `\nSegment summaries (what happened in this session):\n${segmentSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  // Sample cleaned user prompts
  const step = Math.max(1, Math.floor(exchanges.length / 4));
  const samples: string[] = [];
  for (let i = 0; i < exchanges.length && samples.length < 4; i += step) {
    const cleaned = stripNoise(exchanges[i].user_prompt);
    if (cleaned.length > 10) samples.push(cleaned.substring(0, 150));
  }

  const filePaths = [...files].filter(Boolean).slice(0, 8);

  const prompt = `Generate a title (4-8 words, max 50 chars) for this coding session.
${summaryContext}

User prompts (sampled):
${samples.map((p, i) => `- ${p}`).join("\n")}

Files: ${filePaths.join(", ") || "none"}
Session length: ${exchanges.length} exchanges

RULES:
- 4-8 words, max 50 characters
- Start with verb: Build, Fix, Add, Debug, Refactor, Configure, Implement, Design
- Name the ACTUAL project, feature, or component from the summaries/prompts
- Just the title text, nothing else
- Do NOT invent project names — use what's mentioned in the conversation`;

  const title = await provider.complete(prompt, model);
  return title.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^title:\s*/i, "")
    .split("\n")[0]
    .substring(0, 60);
}
