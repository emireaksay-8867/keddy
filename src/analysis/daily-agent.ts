// ============================================================
// Keddy — Daily Notes Generator
//
// 1. Collects session notes for the day (generates missing ones IN PARALLEL)
// 2. Feeds session notes to a single synthesis call
// 3. No raw exchange parsing, no MCP, no sub-agents
// ============================================================

import {
  getSessionsByDate,
  getDailyMilestones,
  getSessionNotes,
  upsertSessionNote,
  getSession,
} from "../db/queries.js";
import { generateSessionNotesStream } from "./agent.js";
import type { AgentEvent } from "./agent.js";

export interface DailyNotesResult {
  content: string;
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

// ── Helper: consume a session note generator, return result ──

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
      // Store the generated note so it's available for future use
      const session = getSession(sessionId);
      if (session) {
        upsertSessionNote({
          session_id: session.id, // internal DB id
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

// ── System Prompt ────────────────────────────────────────────

function buildDailySystemPrompt(sessionCount: number): string {
  const isLowSession = sessionCount <= 2;

  const summary = isLowSession
    ? `## Summary
Detailed narrative of what the session(s) accomplished. Since there are few sessions,
include the specific progression — what was attempted, what worked, what changed direction.
Reference exchanges as [session N, #X]. Quote from session notes where relevant.
Do not abbreviate.`
    : `## Summary
Narrative of the day's work. Connect sessions that relate to each other —
show how work flowed across sessions, not just what each session did individually.
Reference sessions as [session N]. Quote from session notes where relevant.
Proportional: 5+ sessions = detailed narrative.`;

  const keyDecisions = isLowSession
    ? `## Key Decisions
Include all decisions that had meaningful impact — architectural choices, approach changes,
tool selections, configuration changes. Do not filter for cross-session significance
since there are only ${sessionCount} session${sessionCount > 1 ? "s" : ""}.
Format: **[session N, #X]** Bold decision — explanation
Omit if no decisions were made.`
    : `## Key Decisions
Decisions with day-level significance from across the session notes.
Do not list every decision from every session — only those that shaped
the day's direction or had consequences across sessions.
Format: **[session N]** Bold decision — explanation
Omit if no significant decisions.`;

  const frictionPoints = isLowSession
    ? `## Friction Points
Include specific friction that occurred — errors, dead ends, tooling issues, confusion points.
Since there are few sessions, include anything that cost time or changed approach.
Format: bullet list with [session N, #X] references.
Omit if the session(s) went smoothly.`
    : `## Friction Points
Patterns of friction that span sessions or had notable impact.
Not every error from every session — only recurring issues, cross-session
problems, or friction that changed the day's direction.
Format: bullet list with [session N] references.
Omit if the day was smooth.`;

  const proportionRule = isLowSession
    ? ""
    : "\n- Keep the total length proportional to the number of sessions";

  const moreMarkerRule = `
- For sections with substantial content (5+ bullet items or 3+ paragraphs), place <!-- more --> after the first 2-3 items. Content before the marker is shown condensed; content after is revealed on expand. Only use when the section has enough content to warrant it.`;

  return `You synthesize individual session notes into a daily note.
Sessions are numbered chronologically: session 1 = first of the day.
Use the same section format as the session notes you're reading.

${summary}

## Session Flow
A mermaid diagram (\`\`\`mermaid code block, graph LR).
Show sessions as nodes with their key activity. Connect sessions that
share work (same files, continuation of features, related decisions).
Keep it readable — one node per session, not per exchange.

${keyDecisions}

${frictionPoints}

## Files Changed
Files modified across all sessions, grouped by feature or purpose.
Include the explanation of WHY from the session notes.
Format: **Feature area:** file1.ts, file2.ts — explanation [sessions N, M]
Omit files that were only read.

Rules:
- Synthesize, don't aggregate. Show connections between sessions.
- Reference sessions as [session N]
- Omit sections with no meaningful content
- Start directly with ## Summary — no preamble${proportionRule}${moreMarkerRule}`;
}

// ── Generator ────────────────────────────────────────────────

export async function* generateDailyNotesStream(
  dateStr: string,
  options?: { apiKey?: string; model?: string; sessionIds?: string[] },
): AsyncGenerator<AgentEvent, DailyNotesResult> {
  yield { type: "status", message: "Loading day data", detail: dateStr, timestamp: Date.now() };

  let sessions = getSessionsByDate(dateStr);
  if (options?.sessionIds && options.sessionIds.length > 0) {
    const allowed = new Set(options.sessionIds);
    sessions = sessions.filter((s) => allowed.has(s.session_id));
  }
  if (sessions.length === 0) throw new Error("No sessions found for this date");

  const sessionIds = sessions.map((s) => s.session_id);
  const milestones = getDailyMilestones(dateStr);

  yield {
    type: "tool_call",
    message: "Day loaded",
    detail: `${sessions.length} sessions, ${milestones.length} milestones`,
    timestamp: Date.now(),
  };

  // Phase 1: Collect session notes — existing ones instantly, missing ones in parallel
  const sessionNoteContents: Array<{ index: number; content: string }> = [];
  const missingIndexes: number[] = [];
  let totalCost = 0;
  let totalTurns = 0;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const num = i + 1;
    const project = s.project_path.split("/").pop() || s.project_path;
    let header = `## Session ${num}: "${s.title || s.session_id.substring(0, 16)}" — ${project}, ${s.exchange_count} exchanges`;

    // Add fork relationship context
    if (s.forked_from) {
      try {
        const forkData = JSON.parse(s.forked_from);
        if (forkData.sessionId) {
          const parentSession = getSession(forkData.sessionId);
          const parentNum = sessions.findIndex((ps) => ps.session_id === forkData.sessionId) + 1;
          if (parentNum > 0) {
            header += ` (forked from session ${parentNum})`;
          } else if (parentSession?.title) {
            header += ` (forked from "${parentSession.title}")`;
          }
        }
      } catch {}
    }

    const existingNotes = getSessionNotes(s.id);
    if (existingNotes.length > 0) {
      yield { type: "status", message: `Session ${num}: existing note`, detail: project, timestamp: Date.now() };
      sessionNoteContents.push({ index: i, content: `${header}\n\n${existingNotes[0].content}` });
    } else {
      missingIndexes.push(i);
    }
  }

  // Generate missing notes in parallel
  if (missingIndexes.length > 0) {
    yield {
      type: "status",
      message: `Generating ${missingIndexes.length} session note${missingIndexes.length > 1 ? "s" : ""} in parallel`,
      detail: missingIndexes.map((i) => `session ${i + 1}`).join(", "),
      timestamp: Date.now(),
    };

    const promises = missingIndexes.map(async (i) => {
      const s = sessions[i];
      const num = i + 1;
      const project = s.project_path.split("/").pop() || s.project_path;
      let header = `## Session ${num}: "${s.title || s.session_id.substring(0, 16)}" — ${project}, ${s.exchange_count} exchanges`;
      if (s.forked_from) {
        try {
          const forkData = JSON.parse(s.forked_from);
          const parentNum = sessions.findIndex((ps) => ps.session_id === forkData.sessionId) + 1;
          if (parentNum > 0) header += ` (forked from session ${parentNum})`;
        } catch {}
      }

      const result = await consumeSessionNoteGenerator(s.session_id, options);
      if (result) {
        return { index: i, content: `${header}\n\n${result.content}`, cost: result.costUsd, turns: result.agentTurns };
      }
      return { index: i, content: `${header}\n\n(Note generation failed)`, cost: 0, turns: 0 };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      sessionNoteContents.push({ index: r.index, content: r.content });
      totalCost += r.cost;
      totalTurns += r.turns;
      yield { type: "tool_call", message: `Session ${r.index + 1}: note ready`, timestamp: Date.now() };
    }
  }

  // Sort by session order
  sessionNoteContents.sort((a, b) => a.index - b.index);

  // Phase 2: Synthesize daily note from session notes
  yield { type: "status", message: "Synthesizing daily note", detail: `${sessionNoteContents.length} session notes`, timestamp: Date.now() };

  const milestoneLines = milestones.length > 0
    ? "\nMilestones today:\n" + milestones.map((m) => {
        const sessionNum = sessions.findIndex((s) => s.session_id === m.session_id) + 1;
        return `- ${m.milestone_type}: ${m.description} [session ${sessionNum}]`;
      }).join("\n")
    : "";

  const sessionMeta = `Date: ${dateStr}\nTotal sessions: ${sessions.length}\nSession exchanges: ${sessions.map((s, i) => `session ${i + 1}: ${s.exchange_count}`).join(", ")}\n\n`;
  const prompt = `${sessionMeta}${sessionNoteContents.map((n) => n.content).join("\n\n---\n\n")}${milestoneLines}\n\nWrite the daily note for ${dateStr}.`;

  let queryFn: any;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    throw new Error("Claude Agent SDK not installed");
  }

  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.apiKey) env.ANTHROPIC_API_KEY = options.apiKey;

  let result = "";
  let model: string | null = null;

  for await (const msg of queryFn({
    prompt,
    options: {
      systemPrompt: buildDailySystemPrompt(sessions.length),
      model: options?.model || "opus",
      effort: "medium",
      maxTurns: 5,
      maxBudgetUsd: 1.00,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      env,
    },
  })) {
    if (msg.type === "assistant" && msg.message?.content) {
      if (!msg.message.content.some((b: any) => b.type === "tool_use")) {
        yield { type: "thinking", message: "Writing daily note...", timestamp: Date.now() };
      }
    }
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        result = msg.result || "";
        totalTurns += msg.num_turns || 0;
        totalCost += msg.total_cost_usd || 0;
        if (msg.modelUsage) model = Object.keys(msg.modelUsage)[0] || null;
        yield { type: "result", message: `Done — ${totalTurns} turns, $${totalCost.toFixed(4)}`, detail: `${sessions.length} sessions`, timestamp: Date.now() };
      } else {
        throw new Error(`Synthesis failed (${msg.subtype}): ${msg.errors?.join(", ") || ""}`);
      }
    }
  }

  if (!result) throw new Error("Synthesis returned empty result");

  // Strip any preamble before the first ## heading
  const firstHeading = result.indexOf("## ");
  if (firstHeading > 0) result = result.substring(firstHeading);

  return { content: result, model, agentTurns: totalTurns, costUsd: totalCost, sessionIds };
}
