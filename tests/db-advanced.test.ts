import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { initDb, closeDb, getDb } from "../src/db/index.js";
import {
  insertSession,
  upsertSession,
  getSession,
  getSessionById,
  getRecentSessions,
  insertExchange,
  getSessionExchanges,
  insertToolCall,
  insertPlan,
  getSessionPlans,
  getRecentPlans,
  insertSegment,
  getSessionSegments,
  insertMilestone,
  getSessionMilestones,
  insertDecision,
  insertCompactionEvent,
  getSessionCompactionEvents,
  insertSessionLink,
  searchSessions,
  updateSessionEnd,
  getStats,
  getConfig,
  setConfig,
} from "../src/db/queries.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "keddy-db-adv-"));
  initDb(join(tmpDir, "test.db"));
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("database — schema integrity", () => {
  it("should have all required tables", () => {
    const db = getDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("exchanges");
    expect(tableNames).toContain("tool_calls");
    expect(tableNames).toContain("plans");
    expect(tableNames).toContain("segments");
    expect(tableNames).toContain("milestones");
    expect(tableNames).toContain("decisions");
    expect(tableNames).toContain("compaction_events");
    expect(tableNames).toContain("session_links");
    expect(tableNames).toContain("config");
  });

  it("should have FTS5 virtual table", () => {
    const db = getDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='exchanges_fts'",
      )
      .all() as { name: string }[];
    expect(tables.length).toBe(1);
  });

  it("should have WAL mode enabled", () => {
    const db = getDb();
    const mode = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(mode[0].journal_mode).toBe("wal");
  });

  it("should have foreign keys enabled", () => {
    const db = getDb();
    const fk = db.pragma("foreign_keys") as { foreign_keys: number }[];
    expect(fk[0].foreign_keys).toBe(1);
  });

  it("should have required indexes", () => {
    const db = getDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_exchanges_session");
    expect(indexNames).toContain("idx_tool_calls_exchange");
    expect(indexNames).toContain("idx_tool_calls_session");
    expect(indexNames).toContain("idx_plans_session");
    expect(indexNames).toContain("idx_segments_session");
    expect(indexNames).toContain("idx_milestones_session");
    expect(indexNames).toContain("idx_sessions_project");
    expect(indexNames).toContain("idx_sessions_started");
  });
});

describe("database — cascade deletes", () => {
  it("should cascade delete exchanges when session is deleted", () => {
    const sessionId = insertSession({
      session_id: "cascade-test",
      project_path: "/test",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "test",
    });

    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

    const exchanges = getSessionExchanges(sessionId);
    expect(exchanges.length).toBe(0);
  });

  it("should cascade delete tool_calls when exchange is deleted", () => {
    const sessionId = insertSession({
      session_id: "cascade-tools",
      project_path: "/test",
    });

    const exchangeId = insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "test",
    });

    insertToolCall({
      exchange_id: exchangeId,
      session_id: sessionId,
      tool_name: "Read",
      tool_use_id: "t1",
    });

    const db = getDb();
    db.prepare("DELETE FROM exchanges WHERE id = ?").run(exchangeId);

    const tools = db
      .prepare("SELECT * FROM tool_calls WHERE exchange_id = ?")
      .all(exchangeId);
    expect(tools.length).toBe(0);
  });
});

describe("database — FTS5 sync", () => {
  it("should sync FTS on insert via trigger", () => {
    const sessionId = insertSession({
      session_id: "fts-sync",
      project_path: "/test",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "unique_search_term_xyz123",
    });

    const results = searchSessions("unique_search_term_xyz123");
    expect(results.length).toBe(1);
  });

  it("should handle FTS search with multiple words", () => {
    const sessionId = insertSession({
      session_id: "fts-multi",
      project_path: "/test",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "implement authentication middleware for Express app",
    });

    // Should find with single word
    expect(searchSessions("authentication").length).toBe(1);
    // Should find with multiple words
    expect(searchSessions("authentication middleware").length).toBe(1);
  });

  it("should return empty for queries with only special characters", () => {
    const results = searchSessions("!@#$%");
    expect(results.length).toBe(0);
  });
});

describe("database — session queries", () => {
  it("should get session by both session_id and id", () => {
    const id = insertSession({
      session_id: "dual-lookup",
      project_path: "/test",
    });

    const bySessionId = getSession("dual-lookup");
    expect(bySessionId).toBeDefined();

    const byId = getSessionById(id);
    expect(byId).toBeDefined();

    expect(bySessionId!.id).toBe(byId!.id);
  });

  it("should respect limit in getRecentSessions", () => {
    for (let i = 0; i < 10; i++) {
      insertSession({
        session_id: `limit-test-${i}`,
        project_path: "/test",
      });
      updateSessionEnd(`limit-test-${i}`, 1);
    }

    const limited = getRecentSessions(30, 5);
    expect(limited.length).toBe(5);
  });

  it("should order recent sessions by started_at DESC", () => {
    const sessions = getRecentSessions(30);
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i - 1].started_at >= sessions[i].started_at).toBe(true);
    }
  });
});

