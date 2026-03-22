import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initDb } from "../db/index.js";
import {
  searchSessions,
  getSession,
  getSessionExchanges,
  getSessionPlans,
  getSessionSegments,
  getSessionMilestones,
  getSessionCompactionEvents,
  getRecentSessions,
  getRecentPlans,
  getStats,
  searchByFile,
  getSessionTranscript,
} from "../db/queries.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

const server = new McpServer({
  name: "keddy",
  version: "0.1.0",
});

// Tool 1: Search sessions
server.tool(
  "keddy_search_sessions",
  "Search past Claude Code sessions by keyword. Searches user prompts and plan text via full-text search.",
  {
    query: z.string().describe("Search query (supports FTS5 syntax)"),
    project: z.string().optional().describe("Filter by project path substring"),
    days: z.number().optional().describe("Limit to last N days"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ query, project, days, limit }) => {
    const results = searchSessions(query, { project, days, limit });
    if (results.length === 0) {
      return textResult("No sessions found matching your query.");
    }

    const formatted = results.map((s) => ({
      session_id: s.session_id,
      title: s.title,
      project: s.project_path,
      branch: s.git_branch,
      started: s.started_at,
      exchanges: s.exchange_count,
    }));

    return jsonResult({ count: results.length, sessions: formatted });
  },
);

// Tool 2: Get session details
server.tool(
  "keddy_get_session",
  "Get full details of a specific session including segments, plans, milestones, and compaction events.",
  {
    session_id: z.string().describe("The session ID to retrieve"),
  },
  async ({ session_id }) => {
    const session = getSession(session_id);
    if (!session) {
      return textResult(`Session not found: ${session_id}`);
    }

    const exchanges = getSessionExchanges(session.id);
    const plans = getSessionPlans(session.id);
    const segments = getSessionSegments(session.id);
    const milestones = getSessionMilestones(session.id);
    const compactions = getSessionCompactionEvents(session.id);

    return jsonResult({
      session: {
        session_id: session.session_id,
        title: session.title,
        project: session.project_path,
        branch: session.git_branch,
        started: session.started_at,
        ended: session.ended_at,
        exchange_count: session.exchange_count,
      },
      exchanges: exchanges.map((e) => ({
        index: e.exchange_index,
        prompt: e.user_prompt.substring(0, 500),
        response_preview: (e.assistant_response || "").substring(0, 300),
        tools: e.tool_call_count,
        is_interrupt: !!e.is_interrupt,
      })),
      plans: plans.map((p) => ({
        version: p.version,
        status: p.status,
        feedback: p.user_feedback,
        text: p.plan_text.substring(0, 500),
      })),
      segments: segments.map((s) => {
        let files: unknown = [];
        let tools: unknown = {};
        try { files = JSON.parse(s.files_touched); } catch { /* use default */ }
        try { tools = JSON.parse(s.tool_counts); } catch { /* use default */ }
        return {
          type: s.segment_type,
          range: `${s.exchange_index_start}-${s.exchange_index_end}`,
          files,
          tools,
        };
      }),
      milestones: milestones.map((m) => ({
        type: m.milestone_type,
        index: m.exchange_index,
        description: m.description,
      })),
      compactions: compactions.map((c) => ({
        index: c.exchange_index,
        summary: c.summary ? c.summary.substring(0, 200) : null,
        pre_tokens: (c as any).pre_tokens || null,
      })),
      tasks: (() => {
        try {
          const { getSessionTasks } = require("../db/queries.js");
          return getSessionTasks(session.id).map((t: any) => ({
            subject: t.subject,
            status: t.status,
            description: t.description,
          }));
        } catch { return []; }
      })(),
    });
  },
);

