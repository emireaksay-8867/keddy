import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { initDb, closeDb } from "../src/db/index.js";
import {
  insertSession,
  insertExchange,
  insertToolCall,
  insertPlan,
  insertSegment,
  insertMilestone,
  insertTask,
  getSession,
  getSessionExchanges,
  getSessionPlans,
  getSessionSegments,
  getSessionMilestones,
  getSessionTasks,
  getRecentSessions,
  searchSessions,
  searchByFile,
  getSessionTranscript,
  getStats,
  updateSessionEnd,
  getProjectStatus,
  getProjectContextForSessionStart,
} from "../src/db/queries.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "keddy-mcp-tools-test-"));
  initDb(join(tmpDir, "test.db"));
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: create a realistic session with plans, segments, milestones, tasks
 */
function createFullSession(projectPath: string, sessionId: string, options?: {
  planCount?: number;
  planStatus?: string;
  taskCount?: number;
  completedTasks?: number;
  milestoneTypes?: string[];
  segmentTypes?: string[];
  exchangeCount?: number;
}) {
  const opts = {
    planCount: 0, planStatus: "implemented", taskCount: 0, completedTasks: 0,
    milestoneTypes: [], segmentTypes: [], exchangeCount: 5,
    ...options,
  };

  const sid = insertSession({
    session_id: sessionId,
    project_path: projectPath,
    title: `Session ${sessionId}`,
    git_branch: "main",
  });

  // Exchanges
  for (let i = 0; i < opts.exchangeCount; i++) {
    const eid = insertExchange({
      session_id: sid,
      exchange_index: i,
      user_prompt: `User prompt ${i} for session ${sessionId}`,
      assistant_response: `Assistant response ${i}`,
      tool_call_count: i % 3,
    });
    // Add a tool call to some exchanges
    if (i % 2 === 0) {
      insertToolCall({
        exchange_id: eid,
        session_id: sid,
        tool_name: "Edit",
        tool_input: JSON.stringify({ file_path: `/src/file${i}.ts` }),
        tool_use_id: `tool-${sessionId}-${i}`,
      });
    }
  }

  // Plans
  for (let v = 1; v <= opts.planCount; v++) {
    const isLast = v === opts.planCount;
    insertPlan({
      session_id: sid,
      version: v,
      plan_text: `## Plan v${v} for ${sessionId}\n\n1. Task A\n2. Task B\n3. Task C`,
      status: isLast ? opts.planStatus : (v === opts.planCount - 1 && opts.planCount > 1 ? "revised" : "superseded"),
      user_feedback: v < opts.planCount ? `Feedback on v${v}` : null,
      exchange_index_start: v * 2,
      exchange_index_end: v * 2 + 1,
    });
  }

  // Tasks
  for (let t = 0; t < opts.taskCount; t++) {
    insertTask({
      session_id: sid,
      task_index: t,
      subject: `Task ${t}: Do something ${t}`,
      description: `Description for task ${t}`,
      status: t < opts.completedTasks ? "completed" : "pending",
      exchange_index_created: t + 1,
      exchange_index_completed: t < opts.completedTasks ? t + 3 : null,
    });
  }

  // Milestones
  opts.milestoneTypes.forEach((type, i) => {
    insertMilestone({
      session_id: sid,
      milestone_type: type,
      exchange_index: i + 1,
      description: type === "commit" ? `Commit: fix issue ${i}` :
                   type === "test_pass" ? "Tests passed" :
                   type === "test_fail" ? "Tests failed" :
                   type === "pr" ? "PR: Add feature" :
                   type === "push" ? "Pushed to origin/main" :
                   `Branch: feature-${i}`,
      metadata: type === "commit" ? JSON.stringify({ message: `fix issue ${i}` }) : null,
    });
  });

  // Segments
  let exIdx = 0;
  opts.segmentTypes.forEach((type) => {
    const segSize = Math.max(2, Math.floor(opts.exchangeCount / opts.segmentTypes.length));
    insertSegment({
      session_id: sid,
      segment_type: type,
      exchange_index_start: exIdx,
      exchange_index_end: Math.min(exIdx + segSize - 1, opts.exchangeCount - 1),
      files_touched: JSON.stringify([`/src/file${exIdx}.ts`]),
      tool_counts: JSON.stringify({ Edit: segSize, Read: 1 }),
    });
    exIdx += segSize;
  });

  updateSessionEnd(sessionId, opts.exchangeCount);
  return sid;
}

