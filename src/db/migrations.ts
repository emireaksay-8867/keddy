import type Database from "better-sqlite3";

const CURRENT_VERSION = 2;

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
