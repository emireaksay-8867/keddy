// ============================================================
// Keddy — Daily Notes Generator
//
// Architecture:
//   1. Classify sessions: fresh / stale / missing notes
//   2. Generate missing session notes in PARALLEL (blocking)
//   3. Build day-aware context (notes + stale supplements)
//   4. Daily synthesis via Agent SDK + MCP
//
// Key features:
//   - Parallel session note generation for uncached sessions
//   - Stale note detection (supplements uncovered exchanges)
//   - Exchange-level day-slicing via timestamps
//   - Free-form output (content determines structure)
//   - Streaming text_delta events
// ============================================================

import {
  getSessionsByDate,
  getDailyMilestones,
  getSessionNotes,
  getSession,
  getSessionTranscript,
  getSessionMilestones,
  getExchangeRangesByDate,
  getDailyNote,
  upsertSessionNote,
} from "../db/queries.js";
import { generateSessionNotesStream } from "./agent.js";
import { loadConfig } from "../cli/config.js";
import { createKeddyMcpServer } from "../mcp/tools.js";
import type { AgentEvent } from "./agent.js";
import type { Session } from "../types.js";

export interface DailyNotesResult {
  content: string;
  title: string | null;
  model: string | null;
  agentTurns: number;
  costUsd: number;
  sessionIds: string[];
}

export function getDailyData(dateStr: string) {
  return {
    sessions: getSessionsByDate(dateStr),
    milestones: getDailyMilestones(dateStr),
  };
}

// ── Session note generator (returns result for immediate use) ──

