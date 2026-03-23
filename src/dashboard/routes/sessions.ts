import { Hono } from "hono";
import { extractSegments } from "../../capture/segments.js";
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
      has_pr: milestones.some((m) => m.milestone_type === "pr"),
      tests_passed: lastTest?.milestone_type === "test_pass",
      tests_failed: lastTest?.milestone_type === "test_fail",
    };

    // Find latest non-superseded plan status
    const latestPlan = plans.length > 0
      ? plans.filter((p) => p.status !== "superseded").pop() || plans[plans.length - 1]
      : null;

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

      const newSegments = extractSegments(parsedExchanges);
      const newMilestones = extractMilestones(parsedExchanges);
      const newPlans = extractPlans(parsedExchanges);
      const db = getDb();
      const { insertSegment, insertMilestone, insertPlan } = require("../../db/queries.js");

      for (const seg of newSegments) {
        insertSegment({
          session_id: session.id,
          segment_type: seg.segment_type,
          exchange_index_start: seg.exchange_index_start,
          exchange_index_end: seg.exchange_index_end,
          files_touched: JSON.stringify(seg.files_touched),
          tool_counts: JSON.stringify(seg.tool_counts),
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

  return c.json({
    ...session,
    segments,
    milestones,
    plans,
    compaction_events: compactions,
    tasks,
    decisions,
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