// Tool 3: Get plans
server.tool(
  "keddy_get_plans",
  "Get plan versions with full text, feedback, and status. Without session_id, returns recent plans across all sessions.",
  {
    session_id: z.string().optional().describe("Session ID (optional, returns recent plans if omitted)"),
  },
  async ({ session_id }) => {
    let plans;
    if (session_id) {
      const session = getSession(session_id);
      if (!session) return textResult(`Session not found: ${session_id}`);
      plans = getSessionPlans(session.id);
    } else {
      plans = getRecentPlans(20);
    }

    if (plans.length === 0) {
      return textResult("No plans found.");
    }

    return jsonResult(
      plans.map((p) => ({
        version: p.version,
        status: p.status,
        plan_text: p.plan_text,
        user_feedback: p.user_feedback,
        exchange_range: `${p.exchange_index_start}-${p.exchange_index_end}`,
        created: p.created_at,
      })),
    );
  },
);

// Tool 4: Recent activity
server.tool(
  "keddy_recent_activity",
  "Get a summary of recent Claude Code sessions and activity.",
  {
    days: z.number().optional().describe("Number of days to look back (default 7)"),
  },
  async ({ days }) => {
    const sessions = getRecentSessions(days ?? 7);
    const stats = getStats();

    if (sessions.length === 0) {
      return textResult("No recent sessions found.");
    }

    const summary = sessions.map((s) => ({
      session_id: s.session_id,
      title: s.title,
      project: s.project_path,
      branch: s.git_branch,
      started: s.started_at,
      ended: s.ended_at,
      exchanges: s.exchange_count,
    }));

    return jsonResult({
      period: `Last ${days ?? 7} days`,
      session_count: sessions.length,
      stats,
      sessions: summary,
    });
  },
);

// Tool 5: Get transcript
server.tool(
  "keddy_get_transcript",
  "Get the full conversation transcript for a session — includes both user prompts and Claude's responses. Use exchange range to get a specific portion.",
  {
    session_id: z.string().describe("The session ID"),
    from: z.number().optional().describe("Start exchange index (inclusive)"),
    to: z.number().optional().describe("End exchange index (inclusive)"),
  },
  async ({ session_id, from, to }) => {
    const session = getSession(session_id);
    if (!session) return textResult(`Session not found: ${session_id}`);

    const exchanges = getSessionTranscript(session.id, { from, to });
    if (exchanges.length === 0) return textResult("No exchanges in range.");

    const transcript = exchanges.map((e) => {
      let text = `--- Exchange #${e.exchange_index} ---\n`;
      text += `**User:** ${e.user_prompt}\n`;
      if (e.assistant_response) text += `\n**Claude:** ${e.assistant_response}\n`;
      if (e.tool_call_count > 0) text += `\n(${e.tool_call_count} tool calls)\n`;
      if (e.is_interrupt) text += `\n[INTERRUPTED]\n`;
      return text;
    }).join("\n");

    return textResult(transcript);
  },
);

// Tool 6: Search by file
server.tool(
  "keddy_search_by_file",
  "Find all sessions that touched a specific file. Useful for understanding the history of changes to a file across sessions.",
  {
    file_path: z.string().describe("The file path to search for (can be partial, e.g. 'src/auth.ts')"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ file_path, limit }) => {
    const results = searchByFile(file_path, limit ?? 20);
    if (results.length === 0) {
      return textResult(`No sessions found that touched: ${file_path}`);
    }

    // Group by session
    const bySession = new Map<string, typeof results>();
    for (const r of results) {
      if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
      bySession.get(r.session_id)!.push(r);
    }

    const formatted = Array.from(bySession.entries()).map(([sid, ops]) => ({
      session_id: sid,
      title: ops[0].title,
      project: ops[0].project_path,
      started: ops[0].started_at,
      operations: ops.map((o) => ({
        exchange: o.exchange_index,
        tool: o.tool_name,
      })),
    }));

    return jsonResult({ file: file_path, sessions: formatted });
  },
);

// Start server — initialize DB once for the process lifetime
async function main() {
  initDb();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[keddy-mcp] Error:", err);
  process.exit(1);
});
