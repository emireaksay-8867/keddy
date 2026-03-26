import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDailyNote, upsertDailyNote, deleteDailyNote } from "../../db/queries.js";
import { loadConfig } from "../../cli/config.js";
import { generateDailyNotesStream, getDailyData } from "../../analysis/daily-agent.js";

export const dailyRoutes = new Hono();

// GET /daily/:date/data — instant data layer (sessions + milestones + stored note)
dailyRoutes.get("/:date/data", (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "Invalid date format (YYYY-MM-DD)" }, 400);

  const data = getDailyData(date);
  const note = getDailyNote(date);
  return c.json({ ...data, note, date });
});

// POST /daily/:date/generate — AI daily note via SSE
dailyRoutes.post("/:date/generate", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "Invalid date format" }, 400);

  const config = loadConfig();
  const body = await c.req.json().catch(() => ({}));
  const apiKey = body.apiKey || config.analysis?.apiKey || undefined;
  const model = body.model || undefined;
  const sessionIds: string[] | undefined = body.sessionIds;

  return streamSSE(c, async (stream) => {
    try {
      const gen = generateDailyNotesStream(date, { apiKey, model, sessionIds });
      let finalResult: any = null;

      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          finalResult = value;
          break;
        }
        await stream.writeSSE({ event: value.type, data: JSON.stringify(value) });
      }

      if (finalResult) {
        upsertDailyNote({
          date,
          content: finalResult.content,
          sessions_json: JSON.stringify(finalResult.sessionIds),
          model: finalResult.model,
          agent_turns: finalResult.agentTurns,
          cost_usd: finalResult.costUsd,
        });
        const note = getDailyNote(date);
        await stream.writeSSE({ event: "done", data: JSON.stringify({ ok: true, note }) });
      }
    } catch (err: any) {
      console.error("[keddy] Daily notes generation failed:", err.message);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: err.message || "Failed to generate daily notes" }) });
    }
  });
});

// DELETE /daily/:date — delete stored note
dailyRoutes.delete("/:date", (c) => {
  const date = c.req.param("date");
  deleteDailyNote(date);
  return c.json({ ok: true });
});
