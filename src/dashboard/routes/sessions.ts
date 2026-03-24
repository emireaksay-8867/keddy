import { Hono } from "hono";
import { extractActivityGroups, deriveDisplayType } from "../../capture/activity-groups.js";
import { extractMilestones } from "../../capture/milestones.js";
import { extractPlans } from "../../capture/plans.js";
import {
  searchSessions,
  getRecentSessions,
  getSession,
  getSessionById,
  getSessionExchanges,
  getSessionSegments,
  getSessionMilestones,
  getSessionCompactionEvents,
  getSessionPlans,
} from "../../db/queries.js";
import { getDb } from "../../db/index.js";

export const sessionsRoutes = new Hono();

// GET /api/sessions — list, search, paginate
sessionsRoutes.get("/", (c) => {
  const query = c.req.query("q");
  const project = c.req.query("project");
  const parsedDays = parseInt(c.req.query("days") ?? "", 10);
  const parsedLimit = parseInt(c.req.query("limit") ?? "", 10);
  const daysVal = !isNaN(parsedDays) && parsedDays > 0 ? parsedDays : undefined;
  const limitVal = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;

  let sessions;
  if (query) {
    sessions = searchSessions(query, {
      project: project ?? undefined,
      days: daysVal,
      limit: limitVal,
    });
  } else {
    sessions = getRecentSessions(daysVal ?? 365, limitVal);
    // Apply project filter — match exact path, repo directory name, or worktree repo name
    if (project) {
      const repoName = project.split("/").pop() || project;
      // Also extract worktree repo name from filter path (e.g. .../worktrees/mano/branch → mano)
      const filterParts = project.split("/");
      const filterWtIdx = filterParts.indexOf("worktrees");
      const filterWtRepo = filterWtIdx >= 0 ? filterParts[filterWtIdx + 1] : null;

      sessions = sessions.filter((s) => {
        if (s.project_path === project) return true;
        // Match by repo directory name
        const sessionRepo = s.project_path.split("/").pop() || "";
        if (sessionRepo === repoName) return true;
        // Match session worktree repo name against filter repo name
        const parts = s.project_path.split("/");
        const wtIdx = parts.indexOf("worktrees");
        if (wtIdx >= 0 && parts[wtIdx + 1] === repoName) return true;
        // Match if filter is a worktree path — match its repo name against session repo name
        if (filterWtRepo && sessionRepo === filterWtRepo) return true;
        if (filterWtRepo && wtIdx >= 0 && parts[wtIdx + 1] === filterWtRepo) return true;
        return false;
      });
    }
  }

  // Filter out ghost sessions (SessionStart fired but no exchanges ever captured)
  sessions = sessions.filter((s) => s.exchange_count > 0);

  const db = getDb();

  // Sync custom titles from JSONL for recently modified sessions
  // This catches /rename and auto-rename without waiting for Stop hook
  try {
    const { existsSync, statSync, readFileSync } = require("node:fs");
    const now = Date.now();
    const RECENT_THRESHOLD = 10 * 60 * 1000; // 10 minutes
    for (const s of sessions) {
      if (!s.jsonl_path || !existsSync(s.jsonl_path)) continue;
      const mtime = statSync(s.jsonl_path).mtimeMs;
      if (now - mtime > RECENT_THRESHOLD) continue;
      // Scan file for custom-title entries (they're small, ~50 bytes each)
      const content = readFileSync(s.jsonl_path, "utf8");
      let customTitle: string | null = null;
      for (const line of content.split("\n")) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "custom-title" && entry.customTitle) {
            customTitle = entry.customTitle;
          }
        } catch { /* skip malformed lines */ }
      }
      if (customTitle && customTitle !== s.title) {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(customTitle, s.id);
        s.title = customTitle;
      }
    }
  } catch { /* non-critical */ }

  // Enrich with segment data + plans + AI status + fork info
  const enriched = sessions.map((s) => {
    const segments = getSessionSegments(s.id);
    const milestones = getSessionMilestones(s.id);
    const plans = getSessionPlans(s.id);
    const hasAiSummaries = segments.some((seg) => seg.summary);

    // Resolve parent session title for forks
    let parentTitle: string | null = null;
    if (s.forked_from) {
      try {
        const forkData = JSON.parse(s.forked_from);
        if (forkData.sessionId) {
          const parent = db.prepare("SELECT title FROM sessions WHERE session_id = ?").get(forkData.sessionId) as { title: string | null } | undefined;
          parentTitle = parent?.title ?? null;
        }
      } catch { /* invalid JSON */ }
    }

    // Compute outcomes from milestones
    // For tests, use the LAST test result — if you fix a failing test, the session outcome is "passed"
    const testMilestones = milestones.filter(
      (m) => m.milestone_type === "test_pass" || m.milestone_type === "test_fail",
    );
    const lastTest = testMilestones.length > 0 ? testMilestones[testMilestones.length - 1] : null;
    const outcomes = {
      commits: milestones.filter((m) => m.milestone_type === "commit").length,
      has_push: milestones.some((m) => m.milestone_type === "push"),
      has_pr: milestones.some((m) => m.milestone_type === "pr"),
      tests_passed: lastTest?.milestone_type === "test_pass",
      tests_failed: lastTest?.milestone_type === "test_fail",
    };

    // Find latest non-superseded plan status
    const latestPlan = plans.length > 0
      ? plans.filter((p) => p.status !== "superseded").pop() || plans[plans.length - 1]
      : null;

    // Facts-first: activity group summaries for the activity strip
    const activityGroups = segments
      .filter((seg) => seg.boundary_type != null)
      .map((seg) => {
        const toolCounts = (() => { try { return JSON.parse(seg.tool_counts); } catch { return {}; } })() as Record<string, number>;
        // Classify dominant tool category
        const readTools = new Set(["Read", "Grep", "Glob"]);
        const editTools = new Set(["Edit", "Write", "NotebookEdit"]);
        let readC = 0, editC = 0, bashC = 0, planC = 0, total = 0;
        for (const [tool, count] of Object.entries(toolCounts)) {
          total += count;
          if (readTools.has(tool)) readC += count;
          else if (editTools.has(tool)) editC += count;
          else if (tool === "Bash") bashC += count;
          else if (tool === "EnterPlanMode" || tool === "ExitPlanMode") planC += count;
        }
        let dominant = "none";
        if (total > 0) {
          if (planC > 0) dominant = "plan";
          else {
            const max = Math.max(readC, editC, bashC);
            if (max > 0) {
              if (max === editC && editC >= total * 0.4) dominant = "edit";
              else if (max === readC && readC >= total * 0.5) dominant = "read";
              else if (max === bashC && bashC >= total * 0.5) dominant = "bash";
              else dominant = "mixed";
            }
          }
        }
        return {
          exchange_start: seg.exchange_index_start,
          exchange_end: seg.exchange_index_end,
          exchange_count: seg.exchange_count || (seg.exchange_index_end - seg.exchange_index_start + 1),
          dominant_tool_category: dominant,
          has_errors: (seg.error_count || 0) > 0,
          boundary: seg.boundary_type,
        };
      });

    // Token summary (only if we have facts-first data)
    let tokenSummary = null;
    let dominantModel: string | null = null;
    let fileCount = 0;
    if (activityGroups.length > 0) {
      try {
        const tokenRow = db.prepare(`
          SELECT SUM(input_tokens) as ti, SUM(output_tokens) as to2, SUM(cache_read_tokens) as tcr
          FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL
        `).get(s.id) as { ti: number | null; to2: number | null; tcr: number | null };
        if (tokenRow && tokenRow.ti != null) {
          tokenSummary = {
            total_input: tokenRow.ti || 0,
            total_output: tokenRow.to2 || 0,
            total_cache_read: tokenRow.tcr || 0,
            total: (tokenRow.ti || 0) + (tokenRow.to2 || 0),
          };
        }
        const modelRow = db.prepare(`
          SELECT model, COUNT(*) as cnt FROM exchanges
          WHERE session_id = ? AND model IS NOT NULL
          GROUP BY model ORDER BY cnt DESC LIMIT 1
        `).get(s.id) as { model: string; cnt: number } | undefined;
        dominantModel = modelRow?.model ?? null;
        const fileRow = db.prepare(`
          SELECT COUNT(DISTINCT file_path) as cnt FROM tool_calls
          WHERE session_id = ? AND file_path IS NOT NULL
        `).get(s.id) as { cnt: number };
        fileCount = fileRow?.cnt ?? 0;
      } catch { /* non-critical */ }
    }

    return {
      ...s,
      segments: segments.map((seg) => ({
        type: seg.segment_type,
        start: seg.exchange_index_start,
        end: seg.exchange_index_end,
        has_summary: !!seg.summary,
      })),
      milestone_count: milestones.length,
      outcomes,
      latest_plan: latestPlan ? { version: latestPlan.version, status: latestPlan.status, total_versions: plans.length } : null,
      has_ai: hasAiSummaries,
      compaction_count: s.compaction_count,
      forked_from: s.forked_from,
      parent_title: parentTitle,
      // Facts-first additions
      activity_groups: activityGroups,
      milestones: milestones.map((m) => ({
        type: m.milestone_type,
        exchange_index: m.exchange_index,
        description: m.description,
      })),
      token_summary: tokenSummary,
      model: dominantModel,
      file_count: fileCount,
      total_tool_calls: (() => {
        try {
          const row = db.prepare("SELECT COUNT(*) as cnt FROM tool_calls WHERE session_id = ?").get(s.id) as { cnt: number };
          return row.cnt;
        } catch { return 0; }
      })(),
    };
  });

  return c.json(enriched);
});

