import { initDb, closeDb } from "../db/index.js";
import {
  upsertSession,
  updateSessionEnd,
  insertExchange,
  insertToolCall,
  insertCompactionEvent,
  insertPlan,
  insertSegment,
  insertMilestone,
  getSession,
  getSessionExchanges,
  getRecentSessions,
  insertSessionLink,
} from "../db/queries.js";
import { parseTranscript, parseLatestExchanges } from "./parser.js";
import { extractPlans } from "./plans.js";
import { extractSegments } from "./segments.js";
import { extractMilestones } from "./milestones.js";

interface HookStdin {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  compact_summary?: string;
  [key: string]: unknown;
}

async function readStdin(): Promise<HookStdin> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    // Timeout after 5s
    setTimeout(() => resolve({}), 5000);
  });
}

async function handleSessionStart(input: HookStdin): Promise<void> {
  if (!input.session_id || !input.cwd) return;

  initDb();
  try {
    upsertSession({
      session_id: input.session_id,
      project_path: input.cwd,
      jsonl_path: input.transcript_path ?? null,
    });

    // Count previous sessions for context
    const recentSessions = getRecentSessions(30, 5);
    const projectSessions = recentSessions.filter(
      (s) => s.project_path === input.cwd,
    );

    // Write additional context to stdout (sync hook)
    const context = {
      additionalContext: `[Keddy] Session tracked. ${projectSessions.length} recent sessions in this project.`,
    };
    process.stdout.write(JSON.stringify(context));
  } finally {
    closeDb();
  }
}

async function handleStop(input: HookStdin): Promise<void> {
  if (!input.session_id || !input.transcript_path) return;

  initDb();
  try {
    const session = getSession(input.session_id);
    if (!session) {
      upsertSession({
        session_id: input.session_id,
        project_path: input.cwd ?? "",
        jsonl_path: input.transcript_path,
      });
    }

    // Parse latest exchange — use actual exchange count from DB, not session.exchange_count
    // (which is only updated at SessionEnd)
    const sessionRow = getSession(input.session_id);
    if (!sessionRow) return;

    const existingExchanges = getSessionExchanges(sessionRow.id);
    const sinceIndex = existingExchanges.length;

    const latestExchanges = parseLatestExchanges(
      input.transcript_path,
      sinceIndex,
    );

    for (const exchange of latestExchanges) {
      const exchangeId = insertExchange({
        session_id: sessionRow.id,
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
          session_id: sessionRow.id,
          tool_name: tc.name,
          tool_input: JSON.stringify(tc.input),
          tool_result: tc.result ?? null,
          tool_use_id: tc.id,
          is_error: tc.is_error ?? false,
        });
      }
    }
  } finally {
    closeDb();
  }
}

async function handlePostCompact(input: HookStdin): Promise<void> {
  if (!input.session_id) return;

  initDb();
  try {
    const session = getSession(input.session_id);
    if (!session) return;

    insertCompactionEvent({
      session_id: session.id,
      exchange_index: session.exchange_count,
      summary: input.compact_summary ?? null,
    });
  } finally {
    closeDb();
  }
}

async function handleSessionEnd(input: HookStdin): Promise<void> {
  if (!input.session_id || !input.transcript_path) return;

  initDb();
  try {
    // Ensure session exists
    upsertSession({
      session_id: input.session_id,
      project_path: input.cwd ?? "",
      jsonl_path: input.transcript_path,
    });

    const session = getSession(input.session_id);
    if (!session) return;

    // Full transcript parse
    const transcript = parseTranscript(input.transcript_path);

    // Update session metadata
    if (transcript.git_branch || transcript.claude_version || transcript.slug) {
      upsertSession({
        session_id: input.session_id,
        project_path: transcript.project_path || input.cwd || "",
        git_branch: transcript.git_branch,
        claude_version: transcript.claude_version,
        slug: transcript.slug,
        forked_from: transcript.forked_from,
        title:
          transcript.exchanges[0]?.user_prompt.substring(0, 80) ?? null,
      });
    }

    // Store all exchanges
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

    // Mark session ended
    updateSessionEnd(input.session_id, transcript.exchanges.length, transcript.ended_at ?? undefined);

    // Run programmatic analysis
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

    const segments = extractSegments(transcript.exchanges);
    for (const segment of segments) {
      insertSegment({
        session_id: session.id,
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
        session_id: session.id,
        milestone_type: milestone.milestone_type,
        exchange_index: milestone.exchange_index,
        description: milestone.description,
        metadata: milestone.metadata ? JSON.stringify(milestone.metadata) : null,
      });
    }

    // Compaction events from transcript
    for (const boundary of transcript.compaction_boundaries) {
      insertCompactionEvent({
        session_id: session.id,
        exchange_index: boundary,
      });
    }

    // Detect session links (shared files with recent sessions)
    const filesTouched = new Set<string>();
    for (const seg of segments) {
      for (const f of seg.files_touched) {
        filesTouched.add(f);
      }
    }

    if (filesTouched.size > 0) {
      const recentSessions = getRecentSessions(7, 20);
      for (const recent of recentSessions) {
        if (recent.id === session.id) continue;
        // Simple heuristic: check if project paths match
        if (recent.project_path === session.project_path) {
          insertSessionLink({
            source_session_id: session.id,
            target_session_id: recent.id,
            link_type: "same_project",
            shared_files: "[]",
          });
        }
      }
    }
  } finally {
    closeDb();
  }
}

// Main entry point
async function main(): Promise<void> {
  const hookType = process.argv[2];
  if (!hookType) {
    console.error("Usage: handler.js <SessionStart|Stop|PostCompact|SessionEnd>");
    process.exit(1);
  }

  const input = await readStdin();

  switch (hookType) {
    case "SessionStart":
      await handleSessionStart(input);
      break;
    case "Stop":
      await handleStop(input);
      break;
    case "PostCompact":
      await handlePostCompact(input);
      break;
    case "SessionEnd":
      await handleSessionEnd(input);
      break;
    default:
      console.error(`Unknown hook type: ${hookType}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[keddy] Handler error:", err);
  process.exit(1);
});
