import { Hono } from "hono";
import { getSession, getSessionById, getSessionPlans } from "../../db/queries.js";

export const plansRoutes = new Hono();

// GET /api/sessions/:id/plans
plansRoutes.get("/sessions/:id/plans", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const plans = getSessionPlans(session.id);
  return c.json(plans);
});