// GET /api/sessions/:id — detail
sessionsRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  // Try by session_id first, then by id
  let session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  let segments = getSessionSegments(session.id);
  let milestones = getSessionMilestones(session.id);
  let plans = getSessionPlans(session.id);
  const compactions = getSessionCompactionEvents(session.id);

  // If no segments but has exchanges, generate analysis on-the-fly
  // This handles live sessions where SessionEnd hasn't run yet
  if (segments.length === 0 && session.exchange_count > 0) {
    try {
      const exchanges = getSessionExchanges(session.id);
      const parsedExchanges = exchanges.map((e: any) => ({
        index: e.exchange_index,
        user_prompt: e.user_prompt,
        assistant_response: e.assistant_response,
        tool_calls: (() => {
          try {
            const db = getDb();
            return db.prepare("SELECT tool_name as name, tool_input as input, tool_result as result, tool_use_id as id, is_error FROM tool_calls WHERE exchange_id = ?").all(e.id).map((tc: any) => ({
              ...tc,
              input: tc.input ? JSON.parse(tc.input) : {},
              is_error: !!tc.is_error,
            }));
          } catch { return []; }
        })(),
        timestamp: e.timestamp,
        is_interrupt: !!e.is_interrupt,
        is_compact_summary: !!e.is_compact_summary,
      }));

      const newMilestones = extractMilestones(parsedExchanges);
      const newPlans = extractPlans(parsedExchanges);
      const newGroups = extractActivityGroups(parsedExchanges, newMilestones);
      const db = getDb();
      const { insertSegment, insertMilestone, insertPlan } = require("../../db/queries.js");

      for (const group of newGroups) {
        const { deriveDisplayType: ddt } = require("../../capture/activity-groups.js");
        const allFiles = [...new Set([...group.files_read, ...group.files_written])];
        insertSegment({
          session_id: session.id,
          segment_type: ddt(group),
          exchange_index_start: group.exchange_index_start,
          exchange_index_end: group.exchange_index_end,
          files_touched: JSON.stringify(allFiles),
          tool_counts: JSON.stringify(group.tool_counts),
          boundary_type: group.boundary,
          files_read: JSON.stringify(group.files_read),
          files_written: JSON.stringify(group.files_written),
          error_count: group.error_count,
          total_input_tokens: group.total_input_tokens,
          total_output_tokens: group.total_output_tokens,
          total_cache_read_tokens: group.total_cache_read_tokens,
          total_cache_write_tokens: group.total_cache_write_tokens,
          duration_ms: group.duration_ms,
          models: JSON.stringify(group.models),
          markers: JSON.stringify(group.markers),
          exchange_count: group.exchange_count,
          started_at: group.started_at,
          ended_at: group.ended_at,
        });
      }
      for (const m of newMilestones) {
        insertMilestone({
          session_id: session.id,
          milestone_type: m.milestone_type,
          exchange_index: m.exchange_index,
          description: m.description,
          metadata: m.metadata ? JSON.stringify(m.metadata) : null,
        });
      }
      for (const p of newPlans) {
        insertPlan({
          session_id: session.id,
          version: p.version,
          plan_text: p.plan_text,
          status: p.status,
          user_feedback: p.user_feedback,
          exchange_index_start: p.exchange_index_start,
          exchange_index_end: p.exchange_index_end,
        });
      }

      // Re-read after insert
      segments = getSessionSegments(session.id);
      milestones = getSessionMilestones(session.id);
      plans = getSessionPlans(session.id);
    } catch (e) {
      // Non-critical — timeline just stays empty
      console.error("[keddy] On-the-fly analysis failed:", e);
    }
  }

  // Get tasks from DB (stored during import/capture)
  const db = getDb();
  const tasks = db.prepare(`
    SELECT id, task_index, subject, description, status, exchange_index_created as exchange_created, exchange_index_completed as exchange_completed
    FROM tasks WHERE session_id = ? ORDER BY task_index
  `).all(session.id);

  // Get decisions (from AI analysis)
  const decisions = db.prepare(`
    SELECT id, exchange_index, decision_text, context, alternatives
    FROM decisions WHERE session_id = ? ORDER BY exchange_index
  `).all(session.id);

  // Facts-first: build activity group details from segments with boundary_type
  const activityGroups = segments
    .filter((seg) => seg.boundary_type != null)
    .map((seg) => ({
      exchange_start: seg.exchange_index_start,
      exchange_end: seg.exchange_index_end,
      exchange_count: seg.exchange_count || (seg.exchange_index_end - seg.exchange_index_start + 1),
      started_at: seg.started_at,
      ended_at: seg.ended_at,
      tool_counts: (() => { try { return JSON.parse(seg.tool_counts); } catch { return {}; } })(),
      error_count: seg.error_count || 0,
      files_read: (() => { try { return JSON.parse(seg.files_read || "[]"); } catch { return []; } })(),
      files_written: (() => { try { return JSON.parse(seg.files_written || "[]"); } catch { return []; } })(),
      total_input_tokens: seg.total_input_tokens || 0,
      total_output_tokens: seg.total_output_tokens || 0,
      total_cache_read_tokens: seg.total_cache_read_tokens || 0,
      total_cache_write_tokens: seg.total_cache_write_tokens || 0,
      duration_ms: seg.duration_ms || 0,
      models: (() => { try { return JSON.parse(seg.models || "[]"); } catch { return []; } })(),
      markers: (() => { try { return JSON.parse(seg.markers || "[]"); } catch { return []; } })(),
      boundary: seg.boundary_type,
      ai_summary: seg.ai_summary,
      ai_label: seg.ai_label,
    }));

  // Token summary
  let tokenSummary = null;
  try {
    const tokenRow = db.prepare(`
      SELECT SUM(input_tokens) as ti, SUM(output_tokens) as to2,
        SUM(cache_read_tokens) as tcr, SUM(cache_write_tokens) as tcw
      FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL
    `).get(session.id) as any;
    if (tokenRow && tokenRow.ti != null) {
      const total = (tokenRow.ti || 0) + (tokenRow.to2 || 0);
      const cacheRead = tokenRow.tcr || 0;
      tokenSummary = {
        total_input: tokenRow.ti || 0,
        total_output: tokenRow.to2 || 0,
        total_cache_read: cacheRead,
        total_cache_write: tokenRow.tcw || 0,
        total,
        cache_hit_rate: total > 0 ? Math.round((cacheRead / (tokenRow.ti || 1)) * 100) : 0,
      };
    }
  } catch { /* non-critical */ }

  // Model breakdown
  let modelBreakdown: Array<{ model: string; exchange_count: number; total_tokens: number }> = [];
  try {
    modelBreakdown = db.prepare(`
      SELECT model, COUNT(*) as exchange_count,
        SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as total_tokens
      FROM exchanges WHERE session_id = ? AND model IS NOT NULL
      GROUP BY model ORDER BY exchange_count DESC
    `).all(session.id) as any[];
  } catch { /* non-critical */ }

  // File operations
  let fileOperations: Array<{ file_path: string; short_name: string; reads: number; edits: number; writes: number }> = [];
  try {
    const rows = db.prepare(`
      SELECT file_path,
        SUM(CASE WHEN tool_name IN ('Read', 'Grep', 'Glob') THEN 1 ELSE 0 END) as reads,
        SUM(CASE WHEN tool_name = 'Edit' THEN 1 ELSE 0 END) as edits,
        SUM(CASE WHEN tool_name = 'Write' THEN 1 ELSE 0 END) as writes
      FROM tool_calls WHERE session_id = ? AND file_path IS NOT NULL
      GROUP BY file_path ORDER BY (edits + writes) DESC, reads DESC
    `).all(session.id) as any[];
    fileOperations = rows.map((r: any) => ({
      ...r,
      short_name: r.file_path.split("/").pop() || r.file_path,
    }));
  } catch { /* non-critical */ }

  return c.json({
    ...session,
    segments,
    milestones,
    plans,
    compaction_events: compactions,
    tasks,
    decisions,
    // Facts-first additions
    activity_groups: activityGroups,
    token_summary: tokenSummary,
    model_breakdown: modelBreakdown,
    file_operations: fileOperations,
  });
});

