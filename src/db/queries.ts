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
  SessionNote,
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
  fork_exchange_index?: number | null;
  started_at?: string | null;
  metadata?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sessions (id, session_id, project_path, git_branch, title, slug, claude_version, jsonl_path, forked_from, fork_exchange_index, started_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.fork_exchange_index ?? null,
    data.started_at ?? new Date().toISOString(),
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
  fork_exchange_index?: number | null;
  started_at?: string | null;
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
        fork_exchange_index = COALESCE(?, fork_exchange_index),
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
      data.fork_exchange_index ?? null,
      data.metadata ?? null,
      data.session_id,
    );
    return existing.id;
  }

  return insertSession(data);
}

export function updateSessionEnd(sessionId: string, exchangeCount: number, endedAt?: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE sessions SET ended_at = COALESCE(?, datetime('now')), exchange_count = ? WHERE session_id = ?
  `).run(endedAt ?? null, exchangeCount, sessionId);
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

export function getRecentSessions(days: number = 7, limit: number = 50, offset: number = 0): Session[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE started_at >= datetime('now', ?)
         AND exchange_count > 0
       ORDER BY COALESCE(ended_at, started_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(`-${days} days`, limit, offset) as Session[];
}

export function getProjects(): Array<{ project_path: string; session_count: number; last_activity: string; exchange_count: number }> {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        project_path,
        COUNT(*) as session_count,
        MAX(COALESCE(ended_at, started_at)) as last_activity,
        SUM(exchange_count) as exchange_count
       FROM sessions
       WHERE exchange_count > 0
       GROUP BY project_path
       ORDER BY last_activity DESC`,
    )
    .all() as Array<{ project_path: string; session_count: number; last_activity: string; exchange_count: number }>;
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
  assistant_response_pre?: string;
  tool_call_count?: number;
  timestamp?: string;
  duration_ms?: number | null;
  is_interrupt?: boolean;
  is_compact_summary?: boolean;
  metadata?: string | null;
  // Facts-first fields
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  stop_reason?: string | null;
  has_thinking?: boolean;
  permission_mode?: string | null;
  is_sidechain?: boolean;
  entrypoint?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  turn_duration_ms?: number | null;
}): string {
  const db = getDb();

  // Return existing exchange ID if already stored (idempotent)
  const existing = db
    .prepare("SELECT id FROM exchanges WHERE session_id = ? AND exchange_index = ?")
    .get(data.session_id, data.exchange_index) as { id: string } | undefined;

  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO exchanges (id, session_id, exchange_index, user_prompt, assistant_response, assistant_response_pre,
      tool_call_count, timestamp, duration_ms, is_interrupt, is_compact_summary, metadata,
      model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      stop_reason, has_thinking, permission_mode, is_sidechain, entrypoint, cwd, git_branch,
      turn_duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.exchange_index,
    data.user_prompt,
    data.assistant_response ?? "",
    data.assistant_response_pre ?? "",
    data.tool_call_count ?? 0,
    data.timestamp ?? new Date().toISOString(),
    data.duration_ms ?? null,
    data.is_interrupt ? 1 : 0,
    data.is_compact_summary ? 1 : 0,
    data.metadata ?? null,
    data.model ?? null,
    data.input_tokens ?? null,
    data.output_tokens ?? null,
    data.cache_read_tokens ?? null,
    data.cache_write_tokens ?? null,
    data.stop_reason ?? null,
    data.has_thinking ? 1 : null,
    data.permission_mode ?? null,
    data.is_sidechain ? 1 : null,
    data.entrypoint ?? null,
    data.cwd ?? null,
    data.git_branch ?? null,
    data.turn_duration_ms ?? null,
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
  // Facts-first enrichment
  skill_name?: string | null;
  subagent_type?: string | null;
  subagent_desc?: string | null;
  file_path?: string | null;
  bash_command?: string | null;
  bash_desc?: string | null;
  web_query?: string | null;
  web_url?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO tool_calls (id, exchange_id, session_id, tool_name, tool_input, tool_result,
      tool_use_id, is_error, duration_ms, skill_name, subagent_type, subagent_desc,
      file_path, bash_command, bash_desc, web_query, web_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.skill_name ?? null,
    data.subagent_type ?? null,
    data.subagent_desc ?? null,
    data.file_path ?? null,
    data.bash_command ?? null,
    data.bash_desc ?? null,
    data.web_query ?? null,
    data.web_url ?? null,
  );
  return id;
}

/** Extract structured fields from tool call inputs at insert time */
export function extractToolCallFields(toolName: string, toolInput: unknown): {
  skill_name: string | null;
  subagent_type: string | null;
  subagent_desc: string | null;
  file_path: string | null;
  bash_command: string | null;
  bash_desc: string | null;
  web_query: string | null;
  web_url: string | null;
} {
  const input = (typeof toolInput === "object" && toolInput !== null)
    ? toolInput as Record<string, unknown>
    : {};

  return {
    skill_name: toolName === "Skill" && typeof input.skill === "string"
      ? input.skill : null,
    subagent_type: toolName === "Agent" && typeof input.subagent_type === "string"
      ? input.subagent_type : null,
    subagent_desc: toolName === "Agent" && typeof input.description === "string"
      ? (input.description as string).substring(0, 500) : null,
    file_path: ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"].includes(toolName)
      ? (typeof input.file_path === "string" ? input.file_path
         : typeof input.path === "string" ? input.path
         : null)
      : null,
    bash_command: toolName === "Bash" && typeof input.command === "string"
      ? (input.command as string).substring(0, 1000) : null,
    bash_desc: toolName === "Bash" && typeof input.description === "string"
      ? (input.description as string).substring(0, 500) : null,
    web_query: toolName === "WebSearch" && typeof input.query === "string"
      ? input.query as string : null,
    web_url: toolName === "WebFetch" && typeof input.url === "string"
      ? input.url as string : null,
  };
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
    ON CONFLICT(session_id, version) DO UPDATE SET
      plan_text = CASE WHEN length(excluded.plan_text) > length(plan_text) THEN excluded.plan_text ELSE plan_text END,
      status = excluded.status,
      user_feedback = COALESCE(excluded.user_feedback, user_feedback),
      exchange_index_start = excluded.exchange_index_start,
      exchange_index_end = excluded.exchange_index_end
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
  // Facts-first activity group fields
  boundary_type?: string | null;
  files_read?: string;
  files_written?: string;
  error_count?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cache_read_tokens?: number;
  total_cache_write_tokens?: number;
  duration_ms?: number;
  models?: string;
  markers?: string;
  exchange_count?: number;
  started_at?: string | null;
  ended_at?: string | null;
  ai_label?: string | null;
  ai_summary?: string | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO segments (id, session_id, segment_type, exchange_index_start, exchange_index_end,
      files_touched, tool_counts, summary, boundary_type, files_read, files_written,
      error_count, total_input_tokens, total_output_tokens, total_cache_read_tokens,
      total_cache_write_tokens, duration_ms, models, markers, exchange_count,
      started_at, ended_at, ai_label, ai_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.segment_type,
    data.exchange_index_start,
    data.exchange_index_end,
    data.files_touched ?? "[]",
    data.tool_counts ?? "{}",
    data.summary ?? null,
    data.boundary_type ?? null,
    data.files_read ?? "[]",
    data.files_written ?? "[]",
    data.error_count ?? 0,
    data.total_input_tokens ?? 0,
    data.total_output_tokens ?? 0,
    data.total_cache_read_tokens ?? 0,
    data.total_cache_write_tokens ?? 0,
    data.duration_ms ?? 0,
    data.models ?? "[]",
    data.markers ?? "[]",
    data.exchange_count ?? 0,
    data.started_at ?? null,
    data.ended_at ?? null,
    data.ai_label ?? null,
    data.ai_summary ?? null,
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

  if (data.milestone_type === "commit" || data.milestone_type === "branch") {
    // Commits and branches are unique per session by description — a commit message
    // only happens once. "Last wins": if the same commit exists at a different
    // exchange_index, update to the new one (handles full-reparse correctness).
    db.prepare(`
      INSERT INTO milestones (id, session_id, milestone_type, exchange_index, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, milestone_type, description)
        WHERE milestone_type IN ('commit','branch')
        DO UPDATE SET exchange_index = excluded.exchange_index,
                      metadata = COALESCE(excluded.metadata, metadata)
    `).run(
      id,
      data.session_id,
      data.milestone_type,
      data.exchange_index,
      data.description,
      data.metadata ?? null,
    );
  } else {
    // Push/pull/pr/test: unique per (session, type, exchange, description).
    // Multiple pushes to the same remote at different exchanges are separate events.
    db.prepare(`
      INSERT OR IGNORE INTO milestones (id, session_id, milestone_type, exchange_index, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.session_id,
      data.milestone_type,
      data.exchange_index,
      data.description,
      data.metadata ?? null,
    );
  }
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
  analysis_summary?: string | null;
  exchanges_before?: number;
  exchanges_after?: number;
  pre_tokens?: number | null;
}): string {
  const db = getDb();

  // Dedup: check for existing compaction at this exchange index
  const existing = db.prepare(
    "SELECT id FROM compaction_events WHERE session_id = ? AND exchange_index = ?",
  ).get(data.session_id, data.exchange_index) as { id: string } | undefined;

  if (existing) {
    // Merge new data into existing row — preserve fields that already have values
    db.prepare(`
      UPDATE compaction_events SET
        summary = COALESCE(?, summary),
        analysis_summary = COALESCE(?, analysis_summary),
        exchanges_before = CASE WHEN ? > 0 THEN ? ELSE exchanges_before END,
        exchanges_after = CASE WHEN ? > 0 THEN ? ELSE exchanges_after END,
        pre_tokens = COALESCE(?, pre_tokens)
      WHERE id = ?
    `).run(
      data.summary ?? null,
      data.analysis_summary ?? null,
      data.exchanges_before ?? 0, data.exchanges_before ?? 0,
      data.exchanges_after ?? 0, data.exchanges_after ?? 0,
      data.pre_tokens ?? null,
      existing.id,
    );
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO compaction_events (id, session_id, exchange_index, summary, analysis_summary, exchanges_before, exchanges_after, pre_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.exchange_index,
    data.summary ?? null,
    data.analysis_summary ?? null,
    data.exchanges_before ?? 0,
    data.exchanges_after ?? 0,
    data.pre_tokens ?? null,
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
    db.prepare("SELECT COUNT(*) as count FROM sessions WHERE exchange_count > 0").get() as {
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
        "SELECT COUNT(DISTINCT project_path) as count FROM sessions WHERE exchange_count > 0",
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

// --- Tasks ---

export function insertTask(data: {
  session_id: string;
  task_index: number;
  subject: string;
  description?: string;
  status?: string;
  exchange_index_created: number;
  exchange_index_completed?: number | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO tasks (id, session_id, task_index, subject, description, status, exchange_index_created, exchange_index_completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.task_index,
    data.subject,
    data.description ?? "",
    data.status ?? "pending",
    data.exchange_index_created,
    data.exchange_index_completed ?? null,
  );
  return id;
}

export function getSessionTasks(sessionId: string): Array<{
  id: string;
  task_index: number;
  subject: string;
  description: string;
  status: string;
  exchange_index_created: number;
  exchange_index_completed: number | null;
}> {
  const db = getDb();
  return db.prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY task_index").all(sessionId) as any[];
}

// --- Search by file ---

export function searchByFile(filePath: string, limit: number = 20): Array<{
  session_id: string;
  project_path: string;
  title: string | null;
  started_at: string;
  exchange_index: number;
  tool_name: string;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT s.session_id, s.project_path, s.title, s.started_at,
           e.exchange_index, tc.tool_name
    FROM tool_calls tc
    JOIN exchanges e ON e.id = tc.exchange_id
    JOIN sessions s ON s.id = tc.session_id
    WHERE tc.tool_input LIKE ?
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(`%${filePath}%`, limit) as Array<{
    session_id: string;
    project_path: string;
    title: string | null;
    started_at: string;
    exchange_index: number;
    tool_name: string;
  }>;
}

// --- Get transcript ---

export function getSessionTranscript(
  sessionId: string,
  options?: { from?: number; to?: number },
): Array<{
  exchange_index: number;
  user_prompt: string;
  assistant_response: string;
  tool_call_count: number;
  is_interrupt: number;
  timestamp: string;
}> {
  const db = getDb();
  let sql = `
    SELECT exchange_index, user_prompt, assistant_response, tool_call_count, is_interrupt, timestamp
    FROM exchanges WHERE session_id = ?
  `;
  const params: unknown[] = [sessionId];

  if (options?.from !== undefined) {
    sql += " AND exchange_index >= ?";
    params.push(options.from);
  }
  if (options?.to !== undefined) {
    sql += " AND exchange_index <= ?";
    params.push(options.to);
  }

  sql += " ORDER BY exchange_index";
  return db.prepare(sql).all(...params) as Array<{
    exchange_index: number;
    user_prompt: string;
    assistant_response: string;
    tool_call_count: number;
    is_interrupt: number;
    timestamp: string;
  }>;
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

// --- Project-Level Queries (for MCP tools) ---

/** Lightweight project context for SessionStart hook — must be fast (<50ms) */
export function getProjectContextForSessionStart(projectPath: string): {
  sessionCount: number;
  activePlan: { version: number; status: string; excerpt: string; sessionId: string } | null;
  pendingTasks: string[];
  lastMilestone: string | null;
} {
  const db = getDb();

  const countRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM sessions WHERE project_path = ? AND exchange_count > 0",
  ).get(projectPath) as { cnt: number };

  // Find the most recent approved/implemented plan
  const planRow = db.prepare(`
    SELECT p.version, p.status, SUBSTR(p.plan_text, 1, 200) as excerpt, s.id as sid
    FROM plans p
    JOIN sessions s ON s.id = p.session_id
    WHERE s.project_path = ? AND p.status IN ('approved', 'implemented')
    ORDER BY s.started_at DESC, p.created_at DESC
    LIMIT 1
  `).get(projectPath) as { version: number; status: string; excerpt: string; sid: string } | undefined;

  let pendingTasks: string[] = [];
  if (planRow) {
    const taskRows = db.prepare(
      "SELECT subject FROM tasks WHERE session_id = ? AND status IN ('pending', 'in_progress') ORDER BY task_index LIMIT 5",
    ).all(planRow.sid) as Array<{ subject: string }>;
    pendingTasks = taskRows.map((t) => t.subject);
  }

  const milestoneRow = db.prepare(`
    SELECT m.description
    FROM milestones m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.project_path = ?
    ORDER BY s.started_at DESC, m.exchange_index DESC
    LIMIT 1
  `).get(projectPath) as { description: string } | undefined;

  return {
    sessionCount: countRow.cnt,
    activePlan: planRow
      ? { version: planRow.version, status: planRow.status, excerpt: planRow.excerpt, sessionId: planRow.sid }
      : null,
    pendingTasks,
    lastMilestone: milestoneRow?.description ?? null,
  };
}

/** Full project status for keddy_project_status MCP tool */
export function getProjectStatus(projectPath: string): {
  recentSessions: Array<{
    session_id: string;
    title: string | null;
    started_at: string;
    ended_at: string | null;
    exchange_count: number;
    git_branch: string | null;
  }>;
  activePlan: {
    sessionId: string;
    version: number;
    plan_text: string;
    status: string;
    user_feedback: string | null;
  } | null;
  planHistory: Array<{
    version: number;
    status: string;
    user_feedback: string | null;
  }>;
  tasks: Array<{
    subject: string;
    status: string;
    description: string;
  }>;
  recentMilestones: Array<{
    milestone_type: string;
    description: string;
    session_id: string;
  }>;
  segmentTypes: string[];
  activeFiles: string[];
} {
  const db = getDb();

  // Recent sessions
  const recentSessions = db.prepare(`
    SELECT session_id, title, started_at, ended_at, exchange_count, git_branch
    FROM sessions
    WHERE project_path = ? AND exchange_count > 0
    ORDER BY COALESCE(ended_at, started_at) DESC
    LIMIT 5
  `).all(projectPath) as Array<{
    session_id: string;
    title: string | null;
    started_at: string;
    ended_at: string | null;
    exchange_count: number;
    git_branch: string | null;
  }>;

  // Active plan: most recent approved/implemented
  const planRow = db.prepare(`
    SELECT s.id as sid, s.session_id, p.version, p.plan_text, p.status, p.user_feedback, p.created_at
    FROM plans p
    JOIN sessions s ON s.id = p.session_id
    WHERE s.project_path = ? AND p.status IN ('approved', 'implemented')
    ORDER BY s.started_at DESC, p.created_at DESC
    LIMIT 1
  `).get(projectPath) as {
    sid: string;
    session_id: string;
    version: number;
    plan_text: string;
    status: string;
    user_feedback: string | null;
    created_at: string;
  } | undefined;

  // Plan history (all versions from the active plan's session)
  let planHistory: Array<{ version: number; status: string; user_feedback: string | null }> = [];
  let tasks: Array<{ subject: string; status: string; description: string }> = [];

  if (planRow) {
    planHistory = db.prepare(
      "SELECT version, status, user_feedback FROM plans WHERE session_id = ? ORDER BY version",
    ).all(planRow.sid) as typeof planHistory;

    tasks = db.prepare(
      "SELECT subject, status, description FROM tasks WHERE session_id = ? ORDER BY task_index",
    ).all(planRow.sid) as typeof tasks;
  }

  // Recent milestones across sessions
  const recentMilestones = db.prepare(`
    SELECT m.milestone_type, m.description, s.session_id
    FROM milestones m
    JOIN sessions s ON s.id = m.session_id
    WHERE s.project_path = ?
    ORDER BY s.started_at DESC, m.exchange_index DESC
    LIMIT 5
  `).all(projectPath) as Array<{
    milestone_type: string;
    description: string;
    session_id: string;
  }>;

  // Segment types from most recent session
  const latestSessionId = recentSessions[0]
    ? db.prepare("SELECT id FROM sessions WHERE session_id = ?").get(recentSessions[0].session_id) as { id: string } | undefined
    : undefined;

  let segmentTypes: string[] = [];
  if (latestSessionId) {
    const segRows = db.prepare(
      "SELECT DISTINCT segment_type FROM segments WHERE session_id = ? ORDER BY exchange_index_start",
    ).all(latestSessionId.id) as Array<{ segment_type: string }>;
    segmentTypes = segRows.map((r) => r.segment_type);
  }

  // Active files from recent segments
  let activeFiles: string[] = [];
  if (latestSessionId) {
    const segFileRows = db.prepare(
      "SELECT files_touched FROM segments WHERE session_id = ?",
    ).all(latestSessionId.id) as Array<{ files_touched: string }>;
    const allFiles = new Set<string>();
    for (const row of segFileRows) {
      try {
        const files = JSON.parse(row.files_touched) as string[];
        for (const f of files) allFiles.add(f);
      } catch { /* skip */ }
    }
    activeFiles = [...allFiles].slice(0, 10);
  }

  return {
    recentSessions,
    activePlan: planRow
      ? {
          sessionId: planRow.session_id,
          version: planRow.version,
          plan_text: planRow.plan_text,
          status: planRow.status,
          user_feedback: planRow.user_feedback,
          created_at: planRow.created_at,
        }
      : null,
    planHistory,
    tasks,
    recentMilestones,
    segmentTypes,
    activeFiles,
  };
}

/** Full active plan with version history for keddy_continue_plan MCP tool */
export function getActivePlanForProject(projectPath: string): {
  sessionId: string;
  sessionTitle: string | null;
  plans: Array<{
    version: number;
    plan_text: string;
    status: string;
    user_feedback: string | null;
    exchange_index_start: number;
    exchange_index_end: number;
  }>;
  tasks: Array<{
    subject: string;
    status: string;
    description: string;
  }>;
  lastMilestone: {
    milestone_type: string;
    description: string;
  } | null;
} | null {
  const db = getDb();

  // Find session with most recent active plan
  const planRow = db.prepare(`
    SELECT s.id as sid, s.session_id, s.title
    FROM plans p
    JOIN sessions s ON s.id = p.session_id
    WHERE s.project_path = ? AND p.status IN ('approved', 'implemented')
    ORDER BY s.started_at DESC, p.created_at DESC
    LIMIT 1
  `).get(projectPath) as { sid: string; session_id: string; title: string | null } | undefined;

  if (!planRow) return null;

  // All plan versions for that session
  const plans = db.prepare(`
    SELECT version, plan_text, status, user_feedback, exchange_index_start, exchange_index_end
    FROM plans WHERE session_id = ? ORDER BY version
  `).all(planRow.sid) as Array<{
    version: number;
    plan_text: string;
    status: string;
    user_feedback: string | null;
    exchange_index_start: number;
    exchange_index_end: number;
  }>;

  // Tasks
  const tasks = db.prepare(
    "SELECT subject, status, description FROM tasks WHERE session_id = ? ORDER BY task_index",
  ).all(planRow.sid) as Array<{ subject: string; status: string; description: string }>;

  // Last milestone
  const milestone = db.prepare(
    "SELECT milestone_type, description FROM milestones WHERE session_id = ? ORDER BY exchange_index DESC LIMIT 1",
  ).get(planRow.sid) as { milestone_type: string; description: string } | undefined;

  return {
    sessionId: planRow.session_id,
    sessionTitle: planRow.title,
    plans,
    tasks,
    lastMilestone: milestone ?? null,
  };
}

// --- Session Notes ---

/** Get all notes for a session, most recent first */
export function getSessionNotes(sessionId: string): SessionNote[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM session_notes WHERE session_id = ? ORDER BY generated_at DESC",
  ).all(sessionId) as SessionNote[];
}

/** Get the most recent note for a session */
export function getSessionNote(sessionId: string): SessionNote | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM session_notes WHERE session_id = ? ORDER BY generated_at DESC LIMIT 1",
  ).get(sessionId) as SessionNote | undefined;
}

/** Insert a new session note (keeps history — no upsert) */
export function upsertSessionNote(data: {
  session_id: string;
  content: string;
  mermaid?: string | null;
  model?: string | null;
  agent_turns?: number | null;
  cost_usd?: number | null;
  generated_at?: string;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO session_notes (id, session_id, content, mermaid, model, agent_turns, cost_usd, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id,
    data.content,
    data.mermaid ?? null,
    data.model ?? null,
    data.agent_turns ?? null,
    data.cost_usd ?? null,
    data.generated_at ?? new Date().toISOString(),
  );
  return id;
}

/** Delete all notes for a session */
export function deleteSessionNote(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM session_notes WHERE session_id = ?").run(sessionId);
}

/** Batch-enrich sessions with plan/milestone/segment data (avoids N+1 queries) */
export function enrichSessionBatch(sessionInternalIds: string[]): Map<string, {
  planCount: number;
  latestPlanStatus: string | null;
  milestoneHighlights: string[];
  segmentTypes: string[];
}> {
  const result = new Map<string, {
    planCount: number;
    latestPlanStatus: string | null;
    milestoneHighlights: string[];
    segmentTypes: string[];
  }>();

  if (sessionInternalIds.length === 0) return result;

  const db = getDb();
  const placeholders = sessionInternalIds.map(() => "?").join(",");

  // Initialize all entries
  for (const id of sessionInternalIds) {
    result.set(id, { planCount: 0, latestPlanStatus: null, milestoneHighlights: [], segmentTypes: [] });
  }

  // Plan counts + latest status per session
  const planRows = db.prepare(`
    SELECT session_id, COUNT(*) as cnt,
      (SELECT status FROM plans p2 WHERE p2.session_id = plans.session_id ORDER BY version DESC LIMIT 1) as latest_status
    FROM plans
    WHERE session_id IN (${placeholders})
    GROUP BY session_id
  `).all(...sessionInternalIds) as Array<{ session_id: string; cnt: number; latest_status: string | null }>;

  for (const row of planRows) {
    const entry = result.get(row.session_id);
    if (entry) {
      entry.planCount = row.cnt;
      entry.latestPlanStatus = row.latest_status;
    }
  }

  // Milestone highlights per session (first 3)
  const milestoneRows = db.prepare(`
    SELECT session_id, description, exchange_index,
      ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY exchange_index) as rn
    FROM milestones
    WHERE session_id IN (${placeholders})
  `).all(...sessionInternalIds) as Array<{ session_id: string; description: string; rn: number }>;

  for (const row of milestoneRows) {
    if (row.rn <= 3) {
      const entry = result.get(row.session_id);
      if (entry) entry.milestoneHighlights.push(row.description);
    }
  }

  // Segment types per session
  const segRows = db.prepare(`
    SELECT DISTINCT session_id, segment_type
    FROM segments
    WHERE session_id IN (${placeholders})
  `).all(...sessionInternalIds) as Array<{ session_id: string; segment_type: string }>;

  for (const row of segRows) {
    const entry = result.get(row.session_id);
    if (entry) entry.segmentTypes.push(row.segment_type);
  }

  return result;
}

// --- Daily Notes ---

export function getSessionsByDate(dateStr: string): Session[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM sessions WHERE date(started_at) <= ? AND date(COALESCE(ended_at, started_at)) >= ? AND exchange_count > 0 ORDER BY started_at ASC",
  ).all(dateStr, dateStr) as Session[];
}

export function getDailyMilestones(dateStr: string): Array<{
  session_id: string; session_title: string | null;
  milestone_type: string; exchange_index: number; description: string;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT m.milestone_type, m.exchange_index, m.description, s.session_id, s.title as session_title
    FROM milestones m JOIN sessions s ON s.id = m.session_id
    WHERE date(s.started_at) <= ? AND date(COALESCE(s.ended_at, s.started_at)) >= ? AND s.exchange_count > 0
    ORDER BY s.started_at, m.exchange_index
  `).all(dateStr, dateStr) as any[];
}

export function getExchangeRangesByDate(
  dateStr: string,
  sessionInternalIds: string[],
): Record<string, { first_exchange: number; last_exchange: number; day_exchange_count: number }> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT MIN(exchange_index) as first_exchange,
           MAX(exchange_index) as last_exchange,
           COUNT(*) as day_exchange_count
    FROM exchanges
    WHERE session_id = ? AND date(timestamp) = ?
  `);
  const result: Record<string, { first_exchange: number; last_exchange: number; day_exchange_count: number }> = {};
  for (const id of sessionInternalIds) {
    const row = stmt.get(id, dateStr) as any;
    if (row && row.first_exchange != null) {
      result[id] = {
        first_exchange: row.first_exchange,
        last_exchange: row.last_exchange,
        day_exchange_count: row.day_exchange_count,
      };
    }
  }
  return result;
}

export function getDailyNote(dateStr: string): import("../types.js").DailyNote | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM daily_notes WHERE date = ? ORDER BY generated_at DESC LIMIT 1").get(dateStr) as any;
}

export function getDailyNotes(dateStr: string): import("../types.js").DailyNote[] {
  const db = getDb();
  return db.prepare("SELECT * FROM daily_notes WHERE date = ? ORDER BY generated_at DESC").all(dateStr) as any[];
}

export function insertDailyNote(data: {
  date: string; content: string; sessions_json: string;
  title?: string | null; model?: string | null; agent_turns?: number | null; cost_usd?: number | null;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO daily_notes (id, date, title, content, sessions_json, model, agent_turns, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, data.date, data.title ?? null, data.content, data.sessions_json, data.model ?? null, data.agent_turns ?? null, data.cost_usd ?? null);
  return id;
}

export function deleteDailyNote(noteId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM daily_notes WHERE id = ?").run(noteId);
}

export function deleteDailyNotesByDate(dateStr: string): void {
  const db = getDb();
  db.prepare("DELETE FROM daily_notes WHERE date = ?").run(dateStr);
}

export function getDailyList(days: number = 90): Array<{
  date: string;
  session_count: number;
  total_exchanges: number;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT date(e.timestamp) as date,
           COUNT(DISTINCT e.session_id) as session_count,
           COUNT(*) as total_exchanges
    FROM exchanges e
    JOIN sessions s ON e.session_id = s.id
    WHERE s.exchange_count > 0
      AND e.timestamp >= datetime('now', ?)
    GROUP BY date(e.timestamp)
    ORDER BY date DESC
  `).all(`-${days} days`) as any[];
}

export function getDatesWithNotes(days: number = 90): Record<string, {
  id: string; summary: string; model: string | null; generated_at: string;
}> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, date, title, content, model, generated_at
    FROM daily_notes
    WHERE date >= date('now', ?)
    ORDER BY generated_at DESC
  `).all(`-${days} days`) as any[];

  const result: Record<string, any> = {};
  for (const r of rows) {
    if (!result[r.date]) {
      let summary = "";
      if (r.title) {
        summary = r.title;
      } else {
        const headingMatch = r.content.match(/^##\s+(.+)$/m);
        if (headingMatch) {
          summary = headingMatch[1].substring(0, 120);
        } else {
          summary = r.content.replace(/[#*_`]/g, "").substring(0, 120);
        }
      }
      result[r.date] = { id: r.id, summary, model: r.model, generated_at: r.generated_at };
    }
  }
  return result;
}
