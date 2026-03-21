import { Hono } from "hono";
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
    // Apply project filter
    if (project) {
      sessions = sessions.filter((s) => s.project_path === project);
    }
  }

  // Enrich with segment data
  const enriched = sessions.map((s) => {
    const segments = getSessionSegments(s.id);
    const milestones = getSessionMilestones(s.id);
    return {
      ...s,
      segments: segments.map((seg) => ({
        type: seg.segment_type,
        start: seg.exchange_index_start,
        end: seg.exchange_index_end,
      })),
      milestone_count: milestones.length,
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

  const segments = getSessionSegments(session.id);
  const milestones = getSessionMilestones(session.id);
  const plans = getSessionPlans(session.id);
  const compactions = getSessionCompactionEvents(session.id);

  return c.json({
    ...session,
    segments,
    milestones,
    plans,
    compaction_events: compactions,
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
