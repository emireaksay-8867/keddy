import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      project_path TEXT NOT NULL,
      git_branch TEXT,
      title TEXT,
      slug TEXT,
      claude_version TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      exchange_count INTEGER NOT NULL DEFAULT 0,
      compaction_count INTEGER NOT NULL DEFAULT 0,
      jsonl_path TEXT,
      forked_from TEXT,
      metadata TEXT,
      entrypoint TEXT
    );

    CREATE TABLE IF NOT EXISTS exchanges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      exchange_index INTEGER NOT NULL,
      user_prompt TEXT NOT NULL,
      assistant_response TEXT NOT NULL DEFAULT '',
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER,
      is_interrupt INTEGER NOT NULL DEFAULT 0,
      is_compact_summary INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      stop_reason TEXT,
      has_thinking INTEGER,
      permission_mode TEXT,
      is_sidechain INTEGER,
      entrypoint TEXT,
      cwd TEXT,
      git_branch TEXT,
      turn_duration_ms INTEGER,
      UNIQUE(session_id, exchange_index)
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      exchange_id TEXT NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      tool_input TEXT NOT NULL DEFAULT '{}',
      tool_result TEXT,
      tool_use_id TEXT NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      skill_name TEXT,
      subagent_type TEXT,
      subagent_desc TEXT,
      file_path TEXT,
      bash_command TEXT,
      bash_desc TEXT,
      web_query TEXT,
      web_url TEXT,
      UNIQUE(session_id, tool_use_id)
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      plan_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafted',
      user_feedback TEXT,
      exchange_index_start INTEGER NOT NULL,
      exchange_index_end INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, version)
    );

    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      segment_type TEXT NOT NULL,
      exchange_index_start INTEGER NOT NULL,
      exchange_index_end INTEGER NOT NULL,
      files_touched TEXT NOT NULL DEFAULT '[]',
      tool_counts TEXT NOT NULL DEFAULT '{}',
      summary TEXT,
      boundary_type TEXT,
      files_read TEXT DEFAULT '[]',
      files_written TEXT DEFAULT '[]',
      error_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      total_cache_write_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      models TEXT DEFAULT '[]',
      markers TEXT DEFAULT '[]',
      exchange_count INTEGER DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      ai_label TEXT,
      ai_summary TEXT,
      UNIQUE(session_id, exchange_index_start, exchange_index_end)
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      milestone_type TEXT NOT NULL,
      exchange_index INTEGER NOT NULL,
      description TEXT NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      exchange_index INTEGER NOT NULL,
      decision_text TEXT NOT NULL,
      context TEXT,
      alternatives TEXT
    );

    CREATE TABLE IF NOT EXISTS compaction_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      exchange_index INTEGER NOT NULL,
      summary TEXT,
      analysis_summary TEXT,
      exchanges_before INTEGER NOT NULL DEFAULT 0,
      exchanges_after INTEGER NOT NULL DEFAULT 0,
      pre_tokens INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, exchange_index)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      task_index INTEGER NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      exchange_index_created INTEGER NOT NULL,
      exchange_index_completed INTEGER,
      UNIQUE(session_id, task_index)
    );

    CREATE TABLE IF NOT EXISTS session_links (
      id TEXT PRIMARY KEY,
      source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      shared_files TEXT NOT NULL DEFAULT '[]'
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_exchanges_session ON exchanges(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_exchange ON tool_calls(exchange_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
    CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id);
    CREATE INDEX IF NOT EXISTS idx_milestones_session ON milestones(session_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
    CREATE INDEX IF NOT EXISTS idx_compaction_events_session ON compaction_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_links_source ON session_links(source_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_links_target ON session_links(target_session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);

    -- Facts-first indexes
    CREATE INDEX IF NOT EXISTS idx_tool_calls_skill ON tool_calls(skill_name) WHERE skill_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tool_calls_file_path ON tool_calls(file_path) WHERE file_path IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tool_calls_subagent ON tool_calls(subagent_type) WHERE subagent_type IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tool_calls_web_query ON tool_calls(web_query) WHERE web_query IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_exchanges_model ON exchanges(model);
    CREATE INDEX IF NOT EXISTS idx_segments_boundary ON segments(session_id, boundary_type);
  `);

  // FTS5 virtual table for full-text search (both prompts and responses)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS exchanges_fts USING fts5(
      user_prompt,
      assistant_response,
      content=exchanges,
      content_rowid=rowid
    );
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS exchanges_fts_insert AFTER INSERT ON exchanges BEGIN
      INSERT INTO exchanges_fts(rowid, user_prompt, assistant_response) VALUES (NEW.rowid, NEW.user_prompt, NEW.assistant_response);
    END;

    CREATE TRIGGER IF NOT EXISTS exchanges_fts_delete AFTER DELETE ON exchanges BEGIN
      INSERT INTO exchanges_fts(exchanges_fts, rowid, user_prompt, assistant_response) VALUES ('delete', OLD.rowid, OLD.user_prompt, OLD.assistant_response);
    END;

    CREATE TRIGGER IF NOT EXISTS exchanges_fts_update AFTER UPDATE ON exchanges BEGIN
      INSERT INTO exchanges_fts(exchanges_fts, rowid, user_prompt, assistant_response) VALUES ('delete', OLD.rowid, OLD.user_prompt, OLD.assistant_response);
      INSERT INTO exchanges_fts(rowid, user_prompt, assistant_response) VALUES (NEW.rowid, NEW.user_prompt, NEW.assistant_response);
    END;
  `);

  // Config table (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migration: deduplicate compaction_events for existing databases
  // The UNIQUE constraint only applies to newly created tables, so we
  // need to clean up duplicates in existing databases manually.
  try {
    const dupeCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM compaction_events
      WHERE id NOT IN (
        SELECT MIN(id) FROM compaction_events
        GROUP BY session_id, exchange_index
      )
    `).get() as { cnt: number }).cnt;

    if (dupeCount > 0) {
      db.prepare(`
        DELETE FROM compaction_events
        WHERE id NOT IN (
          SELECT MIN(id) FROM compaction_events
          GROUP BY session_id, exchange_index
        )
      `).run();
    }
  } catch {
    // Table may not exist yet on first run — safe to ignore
  }
}
