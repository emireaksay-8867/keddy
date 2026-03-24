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
  getSessionTasks,
  getProjectStatus,
} from "../db/queries.js";
import { getDb } from "../db/index.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

const server = new McpServer({
  name: "keddy",
  version: process.env.KEDDY_VERSION || "0.0.0",
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

    // Reordered: plans + tasks first (decisions), then segments/milestones (context), exchanges last (raw data)
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
      plans: plans.map((p) => ({
        version: p.version,
        status: p.status,
        feedback: p.user_feedback,
        text: p.plan_text, // Full text — not truncated
      })),
      tasks: getSessionTasks(session.id).map((t) => ({
        subject: t.subject,
        status: t.status,
        description: t.description,
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
          summary: s.summary || undefined,
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
      exchanges: exchanges.map((e) => ({
        index: e.exchange_index,
        prompt: e.user_prompt.substring(0, 500),
        response_preview: (e.assistant_response || "").substring(0, 300),
        tools: e.tool_call_count,
        is_interrupt: !!e.is_interrupt,
      })),
      // Facts-first additions
      activity_groups: segments.filter((s) => s.boundary_type).map((s) => {
        let toolCounts: unknown = {};
        let filesRead: unknown = [];
        let filesWritten: unknown = [];
        let markers: unknown = [];
        let models: unknown = [];
        try { toolCounts = JSON.parse(s.tool_counts); } catch {}
        try { filesRead = JSON.parse(s.files_read || "[]"); } catch {}
        try { filesWritten = JSON.parse(s.files_written || "[]"); } catch {}
        try { markers = JSON.parse(s.markers || "[]"); } catch {}
        try { models = JSON.parse(s.models || "[]"); } catch {}
        return {
          range: `${s.exchange_index_start}-${s.exchange_index_end}`,
          exchange_count: s.exchange_count,
          tokens: { input: s.total_input_tokens, output: s.total_output_tokens, cache_read: s.total_cache_read_tokens },
          tools: toolCounts,
          errors: s.error_count,
          files_read: filesRead,
          files_written: filesWritten,
          models,
          markers,
          boundary: s.boundary_type,
          ai_summary: s.ai_summary || undefined,
        };
      }),
      token_summary: (() => {
        try {
          const db = getDb();
          const row = db.prepare(`
            SELECT SUM(input_tokens) as ti, SUM(output_tokens) as to2, SUM(cache_read_tokens) as tcr
            FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL
          `).get(session.id) as any;
          if (row && row.ti != null) {
            return {
              total_input: row.ti || 0, total_output: row.to2 || 0,
              total_cache_read: row.tcr || 0, total: (row.ti || 0) + (row.to2 || 0),
              cache_hit_rate: row.ti > 0 ? Math.round(((row.tcr || 0) / row.ti) * 100) : 0,
            };
          }
        } catch {}
        return undefined;
      })(),
      file_operations: (() => {
        try {
          const db = getDb();
          return db.prepare(`
            SELECT file_path as file,
              SUM(CASE WHEN tool_name IN ('Read','Grep','Glob') THEN 1 ELSE 0 END) as reads,
              SUM(CASE WHEN tool_name = 'Edit' THEN 1 ELSE 0 END) as edits,
              SUM(CASE WHEN tool_name = 'Write' THEN 1 ELSE 0 END) as writes
            FROM tool_calls WHERE session_id = ? AND file_path IS NOT NULL
            GROUP BY file_path ORDER BY (edits + writes) DESC, reads DESC LIMIT 20
          `).all(session.id);
        } catch { return undefined; }
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

// Tool 7: Project status
server.tool(
  "keddy_project_status",
  "Get the current state of a project: active plan with full text, task progress, recent milestones, segment types, and active files. Use this to understand where a project stands before starting work.",
  {
    project_path: z.string().describe("The project path (usually the current working directory)"),
  },
  async ({ project_path }) => {
    const status = getProjectStatus(project_path);

    if (status.recentSessions.length === 0) {
      return textResult(`No sessions found for project: ${project_path}`);
    }

    const pendingTasks = status.tasks.filter((t) => t.status !== "completed");
    const completedTasks = status.tasks.filter((t) => t.status === "completed");

    return jsonResult({
      project: project_path,
      total_sessions: status.recentSessions.length,
      active_plan: status.activePlan
        ? {
            session_id: status.activePlan.sessionId,
            version: status.activePlan.version,
            status: status.activePlan.status,
            plan_text: status.activePlan.plan_text,
            created_at: status.activePlan.created_at,
            tasks: {
              total: status.tasks.length,
              completed: completedTasks.length,
              pending: pendingTasks.length,
              remaining: pendingTasks.map((t) => ({ subject: t.subject, status: t.status })),
            },
          }
        : null,
      plan_history: status.planHistory.map((p) => ({
        version: p.version,
        status: p.status,
        feedback: p.user_feedback,
      })),
      recent_milestones: status.recentMilestones.map((m) => ({
        type: m.milestone_type,
        description: m.description,
      })),
      recent_work: {
        segments: status.segmentTypes,
        active_files: status.activeFiles,
        last_session: (() => {
          const ls = status.recentSessions[0];
          if (!ls) return null;
          const base: Record<string, unknown> = {
            branch: ls.git_branch,
            exchanges: ls.exchange_count,
            started: ls.started_at,
            ended: ls.ended_at,
          };
          // Enrich with facts-first data if available
          try {
            const db = getDb();
            const sid = db.prepare("SELECT id FROM sessions WHERE session_id = ?").get(ls.session_id) as { id: string } | undefined;
            if (sid) {
              const modelRow = db.prepare("SELECT model, COUNT(*) as cnt FROM exchanges WHERE session_id = ? AND model IS NOT NULL GROUP BY model ORDER BY cnt DESC LIMIT 1").get(sid.id) as any;
              if (modelRow) base.model = modelRow.model;
              const tokenRow = db.prepare("SELECT SUM(input_tokens) as ti, SUM(output_tokens) as to2 FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL").get(sid.id) as any;
              if (tokenRow && tokenRow.ti != null) base.total_tokens = (tokenRow.ti || 0) + (tokenRow.to2 || 0);
              const errorRow = db.prepare("SELECT COUNT(*) as cnt FROM tool_calls WHERE session_id = ? AND is_error = 1").get(sid.id) as any;
              base.error_count = errorRow?.cnt || 0;
              const filesRow = db.prepare("SELECT file_path FROM tool_calls WHERE session_id = ? AND file_path IS NOT NULL AND tool_name IN ('Edit','Write') GROUP BY file_path ORDER BY COUNT(*) DESC LIMIT 5").all(sid.id) as any[];
              if (filesRow.length > 0) base.files_written = filesRow.map((r: any) => r.file_path);
            }
          } catch { /* non-critical */ }
          return base;
        })(),
      },
    });
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
