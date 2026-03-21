import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { initDb, closeDb } from "../src/db/index.js";
import {
  insertSession,
  insertExchange,
  insertPlan,
  insertSegment,
  insertMilestone,
  getSession,
  getSessionExchanges,
  getSessionPlans,
  getSessionSegments,
  getSessionMilestones,
  getRecentSessions,
  searchSessions,
  getStats,
} from "../src/db/queries.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "keddy-mcp-test-"));
  initDb(join(tmpDir, "test.db"));
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Since we can't easily test the MCP server via stdio in unit tests,
// we test the underlying query functions that the MCP tools use.

describe("MCP tool: keddy_search_sessions (underlying queries)", () => {
  it("should search sessions by query", () => {
    const sessionId = insertSession({
      session_id: "mcp-search-1",
      project_path: "/mcp/test",
      title: "Auth implementation",
    });

    insertExchange({
      session_id: sessionId,
      exchange_index: 0,
      user_prompt: "Implement OAuth authentication flow",
    });

    const results = searchSessions("OAuth");
    expect(results.length).toBe(1);
    expect(results[0].session_id).toBe("mcp-search-1");
  });

  it("should respect project filter", () => {
    const s1 = insertSession({
      session_id: "mcp-proj-1",
      project_path: "/project/frontend",
    });
    insertExchange({
      session_id: s1,
      exchange_index: 0,
      user_prompt: "Add button component",
    });

    const s2 = insertSession({
      session_id: "mcp-proj-2",
      project_path: "/project/backend",
    });
    insertExchange({
      session_id: s2,
      exchange_index: 0,
      user_prompt: "Add API endpoint",
    });

    const frontendResults = searchSessions("Add", { project: "frontend" });
    expect(frontendResults.length).toBe(1);
    expect(frontendResults[0].project_path).toContain("frontend");
  });

  it("should respect limit", () => {
    for (let i = 0; i < 5; i++) {
      const sid = insertSession({
        session_id: `mcp-limit-${i}`,
        project_path: "/test",
      });
      insertExchange({
        session_id: sid,
        exchange_index: 0,
        user_prompt: "repeated keyword search",
      });
    }

    const results = searchSessions("keyword", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

describe("MCP tool: keddy_get_session (underlying queries)", () => {
  it("should return full session details", () => {
    const sid = insertSession({
      session_id: "mcp-detail-1",
      project_path: "/detail/test",
      title: "Detailed session",
      git_branch: "main",
    });

    insertExchange({
      session_id: sid,
      exchange_index: 0,
      user_prompt: "First prompt",
      assistant_response: "First response",
      tool_call_count: 2,
    });

    insertSegment({
      session_id: sid,
      segment_type: "implementing",
      exchange_index_start: 0,
      exchange_index_end: 0,
    });

    insertMilestone({
      session_id: sid,
      milestone_type: "commit",
      exchange_index: 0,
      description: "initial commit",
    });

    const session = getSession("mcp-detail-1");
    expect(session).toBeDefined();

    const exchanges = getSessionExchanges(sid);
    expect(exchanges.length).toBe(1);

    const segments = getSessionSegments(sid);
    expect(segments.length).toBe(1);

    const milestones = getSessionMilestones(sid);
    expect(milestones.length).toBe(1);
  });

  it("should return undefined for nonexistent session", () => {
    const session = getSession("nonexistent");
    expect(session).toBeUndefined();
  });
});

describe("MCP tool: keddy_get_plans (underlying queries)", () => {
  it("should return plans for a session", () => {
    const sid = insertSession({
      session_id: "mcp-plans-1",
      project_path: "/plans/test",
    });

    insertPlan({
      session_id: sid,
      version: 1,
      plan_text: "Plan v1: Do X",
      status: "superseded",
      exchange_index_start: 0,
      exchange_index_end: 2,
    });

    insertPlan({
      session_id: sid,
      version: 2,
      plan_text: "Plan v2: Do Y instead",
      status: "approved",
      user_feedback: "Prefer approach Y",
      exchange_index_start: 3,
      exchange_index_end: 5,
    });

    const plans = getSessionPlans(sid);
    expect(plans.length).toBe(2);
    expect(plans[0].version).toBe(1);
    expect(plans[0].status).toBe("superseded");
    expect(plans[1].version).toBe(2);
    expect(plans[1].user_feedback).toBe("Prefer approach Y");
  });
});

describe("MCP tool: keddy_recent_activity (underlying queries)", () => {
  it("should return recent sessions", () => {
    insertSession({
      session_id: "mcp-recent-1",
      project_path: "/recent/test",
    });
    insertSession({
      session_id: "mcp-recent-2",
      project_path: "/recent/test",
    });

    const sessions = getRecentSessions(7);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  it("should return stats alongside activity", () => {
    insertSession({
      session_id: "mcp-stats-1",
      project_path: "/stats/test",
    });

    const stats = getStats();
    expect(stats).toHaveProperty("total_sessions");
    expect(stats).toHaveProperty("total_exchanges");
    expect(stats).toHaveProperty("projects");
  });
});
