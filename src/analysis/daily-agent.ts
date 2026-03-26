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

const SYSTEM_PROMPT = `You write a daily note by synthesizing individual session notes.
Sessions are numbered chronologically: session 1 = first of the day.

Structure the note as:

## {Date}

### Your Day
Narrative connecting the sessions. Quote from the session notes where relevant.
Reference sessions as [session N]. Connect sessions that relate to each other.

### Milestones
List milestones with session references. Omit if none.

### Sessions
One line per session: title, project, exchange count.

### Observations
Cross-session patterns or notable items from the session notes.
Omit if nothing notable.

Rules:
- Reference sessions as [session N]
- Milestones are events, not "accomplishments"
- No labels: goal, accomplished, pending
- Proportional: 1 session = 2-3 sentences, 5+ sessions = full sections
- Start directly with the ## heading`;

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
    const header = `## Session ${num}: "${s.title || s.session_id.substring(0, 16)}" — ${project}, ${s.exchange_count} exchanges`;

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
      const header = `## Session ${num}: "${s.title || s.session_id.substring(0, 16)}" — ${project}, ${s.exchange_count} exchanges`;

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

  const prompt = `${sessionNoteContents.map((n) => n.content).join("\n\n---\n\n")}${milestoneLines}\n\nWrite the daily note for ${dateStr}.`;

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
      systemPrompt: SYSTEM_PROMPT,
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

  return { content: result, model, agentTurns: totalTurns, costUsd: totalCost, sessionIds };
}
