import type { LLMProvider } from "./providers.js";
import type { ParsedExchange } from "../types.js";

export async function generateTitle(
  provider: LLMProvider,
  exchanges: ParsedExchange[],
  model: string,
): Promise<string> {
  const first = exchanges[0];
  const last = exchanges[exchanges.length - 1];
  if (!first) return "Untitled Session";

  const prompt = `Generate a concise title (max 60 chars) for a coding session. First prompt: "${first.user_prompt.substring(0, 200)}". Last prompt: "${last?.user_prompt.substring(0, 200) ?? ""}". Total exchanges: ${exchanges.length}. Reply with ONLY the title, no quotes.`;

  const title = await provider.complete(prompt, model);
  return title.trim().substring(0, 80);
}
