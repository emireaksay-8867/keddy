import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { initDb, closeDb, getDb } from "../src/db/index.js";
import {
  insertSession,
  upsertSession,
  getSession,
  getRecentSessions,
  insertExchange,
  getSessionExchanges,
  insertToolCall,
  insertPlan,
  getSessionPlans,
  insertSegment,
  getSessionSegments,
  insertMilestone,
  getSessionMilestones,
  insertCompactionEvent,
  getSessionCompactionEvents,
  insertDecision,
  insertSessionLink,
  searchSessions,
  getStats,
  getConfig,
  setConfig,
  updateSessionEnd,
} from "../src/db/queries.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "keddy-test-"));
  initDb(join(tmpDir, "test.db"));
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("sessions", () => {
  it("should insert and retrieve a session", () => {
    const id = insertSession({
      session_id: "test-session-1",
      project_path: "/Users/test/project",
      git_branch: "main",
      title: "Test Session",
    });

    const session = getSession("test-session-1");
    expect(session).toBeDefined();
    expect(session!.session_id).toBe("test-session-1");
    expect(session!.project_path).toBe("/Users/test/project");
    expect(session!.git_branch).toBe("main");
    expect(session!.title).toBe("Test Session");
  });

  it("should upsert a session (update existing)", () => {
    insertSession({
      session_id: "test-session-2",
      project_path: "/Users/test/project",
    });

    upsertSession({
      session_id: "test-session-2",
      project_path: "/Users/test/project",
      git_branch: "develop",
      title: "Updated Title",
    });

    const session = getSession("test-session-2");
    expect(session!.git_branch).toBe("develop");
    expect(session!.title).toBe("Updated Title");
  });

  it("should upsert a session (insert new)", () => {
    upsertSession({
      session_id: "test-session-new",
      project_path: "/Users/test/new-project",
    });

    const session = getSession("test-session-new");
    expect(session).toBeDefined();
    expect(session!.project_path).toBe("/Users/test/new-project");
  });

  it("should get recent sessions", () => {
    insertSession({
      session_id: "recent-1",
      project_path: "/test",
    });
    updateSessionEnd("recent-1", 1);
    insertSession({
      session_id: "recent-2",
      project_path: "/test",
    });
    updateSessionEnd("recent-2", 1);

    const sessions = getRecentSessions(7);
    expect(sessions.length).toBe(2);
  });

  it("should update session end", () => {
    insertSession({
      session_id: "end-test",
      project_path: "/test",
    });

    updateSessionEnd("end-test", 10);

    const session = getSession("end-test");
    expect(session!.ended_at).toBeTruthy();
    expect(session!.exchange_count).toBe(10);
  });
});

describe("exchanges", () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = insertSession({
      session_id: "exchange-test",
      project_path: "/test",
    });
  });

  it("should insert and retrieve exchanges", () => {
    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "Hello world",
      assistant_response: "Hi there!",
      tool_call_count: 0,
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 1,
      user_prompt: "What is 2+2?",
      assistant_response: "4",
      tool_call_count: 0,
    });

    const exchanges = getSessionExchanges(sessionId);
    expect(exchanges.length).toBe(2);
    expect(exchanges[0].user_prompt).toBe("Hello world");
    expect(exchanges[1].user_prompt).toBe("What is 2+2?");
  });

  it("should handle duplicate exchange indices (INSERT OR IGNORE)", () => {
    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "First",
    });
    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "Duplicate",
    });

    const exchanges = getSessionExchanges(sessionId);
    expect(exchanges.length).toBe(1);
    expect(exchanges[0].user_prompt).toBe("First");
  });
});

describe("tool calls", () => {
  it("should insert tool calls linked to exchanges", () => {
    const sessionId = insertSession({
      session_id: "tool-test",
      project_path: "/test",
    });

    const exchangeId = insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "Read file",
    });

    insertToolCall({
      exchange_id: exchangeId,
      session_id: sessionId,
      tool_name: "Read",
      tool_input: '{"file_path":"/test.ts"}',
      tool_result: "file contents",
      tool_use_id: "tool-1",
    });

    // Verify via raw query
    const db = getDb();
    const tools = db
      .prepare("SELECT * FROM tool_calls WHERE exchange_id = ?")
      .all(exchangeId);
    expect(tools.length).toBe(1);
    expect(tools[0].tool_name).toBe("Read");
  });
});

describe("plans", () => {
  it("should insert and retrieve plans", () => {
    const sessionId = insertSession({
      session_id: "plan-test",
      project_path: "/test",
    });

    insertPlan({
      session_id: sessionId,
      version: 1,
      plan_text: "Step 1: Do something",
      status: "approved",
      exchange_index_start: 0,
      exchange_index_end: 2,
    });

    insertPlan({
      session_id: sessionId,
      version: 2,
      plan_text: "Step 1: Do something else",
      status: "drafted",
      user_feedback: "Need more detail",
      exchange_index_start: 3,
      exchange_index_end: 5,
    });

    const plans = getSessionPlans(sessionId);
    expect(plans.length).toBe(2);
    expect(plans[0].version).toBe(1);
    expect(plans[0].status).toBe("approved");
    expect(plans[1].user_feedback).toBe("Need more detail");
  });
});

