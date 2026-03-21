import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { initDb, closeDb, getDb } from "../src/db/index.js";
import {
  upsertSession,
  getSession,
  getSessionExchanges,
  getSessionPlans,
  getSessionSegments,
  getSessionMilestones,
  updateSessionEnd,
  insertExchange,
  insertToolCall,
  getSessionCompactionEvents,
  insertCompactionEvent,
  insertPlan,
} from "../src/db/queries.js";
import { parseTranscript } from "../src/capture/parser.js";
import { extractPlans } from "../src/capture/plans.js";
import { extractSegments } from "../src/capture/segments.js";
import { extractMilestones } from "../src/capture/milestones.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "keddy-handler-"));
  initDb(join(tmpDir, "test.db"));
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SessionEnd handler simulation", () => {
  it("should fully import a session from JSONL transcript", () => {
    const fixturesDir = join(__dirname, "fixtures");
    const filePath = join(fixturesDir, "sample-session.jsonl");

    // Simulate what handleSessionEnd does
    const sessionDbId = upsertSession({
      session_id: "sess-001",
      project_path: "/Users/test/project",
      jsonl_path: filePath,
    });

    const session = getSession("sess-001")!;
    const transcript = parseTranscript(filePath);

    // Update session metadata
    upsertSession({
      session_id: "sess-001",
      project_path: transcript.project_path,
      git_branch: transcript.git_branch,
      claude_version: transcript.claude_version,
      slug: transcript.slug,
      forked_from: transcript.forked_from,
      title: transcript.exchanges[0]?.user_prompt.substring(0, 80) ?? null,
    });

    // Store exchanges
    for (const exchange of transcript.exchanges) {
      const exchangeId = insertExchange({
        session_id: session.id,
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
          session_id: session.id,
          tool_name: tc.name,
          tool_input: JSON.stringify(tc.input),
          tool_result: tc.result ?? null,
          tool_use_id: tc.id,
          is_error: tc.is_error ?? false,
        });
      }
    }

    updateSessionEnd("sess-001", transcript.exchanges.length);

    // Verify
    const updatedSession = getSession("sess-001")!;
    expect(updatedSession.ended_at).toBeTruthy();
    expect(updatedSession.exchange_count).toBe(transcript.exchanges.length);
    expect(updatedSession.title).toBe("Read the package.json file");

    const exchanges = getSessionExchanges(session.id);
    expect(exchanges.length).toBe(transcript.exchanges.length);

    // Verify tool calls are stored
    const db = getDb();
    const toolCalls = db
      .prepare("SELECT * FROM tool_calls WHERE session_id = ?")
      .all(session.id);
    expect(toolCalls.length).toBeGreaterThan(0);
  });

  it("should import plans from a session with plan mode", () => {
    const filePath = join(__dirname, "fixtures", "sample-with-plans.jsonl");
    const sessionDbId = upsertSession({
      session_id: "sess-002",
      project_path: "/Users/test/project",
    });

    const session = getSession("sess-002")!;
    const transcript = parseTranscript(filePath);

    // Store exchanges
    for (const exchange of transcript.exchanges) {
      insertExchange({
        session_id: session.id,
        exchange_index: exchange.index,
        user_prompt: exchange.user_prompt,
        assistant_response: exchange.assistant_response,
        tool_call_count: exchange.tool_calls.length,
        timestamp: exchange.timestamp,
        is_interrupt: exchange.is_interrupt,
        is_compact_summary: exchange.is_compact_summary,
      });
    }

    // Run plan analysis
    const plans = extractPlans(transcript.exchanges);
    for (const plan of plans) {
      insertPlan({
        session_id: session.id,
        version: plan.version,
        plan_text: plan.plan_text,
        status: plan.status,
        user_feedback: plan.user_feedback,
        exchange_index_start: plan.exchange_index_start,
        exchange_index_end: plan.exchange_index_end,
      });
    }

    const storedPlans = getSessionPlans(session.id);
    expect(storedPlans.length).toBe(3);
    expect(storedPlans[0].version).toBe(1);
    expect(storedPlans[2].version).toBe(3);
  });

  it("should detect compaction boundaries from transcript", () => {
    const filePath = join(__dirname, "fixtures", "sample-with-compaction.jsonl");
    const sessionDbId = upsertSession({
      session_id: "sess-003",
      project_path: "/Users/test/project",
    });

    const session = getSession("sess-003")!;
    const transcript = parseTranscript(filePath);

    for (const boundary of transcript.compaction_boundaries) {
      insertCompactionEvent({
        session_id: session.id,
        exchange_index: boundary,
      });
    }

    const compactions = getSessionCompactionEvents(session.id);
    expect(compactions.length).toBe(transcript.compaction_boundaries.length);
  });

  it("should handle idempotent re-import of same session", () => {
    const filePath = join(__dirname, "fixtures", "sample-session.jsonl");
    const transcript = parseTranscript(filePath);

    // First import
    upsertSession({
      session_id: "sess-001",
      project_path: "/Users/test/project",
    });
    const session = getSession("sess-001")!;

    for (const exchange of transcript.exchanges) {
      const exchangeId = insertExchange({
        session_id: session.id,
        exchange_index: exchange.index,
        user_prompt: exchange.user_prompt,
      });
      for (const tc of exchange.tool_calls) {
        insertToolCall({
          exchange_id: exchangeId,
          session_id: session.id,
          tool_name: tc.name,
          tool_use_id: tc.id,
        });
      }
    }

    // Second import (should be idempotent)
    for (const exchange of transcript.exchanges) {
      const exchangeId = insertExchange({
        session_id: session.id,
        exchange_index: exchange.index,
        user_prompt: exchange.user_prompt,
      });
      for (const tc of exchange.tool_calls) {
        insertToolCall({
          exchange_id: exchangeId,
          session_id: session.id,
          tool_name: tc.name,
          tool_use_id: tc.id,
        });
      }
    }

    // Should NOT have duplicates
    const exchanges = getSessionExchanges(session.id);
    expect(exchanges.length).toBe(transcript.exchanges.length);

    const db = getDb();
    const toolCalls = db
      .prepare("SELECT * FROM tool_calls WHERE session_id = ?")
      .all(session.id);
    const allToolCalls = transcript.exchanges.flatMap((e) => e.tool_calls);
    expect(toolCalls.length).toBe(allToolCalls.length);
  });
});

