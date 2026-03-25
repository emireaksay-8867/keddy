import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getSession,
  getSessionNote,
  getSessionNotes,
  upsertSessionNote,
  deleteSessionNote,
} from "../../db/queries.js";
import { getDb } from "../../db/index.js";
import { loadConfig } from "../../cli/config.js";
import { generateSessionNotesStream } from "../../analysis/agent.js";

export const notesRoutes = new Hono();

function resolveSession(id: string) {
  const bySessionId = getSession(id);
  if (bySessionId) return bySessionId;
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any | undefined;
}

// GET /sessions/:id/notes — get all session notes (most recent first)
notesRoutes.get("/sessions/:id/notes", (c) => {
  const id = c.req.param("id");
  const session = resolveSession(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const notes = getSessionNotes(session.id);
  return c.json(notes);
});

// GET /sessions/:id/notes/latest — get most recent note only
notesRoutes.get("/sessions/:id/notes/latest", (c) => {
  const id = c.req.param("id");
  const session = resolveSession(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const notes = getSessionNotes(session.id);
  return c.json(notes[0] || null);
});

// POST /sessions/:id/notes/generate — SSE stream: live agent progress + final note
notesRoutes.post("/sessions/:id/notes/generate", async (c) => {
  const id = c.req.param("id");
  const session = resolveSession(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const config = loadConfig();
  const body = await c.req.json().catch(() => ({}));
  const apiKey = body.apiKey || config.analysis?.apiKey || undefined;
  const model = body.model || undefined;

  return streamSSE(c, async (stream) => {
    try {
      const gen = generateSessionNotesStream(session.session_id, { apiKey, model });
      let finalResult: any = null;

      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          // done.value is the return value (NotesResult)
          finalResult = value;
          break;
        }
        // value is an AgentEvent — stream it to the client
        await stream.writeSSE({
          event: value.type,
          data: JSON.stringify(value),
        });
      }

      if (finalResult) {
        // Store in DB (new row each time — keeps history)
        const noteId = upsertSessionNote({
          session_id: session.id,
          content: finalResult.content,
          mermaid: finalResult.mermaid,
          model: finalResult.model,
          agent_turns: finalResult.agentTurns,
          cost_usd: finalResult.costUsd,
          generated_at: new Date().toISOString(),
        });

        const note = getSessionNote(session.id);
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ ok: true, note }),
        });
      }
    } catch (err: any) {
      console.error("[keddy] Session notes generation failed:", err.message);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: err.message || "Failed to generate notes" }),
      });
    }
  });
});

// DELETE /sessions/:id/notes — delete a specific note by note id
notesRoutes.delete("/sessions/:id/notes/:noteId", (c) => {
  const noteId = c.req.param("noteId");
  const db = getDb();
  db.prepare("DELETE FROM session_notes WHERE id = ?").run(noteId);
  return c.json({ ok: true });
});

// DELETE /sessions/:id/notes — delete all notes for session
notesRoutes.delete("/sessions/:id/notes", (c) => {
  const id = c.req.param("id");
  const session = resolveSession(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  deleteSessionNote(session.id);
  return c.json({ ok: true });
});