// ============================================================
// keddy_project_status — getProjectStatus
// ============================================================
describe("keddy_project_status (getProjectStatus)", () => {
  it("should return active plan with full text and created_at", () => {
    createFullSession("/projects/auth", "ps-1", {
      planCount: 3,
      planStatus: "implemented",
      taskCount: 4,
      completedTasks: 2,
      milestoneTypes: ["commit", "test_pass"],
      segmentTypes: ["planning", "implementing"],
      exchangeCount: 20,
    });

    const status = getProjectStatus("/projects/auth");

    // Active plan exists
    expect(status.activePlan).not.toBeNull();
    expect(status.activePlan!.version).toBe(3);
    expect(status.activePlan!.status).toBe("implemented");
    // Full plan text — not truncated
    expect(status.activePlan!.plan_text).toContain("## Plan v3");
    expect(status.activePlan!.plan_text).toContain("Task A");
    // Has created_at for freshness judgment
    expect(status.activePlan!.created_at).toBeDefined();
    expect(status.activePlan!.created_at.length).toBeGreaterThan(0);
  });

  it("should return plan history with version evolution", () => {
    createFullSession("/projects/auth", "ps-2", {
      planCount: 3,
      planStatus: "approved",
    });

    const status = getProjectStatus("/projects/auth");

    expect(status.planHistory.length).toBe(3);
    expect(status.planHistory[0].version).toBe(1);
    expect(status.planHistory[0].status).toBe("superseded");
    expect(status.planHistory[1].version).toBe(2);
    expect(status.planHistory[1].status).toBe("revised");
    expect(status.planHistory[1].user_feedback).toBe("Feedback on v2");
    expect(status.planHistory[2].version).toBe(3);
    expect(status.planHistory[2].status).toBe("approved");
  });

  it("should return tasks with status", () => {
    createFullSession("/projects/auth", "ps-3", {
      planCount: 1,
      planStatus: "implemented",
      taskCount: 5,
      completedTasks: 3,
    });

    const status = getProjectStatus("/projects/auth");

    expect(status.tasks.length).toBe(5);
    expect(status.tasks.filter(t => t.status === "completed").length).toBe(3);
    expect(status.tasks.filter(t => t.status === "pending").length).toBe(2);
  });

  it("should return recent milestones across sessions", () => {
    createFullSession("/projects/auth", "ps-4a", {
      milestoneTypes: ["commit", "test_pass"],
    });
    createFullSession("/projects/auth", "ps-4b", {
      milestoneTypes: ["commit", "test_fail", "commit"],
    });

    const status = getProjectStatus("/projects/auth");

    expect(status.recentMilestones.length).toBeGreaterThanOrEqual(3);
    expect(status.recentMilestones.some(m => m.milestone_type === "commit")).toBe(true);
  });

  it("should return segment types from latest session", () => {
    createFullSession("/projects/auth", "ps-5", {
      segmentTypes: ["exploring", "implementing", "testing"],
      exchangeCount: 15,
    });

    const status = getProjectStatus("/projects/auth");

    expect(status.segmentTypes).toContain("exploring");
    expect(status.segmentTypes).toContain("implementing");
    expect(status.segmentTypes).toContain("testing");
  });

  it("should return active files from segments", () => {
    createFullSession("/projects/auth", "ps-6", {
      segmentTypes: ["implementing"],
      exchangeCount: 10,
    });

    const status = getProjectStatus("/projects/auth");

    expect(status.activeFiles.length).toBeGreaterThan(0);
  });

  it("should handle project with NO plans gracefully", () => {
    createFullSession("/projects/noplan", "ps-7", {
      planCount: 0,
      milestoneTypes: ["commit", "test_pass"],
      segmentTypes: ["implementing", "testing"],
    });

    const status = getProjectStatus("/projects/noplan");

    expect(status.activePlan).toBeNull();
    expect(status.planHistory).toEqual([]);
    expect(status.tasks).toEqual([]);
    // Milestones and segments still present
    expect(status.recentMilestones.length).toBeGreaterThan(0);
    expect(status.segmentTypes.length).toBeGreaterThan(0);
  });

  it("should handle empty project", () => {
    const status = getProjectStatus("/projects/nonexistent");

    expect(status.recentSessions).toEqual([]);
    expect(status.activePlan).toBeNull();
    expect(status.tasks).toEqual([]);
    expect(status.recentMilestones).toEqual([]);
  });

  it("should find active plan from earlier session when latest has none", () => {
    // Session 1 has a plan with incomplete tasks
    createFullSession("/projects/multi", "ps-8a", {
      planCount: 1,
      planStatus: "approved",
      taskCount: 3,
      completedTasks: 1,
    });
    // Session 2 has no plan (just discussion)
    createFullSession("/projects/multi", "ps-8b", {
      planCount: 0,
      milestoneTypes: ["test_pass"],
    });

    const status = getProjectStatus("/projects/multi");

    // Should still find the plan from session 1
    expect(status.activePlan).not.toBeNull();
    expect(status.activePlan!.sessionId).toBe("ps-8a");
  });
});

