import { initDb, closeDb, getDb } from "../db/index.js";
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
  getProjectContextForSessionStart,
} from "../db/queries.js";
import { parseTranscript, parseLatestExchanges } from "./parser.js";
import { extractPlans } from "./plans.js";
import { extractSegments } from "./segments.js";
import { extractMilestones } from "./milestones.js";
import { deriveTitle } from "./titles.js";

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

    // Build project context for Claude
    const ctx = getProjectContextForSessionStart(input.cwd!);
    const parts: string[] = [`[Keddy] ${ctx.sessionCount} sessions tracked.`];

    if (ctx.activePlan) {
      const firstLine = ctx.activePlan.excerpt
        .split("\n")
        .find((l: string) => l.trim().length > 3 && !l.trim().startsWith("#"))
        ?.trim() || "";
      const planLine = firstLine.length > 60 ? firstLine.substring(0, 60) + "..." : firstLine;
      parts.push(`Active plan v${ctx.activePlan.version} (${ctx.activePlan.status}): ${planLine}`);
    }

    if (ctx.pendingTasks.length > 0) {
      parts.push(`Remaining tasks: ${ctx.pendingTasks.join(", ")}`);
    }

    if (ctx.lastMilestone) {
      parts.push(`Last: ${ctx.lastMilestone}`);
    }

    if (ctx.activePlan || ctx.lastMilestone) {
      parts.push("Use keddy_project_status or keddy_continue_plan for full details.");
    }

    const context = {
      additionalContext: parts.join(" | "),
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

    // Extract plans from new exchanges in real-time (so plan cards appear mid-session)
    const hasPlanTools = latestExchanges.some((ex) =>
      ex.tool_calls.some((tc) => tc.name === "EnterPlanMode" || tc.name === "ExitPlanMode"),
    );
    if (hasPlanTools) {
      // Re-extract plans from ALL exchanges (plan status depends on full context)
      const allExchanges = getSessionExchanges(sessionRow.id);
      const parsedForPlans = allExchanges.map((e: any) => {
        const db = getDb();
        const tcs = db
          .prepare("SELECT tool_name as name, tool_input as input, tool_result as result, tool_use_id as id, is_error FROM tool_calls WHERE exchange_id = ?")
          .all(e.id)
          .map((tc: any) => ({
            ...tc,
            input: tc.input ? (() => { try { return JSON.parse(tc.input); } catch { return {}; } })() : {},
            is_error: !!tc.is_error,
          }));
        return {
          index: e.exchange_index,
          user_prompt: e.user_prompt,
          assistant_response: e.assistant_response,
          tool_calls: tcs,
          timestamp: e.timestamp,
          is_interrupt: !!e.is_interrupt,
          is_compact_summary: !!e.is_compact_summary,
        };
      });
      const plans = extractPlans(parsedForPlans);
      // Clear old plans and re-insert (status inference depends on full sequence)
      const db = getDb();
      db.prepare("DELETE FROM plans WHERE session_id = ?").run(sessionRow.id);
      for (const plan of plans) {
        insertPlan({
          session_id: sessionRow.id,
          version: plan.version,
          plan_text: plan.plan_text,
          status: plan.status,
          user_feedback: plan.user_feedback,
          exchange_index_start: plan.exchange_index_start,
          exchange_index_end: plan.exchange_index_end,
        });
      }
    }

    // Extract milestones and tasks from new exchanges in real-time
    // (so commits, test results, and tasks appear mid-session)
    if (latestExchanges.length > 0) {
      const newMilestones = extractMilestones(latestExchanges);
      for (const milestone of newMilestones) {
        insertMilestone({
          session_id: sessionRow.id,
          milestone_type: milestone.milestone_type,
          exchange_index: milestone.exchange_index,
          description: milestone.description,
          metadata: milestone.metadata ? JSON.stringify(milestone.metadata) : null,
        });
      }

      // Extract tasks from new exchanges
      const hasTaskTools = latestExchanges.some((ex) =>
        ex.tool_calls.some((tc) => tc.name === "TaskCreate" || tc.name === "TaskUpdate" || tc.name === "TaskStop"),
      );
      if (hasTaskTools) {
        const { extractTasks } = await import("./tasks.js");
        const { insertTask } = await import("../db/queries.js");
        // Re-extract all tasks (status updates depend on full sequence)
        const allExchanges = getSessionExchanges(sessionRow.id);
        const parsedForTasks = allExchanges.map((e: any) => {
          const db = getDb();
          const tcs = db
            .prepare("SELECT tool_name as name, tool_input as input, tool_result as result, tool_use_id as id, is_error FROM tool_calls WHERE exchange_id = ?")
            .all(e.id)
            .map((tc: any) => ({
              ...tc,
              input: tc.input ? (() => { try { return JSON.parse(tc.input); } catch { return {}; } })() : {},
              is_error: !!tc.is_error,
            }));
          return {
            index: e.exchange_index,
            user_prompt: e.user_prompt,
            assistant_response: e.assistant_response,
            tool_calls: tcs,
            timestamp: e.timestamp,
            is_interrupt: !!e.is_interrupt,
            is_compact_summary: !!e.is_compact_summary,
          };
        });
        const tasks = extractTasks(parsedForTasks);
        const db = getDb();
        db.prepare("DELETE FROM tasks WHERE session_id = ?").run(sessionRow.id);
        for (const task of tasks) {
          insertTask({
            session_id: sessionRow.id,
            task_index: parseInt(task.id),
            subject: task.subject,
            description: task.description,
            status: task.status,
            exchange_index_created: task.exchange_index_created,
            exchange_index_completed: task.exchange_index_completed,
          });
        }
      }
    }

    // Update session timestamp, title, and metadata on every Stop call
    // so the dashboard shows current activity
    const lastExchange = latestExchanges[latestExchanges.length - 1];
    if (lastExchange) {
      const db = getDb();
      // Set title from first real user prompt if not already set
      const currentTitle = db.prepare("SELECT title FROM sessions WHERE id = ?").get(sessionRow.id) as { title: string | null } | undefined;
      if (!currentTitle?.title) {
        const allExchanges = getSessionExchanges(sessionRow.id);
        const title = deriveTitle(allExchanges.map(e => ({ user_prompt: e.user_prompt })));
        if (title) {
          db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionRow.id);
        }
      }
      db.prepare(`
        UPDATE sessions SET
          ended_at = COALESCE(?, ended_at),
          exchange_count = (SELECT COUNT(*) FROM exchanges WHERE session_id = ?)
        WHERE id = ?
      `).run(lastExchange.timestamp || new Date().toISOString(), sessionRow.id, sessionRow.id);
    }

    // Update git branch and forkedFrom from JSONL entries
    try {
      const fs = await import("node:fs");
      const stat = fs.statSync(input.transcript_path);

      // Read tail for latest git branch (branch can change mid-session)
      const readSize = Math.min(stat.size, 4096);
      const buf = Buffer.alloc(readSize);
      const fd = fs.openSync(input.transcript_path, "r");
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      fs.closeSync(fd);
      const tail = buf.toString("utf8");
      const matches = [...tail.matchAll(/"gitBranch"\s*:\s*"([^"]+)"/g)];
      if (matches.length > 0) {
        const latestBranch = matches[matches.length - 1][1];
        const db = getDb();
        db.prepare("UPDATE sessions SET git_branch = ? WHERE id = ?").run(latestBranch, sessionRow.id);
      }

      // Read head for forkedFrom (only present in branched/forked sessions)
      if (!sessionRow.forked_from) {
        const headSize = Math.min(stat.size, 2048);
        const headBuf = Buffer.alloc(headSize);
        const fd2 = fs.openSync(input.transcript_path, "r");
        fs.readSync(fd2, headBuf, 0, headSize, 0);
        fs.closeSync(fd2);
        const head = headBuf.toString("utf8");
        const forkMatch = head.match(/"forkedFrom"\s*:\s*(\{[^}]+\})/);
        if (forkMatch) {
          const db = getDb();
          db.prepare("UPDATE sessions SET forked_from = ? WHERE id = ?").run(forkMatch[1], sessionRow.id);
        }
      }
    } catch {
      // Non-critical
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

    // Store the compaction analysis from the hook
    // The continuation context (isCompactSummary) will be added later by the parser
    insertCompactionEvent({
      session_id: session.id,
      exchange_index: session.exchange_count,
      analysis_summary: input.compact_summary ?? null,
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
        title: deriveTitle(transcript.exchanges) ?? null,
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

    // Clear previous analysis (SessionEnd does a full re-parse, so old data should be replaced)
    const db = getDb();
    db.prepare("DELETE FROM segments WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM milestones WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM plans WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM compaction_events WHERE session_id = ?").run(session.id);
    // Update forked_from if parser found it (branches set this on every JSONL entry)
    if (transcript.forked_from) {
      db.prepare("UPDATE sessions SET forked_from = ? WHERE id = ?").run(
        transcript.forked_from,
        session.id,
      );
    }

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

    // Update title with enriched context (plans + milestones now available)
    const enrichedTitle = deriveTitle(
      transcript.exchanges.map((e) => ({ user_prompt: e.user_prompt })),
      { plans, milestones },
    );
    if (enrichedTitle) {
      db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(enrichedTitle, session.id);
    }

    // Compaction events from transcript (previous events were cleared above)
    for (const compaction of transcript.compactions) {
      insertCompactionEvent({
        session_id: session.id,
        exchange_index: compaction.exchange_index,
        summary: compaction.summary,
        pre_tokens: compaction.pre_tokens,
      });
    }

    // Extract and store tasks
    const { extractTasks } = await import("./tasks.js");
    const { insertTask } = await import("../db/queries.js");
    const tasks = extractTasks(transcript.exchanges);
    for (const task of tasks) {
      insertTask({
        session_id: session.id,
        task_index: parseInt(task.id),
        subject: task.subject,
        description: task.description,
        status: task.status,
        exchange_index_created: task.exchange_index_created,
        exchange_index_completed: task.exchange_index_completed,
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
