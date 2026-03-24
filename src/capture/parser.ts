import { readFileSync } from "node:fs";
import type { ParsedExchange, ParsedToolCall, ParsedTranscript } from "../types.js";

// Types for JSONL entries
interface JsonlEntry {
  type?: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  isCompactSummary?: boolean;
  sessionId?: string;
  uuid?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  slug?: string;
  timestamp?: string;
  forkedFrom?: string | { sessionId?: string; messageUuid?: string };
  isSidechain?: boolean;
  compactMetadata?: {
    exchangesBefore?: number;
    exchangesAfter?: number;
  };
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

const SKIP_TYPES = new Set(["progress", "queue-operation", "file-history-snapshot"]);

function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

/** Check if a user message contains image blocks */
function hasImages(content: string | ContentBlock[] | undefined): boolean {
  if (!content || typeof content === "string") return false;
  return content.some((b) => b.type === "image");
}

/** Count image blocks in content */
function countImages(content: string | ContentBlock[] | undefined): number {
  if (!content || typeof content === "string") return 0;
  return content.filter((b) => b.type === "image").length;
}

/** Check if a user message is an interrupt-only message (no real content) */
function isInterruptOnly(content: string | ContentBlock[] | undefined): boolean {
  if (!content) return false;
  if (typeof content === "string") {
    return (
      content.trim() === "[Request interrupted by user]" ||
      content.trim() === "[Request interrupted by user for tool use]"
    );
  }
  // All blocks are either interrupt text or empty
  const textBlocks = content.filter((b) => b.type === "text" && b.text);
  return (
    textBlocks.length > 0 &&
    textBlocks.every(
      (b) =>
        b.text?.trim() === "[Request interrupted by user]" ||
        b.text?.trim() === "[Request interrupted by user for tool use]",
    )
  );
}

/** Check if content has only images and [Image: ...] text references (no real text) */
function isImageRefOnly(content: string | ContentBlock[] | undefined): boolean {
  if (!content || typeof content === "string") return false;
  const textBlocks = content.filter((b) => b.type === "text" && b.text);
  if (textBlocks.length === 0) return hasImages(content);
  // All text blocks are just image reference markers
  return textBlocks.every((b) => /^\s*\[Image:\s*source:/.test(b.text!));
}

function extractToolUses(content: string | ContentBlock[] | undefined): ParsedToolCall[] {
  if (!content || typeof content === "string") return [];
  return content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      name: b.name!,
      input: b.input,
      id: b.id!,
    }));
}

function matchToolResults(
  toolCalls: ParsedToolCall[],
  content: string | ContentBlock[] | undefined,
): void {
  if (!content || typeof content === "string") return;
  for (const block of content) {
    if (block.type === "tool_result" && block.tool_use_id) {
      const tc = toolCalls.find((t) => t.id === block.tool_use_id);
      if (tc) {
        tc.result =
          typeof block.content === "string"
            ? block.content
            : extractText(block.content as ContentBlock[]);
        tc.is_error = block.is_error ?? false;
      }
    }
  }
}

function isToolResultOnly(content: string | ContentBlock[] | undefined): boolean {
  if (!content || typeof content === "string") return false;
  // A user message is "tool result only" if it contains only tool_result blocks
  return content.length > 0 && content.every((b) => b.type === "tool_result");
}

function isInterrupt(content: string | ContentBlock[] | undefined): boolean {
  if (!content) return false;
  if (typeof content === "string") {
    return (
      content === '[Request interrupted by user]' ||
      content === '[Request interrupted by user for tool use]'
    );
  }
  return content.some(
    (b) =>
      b.type === "text" &&
      (b.text === '[Request interrupted by user]' ||
        b.text === '[Request interrupted by user for tool use]'),
  );
}

