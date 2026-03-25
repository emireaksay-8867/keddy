// ============================================================
// Keddy — Session Notes Generator (Agent SDK)
//
// Architecture: Pre-fetch raw facts from DB → Sonnet reasons about them
// Agent has MCP access for optional deep dives on specific exchanges
// Code is a faithful data provider. All judgment belongs to Sonnet.
// ============================================================

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  getSession,
  getSessionExchanges,
  getSessionPlans,
  getSessionMilestones,
  getSessionCompactionEvents,
} from "../db/queries.js";
import { getDb } from "../db/index.js";

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

function getMcpServerPath(): string {
  const fromDirname = join(__dirname, "..", "mcp", "server.js");
  if (existsSync(fromDirname)) return fromDirname;
  const fromCwd = join(process.cwd(), "dist", "mcp", "server.js");
  if (existsSync(fromCwd)) return fromCwd;
  throw new Error("Keddy MCP server not found. Run 'npm run build:cli' first.");
}

function findClaudeCodePath(): string | undefined {
  const candidates = [
    join(process.env.HOME || "", ".superset", "bin", "claude"),
    join(process.env.HOME || "", ".claude", "bin", "claude"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    return execSync("which claude", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// ── Pre-fetch: Raw facts from DB, no interpretation ──────────

function buildSessionContext(sessionId: string): { context: string; exchangeCount: number } | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const db = getDb();
  const exchanges = getSessionExchanges(session.id);
  const plans = getSessionPlans(session.id);
  const milestones = getSessionMilestones(session.id);
  const compactions = getSessionCompactionEvents(session.id);

  // Tool calls per exchange — includes file paths, errors, sub-agents
  const toolRows = db.prepare(`
    SELECT e.exchange_index, tc.tool_name, tc.is_error, tc.file_path,
           tc.bash_command, tc.bash_desc, tc.subagent_type, tc.subagent_desc
    FROM tool_calls tc
    JOIN exchanges e ON e.id = tc.exchange_id
    WHERE tc.session_id = ?
    ORDER BY e.exchange_index
  `).all(session.id) as any[];

  const toolsByExchange = new Map<number, string[]>();
  for (const tc of toolRows) {
    const arr = toolsByExchange.get(tc.exchange_index) || [];
    let desc = tc.tool_name;
    if (tc.tool_name === "Agent" && tc.subagent_type) {
      desc = `Agent(${tc.subagent_type}: "${(tc.subagent_desc || "").substring(0, 80)}")`;
    } else {
      if (tc.file_path) desc += ` ${tc.file_path.split("/").pop()}`;
      if (tc.bash_desc) desc += ` (${tc.bash_desc.substring(0, 80)})`;
    }
    if (tc.is_error) desc += " [ERROR]";
    arr.push(desc);
    toolsByExchange.set(tc.exchange_index, arr);
  }

  const lines: string[] = [];

  // ── Session header
  lines.push(`# Session: ${session.title || session.session_id.substring(0, 20)}`);
  lines.push(`Project: ${session.project_path}`);
  if (session.git_branch) lines.push(`Branch: ${session.git_branch}`);
  lines.push(`Started: ${session.started_at} | Ended: ${session.ended_at || "ongoing"}`);
  lines.push(`Exchanges: ${exchanges.length} | Compactions: ${session.compaction_count}`);
  if (session.forked_from) lines.push(`Forked from: ${session.forked_from}`);
  lines.push("");

  // ── Plans (version, status, feedback, text preview)
  if (plans.length > 0) {
    lines.push("## Plans");
    for (const plan of plans) {
      lines.push(`### Plan V${plan.version} (${plan.status})`);
      if (plan.user_feedback) lines.push(`User feedback: ${plan.user_feedback}`);
      lines.push(plan.plan_text.substring(0, 500));
      if (plan.plan_text.length > 500) lines.push("...[truncated — use keddy_get_plans for full text]");
      lines.push("");
    }
  }

  // ── Milestones (all, unfiltered — commits, pushes, PRs, test pass/fail)
  if (milestones.length > 0) {
    lines.push("## Milestones");
    for (const ms of milestones) {
      lines.push(`- [#${ms.exchange_index}] ${ms.milestone_type}: ${ms.description}`);
    }
    lines.push("");
  }

  // ── Compaction events
  if (compactions.length > 0) {
    lines.push("## Compaction Events");
    for (const c of compactions) {
      lines.push(`- [#${c.exchange_index}] ${c.exchanges_before}→${c.exchanges_after} exchanges${c.pre_tokens ? `, ${c.pre_tokens} tokens before` : ""}`);
    }
    lines.push("");
  }

  // ── Exchange timeline: full user prompts + Claude response preview + tools
  lines.push("## Exchange Timeline");
  for (const ex of exchanges) {
    const flags: string[] = [];
    if (ex.is_interrupt) flags.push("INTERRUPTED");
    if (ex.is_compact_summary) flags.push("COMPACTION SUMMARY");
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

    // Full user prompt
    const prompt = (ex.user_prompt || "").trim();
    lines.push(`### #${ex.exchange_index}${flagStr}`);
    lines.push(`**User:** ${prompt}`);

    // Claude response preview (first 200 chars — captures intent)
    const response = (ex.assistant_response || "").trim();
    if (response) {
      const preview = response.substring(0, 200);
      lines.push(`**Claude:** ${preview}${response.length > 200 ? "..." : ""}`);
    }

    // Tools used
    const tools = toolsByExchange.get(ex.exchange_index) || [];
    if (tools.length > 0) {
      lines.push(`**Tools:** ${tools.join(", ")}`);
    }

    lines.push("");
  }

  return { context: lines.join("\n"), exchangeCount: exchanges.length };
}

// ── System Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a session analyst. You have pre-fetched session data below containing every user prompt, tool actions, milestones, and plans. You also have access to Keddy MCP tools if you need to read specific exchanges in full or investigate errors.

Produce a session note in markdown with these sections:

## Summary
What was the user trying to accomplish? What approach was taken? What was the outcome? Read the first few exchanges carefully — the first message may not state the goal directly (it might say "continue from where you left off" or paste an error log). Ground every statement in the data.

## Session Flow
A mermaid diagram (\`\`\`mermaid code block, graph LR format).
- Show the actual phases and turning points based on what happened
- 15-20 nodes maximum
- Use short descriptive labels
- Mark milestones (commits, PRs, tests) distinctively
- Show decision points where the direction changed

## Key Decisions
Bullet list of decisions where an alternative existed and the choice had consequences. Reference exchange numbers like [#14]. Describe what was decided and why based on what you can see in the data.

## Friction Points
Bullet list of places where time or effort was spent without proportional progress — error loops, repeated attempts, plan rejections, long search spirals. Skip this section if the session was smooth.

## Files Changed
List of files that were created or modified (Write/Edit tool calls that succeeded). Don't include files that were only read.

Rules:
- Every claim must reference specific exchange numbers [#N]
- Do not label phases as "debugging", "implementing", etc. — describe the specific actions and files
- Do not assume test failures or errors are problems — look at whether they actually affected the session's direction
- If a section would have no meaningful content, omit it entirely
- Exchanges marked [COMPACTION SUMMARY] are compressed earlier context, not individual exchanges
- Start directly with ## Summary — no preamble`;

// ── Main Generator ───────────────────────────────────────────

export async function* generateSessionNotesStream(
  sessionId: string,
  options?: { apiKey?: string; model?: string },
): AsyncGenerator<AgentEvent, NotesResult> {
  // Phase 1: Pre-fetch raw facts from DB
  yield { type: "status", message: "Reading session data", detail: "Querying local database...", timestamp: Date.now() };

  const data = buildSessionContext(sessionId);
  if (!data) throw new Error(`Session not found: ${sessionId}`);

  const contextKb = (data.context.length / 1024).toFixed(1);
  yield {
    type: "tool_call",
    message: "Session loaded",
    detail: `${data.exchangeCount} exchanges, ${contextKb}KB context`,
    timestamp: Date.now(),
  };

  // Phase 2: Dynamic import of Agent SDK
  let queryFn: any;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    throw new Error("Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk");
  }

  const claudePath = findClaudeCodePath();
  const mcpServerPath = getMcpServerPath();
  const modelName = options?.model || "sonnet";

  yield { type: "status", message: "Starting analysis agent", detail: `${modelName}, effort: medium`, timestamp: Date.now() };

  // Phase 3: Sonnet with pre-fed context + MCP access for deep dives
  const env: Record<string, string | undefined> = { ...process.env };
  if (options?.apiKey) env.ANTHROPIC_API_KEY = options.apiKey;

  const prompt = `Here is the complete session data:\n\n${data.context}\n\nProduce the session note now.`;

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
          command: process.execPath,
          args: [mcpServerPath],
        },
      },
      strictMcpConfig: true,  // ONLY connect to keddy — skip global MCP servers (Notion, Gmail, etc.)
      allowedTools: ["mcp__keddy__*"],
      maxTurns: 10,
      maxBudgetUsd: 0.50,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      env,
      ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
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

    // Agent calling MCP tools (deep dives)
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
      // Also emit thinking event for non-tool assistant messages
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
