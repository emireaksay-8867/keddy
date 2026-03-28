// ============================================================
// Keddy — Session Notes Generator (Agent SDK)
//
// Architecture:
//   1. In-process MCP (no subprocess — eliminates ~3s startup)
//   2. Lightweight prompt (~2KB skeleton, not 100KB dump)
//   3. Agent uses MCP tools to pull what it needs
//   4. Includes programmatic mermaid for agent to enhance
//   5. Short session fast path (≤3 exchanges, direct API)
// ============================================================

import {
  getSession,
  getSessionPlans,
  getSessionMilestones,
  getSessionSegments,
  getSessionTranscript,
} from "../db/queries.js";
import { createKeddyMcpServer } from "../mcp/tools.js";
import { generateSessionMermaid } from "./mermaid-generator.js";
import type { MermaidGroup } from "./mermaid-generator.js";

export interface NotesResult {
  content: string;
  mermaid: string | null;
  model: string | null;
  agentTurns: number;
  costUsd: number;
}

export interface AgentEvent {
  type: "status" | "tool_call" | "mcp_connect" | "thinking" | "result" | "error";
  message: string;
  detail?: string;
  timestamp: number;
}

// ── Lightweight context: ~1-2KB instead of ~100KB ─────────────

function buildLightweightContext(sessionId: string): {
  context: string;
  exchangeCount: number;
  effectiveExchangeCount: number;
  sessionIdInternal: string;
  programmaticMermaid: string;
} | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const milestones = getSessionMilestones(session.id);
  const plans = getSessionPlans(session.id);

  const lines: string[] = [];
  lines.push(`Session: ${session.title || session.session_id.substring(0, 20)}`);
  lines.push(`Session ID: ${session.session_id}`);
  lines.push(`Project: ${session.project_path}`);
  if (session.git_branch) lines.push(`Branch: ${session.git_branch}`);
  lines.push(`Exchanges: ${session.exchange_count}`);
  lines.push(`Started: ${session.started_at} | Ended: ${session.ended_at || "ongoing"}`);

  // Fork context: precise exchange boundary instead of vague hint
  const forkIdx = (session as any).fork_exchange_index as number | null;
  if (session.forked_from && forkIdx != null) {
    let parentTitle = "unknown";
    try {
      const forkData = JSON.parse(session.forked_from);
      if (forkData.sessionId) {
        const parent = getSession(forkData.sessionId);
        if (parent?.title) parentTitle = parent.title;
      }
    } catch {}
    lines.push(`Forked from: "${parentTitle}"`);
    lines.push(`Fork point: exchange #${forkIdx} — content before this is inherited from parent`);
    lines.push(`This session's own work: exchanges #${forkIdx} through #${session.exchange_count - 1}`);
  }

  // Filter plans and milestones to post-fork content only
  const relevantPlans = forkIdx != null
    ? plans.filter((p) => p.exchange_index_start >= forkIdx)
    : plans;
  const relevantMilestones = forkIdx != null
    ? milestones.filter((m) => m.exchange_index >= forkIdx)
    : milestones;

  if (relevantPlans.length > 0) {
    lines.push("");
    lines.push(`Plans: ${relevantPlans.map((p) => `v${p.version}(${p.status}${p.user_feedback ? `, feedback: "${p.user_feedback.substring(0, 80)}"` : ""})`).join(", ")}`);
  }

  if (relevantMilestones.length > 0) {
    lines.push("");
    lines.push("Milestones:");
    for (const ms of relevantMilestones) {
      lines.push(`  [#${ms.exchange_index}] ${ms.milestone_type}: ${ms.description}`);
    }
  }

  // Generate programmatic mermaid from activity groups (post-fork only)
  const segments = getSessionSegments(session.id);
  const groups: MermaidGroup[] = segments
    .filter((s) => s.boundary_type)
    .filter((s) => forkIdx == null || s.exchange_index_end >= forkIdx)
    .map((s) => {
      let filesWritten: string[] = [];
      let filesRead: string[] = [];
      let toolCounts: Record<string, number> = {};
      let markers: Array<{ exchange_index: number; type: string; label: string }> = [];
      try { filesWritten = JSON.parse(s.files_written || "[]"); } catch {}
      try { filesRead = JSON.parse(s.files_read || "[]"); } catch {}
      try { toolCounts = JSON.parse(s.tool_counts); } catch {}
      try { markers = JSON.parse(s.markers || "[]"); } catch {}
      return {
        exchange_start: s.exchange_index_start,
        exchange_end: s.exchange_index_end,
        exchange_count: s.exchange_count,
        boundary: s.boundary_type,
        files_written: filesWritten,
        files_read: filesRead,
        tool_counts: toolCounts,
        error_count: s.error_count,
        markers,
      };
    });

  const programmaticMermaid = generateSessionMermaid(
    groups,
    relevantMilestones.map((m) => ({
      milestone_type: m.milestone_type,
      exchange_index: m.exchange_index,
      description: m.description,
    })),
    forkIdx,
  );

  return {
    context: lines.join("\n"),
    exchangeCount: session.exchange_count,
    effectiveExchangeCount: session.exchange_count - (forkIdx ?? 0),
    sessionIdInternal: session.id,
    programmaticMermaid,
  };
}

