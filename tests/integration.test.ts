import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { parseTranscript } from "../src/capture/parser.js";
import { extractPlans } from "../src/capture/plans.js";
import { extractSegments } from "../src/capture/segments.js";
import { extractMilestones } from "../src/capture/milestones.js";
import { initDb, closeDb } from "../src/db/index.js";
import {
  upsertSession,
  insertExchange,
  insertToolCall,
  insertPlan,
  insertSegment,
  insertMilestone,
  insertCompactionEvent,
  updateSessionEnd,
  getSession,
  getSessionExchanges,
  getSessionPlans,
  getSessionSegments,
  getSessionMilestones,
  searchSessions,
  getStats,
} from "../src/db/queries.js";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// Find real session files to test against
function findRealSessions(maxCount = 3): string[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  const files: string[] = [];
  try {
    const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = join(PROJECTS_DIR, dir.name);
      try {
        const entries = readdirSync(projectPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.endsWith(".jsonl") && !entry.name.startsWith("agent-")) {
            files.push(join(projectPath, entry.name));
            if (files.length >= maxCount) return files;
          }
        }
      } catch {
        // Permission errors
      }
    }
  } catch {
    // No access
  }
  return files;
}

const realSessions = findRealSessions(3);
const hasRealSessions = realSessions.length > 0;

describe.skipIf(!hasRealSessions)("Real JSONL session parsing", () => {
  it("should parse real session files without errors", () => {
    for (const filePath of realSessions) {
      const result = parseTranscript(filePath);

      // Should extract basic metadata
      expect(result.session_id).toBeTruthy();
      expect(result.project_path).toBeTruthy();

      // Should have at least 1 exchange
      expect(result.exchanges.length).toBeGreaterThan(0);

      // Each exchange should have valid fields
      for (const exchange of result.exchanges) {
        expect(typeof exchange.index).toBe("number");
        expect(typeof exchange.user_prompt).toBe("string");
        expect(typeof exchange.assistant_response).toBe("string");
        expect(Array.isArray(exchange.tool_calls)).toBe(true);
        expect(typeof exchange.is_interrupt).toBe("boolean");
        expect(typeof exchange.is_compact_summary).toBe("boolean");
      }

      // Indices should be sequential
      for (let i = 0; i < result.exchanges.length; i++) {
        expect(result.exchanges[i].index).toBe(i);
      }
    }
  });

  it("should extract tool calls with valid structure", () => {
    for (const filePath of realSessions) {
      const result = parseTranscript(filePath);

      for (const exchange of result.exchanges) {
        for (const tc of exchange.tool_calls) {
          expect(tc.name).toBeTruthy();
          expect(tc.id).toBeTruthy();
          // Input can be any type
          expect(tc.input !== undefined).toBe(true);
        }
      }
    }
  });

  it("should run segment analysis without errors", () => {
    for (const filePath of realSessions) {
      const result = parseTranscript(filePath);
      const segments = extractSegments(result.exchanges);

      expect(Array.isArray(segments)).toBe(true);

      for (const seg of segments) {
        expect(seg.segment_type).toBeTruthy();
        expect(seg.exchange_index_start).toBeGreaterThanOrEqual(0);
        expect(seg.exchange_index_end).toBeGreaterThanOrEqual(seg.exchange_index_start);
        expect(Array.isArray(seg.files_touched)).toBe(true);
        expect(typeof seg.tool_counts).toBe("object");
      }
    }
  });

  it("should run milestone extraction without errors", () => {
    for (const filePath of realSessions) {
      const result = parseTranscript(filePath);
      const milestones = extractMilestones(result.exchanges);

      expect(Array.isArray(milestones)).toBe(true);

      for (const ms of milestones) {
        expect(ms.milestone_type).toBeTruthy();
        expect(ms.exchange_index).toBeGreaterThanOrEqual(0);
        expect(ms.description).toBeTruthy();
      }
    }
  });

  it("should run plan extraction without errors", () => {
    for (const filePath of realSessions) {
      const result = parseTranscript(filePath);
      const plans = extractPlans(result.exchanges);

      expect(Array.isArray(plans)).toBe(true);

      for (const plan of plans) {
        expect(plan.version).toBeGreaterThan(0);
        expect(plan.plan_text).toBeDefined();
        expect(["drafted", "approved", "rejected", "superseded"]).toContain(plan.status);
      }
    }
  });
});

