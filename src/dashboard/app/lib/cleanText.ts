/**
 * Strips Claude Code system noise from exchange text before display.
 * Single source of truth — used by both SessionDetail and ContentPanel.
 */
export function cleanText(text: string): { cleaned: string; wasInterrupted: boolean } {
  let wasInterrupted = false;
  let cleaned = text;

  // Detect and strip interrupt markers
  if (/\[Request interrupted by user(?:\s+for tool use)?\]/.test(cleaned)) {
    wasInterrupted = true;
    cleaned = cleaned.replace(/\[Request interrupted by user(?:\s+for tool use)?\]/g, "").trim();
  }

  // Strip Claude Code internal XML tags
  cleaned = cleaned.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  cleaned = cleaned.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "");
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  cleaned = cleaned.replace(/<bash-input>[\s\S]*?<\/bash-input>/g, "");
  cleaned = cleaned.replace(/<bash-stdout>[\s\S]*?<\/bash-stdout>/g, "");
  cleaned = cleaned.replace(/<bash-stderr>[\s\S]*?<\/bash-stderr>/g, "");
  cleaned = cleaned.replace(/<command-name>[\s\S]*?<\/command-name>/g, "");
  cleaned = cleaned.replace(/<command-message>[\s\S]*?<\/command-message>/g, "");
  cleaned = cleaned.replace(/<command-args>[\s\S]*?<\/command-args>/g, "");
  cleaned = cleaned.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  cleaned = cleaned.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "");
  // Catch-all for any remaining XML-style tags
  cleaned = cleaned.replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/g, "");

  // Replace image references with readable placeholder
  cleaned = cleaned.replace(/\[Image:\s*source:\s*\/var\/folders\/[^\]]*\]/g, "(attached image)");
  // Strip internal temp paths — show just the filename
  cleaned = cleaned.replace(/\/private\/tmp\/claude-\d+\/[^\s)]*\/([^\s/)]+)/g, "$1");
  // Strip agent output file references
  cleaned = cleaned.replace(/Read the output file to retrieve the result:\s*\/private\/tmp\/[^\s]*/g, "(reading agent output)");
  cleaned = cleaned.replace(/Read the output file to retrieve the result:\s*\S+\.output/g, "");

  return { cleaned: cleaned.trim(), wasInterrupted };
}
