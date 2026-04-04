import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDailyNote, getDailyNotes, insertDailyNote, deleteDailyNote, getExchangeRangesByDate, getDailyList, getDatesWithNotes } from "../../db/queries.js";
import { loadConfig } from "../../cli/config.js";
import { generateDailyNotesStream, getDailyData } from "../../analysis/daily-agent.js";

export const dailyRoutes = new Hono();

// GET /daily/list — all dates with activity + note summaries
dailyRoutes.get("/list", (c) => {
  const days = Number(c.req.query("days") || 90);
  const dates = getDailyList(days);
  const notesMap = getDatesWithNotes(days);
  const items = dates.map((d) => ({ ...d, note: notesMap[d.date] || null }));
  return c.json(items);
});

// GET /daily/:date/data — instant data layer (sessions + milestones + stored notes)
dailyRoutes.get("/:date/data", (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "Invalid date format (YYYY-MM-DD)" }, 400);

  const data = getDailyData(date);
  const notes = getDailyNotes(date);

  // Compute exchange ranges for day-slicing (keyed by external session_id)
  const ranges = getExchangeRangesByDate(date, data.sessions.map((s: any) => s.id));
  const exchangeRanges: Record<string, any> = {};
  for (const s of data.sessions) {
    if (ranges[(s as any).id]) exchangeRanges[s.session_id] = ranges[(s as any).id];
  }

  // Count exchanges on this date that happened after the latest note
  let newExchangesSinceNote = 0;
  const latestNote = notes[0];
  if (latestNote) {
    const { getDb } = require("../../db/index.js");
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM exchanges e
      JOIN sessions s ON e.session_id = s.id
      WHERE s.exchange_count > 0 AND date(e.timestamp) = ? AND datetime(e.timestamp) > datetime(?)
    `).get(date, latestNote.generated_at) as { cnt: number } | undefined;
    newExchangesSinceNote = row?.cnt || 0;
  }

  return c.json({ ...data, notes, note: notes[0] || null, date, exchangeRanges, newExchangesSinceNote });
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
        insertDailyNote({
          date,
          title: finalResult.title,
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

// DELETE /daily/:date/notes/:noteId — delete a specific note
dailyRoutes.delete("/:date/notes/:noteId", (c) => {
  const noteId = c.req.param("noteId");
  deleteDailyNote(noteId);
  return c.json({ ok: true });
});

// DELETE /daily/:date — delete all notes for date (backward compat)
dailyRoutes.delete("/:date", (c) => {
  const date = c.req.param("date");
  const { deleteDailyNotesByDate } = require("../../db/queries.js");
  deleteDailyNotesByDate(date);
  return c.json({ ok: true });
});