// ============================================================
// SessionStart context — getProjectContextForSessionStart
// ============================================================
describe("SessionStart context (getProjectContextForSessionStart)", () => {
  it("should return session count", () => {
    createFullSession("/projects/ctx", "ctx-1", { exchangeCount: 5 });
    createFullSession("/projects/ctx", "ctx-2", { exchangeCount: 3 });

    const ctx = getProjectContextForSessionStart("/projects/ctx");

    expect(ctx.sessionCount).toBe(2);
  });

  it("should return active plan excerpt", () => {
    createFullSession("/projects/ctx", "ctx-3", {
      planCount: 2,
      planStatus: "implemented",
    });

    const ctx = getProjectContextForSessionStart("/projects/ctx");

    expect(ctx.activePlan).not.toBeNull();
    expect(ctx.activePlan!.version).toBe(2);
    expect(ctx.activePlan!.status).toBe("implemented");
    expect(ctx.activePlan!.excerpt.length).toBeGreaterThan(0);
    expect(ctx.activePlan!.excerpt.length).toBeLessThanOrEqual(200);
  });

  it("should return pending task names", () => {
    createFullSession("/projects/ctx", "ctx-4", {
      planCount: 1,
      planStatus: "approved",
      taskCount: 4,
      completedTasks: 2,
    });

    const ctx = getProjectContextForSessionStart("/projects/ctx");

    expect(ctx.pendingTasks.length).toBe(2);
    expect(ctx.pendingTasks[0]).toContain("Task");
  });

  it("should return last milestone", () => {
    createFullSession("/projects/ctx", "ctx-5", {
      milestoneTypes: ["commit", "test_pass", "commit"],
    });

    const ctx = getProjectContextForSessionStart("/projects/ctx");

    expect(ctx.lastMilestone).not.toBeNull();
  });

  it("should handle project with no data", () => {
    const ctx = getProjectContextForSessionStart("/projects/empty");

    expect(ctx.sessionCount).toBe(0);
    expect(ctx.activePlan).toBeNull();
    expect(ctx.pendingTasks).toEqual([]);
    expect(ctx.lastMilestone).toBeNull();
  });
});

