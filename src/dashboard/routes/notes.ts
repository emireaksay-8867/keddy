import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getSession,
  getSessionNote,
  getSessionNotes,
  getSessionSegments,
  getSessionMilestones,
  upsertSessionNote,
  deleteSessionNote,
} from "../../db/queries.js";
import { getDb } from "../../db/index.js";
import { loadConfig } from "../../cli/config.js";
import { generateSessionNotesStream } from "../../analysis/agent.js";
import { generateSessionMermaid } from "../../analysis/mermaid-generator.js";
import type { MermaidGroup } from "../../analysis/mermaid-generator.js";

/** Extract plan title from plan_text (matches logic in sessions.ts) */
function extractPlanTitle(planText: string): string | null {
  if (!planText) return null;
  for (const line of planText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      let title = trimmed.replace(/^#+\s*/, "");
      title = title.replace(/^Plan:\s*/i, "");
      return title || null;
    }
  }
  for (const line of planText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
      return trimmed.length > 60 ? trimmed.substring(0, 60) : trimmed;
    }
  }
  return null;
}

export const notesRoutes = new Hono();

function resolveSession(id: string) {
  const bySessionId = getSession(id);
  if (bySessionId) return bySessionId;
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any | undefined;
}

// GET /sessions/:id/mermaid — programmatic flow diagram (instant, zero AI cost)
notesRoutes.get("/sessions/:id/mermaid", (c) => {
  const id = c.req.param("id");
  const session = resolveSession(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const db = getDb();
  const segments = getSessionSegments(session.id);
  const milestones = getSessionMilestones(session.id);

  // Batch query: bash_desc values for entire session
  let bashDescRows: Array<{ exchange_index: number; bash_desc: string }> = [];
  try {
    bashDescRows = db.prepare(`
      SELECT e.exchange_index, tc.bash_desc
      FROM tool_calls tc JOIN exchanges e ON tc.exchange_id = e.id
      WHERE e.session_id = ? AND tc.bash_desc IS NOT NULL AND tc.bash_desc != ''
      ORDER BY e.exchange_index
    `).all(session.id) as any[];
  } catch { /* non-critical */ }

  // Batch query: plan titles for entire session
  let planRows: Array<{ exchange_index_start: number; plan_text: string }> = [];
  try {
    planRows = db.prepare(`
      SELECT exchange_index_start, plan_text
      FROM plans WHERE session_id = ? ORDER BY version
    `).all(session.id) as any[];
  } catch { /* non-critical */ }

  // Convert segments (with boundary_type) to MermaidGroup format
  const groups: MermaidGroup[] = segments
    .filter((s) => s.boundary_type)
    .map((s) => {
      let filesWritten: string[] = [];
      let filesRead: string[] = [];
      let toolCounts: Record<string, number> = {};
      let markers: Array<{ exchange_index: number; type: string; label: string }> = [];
      try { filesWritten = JSON.parse(s.files_written || "[]"); } catch {}
      try { filesRead = JSON.parse(s.files_read || "[]"); } catch {}
      try { toolCounts = JSON.parse(s.tool_counts); } catch {}
      try { markers = JSON.parse(s.markers || "[]"); } catch {}

      // Partition bash_descs into this group's exchange range
      const groupBashDescs = bashDescRows
        .filter((r) => r.exchange_index >= s.exchange_index_start && r.exchange_index <= s.exchange_index_end)
        .map((r) => r.bash_desc);
      // Deduplicate while preserving order
      const seenDescs = new Set<string>();
      const uniqueBashDescs: string[] = [];
      for (const desc of groupBashDescs) {
        if (!seenDescs.has(desc)) { seenDescs.add(desc); uniqueBashDescs.push(desc); }
      }

      // Match plan title if this group has plan_enter markers
      let planTitle: string | null = null;
      const hasPlanMarker = markers.some((m) => m.type === "plan_enter" || m.type === "plan_exit");
      if (hasPlanMarker) {
        const matchedPlan = planRows.find((p) =>
          p.exchange_index_start >= s.exchange_index_start && p.exchange_index_start <= s.exchange_index_end
        );
        if (matchedPlan) {
          planTitle = extractPlanTitle(matchedPlan.plan_text);
        }
      }

      return {
        exchange_start: s.exchange_index_start,
        exchange_end: s.exchange_index_end,
        exchange_count: s.exchange_count,
        boundary: s.boundary_type,
        files_written: filesWritten,
        files_read: filesRead,
        tool_counts: toolCounts,
        error_count: s.error_count,
        markers,
        duration_ms: s.duration_ms || 0,
        bash_descs: uniqueBashDescs,
        plan_title: planTitle,
        started_at: s.started_at || null,
        ended_at: s.ended_at || null,
      };
    });

  const forkIdx = (session as any).fork_exchange_index as number | null;

  const mode = c.req.query("mode");
  const result = generateSessionMermaid(groups, milestones.map((m) => ({
    milestone_type: m.milestone_type,
    exchange_index: m.exchange_index,
    description: m.description,
  })), forkIdx, mode === "expanded");

  return c.json(result);
});

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
