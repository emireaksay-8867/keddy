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

/** Truncate text at word boundary with ellipsis */
function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.substring(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLen - 20) return cut.substring(0, lastSpace) + "...";
  return cut + "...";
}

/** Derive a session title with context-aware priority */
export function deriveTitle(
  exchanges: Array<{ user_prompt: string }>,
  context?: {
    plans?: Array<{ plan_text: string; status: string; exchange_index_start?: number }>;
    milestones?: Array<{ milestone_type: string; description: string; exchange_index?: number }>;
    /** For forked sessions: index where new content starts (skip inherited exchanges) */
    forkExchangeIndex?: number | null;
  },
): string | null {
  const forkIdx = context?.forkExchangeIndex ?? null;

  // For forked sessions, only consider exchanges after the fork point
  const relevantExchanges = forkIdx != null
    ? exchanges.slice(forkIdx)
    : exchanges;

  // Priority 1: Use the latest approved/implemented plan's first meaningful line
  // For forked sessions, only consider plans created after the fork point
  if (context?.plans) {
    const relevantPlans = forkIdx != null
      ? context.plans.filter((p) => p.exchange_index_start == null || p.exchange_index_start >= forkIdx)
      : context.plans;

    const activePlan = [...relevantPlans]
      .reverse()
      .find((p) => p.status === "implemented" || p.status === "approved");
    if (activePlan) {
      const firstLine = activePlan.plan_text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 3 && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("##"));
      if (firstLine) {
        const clean = firstLine.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/\*\*/g, "");
        if (clean.length > 3) return truncateAtWord(clean, 80);
      }
    }
  }

  // Priority 2: Use first commit message
  // For forked sessions, only consider milestones after the fork point
  if (context?.milestones) {
    const relevantMilestones = forkIdx != null
      ? context.milestones.filter((m) => m.exchange_index == null || m.exchange_index >= forkIdx)
      : context.milestones;

    const firstCommit = relevantMilestones.find((m) => m.milestone_type === "commit");
    if (firstCommit && firstCommit.description.length > 3) {
      return truncateAtWord(firstCommit.description, 80);
    }
  }

  // Priority 3: First real user prompt (from fork-relevant exchanges)
  for (const ex of relevantExchanges) {
    const cleaned = stripNoiseTags(ex.user_prompt);
    if (!cleaned) continue;
    if (cleaned.length < 3) continue;
    if (cleaned.startsWith("Tool loaded.")) continue;
    if (cleaned === "(attached image)" || /^\(\d+ attached images\)$/.test(cleaned)) continue;
    return truncateAtWord(cleaned, 80);
  }
  return null;
}