// ============================================================
// keddy_get_session — verify response structure
// ============================================================
describe("keddy_get_session response structure", () => {
  it("should return full plan text without truncation", () => {
    const longPlanText = "## Detailed Plan\n\n" + "This is a very detailed plan step. ".repeat(50);
    const sid = insertSession({
      session_id: "gs-1",
      project_path: "/test",
    });
    insertPlan({
      session_id: sid,
      version: 1,
      plan_text: longPlanText,
      status: "approved",
      exchange_index_start: 0,
      exchange_index_end: 1,
    });

    const plans = getSessionPlans(sid);

    expect(plans[0].plan_text).toBe(longPlanText);
    expect(plans[0].plan_text.length).toBeGreaterThan(500);
  });

  it("should return tasks alongside plans", () => {
    const sid = insertSession({
      session_id: "gs-2",
      project_path: "/test",
    });
    insertPlan({
      session_id: sid,
      version: 1,
      plan_text: "Plan text",
      status: "approved",
      exchange_index_start: 0,
      exchange_index_end: 1,
    });
    insertTask({
      session_id: sid,
      task_index: 0,
      subject: "Build the API",
      status: "completed",
      exchange_index_created: 2,
      exchange_index_completed: 5,
    });
    insertTask({
      session_id: sid,
      task_index: 1,
      subject: "Write tests",
      status: "pending",
      exchange_index_created: 3,
    });

    const plans = getSessionPlans(sid);
    const tasks = getSessionTasks(sid);

    expect(plans.length).toBe(1);
    expect(tasks.length).toBe(2);
    expect(tasks[0].subject).toBe("Build the API");
    expect(tasks[0].status).toBe("completed");
    expect(tasks[1].subject).toBe("Write tests");
    expect(tasks[1].status).toBe("pending");
  });

  it("should return all exchanges for a session", () => {
    const sid = insertSession({
      session_id: "gs-3",
      project_path: "/test",
    });
    for (let i = 0; i < 20; i++) {
      insertExchange({
        session_id: sid,
        exchange_index: i,
        user_prompt: `Prompt ${i}: ${"x".repeat(600)}`,
        assistant_response: `Response ${i}: ${"y".repeat(400)}`,
      });
    }

    const exchanges = getSessionExchanges(sid);

    // All 20 exchanges returned — no capping
    expect(exchanges.length).toBe(20);
    // Full text stored in DB — truncation happens in MCP response formatting, not in DB
    expect(exchanges[0].user_prompt.length).toBeGreaterThan(500);
  });
});

// ============================================================
// keddy_search_sessions — verify lean response
// ============================================================
describe("keddy_search_sessions response", () => {
  it("should return lean session data without enrichment", () => {
    const sid = insertSession({
      session_id: "ss-1",
      project_path: "/test/search",
      title: "Auth work",
      git_branch: "feature/auth",
    });
    insertExchange({
      session_id: sid,
      exchange_index: 0,
      user_prompt: "Implement JWT authentication",
    });
    insertPlan({
      session_id: sid,
      version: 1,
      plan_text: "Plan for JWT",
      status: "approved",
      exchange_index_start: 0,
      exchange_index_end: 0,
    });

    const results = searchSessions("JWT");

    expect(results.length).toBe(1);
    // Has basic fields
    expect(results[0].session_id).toBe("ss-1");
    expect(results[0].title).toBe("Auth work");
    expect(results[0].project_path).toBe("/test/search");
    expect(results[0].git_branch).toBe("feature/auth");
    // Does NOT have enrichment fields (those are MCP response-level, not query-level)
    // The query returns Session objects, not enriched objects
  });
});

// ============================================================
// keddy_get_transcript — verify full text
// ============================================================
describe("keddy_get_transcript response", () => {
  it("should return full text without truncation", () => {
    const sid = insertSession({
      session_id: "gt-1",
      project_path: "/test",
    });
    const longPrompt = "A".repeat(5000);
    const longResponse = "B".repeat(8000);
    insertExchange({
      session_id: sid,
      exchange_index: 0,
      user_prompt: longPrompt,
      assistant_response: longResponse,
    });

    const transcript = getSessionTranscript(sid);

    expect(transcript[0].user_prompt.length).toBe(5000);
    expect(transcript[0].assistant_response.length).toBe(8000);
  });

  it("should respect exchange range filters", () => {
    const sid = insertSession({
      session_id: "gt-2",
      project_path: "/test",
    });
    for (let i = 0; i < 10; i++) {
      insertExchange({
        session_id: sid,
        exchange_index: i,
        user_prompt: `Exchange ${i}`,
      });
    }

    const range = getSessionTranscript(sid, { from: 3, to: 7 });

    expect(range.length).toBe(5);
    expect(range[0].exchange_index).toBe(3);
    expect(range[4].exchange_index).toBe(7);
  });
});

