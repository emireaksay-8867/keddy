import { randomUUID } from "node:crypto";
import { getDb } from "./index.js";
import type {
  Session,
  Exchange,
  ToolCall,
  Plan,
  Segment,
  Milestone,
  Decision,
  CompactionEvent,
  SessionLink,
} from "../types.js";

// --- Sessions ---

export function insertSession(data: {
  session_id: string;
  project_path: string;
  git_branch?: string | null;
  title?: string | null;
  slug?: string | null;
  claude_version?: string | null;
  jsonl_path?: string | null;
  forked_from?: string | null;
  metadata?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sessions (id, session_id, project_path, git_branch, title, slug, claude_version, jsonl_path, forked_from, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.project_path,
    data.git_branch ?? null,
    data.title ?? null,
    data.slug ?? null,
    data.claude_version ?? null,
    data.jsonl_path ?? null,
    data.forked_from ?? null,
    data.metadata ?? null,
  );
  return id;
}

export function upsertSession(data: {
  session_id: string;
  project_path: string;
  git_branch?: string | null;
  title?: string | null;
  slug?: string | null;
  claude_version?: string | null;
  jsonl_path?: string | null;
  forked_from?: string | null;
  metadata?: string | null;
}): string {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM sessions WHERE session_id = ?")
    .get(data.session_id) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE sessions SET
        project_path = COALESCE(?, project_path),
        git_branch = COALESCE(?, git_branch),
        title = COALESCE(?, title),
        slug = COALESCE(?, slug),
        claude_version = COALESCE(?, claude_version),
        jsonl_path = COALESCE(?, jsonl_path),
        forked_from = COALESCE(?, forked_from),
        metadata = COALESCE(?, metadata)
      WHERE session_id = ?
    `).run(
      data.project_path,
      data.git_branch ?? null,
      data.title ?? null,
      data.slug ?? null,
      data.claude_version ?? null,
      data.jsonl_path ?? null,
      data.forked_from ?? null,
      data.metadata ?? null,
      data.session_id,
    );
    return existing.id;
  }

  return insertSession(data);
}

export function updateSessionEnd(sessionId: string, exchangeCount: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE sessions SET ended_at = datetime('now'), exchange_count = ? WHERE session_id = ?
  `).run(exchangeCount, sessionId);
}

export function getSession(sessionId: string): Session | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as
    | Session
    | undefined;
}

export function getSessionById(id: string): Session | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
}

export function getRecentSessions(days: number = 7, limit: number = 50): Session[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE started_at >= datetime('now', ?)
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(`-${days} days`, limit) as Session[];
}

function sanitizeFtsQuery(query: string): string {
  // Quote each word to prevent FTS5 syntax errors from special characters
  const words = query
    .replace(/['"]/g, "") // strip quotes
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w}"`);
  return words.join(" ");
}

export function searchSessions(
  query: string,
  options?: { project?: string; days?: number; limit?: number },
): Session[] {
  const db = getDb();
  const limit = options?.limit ?? 20;

  const safeQuery = sanitizeFtsQuery(query);
  if (!safeQuery) return [];

  let sql = `
    SELECT DISTINCT s.* FROM sessions s
    JOIN exchanges e ON e.session_id = s.id
    JOIN exchanges_fts fts ON fts.rowid = e.rowid
    WHERE exchanges_fts MATCH ?
  `;
  const params: unknown[] = [safeQuery];

  if (options?.project) {
    sql += " AND s.project_path LIKE ?";
    params.push(`%${options.project}%`);
  }
  if (options?.days) {
    sql += " AND s.started_at >= datetime('now', ?)";
    params.push(`-${options.days} days`);
  }

  sql += " ORDER BY s.started_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as Session[];
}

// --- Exchanges ---

export function insertExchange(data: {
  session_id: string;
  exchange_index: number;
  user_prompt: string;
  assistant_response?: string;
  tool_call_count?: number;
  timestamp?: string;
  duration_ms?: number | null;
  is_interrupt?: boolean;
  is_compact_summary?: boolean;
  metadata?: string | null;
}): string {
  const db = getDb();

  // Return existing exchange ID if already stored (idempotent)
  const existing = db
    .prepare("SELECT id FROM exchanges WHERE session_id = ? AND exchange_index = ?")
    .get(data.session_id, data.exchange_index) as { id: string } | undefined;

  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO exchanges (id, session_id, exchange_index, user_prompt, assistant_response, tool_call_count, timestamp, duration_ms, is_interrupt, is_compact_summary, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.exchange_index,
    data.user_prompt,
    data.assistant_response ?? "",
    data.tool_call_count ?? 0,
    data.timestamp ?? new Date().toISOString(),
    data.duration_ms ?? null,
    data.is_interrupt ? 1 : 0,
    data.is_compact_summary ? 1 : 0,
    data.metadata ?? null,
  );
  return id;
}

export function getSessionExchanges(sessionId: string): Exchange[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM exchanges WHERE session_id = ? ORDER BY exchange_index",
    )
    .all(sessionId) as Exchange[];
}

// --- Tool Calls ---

