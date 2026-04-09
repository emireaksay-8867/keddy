import { initDb, getDb, closeDb } from "../db/index.js";
import { parseTranscript } from "../capture/parser.js";
import { existsSync } from "node:fs";

export async function runBackfill(): Promise<void> {
  const force = process.argv.includes("--force") || process.argv.includes("-f");
  initDb();
  const db = getDb();

  try {
    const sessions = db.prepare(`
      SELECT s.id, s.session_id, s.jsonl_path, s.title
      FROM sessions s
      WHERE s.jsonl_path IS NOT NULL
      ORDER BY s.started_at DESC
    `).all() as Array<{ id: string; session_id: string; jsonl_path: string; title: string | null }>;

    console.log(`Found ${sessions.length} sessions with JSONL paths${force ? " (force mode)" : ""}`);

    let totalBackfilled = 0;
    let sessionsProcessed = 0;

    const updateForce = db.prepare(`
      UPDATE exchanges SET
        content_blocks = ?,
        turn_duration_ms = COALESCE(?, turn_duration_ms)
      WHERE session_id = ? AND exchange_index = ?
    `);
    const updateNull = db.prepare(`
      UPDATE exchanges SET
        content_blocks = ?,
        turn_duration_ms = COALESCE(?, turn_duration_ms)
      WHERE session_id = ? AND exchange_index = ? AND content_blocks IS NULL
    `);
    const update = force ? updateForce : updateNull;

    for (const session of sessions) {
      if (!existsSync(session.jsonl_path)) continue;

      if (!force) {
        const missing = db.prepare(`
          SELECT COUNT(*) as cnt FROM exchanges
          WHERE session_id = ? AND (content_blocks IS NULL OR turn_duration_ms IS NULL) AND is_compact_summary = 0
        `).get(session.id) as { cnt: number };
        if (missing.cnt === 0) continue;
      }

      let parsed;
      try {
        parsed = parseTranscript(session.jsonl_path);
      } catch {
        console.log(`  Skip ${session.title || session.session_id.substring(0, 12)} — parse error`);
        continue;
      }

      let count = 0;
      for (const ex of parsed.exchanges) {
        const contentBlocksJson = ex.content_blocks && ex.content_blocks.length > 0
          ? JSON.stringify(ex.content_blocks) : null;
        const result = update.run(
          contentBlocksJson,
          ex.turn_duration_ms ?? null,
          session.id,
          ex.index,
        );
        if (result.changes > 0) count++;
      }

      if (count > 0) {
        console.log(`  ${session.title || session.session_id.substring(0, 12)} — backfilled ${count} exchanges`);
        totalBackfilled += count;
        sessionsProcessed++;
      }
    }

    console.log(`\nDone: backfilled ${totalBackfilled} exchanges across ${sessionsProcessed} sessions`);
  } finally {
    closeDb();
  }
}