// ============================================================
// keddy_search_by_file — verify file matching
// ============================================================
describe("keddy_search_by_file response", () => {
  it("should find sessions by file path in tool inputs", () => {
    const sid = insertSession({
      session_id: "sf-1",
      project_path: "/test",
      title: "File test",
    });
    const eid = insertExchange({
      session_id: sid,
      exchange_index: 0,
      user_prompt: "Edit the auth file",
    });
    insertToolCall({
      exchange_id: eid,
      session_id: sid,
      tool_name: "Edit",
      tool_input: JSON.stringify({ file_path: "/src/auth/middleware.ts", old_string: "a", new_string: "b" }),
      tool_use_id: "tc-sf-1",
    });

    const results = searchByFile("auth/middleware.ts");

    expect(results.length).toBe(1);
    expect(results[0].session_id).toBe("sf-1");
    expect(results[0].tool_name).toBe("Edit");
  });

  it("should match partial file paths", () => {
    const sid = insertSession({
      session_id: "sf-2",
      project_path: "/test",
    });
    const eid = insertExchange({
      session_id: sid,
      exchange_index: 0,
      user_prompt: "Read file",
    });
    insertToolCall({
      exchange_id: eid,
      session_id: sid,
      tool_name: "Read",
      tool_input: JSON.stringify({ file_path: "/very/long/path/to/src/components/Button.tsx" }),
      tool_use_id: "tc-sf-2",
    });

    const results = searchByFile("Button.tsx");

    expect(results.length).toBe(1);
  });
});

// ============================================================
// Edge cases and data integrity
// ============================================================
describe("MCP data integrity", () => {
  it("should handle session with plan but no tasks", () => {
    createFullSession("/projects/notasks", "di-1", {
      planCount: 2,
      planStatus: "approved",
      taskCount: 0,
    });

    const status = getProjectStatus("/projects/notasks");

    expect(status.activePlan).not.toBeNull();
    expect(status.tasks).toEqual([]);
  });

  it("should handle session with tasks but no plan", () => {
    const sid = insertSession({
      session_id: "di-2",
      project_path: "/projects/noplan",
    });
    insertExchange({ session_id: sid, exchange_index: 0, user_prompt: "test" });
    insertTask({
      session_id: sid,
      task_index: 0,
      subject: "Orphan task",
      status: "pending",
      exchange_index_created: 0,
    });
    updateSessionEnd("di-2", 1);

    const status = getProjectStatus("/projects/noplan");

    expect(status.activePlan).toBeNull();
    // Tasks exist but aren't returned because they're only fetched for the active plan's session
    expect(status.tasks).toEqual([]);
  });

  it("should handle multiple projects independently", () => {
    createFullSession("/projects/alpha", "di-3a", {
      planCount: 1, planStatus: "approved", taskCount: 2, completedTasks: 1,
    });
    createFullSession("/projects/beta", "di-3b", {
      planCount: 1, planStatus: "implemented", taskCount: 3, completedTasks: 3,
    });

    const alphaStatus = getProjectStatus("/projects/alpha");
    const betaStatus = getProjectStatus("/projects/beta");

    expect(alphaStatus.activePlan!.sessionId).toBe("di-3a");
    expect(betaStatus.activePlan!.sessionId).toBe("di-3b");
    expect(alphaStatus.tasks.length).toBe(2);
    expect(betaStatus.tasks.length).toBe(3);
  });

  it("should return most recent plan as active when multiple sessions have plans", () => {
    // Create with explicit timestamps to ensure ordering
    const sid1 = insertSession({
      session_id: "di-4a",
      project_path: "/projects/evolve",
      started_at: "2026-03-01T10:00:00Z",
    });
    insertExchange({ session_id: sid1, exchange_index: 0, user_prompt: "test" });
    insertPlan({
      session_id: sid1, version: 1, plan_text: "Old plan",
      status: "implemented", exchange_index_start: 0, exchange_index_end: 0,
    });
    updateSessionEnd("di-4a", 1);

    const sid2 = insertSession({
      session_id: "di-4b",
      project_path: "/projects/evolve",
      started_at: "2026-03-10T10:00:00Z",
    });
    insertExchange({ session_id: sid2, exchange_index: 0, user_prompt: "test" });
    insertPlan({
      session_id: sid2, version: 1, plan_text: "New plan",
      status: "approved", exchange_index_start: 0, exchange_index_end: 0,
    });
    updateSessionEnd("di-4b", 1);

    const status = getProjectStatus("/projects/evolve");

    // Should return the MOST RECENT plan (from session b, March 10)
    expect(status.activePlan!.sessionId).toBe("di-4b");
    expect(status.activePlan!.version).toBe(1);
    expect(status.activePlan!.status).toBe("approved");
  });
});