describe.skipIf(!hasRealSessions)("Full pipeline integration (parse → store → query)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "keddy-integration-"));
    initDb(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should import a real session and query it back", () => {
    const filePath = realSessions[0];
    const transcript = parseTranscript(filePath);

    // Store session
    const sessionId = upsertSession({
      session_id: transcript.session_id,
      project_path: transcript.project_path,
      git_branch: transcript.git_branch,
      claude_version: transcript.claude_version,
      slug: transcript.slug,
      jsonl_path: filePath,
      forked_from: transcript.forked_from,
      title: transcript.exchanges[0]?.user_prompt.substring(0, 80) ?? null,
    });

    const session = getSession(transcript.session_id);
    expect(session).toBeDefined();

    // Store exchanges
    for (const exchange of transcript.exchanges) {
      const exchangeId = insertExchange({
        session_id: session!.id,
        exchange_index: exchange.index,
        user_prompt: exchange.user_prompt,
        assistant_response: exchange.assistant_response,
        tool_call_count: exchange.tool_calls.length,
        timestamp: exchange.timestamp,
        is_interrupt: exchange.is_interrupt,
        is_compact_summary: exchange.is_compact_summary,
      });

      for (const tc of exchange.tool_calls) {
        insertToolCall({
          exchange_id: exchangeId,
          session_id: session!.id,
          tool_name: tc.name,
          tool_input: JSON.stringify(tc.input),
          tool_result: tc.result ?? null,
          tool_use_id: tc.id,
          is_error: tc.is_error ?? false,
        });
      }
    }

    // Store analysis results
    const plans = extractPlans(transcript.exchanges);
    for (const plan of plans) {
      insertPlan({
        session_id: session!.id,
        version: plan.version,
        plan_text: plan.plan_text,
        status: plan.status,
        user_feedback: plan.user_feedback,
        exchange_index_start: plan.exchange_index_start,
        exchange_index_end: plan.exchange_index_end,
      });
    }

    const segments = extractSegments(transcript.exchanges);
    for (const segment of segments) {
      insertSegment({
        session_id: session!.id,
        segment_type: segment.segment_type,
        exchange_index_start: segment.exchange_index_start,
        exchange_index_end: segment.exchange_index_end,
        files_touched: JSON.stringify(segment.files_touched),
        tool_counts: JSON.stringify(segment.tool_counts),
      });
    }

    const milestones = extractMilestones(transcript.exchanges);
    for (const milestone of milestones) {
      insertMilestone({
        session_id: session!.id,
        milestone_type: milestone.milestone_type,
        exchange_index: milestone.exchange_index,
        description: milestone.description,
        metadata: milestone.metadata ? JSON.stringify(milestone.metadata) : null,
      });
    }

    for (const compaction of transcript.compactions) {
      insertCompactionEvent({
        session_id: session!.id,
        exchange_index: compaction.exchange_index,
      });
    }

    updateSessionEnd(transcript.session_id, transcript.exchanges.length);

    // Query back and verify
    const storedExchanges = getSessionExchanges(session!.id);
    expect(storedExchanges.length).toBe(transcript.exchanges.length);

    const storedPlans = getSessionPlans(session!.id);
    expect(storedPlans.length).toBe(plans.length);

    const storedSegments = getSessionSegments(session!.id);
    expect(storedSegments.length).toBe(segments.length);

    const storedMilestones = getSessionMilestones(session!.id);
    expect(storedMilestones.length).toBe(milestones.length);

    // Stats should reflect the import
    const stats = getStats();
    expect(stats.total_sessions).toBeGreaterThanOrEqual(1);
    expect(stats.total_exchanges).toBe(transcript.exchanges.length);
  });

  it("should find imported session via FTS search", () => {
    const filePath = realSessions[0];
    const transcript = parseTranscript(filePath);

    const sessionId = upsertSession({
      session_id: transcript.session_id,
      project_path: transcript.project_path,
    });

    const session = getSession(transcript.session_id)!;

    // Store first exchange for search
    const firstExchange = transcript.exchanges[0];
    if (firstExchange) {
      insertExchange({
        session_id: session.id,
        exchange_index: 0,
        user_prompt: firstExchange.user_prompt,
      });

      // Search for a word from the first prompt
      const words = firstExchange.user_prompt.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const results = searchSessions(words[0]);
        expect(results.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("Edge cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "keddy-edge-"));
    initDb(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should handle empty exchanges list", () => {
    const segments = extractSegments([]);
    expect(segments).toEqual([]);

    const plans = extractPlans([]);
    expect(plans).toEqual([]);

    const milestones = extractMilestones([]);
    expect(milestones).toEqual([]);
  });

  it("should handle sessions with only discussion (no tools)", () => {
    const exchanges = [
      {
        index: 0,
        user_prompt: "What is the best way to structure a React app?",
        assistant_response: "There are several approaches...",
        tool_calls: [],
        timestamp: "2024-01-01T00:00:00Z",
        is_interrupt: false,
        is_compact_summary: false,
      },
      {
        index: 1,
        user_prompt: "What about using Next.js?",
        assistant_response: "Next.js provides...",
        tool_calls: [],
        timestamp: "2024-01-01T00:01:00Z",
        is_interrupt: false,
        is_compact_summary: false,
      },
    ];

    const segments = extractSegments(exchanges);
    expect(segments.length).toBe(1);
    expect(segments[0].segment_type).toBe("discussion");
  });

  it("should handle very long user prompts", () => {
    const sessionId = upsertSession({
      session_id: "long-prompt-test",
      project_path: "/test",
    });

    const session = getSession("long-prompt-test")!;
    const longPrompt = "x".repeat(100000);

    const exchangeId = insertExchange({
      session_id: session.id,
      exchange_index: 0,
      user_prompt: longPrompt,
    });

    const exchanges = getSessionExchanges(session.id);
    expect(exchanges.length).toBe(1);
    expect(exchanges[0].user_prompt.length).toBe(100000);
  });

  it("should handle concurrent session inserts", () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(
        upsertSession({
          session_id: `concurrent-${i}`,
          project_path: "/test",
        }),
      );
    }

    const stats = getStats();
    expect(stats.total_sessions).toBeGreaterThanOrEqual(20);
  });

  it("should handle special characters in prompts", () => {
    const sessionId = upsertSession({
      session_id: "special-chars-test",
      project_path: "/test",
    });

    const session = getSession("special-chars-test")!;

    insertExchange({
      session_id: session.id,
      exchange_index: 0,
      user_prompt: 'Test with "quotes" and \'apostrophes\' and \nnewlines and \ttabs and unicode: 你好 🚀',
    });

    const exchanges = getSessionExchanges(session.id);
    expect(exchanges[0].user_prompt).toContain("quotes");
    expect(exchanges[0].user_prompt).toContain("你好");
    expect(exchanges[0].user_prompt).toContain("🚀");
  });

  it("should handle SQL injection attempts in search", () => {
    const sessionId = upsertSession({
      session_id: "sql-inject-test",
      project_path: "/test",
    });
    const session = getSession("sql-inject-test")!;

    insertExchange({
      session_id: session.id,
      exchange_index: 0,
      user_prompt: "normal query text",
    });

    // These should not throw or cause SQL injection
    expect(() => searchSessions("'; DROP TABLE sessions; --")).not.toThrow();
    expect(() => searchSessions("\" OR 1=1 --")).not.toThrow();
    expect(() => searchSessions("UNION SELECT * FROM sessions")).not.toThrow();
  });

  it("should handle multi-tool exchanges in segment detection", () => {
    const exchanges = [
      {
        index: 0,
        user_prompt: "Implement feature",
        assistant_response: "Done",
        tool_calls: [
          { name: "Read", input: { file_path: "/a.ts" }, id: "t1" },
          { name: "Edit", input: { file_path: "/a.ts", old_string: "x", new_string: "y" }, id: "t2" },
          { name: "Read", input: { file_path: "/b.ts" }, id: "t3" },
          { name: "Edit", input: { file_path: "/b.ts", old_string: "a", new_string: "b" }, id: "t4" },
          { name: "Bash", input: { command: "npm test" }, id: "t5" },
          { name: "Bash", input: { command: "git commit -m 'test'" }, id: "t6" },
        ],
        timestamp: "2024-01-01",
        is_interrupt: false,
        is_compact_summary: false,
      },
      {
        index: 1,
        user_prompt: "Push it",
        assistant_response: "Pushed",
        tool_calls: [
          { name: "Bash", input: { command: "git push origin main" }, id: "t7" },
        ],
        timestamp: "2024-01-01",
        is_interrupt: false,
        is_compact_summary: false,
      },
    ];

    const segments = extractSegments(exchanges);
    expect(segments.length).toBeGreaterThan(0);

    // Should detect files touched
    const allFiles = segments.flatMap((s) => s.files_touched);
    expect(allFiles).toContain("/a.ts");
    expect(allFiles).toContain("/b.ts");
  });
});