async function consumeSessionNoteGenerator(
  sessionId: string,
  options?: { apiKey?: string; model?: string },
): Promise<{ content: string; costUsd: number; agentTurns: number } | null> {
  try {
    const gen = generateSessionNotesStream(sessionId, options);
    let result: any = null;
    while (true) {
      const { value, done } = await gen.next();
      if (done) { result = value; break; }
    }
    if (result?.content) {
      const session = getSession(sessionId);
      if (session) {
        upsertSessionNote({
          session_id: session.id,
          content: result.content,
          mermaid: result.mermaid,
          model: result.model,
          agent_turns: result.agentTurns,
          cost_usd: result.costUsd,
          generated_at: new Date().toISOString(),
        });
      }
      return { content: result.content, costUsd: result.costUsd || 0, agentTurns: result.agentTurns || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Session skeleton for uncached sessions ───────────────────

function buildSessionSkeleton(
  session: Session,
  exchangeRange: { first_exchange: number; last_exchange: number; day_exchange_count: number },
  milestones: Array<{ milestone_type: string; exchange_index: number; description: string }>,
): string {
  const lines: string[] = [];
  lines.push(`Project: ${session.project_path}`);
  if (session.git_branch) lines.push(`Branch: ${session.git_branch}`);
  lines.push(`Today's exchanges: #${exchangeRange.first_exchange}–#${exchangeRange.last_exchange} (${exchangeRange.day_exchange_count} of ${session.exchange_count} total)`);

  const todayMilestones = milestones.filter(
    (m) => m.exchange_index >= exchangeRange.first_exchange && m.exchange_index <= exchangeRange.last_exchange,
  );
  if (todayMilestones.length > 0) {
    lines.push("Milestones:");
    for (const m of todayMilestones) {
      lines.push(`  [#${m.exchange_index}] ${m.milestone_type}: ${m.description}`);
    }
  }

  const exchanges = getSessionTranscript(session.id, {
    from: exchangeRange.first_exchange,
    to: exchangeRange.last_exchange,
  });
  if (exchanges.length > 0) {
    lines.push("Exchange outline:");
    for (const e of exchanges) {
      const firstLine = e.user_prompt.split("\n")[0].substring(0, 120);
      lines.push(`  #${e.exchange_index} (${e.timestamp}): ${firstLine}`);
    }
  }

  return lines.join("\n");
}

// ── Exchange supplement for stale notes ──────────────────────

function buildUncoveredSupplement(
  sessionId: string,
  range: { first_exchange: number; last_exchange: number },
  noteGeneratedAt: number,
): string {
  const exchanges = getSessionTranscript(sessionId, {
    from: range.first_exchange,
    to: range.last_exchange,
  });
  const uncovered = exchanges.filter(
    (e) => new Date(e.timestamp).getTime() > noteGeneratedAt,
  );
  if (uncovered.length === 0) return "";

  let supplement = `\n\n[${uncovered.length} exchanges since this note was generated:]`;
  supplement += "\nExchange outline:";
  for (const e of uncovered) {
    const firstLine = e.user_prompt.split("\n")[0].substring(0, 120);
    supplement += `\n  #${e.exchange_index} (${e.timestamp}): ${firstLine}`;
  }
  return supplement;
}

// ── System Prompt ────────────────────────────────────────────

function buildDailySystemPrompt(): string {
  return `You synthesize a day of coding sessions into a daily note.
Sessions are numbered chronologically: session 1 = first of the day.
You have MCP tools to read session transcripts, prior session notes, and daily notes. Use them to understand what actually happened — read the exchanges, check timestamps, trace how work unfolded through the day.

Each session below includes a pre-generated session note as expert context. Some may also include a supplement of exchanges that happened after the note was generated.

For multi-day sessions, focus ONLY on today's exchanges (ranges marked below).
Exchanges marked [COMPACTION SUMMARY] are compressed context, not conversations.

Write about this day. Whatever structure, format, or depth serves it best.
Let the content determine the shape. Connect sessions that relate to each other.
Reference sessions as [session N].
Use timestamps to understand the day — when sessions started, ended, gaps, pacing — and let that shape how you explain what happened.
When files changed or plans evolved, understand what the changes actually do and whether they match the intent. When referencing specific files, use the file search tool to verify what was actually touched — don't infer file names from conversation context alone. Connect the code changes to the decisions that drove them.
When sessions hit problems — things that broke, failed, or didn't work as expected — carry that depth through. The session notes may already detail exact errors, debugging attempts, and where investigations stopped. Preserve that specificity in the daily note. If something is unfinished or broken at end of day, that's the most important thing for tomorrow's context.
When changes were built or deployed, distinguish between "compiled successfully" and "user confirmed it works." A passing build doesn't mean the feature renders or behaves correctly. If session notes or transcripts show user confirmation, say so. If they don't, flag it as unverified.
If a previous day's note is provided, show how today connects to or continues from it.
Start directly with the content — no preamble.
At the very end, after the full analysis, write a single line: TITLE: <short title that captures the day's theme>`;
}

// ── Main Generator ──────────────────────────────────────────

export async function* generateDailyNotesStream(
  dateStr: string,
  options?: { apiKey?: string; model?: string; sessionIds?: string[] },
): AsyncGenerator<AgentEvent, DailyNotesResult> {
  // ── Phase 1: Load day data ──

  yield { type: "status", message: "Loading day data", detail: dateStr, timestamp: Date.now() };

  let sessions = getSessionsByDate(dateStr);
  if (options?.sessionIds && options.sessionIds.length > 0) {
    const allowed = new Set(options.sessionIds);
    sessions = sessions.filter((s) => allowed.has(s.session_id));
  }
  if (sessions.length === 0) throw new Error("No sessions found for this date");

  const sessionIds = sessions.map((s) => s.session_id);
  const milestones = getDailyMilestones(dateStr);
  const exchangeRanges = getExchangeRangesByDate(dateStr, sessions.map((s) => s.id));

  // Look up previous day's note for continuity
  const prevDate = new Date(dateStr + "T12:00:00");
  prevDate.setDate(prevDate.getDate() - 1);
  const prevDateStr = prevDate.toISOString().split("T")[0];
  const previousNote = getDailyNote(prevDateStr);

  yield {
    type: "tool_call",
    message: "Day loaded",
    detail: `${sessions.length} sessions, ${milestones.length} milestones`,
    timestamp: Date.now(),
  };

  // ── Phase 2a: Classify sessions (fresh / stale / missing) ──

  let totalCost = 0;
  let totalTurns = 0;

  const headers: string[] = [];
  const sessionContexts: string[] = [];
  const missingSessions: Array<{ session: Session; index: number }> = [];

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const num = i + 1;
    const project = s.project_path.split("/").pop() || s.project_path;
    const range = exchangeRanges[s.id];

    // Determine if multi-day
    const startDate = s.started_at?.substring(0, 10);
    const endDate = (s.ended_at || s.started_at)?.substring(0, 10);
    const isMultiDay = startDate !== endDate;

    // Build header with session_id and timestamps
    const dayExchCount = range?.day_exchange_count ?? s.exchange_count;
    let header = `## Session ${num}: "${s.title || s.session_id.substring(0, 16)}" — ${project}`;
    if (isMultiDay && range) {
      header += `, ${dayExchCount} exchanges today (exchanges #${range.first_exchange}–#${range.last_exchange} of ${s.exchange_count} total)`;
    } else {
      header += `, ${s.exchange_count} exchanges`;
    }
    header += `\nSession ID: ${s.session_id}`;
    header += `\nStarted: ${s.started_at}${s.ended_at ? ` | Ended: ${s.ended_at}` : " | Ongoing"}`;
    if (range) {
      header += `\nToday's exchange range: #${range.first_exchange}–#${range.last_exchange}`;
    }
    if (s.forked_from) {
      try {
        const forkData = JSON.parse(s.forked_from);
        const parentNum = sessions.findIndex((ps) => ps.session_id === forkData.sessionId) + 1;
        if (parentNum > 0) header += `\nForked from session ${parentNum}`;
      } catch {}
    }

    headers[i] = header;

    // Classify: fresh, stale, or missing
    const existingNotes = getSessionNotes(s.id);
    const latestNote = existingNotes[0];

    if (latestNote && range) {
      const noteGeneratedAt = new Date(latestNote.generated_at).getTime();

      // Check if session has exchanges on this date after the note was generated
      const todayExchanges = getSessionTranscript(s.id, {
        from: range.first_exchange,
        to: range.last_exchange,
      });
      const lastExchangeTs = todayExchanges.length > 0
        ? new Date(todayExchanges[todayExchanges.length - 1].timestamp).getTime()
        : 0;

      if (lastExchangeTs > noteGeneratedAt) {
        const uncoveredCount = todayExchanges.filter((e) => new Date(e.timestamp).getTime() > noteGeneratedAt).length;

        if (sessions.length === 1) {
          // Single-session day with stale note — regenerate it fully
          missingSessions.push({ session: s, index: i });
          sessionContexts[i] = `${header}\n\n[Regenerating session note — ${uncoveredCount} new exchanges...]`;
          yield { type: "status", message: `Session ${num}: stale note — will regenerate (${uncoveredCount} new exchanges)`, detail: project, timestamp: Date.now() };
        } else {
          // Multi-session day — supplement with uncovered exchanges
          const supplement = buildUncoveredSupplement(s.id, range, noteGeneratedAt);
          if (isMultiDay) {
            sessionContexts[i] = `${header}\n\nToday's portion: exchanges #${range.first_exchange}–#${range.last_exchange}\n\n${latestNote.content}${supplement}`;
          } else {
            sessionContexts[i] = `${header}\n\n${latestNote.content}${supplement}`;
          }
          yield { type: "status", message: `Session ${num}: cached note + ${uncoveredCount} new exchanges`, detail: project, timestamp: Date.now() };
        }
      } else {
        // FRESH — note covers everything
        if (isMultiDay) {
          sessionContexts[i] = `${header}\n\nToday's portion: exchanges #${range.first_exchange}–#${range.last_exchange}\n\n${latestNote.content}`;
        } else {
          sessionContexts[i] = `${header}\n\n${latestNote.content}`;
        }
        yield { type: "status", message: `Session ${num}: cached note`, detail: project, timestamp: Date.now() };
      }
    } else if (latestNote && !range) {
      // Has note but no exchanges on this date (UTC edge case)
      sessionContexts[i] = `${header}\n\n${latestNote.content}`;
      yield { type: "status", message: `Session ${num}: cached note (no exchanges on date)`, detail: project, timestamp: Date.now() };
    } else {
      // MISSING — needs generation
      missingSessions.push({ session: s, index: i });
      // Placeholder — will be replaced after generation
      sessionContexts[i] = `${header}\n\n[Generating session note...]`;
      yield { type: "status", message: `Session ${num}: no note — will generate`, detail: project, timestamp: Date.now() };
    }
  }

  // ── Phase 2b: Generate missing session notes in parallel ──

  if (missingSessions.length > 0) {
    yield {
      type: "status",
      message: `Generating ${missingSessions.length} session note${missingSessions.length > 1 ? "s" : ""} in parallel`,
      detail: missingSessions.map(({ index }) => `session ${index + 1}`).join(", "),
      timestamp: Date.now(),
    };

    const notePromises = missingSessions.map(async ({ session, index }) => {
      const result = await consumeSessionNoteGenerator(session.session_id, {
        apiKey: options?.apiKey,
        model: options?.model || (() => { const c = loadConfig(); return c.notes?.dailyModel || c.notes?.model || "sonnet"; })(),
      });
      return { index, session, result };
    });

    const results = await Promise.all(notePromises);

    for (const { index, session, result } of results) {
      if (result) {
        sessionContexts[index] = `${headers[index]}\n\n${result.content}`;
        totalCost += result.costUsd;
        totalTurns += result.agentTurns;
      } else {
        // Generation failed — fall back to skeleton
        const range = exchangeRanges[session.id];
        if (range) {
          const sessionMilestones = getSessionMilestones(session.id);
          const skeleton = buildSessionSkeleton(session, range, sessionMilestones);
          sessionContexts[index] = `${headers[index]}\n\n[Session note generation failed — skeleton below]\n\n${skeleton}`;
        } else {
          sessionContexts[index] = `${headers[index]}\n\n[Session note generation failed, no exchanges on date]`;
        }
      }
      yield { type: "tool_call", message: `Session ${index + 1}: note ready`, timestamp: Date.now() };
    }
  }

  // ── Single-session shortcut ──

  if (sessions.length === 1) {
    const s = sessions[0];
    const range = exchangeRanges[s.id];
    const startDate = s.started_at?.substring(0, 10);
    const endDate = (s.ended_at || s.started_at)?.substring(0, 10);
    const isMultiDay = startDate !== endDate;

    if (!isMultiDay) {
      // Single-day, single-session: use session note directly
      const freshNote = getSessionNotes(s.id)[0];
      if (freshNote) {
        yield { type: "status", message: "Single session — using session note directly", timestamp: Date.now() };

        let title: string | null = s.title || null;
        const headingMatch = freshNote.content.match(/^##?\s+(.+)$/m);
        if (headingMatch) title = headingMatch[1].substring(0, 120);

        yield {
          type: "result",
          message: `Done — ${totalTurns} turn${totalTurns !== 1 ? "s" : ""}, $${totalCost.toFixed(4)}`,
          detail: "1 session",
          timestamp: Date.now(),
        };

        return { content: freshNote.content, title, model: freshNote.model, agentTurns: totalTurns, costUsd: totalCost, sessionIds };
      }
    } else if (range) {
      // Multi-day, single-session: generate day-scoped session note with streaming
      yield { type: "status", message: "Single session (multi-day) — generating day-scoped note", detail: `exchanges #${range.first_exchange}–#${range.last_exchange}`, timestamp: Date.now() };

      const gen = generateSessionNotesStream(s.session_id, {
        apiKey: options?.apiKey,
        model: options?.model || (() => { const c = loadConfig(); return c.notes?.dailyModel || c.notes?.model || "sonnet"; })(),
        dayScope: { date: dateStr, fromExchange: range.first_exchange, toExchange: range.last_exchange },
      });

      let noteResult: any = null;
      while (true) {
        const { value, done } = await gen.next();
        if (done) { noteResult = value; break; }
        // Forward all events (text_delta, tool_call, status, etc.) to the daily notes UI
        yield value;
      }

      if (noteResult?.content) {
        totalCost += noteResult.costUsd || 0;
        totalTurns += noteResult.agentTurns || 0;

        let title: string | null = s.title || null;
        const headingMatch = noteResult.content.match(/^##?\s+(.+)$/m);
        if (headingMatch) title = headingMatch[1].substring(0, 120);

        return { content: noteResult.content, title, model: noteResult.model, agentTurns: totalTurns, costUsd: totalCost, sessionIds };
      }
      // If generation failed, fall through to Phase 3
    }
  }

  // ── Phase 3: Daily synthesis with MCP access (multi-session days) ──

  yield {
    type: "status",
    message: "Synthesizing daily note",
    detail: `${sessionContexts.length} sessions`,
    timestamp: Date.now(),
  };

  let queryFn: any;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    throw new Error("Claude Agent SDK not installed");
  }

  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.apiKey) env.ANTHROPIC_API_KEY = options.apiKey;

  let prompt = `Date: ${dateStr}\nTotal sessions: ${sessions.length}\n\n${sessionContexts.join("\n\n---\n\n")}`;
  if (previousNote) {
    prompt += `\n\n---\n\nPrevious day's note (${prevDateStr}):\n${previousNote.content.substring(0, 800)}`;
  }
  prompt += `\n\nWrite the daily note for ${dateStr}.`;

  const keddyServer = createKeddyMcpServer({ agentTools: true });
  const queryOptions: any = {
    systemPrompt: buildDailySystemPrompt(),
    model: options?.model || (() => { const c = loadConfig(); return c.notes?.dailyModel || c.notes?.model || "sonnet"; })(),
    mcpServers: {
      keddy: { type: "sdk" as const, name: "keddy", instance: keddyServer },
    },
    strictMcpConfig: true,
    allowedTools: ["mcp__keddy__*"],
    maxTurns: 20,
    maxBudgetUsd: 1.00,
    includePartialMessages: true,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    persistSession: false,
    env,
  };

  let result = "";
  let turns = 0;
  let cost = 0;
  let model: string | null = null;

  for await (const message of queryFn({ prompt, options: queryOptions })) {
    if (message.type === "system" && message.subtype === "init") {
      const mcpServers = message.mcp_servers || [];
      const connected = mcpServers.filter((s: any) => s.status === "connected");
      yield {
        type: "mcp_connect" as const,
        message: `MCP: ${connected.length} connected`,
        detail: mcpServers.map((s: any) => `${s.name}: ${s.status}`).join(", "),
        timestamp: Date.now(),
      };
    }

    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const toolName = (block.name || "").replace("mcp__keddy__", "");
          const input = block.input || {};
          let detail = "";
          if (input.session_id) detail = `session: ${String(input.session_id).substring(0, 12)}...`;
          if (input.from !== undefined || input.to !== undefined) detail = `range: #${input.from ?? 0}–#${input.to ?? "end"}`;
          if (input.query) detail = `query: "${input.query}"`;
          yield { type: "tool_call", message: toolName, detail, timestamp: Date.now() };
        }
      }
      const hasToolUse = message.message.content.some((b: any) => b.type === "tool_use");
      if (!hasToolUse) {
        yield { type: "thinking", message: "Writing daily note...", timestamp: Date.now() };
      }
    }

    if (message.type === "stream_event") {
      const event = (message as any).event;
      if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield { type: "text_delta" as const, message: event.delta.text, timestamp: Date.now() };
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        result = message.result || "";
        turns = message.num_turns || 0;
        cost = message.total_cost_usd || 0;
        // Use the model we requested — modelUsage includes internal tool-processing models (haiku)
        const MODEL_IDS: Record<string, string> = { sonnet: "claude-sonnet-4-6", opus: "claude-opus-4-6", haiku: "claude-haiku-4-5" };
        const requestedModel = options?.model || (() => { const c = loadConfig(); return c.notes?.dailyModel || c.notes?.model || "sonnet"; })();
        model = MODEL_IDS[requestedModel] || requestedModel;
        totalCost += cost;
        totalTurns += turns;
        yield {
          type: "result",
          message: `Done — ${totalTurns} turn${totalTurns !== 1 ? "s" : ""}, $${totalCost.toFixed(4)}`,
          detail: `${sessions.length} sessions`,
          timestamp: Date.now(),
        };
      } else {
        const errors = message.errors?.join(", ") || "unknown error";
        yield { type: "error", message: `Agent failed: ${message.subtype}`, detail: errors, timestamp: Date.now() };
        throw new Error(`Agent failed (${message.subtype}): ${errors}`);
      }
    }
  }

  if (!result) throw new Error("Agent returned empty result");

  // Extract TITLE: line from end of content
  let title: string | null = null;
  const titleMatch = result.match(/\nTITLE:\s*(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].trim();
    result = result.replace(/\nTITLE:\s*(.+)$/m, "").trim();
  }

  // Strip preamble before first ## heading
  const firstHeading = result.indexOf("## ");
  if (firstHeading > 0) result = result.substring(firstHeading);

  return { content: result, title, model, agentTurns: totalTurns, costUsd: totalCost, sessionIds };
}
