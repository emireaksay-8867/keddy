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

/** Enrich a session row with facts-first metadata (model, tokens, errors, files) */
function enrichSession(s: { session_id: string; id?: string }) {
  try {
    const db = getDb();
    const sidRow = s.id ? { id: s.id } : db.prepare("SELECT id FROM sessions WHERE session_id = ?").get(s.session_id) as { id: string } | undefined;
    if (!sidRow) return {};
    const sid = sidRow.id;
    const modelRow = db.prepare("SELECT model, COUNT(*) as cnt FROM exchanges WHERE session_id = ? AND model IS NOT NULL GROUP BY model ORDER BY cnt DESC LIMIT 1").get(sid) as any;
    const tokenRow = db.prepare("SELECT SUM(input_tokens) + SUM(output_tokens) as total FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL").get(sid) as any;
    const errorRow = db.prepare("SELECT COUNT(*) as cnt FROM tool_calls WHERE session_id = ? AND is_error = 1").get(sid) as any;
    const fileRow = db.prepare("SELECT COUNT(DISTINCT file_path) as cnt FROM tool_calls WHERE session_id = ? AND file_path IS NOT NULL").get(sid) as any;
    return {
      model: modelRow?.model || null,
      total_tokens: tokenRow?.total || 0,
      error_count: errorRow?.cnt || 0,
      file_count: fileRow?.cnt || 0,
    };
  } catch { return {}; }
}

// Tool 1: Search sessions
server.tool(
  "keddy_search_sessions",
  "Search past sessions by keyword across user prompts and plan text. Returns session metadata with model, token counts, errors, and files touched.",
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
      ...enrichSession(s),
    }));

    return jsonResult({ count: results.length, sessions: formatted });
  },
);