// GET /api/sessions/:id/stats — token, tool, file, model, timing stats
sessionsRoutes.get("/:id/stats", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const db = getDb();

  // Per-exchange token data
  const perExchange = db.prepare(`
    SELECT exchange_index as index, timestamp, model,
      input_tokens as input, output_tokens as output,
      cache_read_tokens as cache_read, cache_write_tokens as cache_write
    FROM exchanges WHERE session_id = ? ORDER BY exchange_index
  `).all(session.id) as any[];

  const totalInput = perExchange.reduce((s: number, e: any) => s + (e.input || 0), 0);
  const totalOutput = perExchange.reduce((s: number, e: any) => s + (e.output || 0), 0);
  const totalCacheRead = perExchange.reduce((s: number, e: any) => s + (e.cache_read || 0), 0);
  const totalCacheWrite = perExchange.reduce((s: number, e: any) => s + (e.cache_write || 0), 0);

  // Tool usage
  const toolRows = db.prepare(`
    SELECT tool_name, COUNT(*) as count,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as errors
    FROM tool_calls WHERE session_id = ?
    GROUP BY tool_name ORDER BY count DESC
  `).all(session.id) as any[];
  const toolCounts: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  let toolTotal = 0, errorTotal = 0;
  for (const r of toolRows) {
    toolCounts[r.tool_name] = r.count;
    if (r.errors > 0) toolErrors[r.tool_name] = r.errors;
    toolTotal += r.count;
    errorTotal += r.errors;
  }

  // File operations
  const fileRows = db.prepare(`
    SELECT file_path,
      SUM(CASE WHEN tool_name IN ('Read', 'Grep', 'Glob') THEN 1 ELSE 0 END) as reads,
      SUM(CASE WHEN tool_name = 'Edit' THEN 1 ELSE 0 END) as edits,
      SUM(CASE WHEN tool_name = 'Write' THEN 1 ELSE 0 END) as writes
    FROM tool_calls WHERE session_id = ? AND file_path IS NOT NULL
    GROUP BY file_path ORDER BY (edits + writes) DESC, reads DESC
  `).all(session.id) as any[];

  // Model breakdown
  const modelRows = db.prepare(`
    SELECT model, COUNT(*) as exchange_count,
      SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as total_tokens
    FROM exchanges WHERE session_id = ? AND model IS NOT NULL
    GROUP BY model ORDER BY exchange_count DESC
  `).all(session.id) as any[];
  const totalExchangesWithModel = modelRows.reduce((s: number, r: any) => s + r.exchange_count, 0);

  // Timing
  const timestamps = perExchange.filter((e: any) => e.timestamp).map((e: any) => ({
    index: e.index, timestamp: e.timestamp,
  }));
  let totalDurationMs = 0, avgTurnMs = 0;
  let longestTurn: { index: number; duration_ms: number } | null = null;
  if (timestamps.length >= 2) {
    totalDurationMs = new Date(timestamps[timestamps.length - 1].timestamp).getTime() -
      new Date(timestamps[0].timestamp).getTime();
    avgTurnMs = Math.round(totalDurationMs / timestamps.length);
    for (let i = 1; i < timestamps.length; i++) {
      const gap = new Date(timestamps[i].timestamp).getTime() - new Date(timestamps[i - 1].timestamp).getTime();
      if (!longestTurn || gap > longestTurn.duration_ms) {
        longestTurn = { index: timestamps[i].index, duration_ms: gap };
      }
    }
  }

  return c.json({
    tokens: {
      total_input: totalInput,
      total_output: totalOutput,
      total_cache_read: totalCacheRead,
      total_cache_write: totalCacheWrite,
      total: totalInput + totalOutput,
      cache_hit_rate: totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 100) : 0,
      per_exchange: perExchange,
    },
    tools: { counts: toolCounts, errors: toolErrors, total: toolTotal, error_total: errorTotal },
    files: fileRows.map((r: any) => ({
      file_path: r.file_path,
      short_name: r.file_path.split("/").pop() || r.file_path,
      reads: r.reads, edits: r.edits, writes: r.writes,
    })),
    models: modelRows.map((r: any) => ({
      model: r.model, exchange_count: r.exchange_count,
      total_tokens: r.total_tokens,
      percentage: totalExchangesWithModel > 0 ? Math.round((r.exchange_count / totalExchangesWithModel) * 100) : 0,
    })),
    timing: { total_duration_ms: totalDurationMs, avg_turn_ms: avgTurnMs, longest_turn: longestTurn, exchange_timestamps: timestamps },
  });
});

