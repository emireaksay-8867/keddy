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
): Promise<string> {
  if (exchanges.length === 0) return "Untitled Session";

  // Collect files touched and tools used
  const files = new Set<string>();
  const toolNames = new Set<string>();
  for (const ex of exchanges) {
    for (const tc of ex.tool_calls) {
      toolNames.add(tc.name);
      if (typeof tc.input === "object" && tc.input !== null) {
        const inp = tc.input as Record<string, unknown>;
        if (typeof inp.file_path === "string") files.add(inp.file_path.split("/").pop() || "");
        if (typeof inp.path === "string") files.add(inp.path.split("/").pop() || "");
      }
    }
  }

  // Sample 5 cleaned user prompts evenly across the session
  const step = Math.max(1, Math.floor(exchanges.length / 5));
  const samples: string[] = [];
  for (let i = 0; i < exchanges.length && samples.length < 5; i += step) {
    const cleaned = stripNoise(exchanges[i].user_prompt);
    if (cleaned.length > 10) samples.push(cleaned.substring(0, 200));
  }

  // Get project path from file paths if available
  const filePaths = [...files].filter(Boolean).slice(0, 10);
  const topTools = [...toolNames].slice(0, 8);

  const prompt = `Generate a title (4-8 words, max 50 chars) for this coding session.

User prompts (sampled across ${exchanges.length} exchanges):
${samples.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Files: ${filePaths.join(", ") || "none"}
Tools: ${topTools.join(", ") || "none"}

FORMAT: "[Verb] [specific thing]" — like:
- "Build Keddy Dashboard & Timeline UI"
- "Fix SQLite Migration & FTS Search"
- "Add Plan Tracking & Task Extraction"
- "Debug Segment Classifier & Scroll Issues"
- "Configure npm Package & CI/CD Pipeline"

RULES:
- 4-8 words, max 50 characters
- Start with a verb: Build, Fix, Add, Debug, Refactor, Configure, Implement
- Name the ACTUAL project/feature from the prompts — don't invent names
- Just the title, nothing else`;

  const title = await provider.complete(prompt, model);
  return title.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^title:\s*/i, "")
    .split("\n")[0]
    .substring(0, 60);
}
