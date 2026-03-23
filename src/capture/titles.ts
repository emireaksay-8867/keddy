/**
 * Derives a session title from the first real user prompt.
 * Strips IDE/system noise tags and finds the actual human text.
 * Shared by handler.ts and import.ts to ensure consistent title quality.
 */

/** Strip all known noise tags from a prompt to find real user text */
function stripNoiseTags(text: string): string {
  let cleaned = text;
  // Strip IDE-injected tags (Cursor, VS Code)
  cleaned = cleaned.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "");
  cleaned = cleaned.replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, "");
  // Strip system tags
  cleaned = cleaned.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  cleaned = cleaned.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "");
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  cleaned = cleaned.replace(/<available-deferred-tools>[\s\S]*?<\/available-deferred-tools>/g, "");
  cleaned = cleaned.replace(/<bash-input>[\s\S]*?<\/bash-input>/g, "");
  cleaned = cleaned.replace(/<bash-stdout>[\s\S]*?<\/bash-stdout>/g, "");
  cleaned = cleaned.replace(/<bash-stderr>[\s\S]*?<\/bash-stderr>/g, "");
  cleaned = cleaned.replace(/<command-name>[\s\S]*?<\/command-name>/g, "");
  cleaned = cleaned.replace(/<command-message>[\s\S]*?<\/command-message>/g, "");
  cleaned = cleaned.replace(/<command-args>[\s\S]*?<\/command-args>/g, "");
  cleaned = cleaned.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  cleaned = cleaned.replace(/<file_[a-z_]+>[\s\S]*?<\/file_[a-z_]+>/g, "");
  // Strip any remaining XML-style tags as catch-all
  cleaned = cleaned.replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/g, "");
  // Strip image references
  cleaned = cleaned.replace(/\[Image:[^\]]*\]/g, "");
  // Strip interrupt markers
  cleaned = cleaned.replace(/\[Request interrupted by user(?:\s+for tool use)?\]/g, "");
  return cleaned.trim();
}

/** Find first real user prompt, skipping noise and extracting text from inside tags */
export function deriveTitle(exchanges: Array<{ user_prompt: string }>): string | null {
  for (const ex of exchanges) {
    const cleaned = stripNoiseTags(ex.user_prompt);
    if (!cleaned) continue;
    // Skip very short text (likely fragments)
    if (cleaned.length < 3) continue;
    // Skip "Tool loaded." prompts
    if (cleaned.startsWith("Tool loaded.")) continue;
    // Skip image-only placeholders
    if (cleaned === "(attached image)" || /^\(\d+ attached images\)$/.test(cleaned)) continue;
    // Truncate at word boundary with ellipsis
    if (cleaned.length <= 80) return cleaned;
    const cut = cleaned.substring(0, 80);
    const lastSpace = cut.lastIndexOf(" ");
    // If there's a space in the last 20 chars, cut at the word boundary
    if (lastSpace > 60) return cut.substring(0, lastSpace) + "...";
    return cut + "...";
  }
  return null;
}
