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
  cwd?: string;
  gitBranch?: string;
  version?: string;
  slug?: string;
  timestamp?: string;
  forkedFrom?: string;
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
  const exchanges: ParsedExchange[] = [];
  const compactionBoundaries: number[] = [];

  let currentUserPrompt = "";
  let currentTimestamp = "";
  let currentIsCompactSummary = false;
  let pendingToolCalls: ParsedToolCall[] = [];
  let exchangeIndex = 0;
  let inExchange = false;

  for (const entry of entries) {
    // Skip noise types
    if (entry.type && SKIP_TYPES.has(entry.type)) continue;

    // Extract metadata from early entries
    if (entry.sessionId && !sessionId) sessionId = entry.sessionId;
    if (entry.cwd && !projectPath) projectPath = entry.cwd;
    if (entry.gitBranch && !gitBranch) gitBranch = entry.gitBranch;
    if (entry.version && !claudeVersion) claudeVersion = entry.version;
    if (entry.slug && !slug) slug = entry.slug;
    if (entry.forkedFrom && !forkedFrom) forkedFrom = entry.forkedFrom as string;

    // Compaction boundary
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      compactionBoundaries.push(exchangeIndex);
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
          assistant_response: "",
          tool_calls: pendingToolCalls,
          timestamp: currentTimestamp,
          is_interrupt: false,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
      }

      currentUserPrompt = extractText(msgContent);
      currentTimestamp = entry.timestamp || new Date().toISOString();
      currentIsCompactSummary = true;
      inExchange = true;
      continue;
    }

    // User message with actual text content — starts a new exchange
    if (role === "user") {
      // If we had a pending exchange without assistant response, save it
      if (inExchange) {
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: "",
          tool_calls: pendingToolCalls,
          timestamp: currentTimestamp,
          is_interrupt: false,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
      }

      currentUserPrompt = extractText(msgContent);
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

      // Collect tool calls from this assistant message
      pendingToolCalls.push(...toolUses);

      // If we have a pending user prompt, check if this is a "final" assistant response
      // (i.e., it doesn't end with tool_use that needs results)
      // We only finalize the exchange when we see the next user text prompt or at EOF
      // But if there are no tool uses, this is a final response
      if (inExchange && toolUses.length === 0) {
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: assistantText,
          tool_calls: [...pendingToolCalls],
          timestamp: currentTimestamp,
          is_interrupt: interrupt,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
        inExchange = false;
      } else if (inExchange && interrupt) {
        // Interrupted — finalize
        exchanges.push({
          index: exchangeIndex,
          user_prompt: currentUserPrompt,
          assistant_response: assistantText,
          tool_calls: [...pendingToolCalls],
          timestamp: currentTimestamp,
          is_interrupt: true,
          is_compact_summary: currentIsCompactSummary,
        });
        exchangeIndex++;
        pendingToolCalls = [];
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
      assistant_response: "",
      tool_calls: pendingToolCalls,
      timestamp: currentTimestamp,
      is_interrupt: false,
      is_compact_summary: currentIsCompactSummary,
    });
  }

  return {
    session_id: sessionId,
    project_path: projectPath,
    git_branch: gitBranch,
    claude_version: claudeVersion,
    slug,
    forked_from: forkedFrom,
    exchanges,
    compaction_boundaries: compactionBoundaries,
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