// Tool 2: Get session details
server.tool(
  "keddy_get_session",
  "Get everything about a session — full segments, plans, milestones, exchanges, activity groups, and token summary. Returns a large response (100KB+). Prefer keddy_get_session_skeleton for a lightweight overview first.",
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
  "Get plan details — full text, version history, user feedback, and status transitions. Use after keddy_get_session_skeleton shows plan activity worth investigating.",
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
  "Start here for cross-project overview. Shows recent sessions across all projects with activity summaries. Use this to see what's been happening before diving into a specific session.",
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
      ...enrichSession(s),
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
  "Read specific exchanges in full — both user prompts and Claude's complete responses. Use keddy_transcript_summary first to find the right exchange range, then call this with from/to parameters to read just that section.",
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
  "Start here for project context. Returns the active plan with full text, task progress, recent milestones, and what the last session was working on. Call this before starting work or when you need to understand where things stand.",
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

// Tool 8: Search tool calls
server.tool(
  "keddy_search_tool_calls",
  "Search across all tool calls — bash commands, file operations, web searches. Find specific commands run, files touched, or operations performed across sessions.",
  {
    tool_name: z.string().optional().describe("Filter by tool name (Bash, Read, Edit, Write, Grep, Agent, etc.)"),
    command_pattern: z.string().optional().describe("Search within bash commands (e.g. 'npm test', 'git push')"),
    file_pattern: z.string().optional().describe("Search file paths (e.g. 'auth.ts', 'src/api')"),
    project: z.string().optional().describe("Filter by project path substring"),
    days: z.number().optional().describe("Limit to last N days"),
    limit: z.number().optional().describe("Max results (default 30)"),
  },
  async ({ tool_name, command_pattern, file_pattern, project, days, limit }) => {
    try {
      const db = getDb();
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (tool_name) { conditions.push("tc.tool_name = ?"); params.push(tool_name); }
      if (command_pattern) { conditions.push("tc.bash_command LIKE ?"); params.push(`%${command_pattern}%`); }
      if (file_pattern) { conditions.push("tc.file_path LIKE ?"); params.push(`%${file_pattern}%`); }
      if (project) { conditions.push("s.project_path LIKE ?"); params.push(`%${project}%`); }
      if (days) {
        conditions.push("s.started_at > datetime('now', ?)");
        params.push(`-${days} days`);
      }

      if (conditions.length === 0) {
        return textResult("Please provide at least one search parameter (tool_name, command_pattern, or file_pattern).");
      }

      const where = conditions.join(" AND ");
      const rows = db.prepare(`
        SELECT tc.tool_name, tc.bash_command, tc.bash_desc, tc.file_path, tc.web_query, tc.is_error,
               SUBSTR(tc.tool_result, 1, 200) as result_preview,
               e.exchange_index, e.timestamp, s.session_id, s.title, s.project_path
        FROM tool_calls tc
        JOIN exchanges e ON tc.exchange_id = e.id
        JOIN sessions s ON tc.session_id = s.id
        WHERE ${where}
        ORDER BY e.timestamp DESC
        LIMIT ?
      `).all(...params, limit ?? 30) as any[];

      if (rows.length === 0) return textResult("No matching tool calls found.");

      return jsonResult({
        count: rows.length,
        results: rows.map((r: any) => ({
          session_id: r.session_id,
          title: r.title,
          project: r.project_path,
          exchange_index: r.exchange_index,
          timestamp: r.timestamp,
          tool_name: r.tool_name,
          bash_command: r.bash_command || undefined,
          bash_desc: r.bash_desc || undefined,
          file_path: r.file_path || undefined,
          web_query: r.web_query || undefined,
          is_error: !!r.is_error,
          result_preview: r.result_preview || undefined,
        })),
      });
    } catch (err) {
      return textResult(`Error searching tool calls: ${err}`);
    }
  },
);

// Tool 9: Find errors
server.tool(
  "keddy_find_errors",
  "Investigate errors — returns failed tool calls with the triggering user prompt and error context. Use after keddy_get_session_skeleton shows errors worth investigating, or to search for recurring error patterns across sessions.",
  {
    pattern: z.string().optional().describe("Search within error messages"),
    tool_name: z.string().optional().describe("Filter by tool type (e.g. 'Bash' for command failures)"),
    project: z.string().optional().describe("Filter by project path substring"),
    days: z.number().optional().describe("Limit to last N days"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ pattern, tool_name, project, days, limit }) => {
    try {
      const db = getDb();
      const conditions: string[] = ["tc.is_error = 1"];
      const params: unknown[] = [];

      if (pattern) { conditions.push("tc.tool_result LIKE ?"); params.push(`%${pattern}%`); }
      if (tool_name) { conditions.push("tc.tool_name = ?"); params.push(tool_name); }
      if (project) { conditions.push("s.project_path LIKE ?"); params.push(`%${project}%`); }
      if (days) {
        conditions.push("s.started_at > datetime('now', ?)");
        params.push(`-${days} days`);
      }

      const where = conditions.join(" AND ");
      const rows = db.prepare(`
        SELECT tc.tool_name, tc.bash_command, tc.file_path,
               SUBSTR(tc.tool_result, 1, 300) as error_preview,
               SUBSTR(e.user_prompt, 1, 200) as prompt_context,
               e.exchange_index, e.timestamp, s.session_id, s.title, s.project_path
        FROM tool_calls tc
        JOIN exchanges e ON tc.exchange_id = e.id
        JOIN sessions s ON tc.session_id = s.id
        WHERE ${where}
        ORDER BY e.timestamp DESC
        LIMIT ?
      `).all(...params, limit ?? 20) as any[];

      if (rows.length === 0) return textResult("No errors found matching your criteria.");

      return jsonResult({
        count: rows.length,
        errors: rows.map((r: any) => ({
          session_id: r.session_id,
          title: r.title,
          project: r.project_path,
          exchange_index: r.exchange_index,
          timestamp: r.timestamp,
          tool_name: r.tool_name,
          bash_command: r.bash_command || undefined,
          file_path: r.file_path || undefined,
          error_preview: r.error_preview,
          prompt_context: r.prompt_context,
        })),
      });
    } catch (err) {
      return textResult(`Error searching errors: ${err}`);
    }
  },
);

// Tool 10: Bash history
server.tool(
  "keddy_get_bash_history",
  "Get chronological bash command history for a project. Shows every shell command Claude ran with results — useful for understanding what was tried and what worked.",
  {
    project: z.string().describe("Project path (or substring)"),
    days: z.number().optional().describe("Limit to last N days (default 7)"),
    limit: z.number().optional().describe("Max results (default 50)"),
    errors_only: z.boolean().optional().describe("Only show failed commands"),
  },
  async ({ project, days, limit, errors_only }) => {
    try {
      const db = getDb();
      const conditions: string[] = [
        "tc.tool_name = 'Bash'",
        "tc.bash_command IS NOT NULL",
        "s.project_path LIKE ?",
      ];
      const params: unknown[] = [`%${project}%`];

      if (errors_only) { conditions.push("tc.is_error = 1"); }
      if (days) {
        conditions.push("s.started_at > datetime('now', ?)");
        params.push(`-${days} days`);
      } else {
        conditions.push("s.started_at > datetime('now', '-7 days')");
      }

      const where = conditions.join(" AND ");
      const rows = db.prepare(`
        SELECT tc.bash_command, tc.bash_desc, tc.is_error,
               SUBSTR(tc.tool_result, 1, 200) as result_preview,
               e.exchange_index, e.timestamp, s.session_id, s.title
        FROM tool_calls tc
        JOIN exchanges e ON tc.exchange_id = e.id
        JOIN sessions s ON tc.session_id = s.id
        WHERE ${where}
        ORDER BY e.timestamp DESC
        LIMIT ?
      `).all(...params, limit ?? 50) as any[];

      if (rows.length === 0) return textResult(`No bash commands found for project: ${project}`);

      return jsonResult({
        project,
        count: rows.length,
        commands: rows.map((r: any) => ({
          session_id: r.session_id,
          title: r.title,
          exchange_index: r.exchange_index,
          timestamp: r.timestamp,
          command: r.bash_command,
          description: r.bash_desc || undefined,
          is_error: !!r.is_error,
          result_preview: r.result_preview || undefined,
        })),
      });
    } catch (err) {
      return textResult(`Error fetching bash history: ${err}`);
    }
  },
);

// ── Agent-optimized lightweight tools ─────────────────────────

server.tool(
  "keddy_get_session_skeleton",
  "Get a session's structure before reading details. Returns timeline of events (milestones, plans, compactions, interrupts), task summary, error counts, and top files touched — all in 3-5KB. Call this after finding a session to understand what happened, then use keddy_transcript_summary or keddy_get_transcript to read specifics.",
  {
    session_id: z.string().describe("Session ID"),
  },
  async ({ session_id }) => {
    try {
      const session = getSession(session_id);
      if (!session) return textResult(`Session not found: ${session_id}`);

      const db = getDb();
      const milestones = getSessionMilestones(session.id);
      const plans = getSessionPlans(session.id);
      const tasks = getSessionTasks(session.id);
      const compactions = getSessionCompactionEvents(session.id);

      // Build timeline of key events (milestones, plans, compactions, interrupts)
      const timeline: Array<{ exchange: number; type: string; label: string }> = [];

      for (const ms of milestones) {
        timeline.push({ exchange: ms.exchange_index, type: ms.milestone_type, label: ms.description });
      }
      for (const plan of plans) {
        timeline.push({ exchange: plan.exchange_index_start, type: "plan", label: `Plan v${plan.version} (${plan.status})${plan.user_feedback ? " — feedback: " + plan.user_feedback.substring(0, 100) : ""}` });
      }
      for (const c of compactions) {
        timeline.push({ exchange: c.exchange_index, type: "compaction", label: `Context compacted (${c.exchanges_before}→${c.exchanges_after} exchanges)` });
      }

      // Interrupts
      const interrupts = db.prepare(
        "SELECT exchange_index FROM exchanges WHERE session_id = ? AND is_interrupt = 1 ORDER BY exchange_index",
      ).all(session.id) as Array<{ exchange_index: number }>;
      for (const intr of interrupts) {
        timeline.push({ exchange: intr.exchange_index, type: "interrupt", label: "User interrupted" });
      }

      timeline.sort((a, b) => a.exchange - b.exchange);

      // Error summary
      const errorRows = db.prepare(
        "SELECT tool_name, COUNT(*) as cnt FROM tool_calls WHERE session_id = ? AND is_error = 1 GROUP BY tool_name",
      ).all(session.id) as Array<{ tool_name: string; cnt: number }>;
      const errorsByTool: Record<string, number> = {};
      let totalErrors = 0;
      for (const r of errorRows) { errorsByTool[r.tool_name] = r.cnt; totalErrors += r.cnt; }

      // Token summary
      const tokenRow = db.prepare(`
        SELECT SUM(input_tokens) as inp, SUM(output_tokens) as out, SUM(cache_read_tokens) as cache
        FROM exchanges WHERE session_id = ?
      `).get(session.id) as any;

      // File summary
      const fileRows = db.prepare(`
        SELECT file_path, COUNT(*) as cnt FROM tool_calls
        WHERE session_id = ? AND file_path IS NOT NULL
        GROUP BY file_path ORDER BY cnt DESC LIMIT 15
      `).all(session.id) as Array<{ file_path: string; cnt: number }>;

      return jsonResult({
        session: {
          session_id: session.session_id,
          title: session.title,
          project: session.project_path,
          branch: session.git_branch,
          exchange_count: session.exchange_count,
          started: session.started_at,
          ended: session.ended_at,
        },
        timeline,
        plans_summary: plans.map((p) => ({
          version: p.version,
          status: p.status,
          feedback: p.user_feedback,
          text_preview: p.plan_text.substring(0, 300),
        })),
        tasks: tasks.map((t: any) => ({ subject: t.subject, status: t.status })),
        errors: { total: totalErrors, by_tool: errorsByTool },
        tokens: { input: tokenRow?.inp || 0, output: tokenRow?.out || 0, cache_read: tokenRow?.cache || 0 },
        top_files: fileRows.map((f) => f.file_path),
      });
    } catch (err) {
      return textResult(`Error: ${err}`);
    }
  },
);

server.tool(
  "keddy_transcript_summary",
  "Scan a session's conversation flow. Shows the first line of each user prompt with tool counts and error flags — the full session outline in 5-8KB. Use this to find which exchange ranges contain what you're looking for, then call keddy_get_transcript with from/to for full detail.",
  {
    session_id: z.string().describe("Session ID"),
    from: z.number().optional().describe("Start exchange index"),
    to: z.number().optional().describe("End exchange index"),
    max_prompt_length: z.number().optional().describe("Max chars per prompt (default 150)"),
  },
  async ({ session_id, from, to, max_prompt_length }) => {
    try {
      const session = getSession(session_id);
      if (!session) return textResult(`Session not found: ${session_id}`);

      const maxLen = max_prompt_length || 150;
      const db = getDb();

      let sql = `
        SELECT e.exchange_index, e.user_prompt, e.tool_call_count, e.is_interrupt,
               e.is_compact_summary, e.model, e.timestamp,
               (SELECT COUNT(*) FROM tool_calls tc WHERE tc.exchange_id = e.id AND tc.is_error = 1) as error_count
        FROM exchanges e
        WHERE e.session_id = ?
      `;
      const params: unknown[] = [session.id];
      if (from !== undefined) { sql += " AND e.exchange_index >= ?"; params.push(from); }
      if (to !== undefined) { sql += " AND e.exchange_index <= ?"; params.push(to); }
      sql += " ORDER BY e.exchange_index";

      const rows = db.prepare(sql).all(...params) as any[];

      return jsonResult({
        session_id: session.session_id,
        exchange_count: rows.length,
        exchanges: rows.map((r) => ({
          index: r.exchange_index,
          prompt: r.user_prompt.split("\n")[0].substring(0, maxLen),
          tools: r.tool_call_count,
          errors: r.error_count,
          ...(r.is_interrupt ? { interrupted: true } : {}),
          ...(r.is_compact_summary ? { compaction: true } : {}),
        })),
      });
    } catch (err) {
      return textResult(`Error: ${err}`);
    }
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