// GET /api/sessions/:id/exchanges
sessionsRoutes.get("/:id/exchanges", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const exchanges = getSessionExchanges(session.id);

  // Optionally include tool calls
  const withTools = c.req.query("tools") === "true";
  if (withTools) {
    const db = getDb();
    const enriched = exchanges.map((e) => {
      const tools = db
        .prepare("SELECT * FROM tool_calls WHERE exchange_id = ?")
        .all(e.id);
      return { ...e, tool_calls: tools };
    });
    return c.json(enriched);
  }

  return c.json(exchanges);
});

// POST /api/sessions/:id/title — rename
sessionsRoutes.post("/:id/title", async (c) => {
  const id = c.req.param("id");
  let body: { title?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.title !== "string" || body.title.length === 0) {
    return c.json({ error: "title must be a non-empty string" }, 400);
  }
  const session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const db = getDb();
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(
    body.title,
    session.id,
  );

  return c.json({ ok: true });
});

// POST /api/sessions/:id/sync — re-sync a session from its JSONL file
sessionsRoutes.post("/:id/sync", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);
  if (!session.jsonl_path) return c.json({ error: "No JSONL file path" }, 400);

  try {
    const { existsSync } = require("node:fs");
    if (!existsSync(session.jsonl_path)) return c.json({ error: "JSONL file not found" }, 404);

    const { parseTranscript } = require("../../capture/parser.js");
    const transcript = parseTranscript(session.jsonl_path);

    const db = getDb();

    // Update session metadata
    db.prepare(`
      UPDATE sessions SET
        git_branch = COALESCE(?, git_branch),
        ended_at = COALESCE(?, ended_at),
        exchange_count = ?
      WHERE id = ?
    `).run(
      transcript.git_branch,
      transcript.ended_at,
      transcript.exchanges.length,
      session.id,
    );

    // Insert any missing exchanges
    const { insertExchange, insertToolCall } = require("../../db/queries.js");
    let added = 0;
    for (const exchange of transcript.exchanges) {
      const eid = insertExchange({
        session_id: session.id,
        exchange_index: exchange.index,
        user_prompt: exchange.user_prompt,
        assistant_response: exchange.assistant_response,
        tool_call_count: exchange.tool_calls.length,
        timestamp: exchange.timestamp,
        is_interrupt: exchange.is_interrupt,
        is_compact_summary: exchange.is_compact_summary,
      });
      // insertExchange returns existing ID if duplicate, but we don't know if it was new
      for (const tc of exchange.tool_calls) {
        try {
          insertToolCall({
            exchange_id: eid,
            session_id: session.id,
            tool_name: tc.name,
            tool_input: JSON.stringify(tc.input),
            tool_result: tc.result ?? null,
            tool_use_id: tc.id,
            is_error: tc.is_error ?? false,
          });
        } catch { /* duplicate tool call */ }
      }
      added++;
    }

    return c.json({
      ok: true,
      exchanges: transcript.exchanges.length,
      branch: transcript.git_branch,
      ended_at: transcript.ended_at,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});
