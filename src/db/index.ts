import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { initSchema } from "./schema.js";

let db: Database.Database | null = null;

function getDefaultDbPath(): string {
  return join(homedir(), ".keddy", "keddy.db");
}

export function initDb(dbPath?: string): Database.Database {
  const path = dbPath || process.env.KEDDY_DB || getDefaultDbPath();

  // Ensure directory exists
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  db = new Database(path);

  // Performance and safety pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  // Initialize schema
  initSchema(db);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    return initDb();
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