export function insertToolCall(data: {
  exchange_id: string;
  session_id: string;
  tool_name: string;
  tool_input?: string;
  tool_result?: string | null;
  tool_use_id: string;
  is_error?: boolean;
  duration_ms?: number | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO tool_calls (id, exchange_id, session_id, tool_name, tool_input, tool_result, tool_use_id, is_error, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.exchange_id,
    data.session_id,
    data.tool_name,
    data.tool_input ?? "{}",
    data.tool_result ?? null,
    data.tool_use_id,
    data.is_error ? 1 : 0,
    data.duration_ms ?? null,
  );
  return id;
}

// --- Plans ---

export function insertPlan(data: {
  session_id: string;
  version: number;
  plan_text: string;
  status?: string;
  user_feedback?: string | null;
  exchange_index_start: number;
  exchange_index_end: number;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO plans (id, session_id, version, plan_text, status, user_feedback, exchange_index_start, exchange_index_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.version,
    data.plan_text,
    data.status ?? "drafted",
    data.user_feedback ?? null,
    data.exchange_index_start,
    data.exchange_index_end,
  );
  return id;
}

export function getSessionPlans(sessionId: string): Plan[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM plans WHERE session_id = ? ORDER BY version")
    .all(sessionId) as Plan[];
}

export function getRecentPlans(limit: number = 20): Plan[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM plans ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Plan[];
}

// --- Segments ---

export function insertSegment(data: {
  session_id: string;
  segment_type: string;
  exchange_index_start: number;
  exchange_index_end: number;
  files_touched?: string;
  tool_counts?: string;
  summary?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO segments (id, session_id, segment_type, exchange_index_start, exchange_index_end, files_touched, tool_counts, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.segment_type,
    data.exchange_index_start,
    data.exchange_index_end,
    data.files_touched ?? "[]",
    data.tool_counts ?? "{}",
    data.summary ?? null,
  );
  return id;
}

export function getSessionSegments(sessionId: string): Segment[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM segments WHERE session_id = ? ORDER BY exchange_index_start",
    )
    .all(sessionId) as Segment[];
}

// --- Milestones ---

export function insertMilestone(data: {
  session_id: string;
  milestone_type: string;
  exchange_index: number;
  description: string;
  metadata?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO milestones (id, session_id, milestone_type, exchange_index, description, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.milestone_type,
    data.exchange_index,
    data.description,
    data.metadata ?? null,
  );
  return id;
}

export function getSessionMilestones(sessionId: string): Milestone[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM milestones WHERE session_id = ? ORDER BY exchange_index",
    )
    .all(sessionId) as Milestone[];
}

// --- Decisions ---

export function insertDecision(data: {
  session_id: string;
  exchange_index: number;
  decision_text: string;
  context?: string | null;
  alternatives?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO decisions (id, session_id, exchange_index, decision_text, context, alternatives)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.exchange_index,
    data.decision_text,
    data.context ?? null,
    data.alternatives ?? null,
  );
  return id;
}

// --- Compaction Events ---

export function insertCompactionEvent(data: {
  session_id: string;
  exchange_index: number;
  summary?: string | null;
  exchanges_before?: number;
  exchanges_after?: number;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO compaction_events (id, session_id, exchange_index, summary, exchanges_before, exchanges_after)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.exchange_index,
    data.summary ?? null,
    data.exchanges_before ?? 0,
    data.exchanges_after ?? 0,
  );
  return id;
}

export function getSessionCompactionEvents(sessionId: string): CompactionEvent[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM compaction_events WHERE session_id = ? ORDER BY exchange_index",
    )
    .all(sessionId) as CompactionEvent[];
}

// --- Session Links ---

export function insertSessionLink(data: {
  source_session_id: string;
  target_session_id: string;
  link_type: string;
  shared_files?: string;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO session_links (id, source_session_id, target_session_id, link_type, shared_files)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    data.source_session_id,
    data.target_session_id,
    data.link_type,
    data.shared_files ?? "[]",
  );
  return id;
}

// --- Stats ---

export function getStats(): {
  total_sessions: number;
  total_exchanges: number;
  total_plans: number;
  total_milestones: number;
  projects: number;
  db_size_mb: number;
} {
  const db = getDb();
  const sessions = (
    db.prepare("SELECT COUNT(*) as count FROM sessions").get() as {
      count: number;
    }
  ).count;
  const exchanges = (
    db.prepare("SELECT COUNT(*) as count FROM exchanges").get() as {
      count: number;
    }
  ).count;
  const plans = (
    db.prepare("SELECT COUNT(*) as count FROM plans").get() as {
      count: number;
    }
  ).count;
  const milestones = (
    db.prepare("SELECT COUNT(*) as count FROM milestones").get() as {
      count: number;
    }
  ).count;
  const projects = (
    db
      .prepare(
        "SELECT COUNT(DISTINCT project_path) as count FROM sessions",
      )
      .get() as { count: number }
  ).count;

  const pageCount = (db.pragma("page_count") as { page_count: number }[])[0]
    ?.page_count ?? 0;
  const pageSize = (db.pragma("page_size") as { page_size: number }[])[0]
    ?.page_size ?? 4096;
  const db_size_mb = Math.round(((pageCount * pageSize) / 1024 / 1024) * 100) / 100;

  return {
    total_sessions: sessions,
    total_exchanges: exchanges,
    total_plans: plans,
    total_milestones: milestones,
    projects,
    db_size_mb,
  };
}

// --- Config ---

export function getConfig(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
  ).run(key, value);
}