describe("database — plans", () => {
  it("should enforce unique version per session", () => {
    const sessionId = insertSession({
      session_id: "plan-unique",
      project_path: "/test",
    });

    insertPlan({
      session_id: sessionId,
      version: 1,
      plan_text: "Plan v1",
      exchange_index_start: 0,
      exchange_index_end: 1,
    });

    // INSERT OR IGNORE silently skips duplicates — verify count stays at 1
    insertPlan({
      session_id: sessionId,
      version: 1,
      plan_text: "Plan v1 duplicate",
      exchange_index_start: 0,
      exchange_index_end: 1,
    });
    const plans = getSessionPlans(sessionId);
    expect(plans.length).toBe(1); // unique constraint keeps only one row per version
  });

  it("should get recent plans across sessions", () => {
    const s1 = insertSession({
      session_id: "recent-plan-1",
      project_path: "/test",
    });
    const s2 = insertSession({
      session_id: "recent-plan-2",
      project_path: "/test",
    });

    insertPlan({
      session_id: s1,
      version: 1,
      plan_text: "Plan A",
      exchange_index_start: 0,
      exchange_index_end: 1,
    });
    insertPlan({
      session_id: s2,
      version: 1,
      plan_text: "Plan B",
      exchange_index_start: 0,
      exchange_index_end: 1,
    });

    const recent = getRecentPlans(10);
    expect(recent.length).toBe(2);
  });
});

describe("database — decisions", () => {
  it("should insert and store decisions", () => {
    const sessionId = insertSession({
      session_id: "decision-test",
      project_path: "/test",
    });

    insertDecision({
      session_id: sessionId,
      exchange_index: 5,
      decision_text: "Use PostgreSQL instead of MySQL",
      context: "Need better JSON support",
      alternatives: '["MySQL","SQLite","MongoDB"]',
    });

    const db = getDb();
    const decisions = db
      .prepare("SELECT * FROM decisions WHERE session_id = ?")
      .all(sessionId) as Array<{ decision_text: string; alternatives: string }>;
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision_text).toBe("Use PostgreSQL instead of MySQL");
    expect(JSON.parse(decisions[0].alternatives)).toContain("MySQL");
  });
});

describe("database — session links", () => {
  it("should create links between sessions", () => {
    const s1 = insertSession({
      session_id: "link-source",
      project_path: "/test",
    });
    const s2 = insertSession({
      session_id: "link-target",
      project_path: "/test",
    });

    insertSessionLink({
      source_session_id: s1,
      target_session_id: s2,
      link_type: "same_project",
      shared_files: '["src/index.ts"]',
    });

    const db = getDb();
    const links = db
      .prepare("SELECT * FROM session_links WHERE source_session_id = ?")
      .all(s1) as Array<{ link_type: string; shared_files: string }>;
    expect(links.length).toBe(1);
    expect(links[0].link_type).toBe("same_project");
    expect(JSON.parse(links[0].shared_files)).toContain("src/index.ts");
  });
});

describe("database — performance", () => {
  it("should handle batch inserts efficiently", () => {
    const sessionId = insertSession({
      session_id: "perf-test",
      project_path: "/test",
    });

    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      insertExchange({
        session_id: sessionId,
        exchange_index: i,
        user_prompt: `Prompt ${i}: ${Array(50).fill("word").join(" ")}`,
        assistant_response: `Response ${i}`,
      });
    }
    const elapsed = performance.now() - start;

    const exchanges = getSessionExchanges(sessionId);
    expect(exchanges.length).toBe(500);
    // Should complete in under 5 seconds (usually <1s)
    expect(elapsed).toBeLessThan(5000);
  });

  it("should search efficiently with FTS", () => {
    const sessionId = insertSession({
      session_id: "fts-perf",
      project_path: "/test",
    });

    for (let i = 0; i < 100; i++) {
      insertExchange({
        session_id: sessionId,
        exchange_index: i,
        user_prompt: `Exchange ${i}: implement feature number ${i} with optimization`,
      });
    }

    const start = performance.now();
    const results = searchSessions("optimization");
    const elapsed = performance.now() - start;

    expect(results.length).toBe(1);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("database — idempotency", () => {
  it("should handle repeated initDb calls", () => {
    // closeDb and reinit should work fine
    closeDb();
    const db = initDb(join(tmpDir, "test.db"));
    expect(db).toBeDefined();

    // Insert should still work
    insertSession({
      session_id: "reinit-test",
      project_path: "/test",
    });

    const session = getSession("reinit-test");
    expect(session).toBeDefined();
  });

  it("should handle upsert correctly on repeated calls", () => {
    upsertSession({
      session_id: "upsert-repeat",
      project_path: "/test",
      title: "First",
    });
    updateSessionEnd("upsert-repeat", 1);
    upsertSession({
      session_id: "upsert-repeat",
      project_path: "/test",
      title: "Second",
    });
    upsertSession({
      session_id: "upsert-repeat",
      project_path: "/test",
      title: "Third",
    });

    const session = getSession("upsert-repeat");
    expect(session!.title).toBe("Third");

    // Should still only be one session
    const stats = getStats();
    expect(stats.total_sessions).toBe(1);
  });
});
