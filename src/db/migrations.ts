import type Database from "better-sqlite3";

const CURRENT_VERSION = 7;

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 2,
    description: "Add assistant_response to FTS, fix tool_use_id uniqueness",
    up: (db) => {
      // Recreate FTS with both user_prompt and assistant_response
      db.exec("DROP TABLE IF EXISTS exchanges_fts");
      db.exec("DROP TRIGGER IF EXISTS exchanges_fts_insert");
      db.exec("DROP TRIGGER IF EXISTS exchanges_fts_delete");
      db.exec("DROP TRIGGER IF EXISTS exchanges_fts_update");

      db.exec(`
        CREATE VIRTUAL TABLE exchanges_fts USING fts5(
          user_prompt,
          assistant_response,
          content=exchanges,
          content_rowid=rowid
        );
      `);

      // Rebuild FTS index from existing data
      db.exec(`
        INSERT INTO exchanges_fts(rowid, user_prompt, assistant_response)
        SELECT rowid, user_prompt, assistant_response FROM exchanges;
      `);

      // New triggers for both columns
      db.exec(`
        CREATE TRIGGER exchanges_fts_insert AFTER INSERT ON exchanges BEGIN
          INSERT INTO exchanges_fts(rowid, user_prompt, assistant_response) VALUES (NEW.rowid, NEW.user_prompt, NEW.assistant_response);
        END;

        CREATE TRIGGER exchanges_fts_delete AFTER DELETE ON exchanges BEGIN
          INSERT INTO exchanges_fts(exchanges_fts, rowid, user_prompt, assistant_response) VALUES ('delete', OLD.rowid, OLD.user_prompt, OLD.assistant_response);
        END;

        CREATE TRIGGER exchanges_fts_update AFTER UPDATE ON exchanges BEGIN
          INSERT INTO exchanges_fts(exchanges_fts, rowid, user_prompt, assistant_response) VALUES ('delete', OLD.rowid, OLD.user_prompt, OLD.assistant_response);
          INSERT INTO exchanges_fts(rowid, user_prompt, assistant_response) VALUES (NEW.rowid, NEW.user_prompt, NEW.assistant_response);
        END;
      `);

      // Fix tool_use_id uniqueness — make it per-session instead of global
      // SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we need to recreate
      // But for existing DBs, just drop and recreate the unique index
      try {
        db.exec("DROP INDEX IF EXISTS sqlite_autoindex_tool_calls_1");
      } catch {
        // Index might not exist
      }
      // The UNIQUE constraint is part of the table definition — can't change it
      // without recreating the table. For now, just ensure INSERT OR IGNORE works.
    },
  },
  {
    version: 3,
    description: "Add pre_tokens to compaction_events, add tasks table",
    up: (db) => {
      // Add pre_tokens column to compaction_events
      try {
        db.exec("ALTER TABLE compaction_events ADD COLUMN pre_tokens INTEGER");
      } catch {
        // Column might already exist
      }

      // Create tasks table for structured task tracking
      db.exec(`
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
        CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      `);
    },
  },
  {
    version: 4,
    description: "Add analysis_summary to compaction_events for PostCompact hook data",
    up: (db) => {
      try {
        db.exec("ALTER TABLE compaction_events ADD COLUMN analysis_summary TEXT");
      } catch {
        // Column might already exist
      }
    },
  },
  {
    version: 5,
    description: "Facts-first data foundation: exchange metadata, tool enrichment, activity groups",
    up: (db) => {
      // --- Exchanges: per-exchange metadata from JSONL ---
      const exchangeCols = [
        "ALTER TABLE exchanges ADD COLUMN model TEXT",
        "ALTER TABLE exchanges ADD COLUMN input_tokens INTEGER",
        "ALTER TABLE exchanges ADD COLUMN output_tokens INTEGER",
        "ALTER TABLE exchanges ADD COLUMN cache_read_tokens INTEGER",
        "ALTER TABLE exchanges ADD COLUMN cache_write_tokens INTEGER",
        "ALTER TABLE exchanges ADD COLUMN stop_reason TEXT",
        "ALTER TABLE exchanges ADD COLUMN has_thinking INTEGER",
        "ALTER TABLE exchanges ADD COLUMN permission_mode TEXT",
        "ALTER TABLE exchanges ADD COLUMN is_sidechain INTEGER",
        "ALTER TABLE exchanges ADD COLUMN entrypoint TEXT",
        "ALTER TABLE exchanges ADD COLUMN cwd TEXT",
        "ALTER TABLE exchanges ADD COLUMN git_branch TEXT",
        "ALTER TABLE exchanges ADD COLUMN turn_duration_ms INTEGER",
      ];
      for (const sql of exchangeCols) {
        try { db.exec(sql); } catch { /* column may already exist */ }
      }

      // --- Tool calls: structured field extraction ---
      const toolCols = [
        "ALTER TABLE tool_calls ADD COLUMN skill_name TEXT",
        "ALTER TABLE tool_calls ADD COLUMN subagent_type TEXT",
        "ALTER TABLE tool_calls ADD COLUMN subagent_desc TEXT",
        "ALTER TABLE tool_calls ADD COLUMN file_path TEXT",
        "ALTER TABLE tool_calls ADD COLUMN bash_command TEXT",
        "ALTER TABLE tool_calls ADD COLUMN bash_desc TEXT",
        "ALTER TABLE tool_calls ADD COLUMN web_query TEXT",
        "ALTER TABLE tool_calls ADD COLUMN web_url TEXT",
      ];
      for (const sql of toolCols) {
        try { db.exec(sql); } catch { /* column may already exist */ }
      }

      // --- Segments: activity group enrichment ---
      const segCols = [
        "ALTER TABLE segments ADD COLUMN boundary_type TEXT",
        "ALTER TABLE segments ADD COLUMN files_read TEXT DEFAULT '[]'",
        "ALTER TABLE segments ADD COLUMN files_written TEXT DEFAULT '[]'",
        "ALTER TABLE segments ADD COLUMN error_count INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN total_input_tokens INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN total_output_tokens INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN total_cache_read_tokens INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN total_cache_write_tokens INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN duration_ms INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN models TEXT DEFAULT '[]'",
        "ALTER TABLE segments ADD COLUMN markers TEXT DEFAULT '[]'",
        "ALTER TABLE segments ADD COLUMN exchange_count INTEGER DEFAULT 0",
        "ALTER TABLE segments ADD COLUMN started_at TEXT",
        "ALTER TABLE segments ADD COLUMN ended_at TEXT",
        "ALTER TABLE segments ADD COLUMN ai_label TEXT",
        "ALTER TABLE segments ADD COLUMN ai_summary TEXT",
      ];
      for (const sql of segCols) {
        try { db.exec(sql); } catch { /* column may already exist */ }
      }

      // --- Sessions: entrypoint ---
      try {
        db.exec("ALTER TABLE sessions ADD COLUMN entrypoint TEXT");
      } catch { /* column may already exist */ }

      // --- Indexes ---
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tool_calls_skill ON tool_calls(skill_name) WHERE skill_name IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tool_calls_file_path ON tool_calls(file_path) WHERE file_path IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tool_calls_subagent ON tool_calls(subagent_type) WHERE subagent_type IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tool_calls_web_query ON tool_calls(web_query) WHERE web_query IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_exchanges_model ON exchanges(model);
        CREATE INDEX IF NOT EXISTS idx_segments_boundary ON segments(session_id, boundary_type);
      `);
    },
  },
  {
    version: 6,
    description: "Add session_notes table for Agent SDK-powered analysis",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_notes (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          mermaid TEXT,
          model TEXT,
          agent_turns INTEGER,
          cost_usd REAL,
          generated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_session_notes_session ON session_notes(session_id);
      `);
      // Drop unique constraint on existing tables (from earlier schema)
      try {
        db.exec("DROP INDEX IF EXISTS sqlite_autoindex_session_notes_1");
      } catch { /* index may not exist */ }
    },
  },
  {
    version: 7,
    description: "Add daily_notes table for AI-generated daily notes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_notes (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL,
          sessions_json TEXT NOT NULL DEFAULT '[]',
          model TEXT,
          agent_turns INTEGER,
          cost_usd REAL,
          generated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(date);
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Get current version
  let currentVersion = 0;
  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (row) currentVersion = parseInt(row.value, 10);
  } catch {
    // Config table might not exist yet
  }

  // For fresh DBs (no version set), check if schema already matches latest
  if (currentVersion === 0) {
    try {
      // Check if FTS already has assistant_response (new schema)
      const ftsInfo = db.prepare("SELECT sql FROM sqlite_master WHERE name='exchanges_fts'").get() as { sql: string } | undefined;
      if (ftsInfo?.sql?.includes("assistant_response")) {
        // Already at latest schema — just set the version
        db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', ?)").run(String(CURRENT_VERSION));
        return;
      }
    } catch {
      // FTS might not exist yet
    }
  }

  if (currentVersion >= CURRENT_VERSION) return;

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`[keddy] Running migration v${migration.version}: ${migration.description}`);
      try {
        db.transaction(() => {
          migration.up(db);
          db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', ?)").run(
            String(migration.version),
          );
        })();
      } catch (err) {
        console.error(`[keddy] Migration v${migration.version} failed:`, err);
        // Don't throw — allow the app to continue with older schema
      }
    }
  }
}