describe("Stop handler simulation", () => {
  it("should store latest exchange incrementally", () => {
    upsertSession({
      session_id: "stop-test",
      project_path: "/test",
    });
    const session = getSession("stop-test")!;

    // Simulate Stop hook — store one exchange
    insertExchange({
      session_id: session.id,
      exchange_index: 0,
      user_prompt: "First prompt",
      assistant_response: "First response",
      tool_call_count: 1,
    });

    // Simulate next Stop hook — store next exchange
    insertExchange({
      session_id: session.id,
      exchange_index: 1,
      user_prompt: "Second prompt",
      assistant_response: "Second response",
      tool_call_count: 0,
    });

    const exchanges = getSessionExchanges(session.id);
    expect(exchanges.length).toBe(2);
    expect(exchanges[0].exchange_index).toBe(0);
    expect(exchanges[1].exchange_index).toBe(1);
  });
});

describe("PostCompact handler simulation", () => {
  it("should store compaction event with metadata", () => {
    upsertSession({
      session_id: "compact-test",
      project_path: "/test",
    });
    const session = getSession("compact-test")!;

    insertCompactionEvent({
      session_id: session.id,
      exchange_index: 15,
      summary: "Summarized 15 exchanges into context",
      exchanges_before: 20,
      exchanges_after: 5,
    });

    const events = getSessionCompactionEvents(session.id);
    expect(events.length).toBe(1);
    expect(events[0].exchange_index).toBe(15);
    expect(events[0].exchanges_before).toBe(20);
    expect(events[0].exchanges_after).toBe(5);
    expect(events[0].summary).toContain("Summarized");
  });
});
