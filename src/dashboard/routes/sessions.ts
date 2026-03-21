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
  const days = c.req.query("days");
  const limit = c.req.query("limit");

  let sessions;
  if (query) {
    sessions = searchSessions(query, {
      project: project ?? undefined,
      days: days ? parseInt(days) : undefined,
      limit: limit ? parseInt(limit) : 50,
    });
  } else {
    sessions = getRecentSessions(
      days ? parseInt(days) : 30,
      limit ? parseInt(limit) : 50,
    );
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
  const body = await c.req.json<{ title: string }>();
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