describe("segments", () => {
  it("should insert and retrieve segments", () => {
    const sessionId = insertSession({
      session_id: "segment-test",
      project_path: "/test",
    });

    insertSegment({
      session_id: sessionId,
      segment_type: "implementing",
      exchange_index_start: 0,
      exchange_index_end: 5,
      files_touched: '["src/index.ts","src/utils.ts"]',
      tool_counts: '{"Edit":3,"Read":2}',
    });

    const segments = getSessionSegments(sessionId);
    expect(segments.length).toBe(1);
    expect(segments[0].segment_type).toBe("implementing");
    expect(JSON.parse(segments[0].files_touched)).toContain("src/index.ts");
  });
});

describe("milestones", () => {
  it("should insert and retrieve milestones", () => {
    const sessionId = insertSession({
      session_id: "milestone-test",
      project_path: "/test",
    });

    insertMilestone({
      session_id: sessionId,
      milestone_type: "commit",
      exchange_index: 5,
      description: "Commit: initial commit",
      metadata: '{"message":"initial commit"}',
    });

    const milestones = getSessionMilestones(sessionId);
    expect(milestones.length).toBe(1);
    expect(milestones[0].milestone_type).toBe("commit");
  });
});

describe("compaction events", () => {
  it("should insert and retrieve compaction events", () => {
    const sessionId = insertSession({
      session_id: "compact-test",
      project_path: "/test",
    });

    insertCompactionEvent({
      session_id: sessionId,
      exchange_index: 10,
      summary: "Context was compacted after 20 exchanges",
      exchanges_before: 20,
      exchanges_after: 5,
    });

    const events = getSessionCompactionEvents(sessionId);
    expect(events.length).toBe(1);
    expect(events[0].exchanges_before).toBe(20);
    expect(events[0].exchanges_after).toBe(5);
  });
});

describe("FTS5 search", () => {
  it("should find sessions by exchange content", () => {
    const sessionId = insertSession({
      session_id: "search-test",
      project_path: "/test/searchable",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "Help me implement authentication with OAuth",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 1,
      user_prompt: "Add passport middleware",
    });

    const results = searchSessions("authentication");
    expect(results.length).toBe(1);
    expect(results[0].session_id).toBe("search-test");
  });

  it("should filter search by project", () => {
    const sessionId = insertSession({
      session_id: "search-project-1",
      project_path: "/project/alpha",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "database migration query",
    });

    const sessionId2 = insertSession({
      session_id: "search-project-2",
      project_path: "/project/beta",
    });

    insertExchange({
      session_id: sessionId2,
      exchange_index: 0,
      user_prompt: "database schema query",
    });

    const results = searchSessions("database", { project: "alpha" });
    expect(results.length).toBe(1);
    expect(results[0].project_path).toBe("/project/alpha");
  });

  it("should return empty for no matches", () => {
    const results = searchSessions("xyznonexistent");
    expect(results.length).toBe(0);
  });
});

describe("stats", () => {
  it("should return correct statistics", () => {
    const sessionId = insertSession({
      session_id: "stats-test",
      project_path: "/stats/project",
    });
    updateSessionEnd("stats-test", 1);

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "Test prompt",
    });

    insertPlan({
      session_id: sessionId,
      version: 1,
      plan_text: "Test plan",
      exchange_index_start: 0,
      exchange_index_end: 0,
    });

    insertMilestone({
      session_id: sessionId,
      milestone_type: "commit",
      exchange_index: 0,
      description: "Test commit",
    });

    const stats = getStats();
    expect(stats.total_sessions).toBeGreaterThanOrEqual(1);
    expect(stats.total_exchanges).toBeGreaterThanOrEqual(1);
    expect(stats.total_plans).toBeGreaterThanOrEqual(1);
    expect(stats.total_milestones).toBeGreaterThanOrEqual(1);
    expect(stats.projects).toBeGreaterThanOrEqual(1);
    expect(stats.db_size_mb).toBeGreaterThanOrEqual(0);
  });
});

describe("config", () => {
  it("should set and get config values", () => {
    setConfig("test.key", "test-value");
    expect(getConfig("test.key")).toBe("test-value");
  });

  it("should overwrite config values", () => {
    setConfig("overwrite.key", "first");
    setConfig("overwrite.key", "second");
    expect(getConfig("overwrite.key")).toBe("second");
  });

  it("should return undefined for missing keys", () => {
    expect(getConfig("nonexistent.key")).toBeUndefined();
  });
});
