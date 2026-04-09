import { readFileSync } from "node:fs";
import type { ParsedExchange, ParsedToolCall, ParsedTranscript, ContentBlockRef } from "../types.js";

// Types for JSONL entries
interface JsonlEntry {
  type?: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
    stop_reason?: string | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
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
  permissionMode?: string;
  isSidechain?: boolean;
  entrypoint?: string;
  durationMs?: number;
  compactMetadata?: {
    exchangesBefore?: number;
    exchangesAfter?: number;
    preTokens?: number;
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
  let currentAssistantTextPre = "";
  let currentTimestamp = "";
  let currentIsCompactSummary = false;
  let pendingToolCalls: ParsedToolCall[] = [];
  let currentContentBlocks: ContentBlockRef[] = [];
  let exchangeIndex = 0;
  let inExchange = false;

  // Fork detection: track when we pass the fork point
  let forkMessageUuid: string | null = null;
  let passedForkPoint = false;
  let forkExchangeIndex: number | null = null;

  // Facts-first: per-exchange metadata accumulators
  let currentModel: string | null = null;
  let currentInputTokens: number | null = null;
  let currentOutputTokens: number | null = null;
  let currentCacheReadTokens: number | null = null;
  let currentCacheWriteTokens: number | null = null;
  let currentStopReason: string | null = null;
  let currentHasThinking = false;
  let currentPermissionMode: string | null = null;
  let currentIsSidechain: boolean | null = null;
  let currentEntrypoint: string | null = null;
  let currentExchangeCwd: string | null = null;
  let currentExchangeBranch: string | null = null;
  let sessionEntrypoint: string | null = null;
  let currentTurnDuration: number | null = null;

  /** Build the facts-first fields object for exchange pushes */
  function factsFields() {
    return {
      model: currentModel,
      input_tokens: currentInputTokens,
      output_tokens: currentOutputTokens,
      cache_read_tokens: currentCacheReadTokens,
      cache_write_tokens: currentCacheWriteTokens,
      stop_reason: currentStopReason,
      has_thinking: currentHasThinking || undefined,
      permission_mode: currentPermissionMode,
      is_sidechain: currentIsSidechain ?? undefined,
      entrypoint: currentEntrypoint,
      cwd: currentExchangeCwd,
      git_branch: currentExchangeBranch,
      turn_duration_ms: currentTurnDuration,
    };
  }

  /** Reset assistant-side accumulators for new exchange */
  function resetAssistantAccumulators() {
    currentModel = null;
    currentInputTokens = null;
    currentOutputTokens = null;
    currentCacheReadTokens = null;
    currentCacheWriteTokens = null;
    currentStopReason = null;
    currentHasThinking = false;
    currentContentBlocks = [];
  }

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

    // Turn duration — belongs to the CURRENT exchange being accumulated (not the previous one).
    // This entry appears after the assistant response but before the next user message.
    if (entry.type === "system" && entry.subtype === "turn_duration" && entry.durationMs) {
      currentTurnDuration = entry.durationMs;
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
        const _r = pendingToolCalls.length === 0 && currentAssistantTextPre && !currentAssistantText;
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: _r ? currentAssistantTextPre : currentAssistantText,
          assistant_response_pre: _r ? "" : currentAssistantTextPre,
          tool_calls: pendingToolCalls,
          timestamp: currentTimestamp,
          is_interrupt: false,
          is_compact_summary: currentIsCompactSummary,
          content_blocks: currentContentBlocks.length > 0 ? [...currentContentBlocks] : undefined,
          ...factsFields(),
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
        currentAssistantTextPre = "";
        resetAssistantAccumulators();
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
          const _r = pendingToolCalls.length === 0 && currentAssistantTextPre && !currentAssistantText;
          exchanges.push({
            index: exchangeIndex,
            user_prompt: currentUserPrompt,
            assistant_response: _r ? currentAssistantTextPre : currentAssistantText,
            assistant_response_pre: _r ? "" : currentAssistantTextPre,
            tool_calls: pendingToolCalls,
            timestamp: currentTimestamp,
            is_interrupt: true,
            is_compact_summary: currentIsCompactSummary,
            content_blocks: currentContentBlocks.length > 0 ? [...currentContentBlocks] : undefined,
            ...factsFields(),
          });
          exchangeIndex++;
          pendingToolCalls = [];
          currentAssistantText = "";
          currentAssistantTextPre = "";
          resetAssistantAccumulators();
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
        // When no tools were called, all text lands in pre — move to main response
        const finalResponse = pendingToolCalls.length === 0 && currentAssistantTextPre && !currentAssistantText
          ? currentAssistantTextPre : currentAssistantText;
        const finalPre = pendingToolCalls.length === 0 && currentAssistantTextPre && !currentAssistantText
          ? "" : currentAssistantTextPre;
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: finalResponse,
          assistant_response_pre: finalPre,
          tool_calls: pendingToolCalls,
          timestamp: currentTimestamp,
          is_interrupt: false,
          is_compact_summary: currentIsCompactSummary,
          content_blocks: currentContentBlocks.length > 0 ? [...currentContentBlocks] : undefined,
          ...factsFields(),
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
        currentAssistantTextPre = "";
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

      // Facts-first: capture per-exchange metadata from user entry
      if (entry.permissionMode) currentPermissionMode = entry.permissionMode;
      if (entry.entrypoint) {
        currentEntrypoint = entry.entrypoint;
        if (!sessionEntrypoint) sessionEntrypoint = entry.entrypoint;
      }
      if (entry.cwd) currentExchangeCwd = entry.cwd;
      if (entry.gitBranch) currentExchangeBranch = entry.gitBranch;
      if (entry.isSidechain !== undefined) currentIsSidechain = entry.isSidechain;
      resetAssistantAccumulators();
      currentTurnDuration = null;

      continue;
    }

    // Assistant message
    if (role === "assistant") {
      const assistantText = extractText(msgContent);
      const toolUses = extractToolUses(msgContent);
      const interrupt = isInterrupt(msgContent);
      const hasThinking = Array.isArray(msgContent) && msgContent.some((b) => b.type === "thinking");

      // Build ordered content blocks — preserves the exact sequence of events
      if (Array.isArray(msgContent)) {
        for (const block of msgContent) {
          if (block.type === "thinking") {
            currentContentBlocks.push({ type: "thinking" });
          } else if (block.type === "text" && block.text?.trim()) {
            currentContentBlocks.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use" && block.id) {
            currentContentBlocks.push({ type: "tool_use", tool_use_id: block.id });
          }
        }
      }

      // Facts-first: extract metadata from assistant entry (last-wins for multi-block turns)
      if (entry.message?.model) currentModel = entry.message.model;
      if (entry.message?.usage) {
        if (entry.message.usage.input_tokens !== undefined) currentInputTokens = entry.message.usage.input_tokens;
        if (entry.message.usage.output_tokens !== undefined) currentOutputTokens = entry.message.usage.output_tokens;
        if (entry.message.usage.cache_read_input_tokens !== undefined) currentCacheReadTokens = entry.message.usage.cache_read_input_tokens;
        if (entry.message.usage.cache_creation_input_tokens !== undefined) currentCacheWriteTokens = entry.message.usage.cache_creation_input_tokens;
      }
      if (entry.message?.stop_reason !== undefined) currentStopReason = entry.message.stop_reason;
      if (hasThinking) currentHasThinking = true;
      if (entry.entrypoint) {
        currentEntrypoint = entry.entrypoint;
        if (!sessionEntrypoint) sessionEntrypoint = entry.entrypoint;
      }
      if (entry.cwd) currentExchangeCwd = entry.cwd;
      if (entry.gitBranch) currentExchangeBranch = entry.gitBranch;
      if (entry.isSidechain !== undefined) currentIsSidechain = entry.isSidechain;

      // Accumulate assistant text — track pre-tool vs post-tool ordering
      if (assistantText) {
        if (pendingToolCalls.length === 0) {
          // No tool calls seen yet — this is pre-tool text
          currentAssistantTextPre += (currentAssistantTextPre ? "\n" : "") + assistantText;
        } else {
          // Tool calls already seen — this is post-tool text
          currentAssistantText += (currentAssistantText ? "\n" : "") + assistantText;
        }
      }

      // Collect tool calls from this assistant message
      pendingToolCalls.push(...toolUses);

      // Skip thinking-only blocks — they're intermediate, not a final response
      if (!assistantText && toolUses.length === 0 && hasThinking) {
        continue;
      }

      // Don't finalize on text-only assistant messages — Claude Code logs text and
      // tool_use as SEPARATE JSONL entries. Exchanges are finalized by the next user
      // message (line 436), interrupt detection, or end-of-file (line 558).
      if (inExchange && interrupt) {
        // Interrupted — finalize
        const _r = pendingToolCalls.length === 0 && currentAssistantTextPre && !currentAssistantText;
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: _r ? currentAssistantTextPre : currentAssistantText,
          assistant_response_pre: _r ? "" : currentAssistantTextPre,
          tool_calls: [...pendingToolCalls],
          timestamp: currentTimestamp,
          is_interrupt: true,
          is_compact_summary: currentIsCompactSummary,
          content_blocks: currentContentBlocks.length > 0 ? [...currentContentBlocks] : undefined,
          ...factsFields(),
        });
        exchangeIndex++;
        pendingToolCalls = [];
        currentAssistantText = "";
        currentAssistantTextPre = "";
        resetAssistantAccumulators();
        inExchange = false;
      }
      // If there are tool uses, we wait for tool results + next assistant message
      continue;
    }
  }

  // Handle trailing exchange without final assistant response
  if (inExchange) {
    const _r = pendingToolCalls.length === 0 && currentAssistantTextPre && !currentAssistantText;
    exchanges.push({
      index: exchangeIndex,
      user_prompt: currentUserPrompt,
      assistant_response: _r ? currentAssistantTextPre : currentAssistantText,
      assistant_response_pre: _r ? "" : currentAssistantTextPre,
      tool_calls: pendingToolCalls,
      timestamp: currentTimestamp,
      is_interrupt: false,
      is_compact_summary: currentIsCompactSummary,
      content_blocks: currentContentBlocks.length > 0 ? [...currentContentBlocks] : undefined,
      ...factsFields(),
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
    entrypoint: sessionEntrypoint,
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