function parseEntries(lines: string[]): JsonlEntry[] {
  const entries: JsonlEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

export function parseTranscript(filePath: string): ParsedTranscript {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const entries = parseEntries(lines);

  let sessionId = "";
  let projectPath = "";
  let gitBranch: string | null = null;
  let claudeVersion: string | null = null;
  let slug: string | null = null;
  let forkedFrom: string | null = null;
  let customTitle: string | null = null;
  let startedAt: string | null = null;
  const exchanges: ParsedExchange[] = [];
  const compactions: Array<{ exchange_index: number; summary: string | null; pre_tokens: number | null }> = [];

  let currentUserPrompt = "";
  let currentAssistantText = "";
  let currentTimestamp = "";
  let currentIsCompactSummary = false;
  let pendingToolCalls: ParsedToolCall[] = [];
  let exchangeIndex = 0;
  let inExchange = false;

  // Fork detection: track when we pass the fork point
  let forkMessageUuid: string | null = null;
  let passedForkPoint = false;
  let forkExchangeIndex: number | null = null;

  for (const entry of entries) {
    // Skip noise types
    if (entry.type && SKIP_TYPES.has(entry.type)) continue;

    // Extract metadata from early entries
    if (entry.sessionId && !sessionId) sessionId = entry.sessionId;
    if (entry.cwd && !projectPath) projectPath = entry.cwd;
    if (entry.gitBranch) gitBranch = entry.gitBranch; // Always update — use latest branch
    if (entry.version && !claudeVersion) claudeVersion = entry.version;
    if (entry.slug && !slug) slug = entry.slug;
    if (entry.forkedFrom && !forkedFrom) {
      forkedFrom = typeof entry.forkedFrom === "string"
        ? entry.forkedFrom
        : JSON.stringify(entry.forkedFrom);
      // Extract fork point messageUuid for divergence detection
      if (typeof entry.forkedFrom === "object" && entry.forkedFrom?.messageUuid) {
        forkMessageUuid = entry.forkedFrom.messageUuid;
      }
    }

    // Detect fork divergence: once we see an entry WITHOUT forkedFrom,
    // or whose uuid matches the fork point, we've passed it
    if (forkMessageUuid && !passedForkPoint) {
      if (!entry.forkedFrom) {
        // Entry without forkedFrom = new content after fork
        passedForkPoint = true;
        forkExchangeIndex = exchangeIndex;
      }
    }
    if (entry.timestamp) {
      if (!startedAt) startedAt = entry.timestamp;
      // Always update — last one wins for ended_at
    }

    // Custom title from /rename — last one wins
    if (entry.type === "custom-title" && typeof (entry as any).customTitle === "string") {
      // The first custom-title in a forked session marks the fork divergence point
      // (Claude Code auto-generates a "(Branch)" or "(Fork)" title at fork time)
      if (forkMessageUuid && forkExchangeIndex === null) {
        forkExchangeIndex = exchangeIndex;
      }
      let title = (entry as any).customTitle as string;
      // Strip noise tags that Claude Code sometimes includes in auto-generated titles
      title = title
        .replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/g, "")
        .replace(/<[a-z_-]+>[^<]*/g, "")
        .trim();
      // Skip auto-generated fork titles that are just truncated parent prompts
      // (they end with "(Fork)", "(Branch)", "(Fork 2)" etc. and are >60 chars)
      if (title.length > 60 && /\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/.test(title)) {
        // Don't set as custom title — let deriveTitle find a better one
        continue;
      }
      if (title) {
        customTitle = title;
      }
      continue;
    }

    // Compaction boundary — capture metadata and content
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const meta = entry.compactMetadata as Record<string, unknown> | undefined;
      compactions.push({
        exchange_index: exchangeIndex,
        summary: null, // Will be filled from the next isCompactSummary entry
        pre_tokens: (meta?.preTokens as number) || null,
      });
      continue;
    }

    const role = entry.message?.role ?? entry.type;
    const msgContent = entry.message?.content;

    // User message that is ONLY tool results — this is a continuation, not a new exchange
    if (role === "user" && !entry.isCompactSummary && isToolResultOnly(msgContent)) {
      // Match tool results to pending tool calls from the previous assistant message
      matchToolResults(pendingToolCalls, msgContent);
      continue;
    }

    // Compact summary
    if (role === "user" && entry.isCompactSummary) {
      if (inExchange) {
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: currentAssistantText,
          tool_calls: pendingToolCalls,
          timestamp: currentTimestamp,
          is_interrupt: false,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
      }

      currentUserPrompt = extractText(msgContent);
      currentTimestamp = entry.timestamp || new Date().toISOString();
      currentIsCompactSummary = true;
      inExchange = true;

      // Link this compact summary to the most recent compaction event
      if (compactions.length > 0 && !compactions[compactions.length - 1].summary) {
        compactions[compactions.length - 1].summary = currentUserPrompt;
      }

      continue;
    }

    // User message with actual text content — starts a new exchange
    // But first: skip system-injected messages that aren't real user input
    if (role === "user") {
      const text = extractText(msgContent);
      const isSystemInjected =
        text.startsWith("<task-notification>") ||
        text.startsWith("<system-reminder>") ||
        text.startsWith("<task-completed>") ||
        text.startsWith("<available-deferred-tools>");
      if (isSystemInjected) {
        // Drop entirely — don't store system-injected content as user input
        continue;
      }

      // Filter IDE-only noise: messages that are purely IDE metadata with no real user text
      // e.g. "<ide_opened_file>...opened file X...</ide_opened_file>" with nothing else
      if (text.startsWith("<ide_") || text.startsWith("<bash-input>") ||
          text.startsWith("<bash-stdout>") || text.startsWith("<local-command-caveat>")) {
        const stripped = text
          .replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, "")
          .replace(/<bash-input>[\s\S]*?<\/bash-input>/g, "")
          .replace(/<bash-stdout>[\s\S]*?<\/bash-stdout>/g, "")
          .replace(/<bash-stderr>[\s\S]*?<\/bash-stderr>/g, "")
          .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
          .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
          .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
          .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
          .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
          .trim();
        if (!stripped) {
          // Pure noise — no real user text. Drop entirely.
          continue;
        }
      }

      // Bug fix 1c: Interrupt-only messages (user hit Esc) — mark previous exchange as interrupted, don't create new one
      if (isInterruptOnly(msgContent)) {
        if (inExchange) {
          exchanges.push({
            index: exchangeIndex,
            user_prompt: currentUserPrompt,
            assistant_response: currentAssistantText,
            tool_calls: pendingToolCalls,
            timestamp: currentTimestamp,
            is_interrupt: true,
            is_compact_summary: currentIsCompactSummary,
          });
          exchangeIndex++;
          pendingToolCalls = [];
          currentAssistantText = "";
          inExchange = false;
        }
        continue;
      }

      // Bug fix 1b: Image-only messages (screenshots with no text) — merge into adjacent exchange
      if (isImageRefOnly(msgContent)) {
        const imgCount = countImages(msgContent);
        const imgTag = imgCount === 1 ? "(attached image)" : `(${imgCount} attached images)`;
        if (inExchange) {
          // Append image reference to current user prompt
          currentUserPrompt += (currentUserPrompt ? "\n" : "") + imgTag;
        }
        // If not in an exchange, this will be picked up by the next user message below
        continue;
      }
    }

    if (role === "user") {
      // If we had a pending exchange without assistant response, save it
      if (inExchange) {
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: currentAssistantText,
          tool_calls: pendingToolCalls,
          timestamp: currentTimestamp,
          is_interrupt: false,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
      }

      // Build user prompt — include image placeholders alongside text
      let prompt = extractText(msgContent);
      if (hasImages(msgContent)) {
        const imgCount = countImages(msgContent);
        const imgTag = imgCount === 1 ? "(attached image)" : `(${imgCount} attached images)`;
        prompt += (prompt ? "\n" : "") + imgTag;
      }

      currentUserPrompt = prompt;
      currentTimestamp = entry.timestamp || new Date().toISOString();
      currentIsCompactSummary = false;
      inExchange = true;
      continue;
    }

    // Assistant message
    if (role === "assistant") {
      const assistantText = extractText(msgContent);
      const toolUses = extractToolUses(msgContent);
      const interrupt = isInterrupt(msgContent);
      const hasThinking = Array.isArray(msgContent) && msgContent.some((b) => b.type === "thinking");

      // Accumulate assistant text across multi-turn tool exchanges
      if (assistantText) {
        currentAssistantText += (currentAssistantText ? "\n" : "") + assistantText;
      }

      // Collect tool calls from this assistant message
      pendingToolCalls.push(...toolUses);

      // Skip thinking-only blocks — they're intermediate, not a final response
      if (!assistantText && toolUses.length === 0 && hasThinking) {
        continue;
      }

      // If there are no tool uses, this is the final response — finalize exchange
      if (inExchange && toolUses.length === 0) {
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: currentAssistantText,
          tool_calls: [...pendingToolCalls],
          timestamp: currentTimestamp,
          is_interrupt: interrupt,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
        inExchange = false;
      } else if (inExchange && interrupt) {
        // Interrupted — finalize
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: currentAssistantText,
          tool_calls: [...pendingToolCalls],
          timestamp: currentTimestamp,
          is_interrupt: true,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
        inExchange = false;
      }
      // If there are tool uses, we wait for tool results + next assistant message
      continue;
    }
  }

  // Handle trailing exchange without final assistant response
  if (inExchange) {
    exchanges.push({
      index: exchangeIndex,
      user_prompt: currentUserPrompt,
      assistant_response: currentAssistantText,
      tool_calls: pendingToolCalls,
      timestamp: currentTimestamp,
      is_interrupt: false,
      is_compact_summary: currentIsCompactSummary,
    });
  }

  // Derive timestamps from exchanges if not captured from metadata
  const firstTs = startedAt || exchanges[0]?.timestamp || null;
  const lastTs = exchanges.length > 0 ? exchanges[exchanges.length - 1].timestamp : firstTs;

  return {
    session_id: sessionId,
    project_path: projectPath,
    git_branch: gitBranch,
    claude_version: claudeVersion,
    slug,
    forked_from: forkedFrom,
    custom_title: customTitle,
    started_at: firstTs,
    ended_at: lastTs,
    exchanges,
    compactions,
    fork_exchange_index: forkExchangeIndex,
  };
}

export function parseLatestExchanges(
  filePath: string,
  sinceIndex?: number,
): ParsedExchange[] {
  const transcript = parseTranscript(filePath);
  if (sinceIndex === undefined) {
    return transcript.exchanges.slice(-1);
  }
  return transcript.exchanges.filter((e) => e.index >= sinceIndex);
}