// ── System Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a session analyst with access to Keddy MCP tools for reading coding session data.

Start by calling keddy_get_session_skeleton to get the session structure and overview.
Then use keddy_transcript_summary to scan the conversation flow.
Use keddy_get_transcript for specific exchange ranges you want to read in detail.

Produce a session note in markdown with these sections:

## Summary
What the user was trying to accomplish, what approach was taken, and what the outcome was.
Ground every statement in specific exchange numbers [#N].
Quote the user's own words when describing their goals and reasoning.
Use Claude's responses to understand what was actually done — Claude often summarizes the actions taken.
But do not treat Claude's stated plans as facts unless they were followed by actual tool execution.
Read the first few exchanges carefully — the first message may not state the goal directly.

## Session Flow
A mermaid diagram (\`\`\`mermaid code block, graph LR format).
You receive a programmatic diagram as input. Enhance its node labels based on what you learn from reading user prompts — replace file-based labels with what the user was actually trying to do.
Keep the exchange ranges from the original diagram. Keep node shapes. Only improve labels.

## Files Changed
List of files that were created or modified (from Write/Edit tool calls that succeeded). Don't include files that were only read.

Rules:
- Every claim must reference specific exchange numbers [#N]
- Exchanges marked [COMPACTION SUMMARY] are compressed context, not user conversations
- Do not label phases as "debugging", "implementing", etc. — describe the specific actions and files
- If the session is straightforward, keep the note brief
- Do not add sections beyond these three unless the data clearly warrants it
- If the session is forked, focus on exchanges AFTER the fork point. Inherited exchanges are context from the parent session — mention the fork briefly in the summary but do not narrate the parent's work
- Start directly with ## Summary — no preamble`;

// ── Short session fast path (≤3 exchanges) ───────────────────

const SHORT_SESSION_PROMPT = `You are a session analyst. Produce a brief session note in markdown.

## Summary
One paragraph: what the user asked for, what happened, what was the outcome.
Reference exchange numbers [#N].

## Session Flow
A mermaid diagram (\`\`\`mermaid code block, graph LR format).
Even for short sessions, show the progression: what was asked → what was done → the result.
Use 2-3 nodes maximum. Label nodes with what actually happened, not file names.

## Files Changed
Files created or modified (if any).

Keep it concise. Start directly with ## Summary.`;

async function generateShortSessionNote(
  sessionId: string,
  context: string,
  programmaticMermaid: string,
  options?: { apiKey?: string; model?: string },
): Promise<NotesResult> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const forkIdx = (session as any).fork_exchange_index as number | null;
  const allExchanges = getSessionTranscript(session.id, {});
  const exchanges = forkIdx != null ? allExchanges.filter((e) => e.exchange_index >= forkIdx) : allExchanges;
  const transcript = exchanges.map((e) => {
    let text = `#${e.exchange_index} User: ${e.user_prompt}`;
    if (e.assistant_response) text += `\nClaude: ${e.assistant_response.substring(0, 500)}`;
    if (e.tool_call_count > 0) text += `\n(${e.tool_call_count} tool calls)`;
    return text;
  }).join("\n\n");

  let sdk: any;
  try {
    sdk = await import("@anthropic-ai/sdk");
  } catch {
    throw new Error("Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk");
  }

  const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No API key available");

  const client = new sdk.default({ apiKey });
  const response = await client.messages.create({
    model: options?.model === "opus" ? "claude-opus-4-6" : options?.model === "haiku" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SHORT_SESSION_PROMPT,
    messages: [{ role: "user", content: `Session: ${context}${programmaticMermaid ? `\nProgrammatic diagram (enhance labels):\n\`\`\`mermaid\n${programmaticMermaid}\n\`\`\`` : ""}\n\nTranscript:\n${transcript}` }],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "";
  const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/);

  return {
    content,
    mermaid: mermaidMatch ? mermaidMatch[1].trim() : null,
    model: response.model || null,
    agentTurns: 1,
    costUsd: 0,
  };
}

// ── Main Generator ───────────────────────────────────────────

export async function* generateSessionNotesStream(
  sessionId: string,
  options?: { apiKey?: string; model?: string },
): AsyncGenerator<AgentEvent, NotesResult> {
  // Phase 1: Build lightweight context
  yield { type: "status", message: "Reading session data", detail: "Querying local database...", timestamp: Date.now() };

  const data = buildLightweightContext(sessionId);
  if (!data) throw new Error(`Session not found: ${sessionId}`);

  const contextKb = (data.context.length / 1024).toFixed(1);
  yield {
    type: "tool_call",
    message: "Session loaded",
    detail: `${data.exchangeCount} exchanges, ${contextKb}KB context`,
    timestamp: Date.now(),
  };

  // Phase 2: Short session fast path (≤3 effective exchanges — skip Agent SDK entirely)
  if (data.effectiveExchangeCount <= 3) {
    yield { type: "status", message: "Short session — using direct API", detail: `${data.exchangeCount} exchanges`, timestamp: Date.now() };
    try {
      const result = await generateShortSessionNote(sessionId, data.context, data.programmaticMermaid, options);
      yield {
        type: "result",
        message: `Done — 1 turn, $${result.costUsd.toFixed(4)}`,
        detail: `${data.exchangeCount} exchanges analyzed`,
        timestamp: Date.now(),
      };
      return result;
    } catch (err: any) {
      yield { type: "status", message: "Direct API unavailable, falling back to Agent SDK", detail: err.message, timestamp: Date.now() };
      // Fall through to Agent SDK path
    }
  }

  // Phase 3: Agent SDK with in-process MCP
  let queryFn: any;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    throw new Error("Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk");
  }

  const modelName = options?.model || "sonnet";
  yield { type: "status", message: "Starting analysis agent", detail: `${modelName}, in-process MCP`, timestamp: Date.now() };

  // Create in-process MCP server (no subprocess, no stdio handshake)
  const keddyServer = createKeddyMcpServer({ agentTools: true });

  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.apiKey) env.ANTHROPIC_API_KEY = options.apiKey;

  const prompt = [
    `Session overview:\n${data.context}`,
    data.programmaticMermaid
      ? `\nProgrammatic session flow diagram:\n\`\`\`mermaid\n${data.programmaticMermaid}\n\`\`\`\n\nAnalyze this session using the MCP tools and produce a note. Enhance the diagram labels based on what you learn from reading user prompts.`
      : `\nAnalyze this session using the MCP tools and produce a note.`,
  ].join("\n");

  let result = "";
  let turns = 0;
  let cost = 0;
  let model: string | null = null;

  for await (const message of queryFn({
    prompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: modelName,
      effort: "medium",
      mcpServers: {
        keddy: {
          type: "sdk" as const,
          name: "keddy",
          instance: keddyServer,
        },
      },
      strictMcpConfig: true,
      allowedTools: ["mcp__keddy__*"],
      maxTurns: 10,
      maxBudgetUsd: 0.50,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      env,
    },
  })) {
    // MCP connection
    if (message.type === "system" && message.subtype === "init") {
      const mcpServers = message.mcp_servers || [];
      const connected = mcpServers.filter((s: any) => s.status === "connected");
      yield {
        type: "mcp_connect",
        message: `MCP: ${connected.length} connected`,
        detail: mcpServers.map((s: any) => `${s.name}: ${s.status}`).join(", "),
        timestamp: Date.now(),
      };
    }

    // Agent calling MCP tools
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
        yield { type: "thinking", message: "Agent is analyzing...", timestamp: Date.now() };
      }
    }

    // Final result
    if (message.type === "result") {
      if (message.subtype === "success") {
        result = message.result || "";
        turns = message.num_turns || 0;
        cost = message.total_cost_usd || 0;
        if (message.modelUsage) {
          const models = Object.keys(message.modelUsage);
          if (models.length > 0) model = models[0];
        }
        yield {
          type: "result",
          message: `Done — ${turns} turn${turns !== 1 ? "s" : ""}, $${cost.toFixed(4)}`,
          detail: `${data.exchangeCount} exchanges analyzed`,
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

  const mermaidMatch = result.match(/```mermaid\n([\s\S]*?)```/);
  const mermaid = mermaidMatch ? mermaidMatch[1].trim() : null;

  return { content: result, mermaid, model, agentTurns: turns, costUsd: cost };
}
