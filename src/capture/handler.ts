import { initDb, closeDb, getDb } from "../db/index.js";
import {
  upsertSession,
  updateSessionEnd,
  insertExchange,
  insertToolCall,
  extractToolCallFields,
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
import { extractActivityGroups, deriveDisplayType } from "./activity-groups.js";
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
    const db = getDb();
    const parts: string[] = [`[Keddy] ${ctx.sessionCount} sessions tracked.`];

    // Last session's final 3 user prompts — what was being worked on
    try {
      const lastPrompts = db.prepare(`
        SELECT e.user_prompt FROM exchanges e
        JOIN sessions s ON s.id = e.session_id
        WHERE s.project_path = ? AND s.exchange_count > 0 AND s.session_id != ?
        ORDER BY s.started_at DESC, e.exchange_index DESC LIMIT 3
      `).all(input.cwd, input.session_id) as Array<{ user_prompt: string }>;
      if (lastPrompts.length > 0) {
        const prompts = lastPrompts.reverse().map((p) => {
          const line = p.user_prompt.split("\n")[0].trim().substring(0, 80);
          return `"${line}"`;
        });
        parts.push(`Last session ended with: ${prompts.join(" → ")}`);
      }
    } catch { /* non-critical */ }

    // Active plan — full text (not just 200-char excerpt)
    if (ctx.activePlan) {
      try {
        const fullPlan = db.prepare(`
          SELECT p.plan_text FROM plans p WHERE p.session_id = ?
          ORDER BY p.version DESC LIMIT 1
        `).get(ctx.activePlan.sessionId) as { plan_text: string } | undefined;
        if (fullPlan) {
          parts.push(`Active plan v${ctx.activePlan.version} (${ctx.activePlan.status}):\n${fullPlan.plan_text}`);
        }
      } catch {
        parts.push(`Active plan v${ctx.activePlan.version} (${ctx.activePlan.status}): ${ctx.activePlan.excerpt}`);
      }
    }

    if (ctx.pendingTasks.length > 0) {
      parts.push(`Remaining tasks: ${ctx.pendingTasks.join(", ")}`);
    }

    if (ctx.lastMilestone) {
      parts.push(`Last milestone: ${ctx.lastMilestone}`);
    }

    // Latest session note summary (if one was generated)
    try {
      const latestNote = db.prepare(`
        SELECT sn.content FROM session_notes sn
        JOIN sessions s ON s.id = sn.session_id
        WHERE s.project_path = ?
        ORDER BY sn.generated_at DESC LIMIT 1
      `).get(input.cwd) as { content: string } | undefined;
      if (latestNote) {
        parts.push(`Latest analysis: ${latestNote.content.substring(0, 500)}`);
      }
    } catch { /* non-critical — table may not exist yet */ }

    parts.push("Use keddy_project_status for full project context, or keddy_get_session_skeleton to inspect a specific session.");

    const context = {
      additionalContext: parts.join("\n"),
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
    // Re-process the last 3 exchanges to catch content_blocks that were partially
    // captured due to JSONL flush timing. The parser always reads the full JSONL —
    // sinceIndex only controls which parsed exchanges we UPDATE in the DB.
    // The length > SQL guard prevents regression of already-good data.
    const sinceIndex = Math.max(0, existingExchanges.length - 3);

    const latestExchanges = parseLatestExchanges(
      input.transcript_path,
      sinceIndex,
    );

    const db = getDb();
    for (const exchange of latestExchanges) {
      // Check if this exchange already exists in DB
      const existing = existingExchanges.find((e: any) => e.exchange_index === exchange.index);

      if (existing) {
        // UPDATE existing exchange with more complete data from parser.
        // The parser reads the append-only JSONL, so its output is always >= previous parse.
        // Use ?? to preserve empty strings (valid: means no post-tool text) while
        // falling back only when the parser returns null/undefined.
        const safeResponse = exchange.assistant_response ?? (existing as any).assistant_response ?? "";
        const safeResponsePre = exchange.assistant_response_pre ?? (existing as any).assistant_response_pre ?? "";
        const safeToolCount = exchange.tool_calls.length;
        const contentBlocksJson = exchange.content_blocks ? JSON.stringify(exchange.content_blocks) : null;
        db.prepare(`
          UPDATE exchanges SET
            assistant_response = ?,
            assistant_response_pre = ?,
            tool_call_count = ?,
            content_blocks = CASE
              WHEN ? IS NOT NULL AND (content_blocks IS NULL OR length(?) > length(content_blocks))
              THEN ? ELSE content_blocks END,
            model = COALESCE(?, model),
            input_tokens = COALESCE(?, input_tokens),
            output_tokens = COALESCE(?, output_tokens),
            cache_read_tokens = COALESCE(?, cache_read_tokens),
            cache_write_tokens = COALESCE(?, cache_write_tokens),
            stop_reason = COALESCE(?, stop_reason),
            has_thinking = COALESCE(?, has_thinking),
            turn_duration_ms = COALESCE(?, turn_duration_ms)
          WHERE id = ?
        `).run(
          safeResponse,
          safeResponsePre,
          safeToolCount,
          contentBlocksJson,
          contentBlocksJson,
          contentBlocksJson,
          exchange.model,
          exchange.input_tokens,
          exchange.output_tokens,
          exchange.cache_read_tokens,
          exchange.cache_write_tokens,
          exchange.stop_reason,
          exchange.has_thinking || null,
          exchange.turn_duration_ms,
          existing.id,
        );

        // Re-insert tool calls (parser has the complete set with results)
        // Only delete+re-insert if parser found tool calls — don't wipe existing data
        if (exchange.tool_calls.length > 0) {
        db.prepare("DELETE FROM tool_calls WHERE exchange_id = ?").run(existing.id);
        }
        for (const tc of exchange.tool_calls) {
          const enriched = extractToolCallFields(tc.name, tc.input);
          insertToolCall({
            exchange_id: existing.id,
            session_id: sessionRow.id,
            tool_name: tc.name,
            tool_input: JSON.stringify(tc.input),
            tool_result: tc.result ?? null,
            tool_use_id: tc.id,
            is_error: tc.is_error ?? false,
            ...enriched,
          });
        }
      } else {
        // INSERT new exchange
        const exchangeId = insertExchange({
          session_id: sessionRow.id,
          exchange_index: exchange.index,
          user_prompt: exchange.user_prompt,
          assistant_response: exchange.assistant_response,
          assistant_response_pre: exchange.assistant_response_pre,
          tool_call_count: exchange.tool_calls.length,
          timestamp: exchange.timestamp,
          is_interrupt: exchange.is_interrupt,
          is_compact_summary: exchange.is_compact_summary,
          model: exchange.model,
          input_tokens: exchange.input_tokens,
          output_tokens: exchange.output_tokens,
          cache_read_tokens: exchange.cache_read_tokens,
          cache_write_tokens: exchange.cache_write_tokens,
          stop_reason: exchange.stop_reason,
          has_thinking: exchange.has_thinking,
          permission_mode: exchange.permission_mode,
          is_sidechain: exchange.is_sidechain,
          entrypoint: exchange.entrypoint,
          cwd: exchange.cwd,
          git_branch: exchange.git_branch,
          turn_duration_ms: exchange.turn_duration_ms,
          content_blocks: exchange.content_blocks ? JSON.stringify(exchange.content_blocks) : null,
        });

        for (const tc of exchange.tool_calls) {
          const enriched = extractToolCallFields(tc.name, tc.input);
          insertToolCall({
            exchange_id: exchangeId,
            session_id: sessionRow.id,
            tool_name: tc.name,
            tool_input: JSON.stringify(tc.input),
            tool_result: tc.result ?? null,
            tool_use_id: tc.id,
            is_error: tc.is_error ?? false,
            ...enriched,
          });
        }
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

      // Check JSONL tail for custom-title (from /rename or auto-rename after plan mode)
      // This is the highest priority title source — always overwrite
      let customTitle: string | null = null;
      try {
        const fs2 = await import("node:fs");
        const stat2 = fs2.statSync(input.transcript_path);
        const tailSize = Math.min(stat2.size, 8192);
        const tailBuf = Buffer.alloc(tailSize);
        const fd2 = fs2.openSync(input.transcript_path, "r");
        fs2.readSync(fd2, tailBuf, 0, tailSize, stat2.size - tailSize);
        fs2.closeSync(fd2);
        const tailText = tailBuf.toString("utf8");
        const titleMatches = [...tailText.matchAll(/"customTitle"\s*:\s*"([^"]+)"/g)];
        if (titleMatches.length > 0) {
          customTitle = titleMatches[titleMatches.length - 1][1];
          // Skip auto-generated fork/branch titles (truncated parent prompts ending with "(Branch)" etc.)
          if (customTitle.length > 60 && /\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/.test(customTitle)) {
            customTitle = null;
          }
        }
      } catch { /* non-critical */ }

      if (customTitle) {
        // Custom title from Claude Code — always takes priority
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(customTitle, sessionRow.id);
      } else if (sessionRow.forked_from) {
        // Forked session: if current title is still the auto-generated fork/branch title, fix it
        const currentTitle = db.prepare("SELECT title, fork_exchange_index FROM sessions WHERE id = ?").get(sessionRow.id) as { title: string | null; fork_exchange_index: number | null } | undefined;
        if (currentTitle?.title && currentTitle.fork_exchange_index != null
          && /\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/.test(currentTitle.title)) {
          const allExchanges = getSessionExchanges(sessionRow.id);
          const title = deriveTitle(
            allExchanges.map(e => ({ user_prompt: e.user_prompt })),
            { forkExchangeIndex: currentTitle.fork_exchange_index },
          );
          if (title) {
            db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionRow.id);
          }
        }
      } else {
        // Non-forked: derive title from first real user prompt if not already set
        const currentTitle = db.prepare("SELECT title FROM sessions WHERE id = ?").get(sessionRow.id) as { title: string | null } | undefined;
        if (!currentTitle?.title) {
          const allExchanges = getSessionExchanges(sessionRow.id);
          const title = deriveTitle(allExchanges.map(e => ({ user_prompt: e.user_prompt })));
          if (title) {
            db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionRow.id);
          }
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

      // Read first JSONL line for forkedFrom (only present in branched/forked sessions).
      // The first line can be very large (100KB+) because branched sessions embed
      // the parent's conversation context. Read up to 1MB to cover any parent size.
      if (!sessionRow.forked_from) {
        const maxRead = Math.min(stat.size, 1_048_576);
        const headBuf = Buffer.alloc(maxRead);
        const fd2 = fs.openSync(input.transcript_path, "r");
        fs.readSync(fd2, headBuf, 0, maxRead, 0);
        fs.closeSync(fd2);
        const head = headBuf.toString("utf8");
        const firstLine = head.indexOf("\n") > 0 ? head.substring(0, head.indexOf("\n")) : head;
        const forkMatch = firstLine.match(/"forkedFrom"\s*:\s*(\{[^}]+\})/);
        if (forkMatch) {
          const db = getDb();
          db.prepare("UPDATE sessions SET forked_from = ? WHERE id = ?").run(forkMatch[1], sessionRow.id);

          // Detect fork_exchange_index + re-derive title + create session link
          try {
            const forkData = JSON.parse(forkMatch[1]);
            if (forkData.sessionId) {
              const parentSession = getSession(forkData.sessionId);
              if (parentSession) {
                // Find fork point: first exchange where child differs from parent
                const divergence = db.prepare(`
                  SELECT b.exchange_index
                  FROM exchanges b
                  LEFT JOIN exchanges p ON p.exchange_index = b.exchange_index AND p.session_id = ?
                  WHERE b.session_id = ?
                  AND (p.id IS NULL OR p.user_prompt != b.user_prompt)
                  ORDER BY b.exchange_index LIMIT 1
                `).get(parentSession.id, sessionRow.id) as { exchange_index: number } | undefined;

                if (divergence) {
                  db.prepare("UPDATE sessions SET fork_exchange_index = ? WHERE id = ?")
                    .run(divergence.exchange_index, sessionRow.id);

                  // Re-derive title with fork awareness
                  const allExchanges = getSessionExchanges(sessionRow.id);
                  const title = deriveTitle(
                    allExchanges.map(e => ({ user_prompt: e.user_prompt })),
                    { forkExchangeIndex: divergence.exchange_index },
                  );
                  if (title) {
                    db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionRow.id);
                  }
                }

                // Create fork session link (bidirectional navigation)
                const existingLink = db.prepare(
                  "SELECT id FROM session_links WHERE source_session_id = ? AND target_session_id = ? AND link_type = 'fork'",
                ).get(sessionRow.id, parentSession.id);
                if (!existingLink) {
                  insertSessionLink({
                    source_session_id: sessionRow.id,
                    target_session_id: parentSession.id,
                    link_type: "fork",
                    shared_files: "[]",
                  });
                }
              }
            }
          } catch { /* non-critical — SessionEnd handles as fallback */ }
        }
      }
    } catch {
      // Non-critical
    }

    // Delayed re-parse: the JSONL may not be fully flushed to disk when the Stop
    // hook fires. Wait 1.5s and re-parse to catch any late-flushed entries.
    // Only updates content_blocks (text/tool ordering) — the most timing-sensitive field.
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          const freshExchanges = parseLatestExchanges(input.transcript_path, sinceIndex);
          const db2 = getDb();
          for (const exchange of freshExchanges) {
            const contentBlocksJson = exchange.content_blocks ? JSON.stringify(exchange.content_blocks) : null;
            if (!contentBlocksJson) continue;
            db2.prepare(`
              UPDATE exchanges SET
                content_blocks = CASE
                  WHEN ? IS NOT NULL AND (content_blocks IS NULL OR length(?) > length(content_blocks))
                  THEN ? ELSE content_blocks END
              WHERE session_id = ? AND exchange_index = ?
            `).run(contentBlocksJson, contentBlocksJson, contentBlocksJson, sessionRow.id, exchange.index);
          }
        } catch { /* non-critical — SessionEnd handles full re-parse */ }
        resolve();
      }, 1500);
    });
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

    // Skip Agent SDK sessions (spawned by Keddy's notes generator)
    if (transcript.exchanges.length > 0) {
      const firstPrompt = transcript.exchanges[0].user_prompt || "";
      if (
        firstPrompt.startsWith("Analyze the coding session with session_id") ||
        firstPrompt.startsWith("Here is the complete session data")
      ) {
        return;
      }
    }

    // Update session metadata
    if (transcript.git_branch || transcript.claude_version || transcript.slug) {
      upsertSession({
        session_id: input.session_id,
        project_path: transcript.project_path || input.cwd || "",
        git_branch: transcript.git_branch,
        claude_version: transcript.claude_version,
        slug: transcript.slug,
        forked_from: transcript.forked_from,
        fork_exchange_index: transcript.fork_exchange_index,
        title: transcript.custom_title || deriveTitle(transcript.exchanges, { forkExchangeIndex: transcript.fork_exchange_index }) || null,
      });
    }

    // Clear ALL previous data — SessionEnd does a full re-parse from JSONL (source of truth).
    // Must replace whatever the Stop hook wrote, not skip it via idempotent insertExchange.
    const db = getDb();
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM exchanges WHERE session_id = ?").run(session.id);

    // Store all exchanges
    for (const exchange of transcript.exchanges) {
      const exchangeId = insertExchange({
        session_id: session.id,
        exchange_index: exchange.index,
        user_prompt: exchange.user_prompt,
        assistant_response: exchange.assistant_response,
        assistant_response_pre: exchange.assistant_response_pre,
        tool_call_count: exchange.tool_calls.length,
        timestamp: exchange.timestamp,
        is_interrupt: exchange.is_interrupt,
        is_compact_summary: exchange.is_compact_summary,
        model: exchange.model,
        input_tokens: exchange.input_tokens,
        output_tokens: exchange.output_tokens,
        cache_read_tokens: exchange.cache_read_tokens,
        cache_write_tokens: exchange.cache_write_tokens,
        stop_reason: exchange.stop_reason,
        has_thinking: exchange.has_thinking,
        permission_mode: exchange.permission_mode,
        is_sidechain: exchange.is_sidechain,
        entrypoint: exchange.entrypoint,
        cwd: exchange.cwd,
        git_branch: exchange.git_branch,
        turn_duration_ms: exchange.turn_duration_ms,
        content_blocks: exchange.content_blocks ? JSON.stringify(exchange.content_blocks) : null,
      });

      for (const tc of exchange.tool_calls) {
        const enriched = extractToolCallFields(tc.name, tc.input);
        insertToolCall({
          exchange_id: exchangeId,
          session_id: session.id,
          tool_name: tc.name,
          tool_input: JSON.stringify(tc.input),
          tool_result: tc.result ?? null,
          tool_use_id: tc.id,
          is_error: tc.is_error ?? false,
          ...enriched,
        });
      }
    }

    // Mark session ended
    updateSessionEnd(input.session_id, transcript.exchanges.length, transcript.ended_at ?? undefined);

    // Clear previous analysis (SessionEnd does a full re-parse, so old data should be replaced)
    db.prepare("DELETE FROM segments WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM milestones WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM plans WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM compaction_events WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM tasks WHERE session_id = ?").run(session.id);
    // Update fork metadata if parser found it
    if (transcript.forked_from) {
      db.prepare("UPDATE sessions SET forked_from = ?, fork_exchange_index = COALESCE(?, fork_exchange_index) WHERE id = ?").run(
        transcript.forked_from,
        transcript.fork_exchange_index,
        session.id,
      );

      // Create "fork" session link for bidirectional navigation
      try {
        const forkData = JSON.parse(transcript.forked_from);
        if (forkData.sessionId) {
          const parentSession = getSession(forkData.sessionId);
          if (parentSession) {
            // Check if link already exists
            const existingLink = db.prepare(
              "SELECT id FROM session_links WHERE source_session_id = ? AND target_session_id = ? AND link_type = 'fork'",
            ).get(session.id, parentSession.id);
            if (!existingLink) {
              insertSessionLink({
                source_session_id: session.id,
                target_session_id: parentSession.id,
                link_type: "fork",
                shared_files: "[]",
              });
            }
          }
        }
      } catch { /* invalid forked_from JSON — non-critical */ }
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

    const milestones = extractMilestones(transcript.exchanges);

    // Git-detection from reflog/log is disabled — it produced false positives from
    // stash entries (git log --all includes refs/stash) and cross-session attribution
    // (pushes from overlapping sessions within the same time window).
    // Tool-call-based extractMilestones() is reliable: correct exchange_index,
    // no cross-session issues, and covers all git operations done through Claude.

    for (const milestone of milestones) {
      insertMilestone({
        session_id: session.id,
        milestone_type: milestone.milestone_type,
        exchange_index: milestone.exchange_index,
        description: milestone.description,
        metadata: milestone.metadata ? JSON.stringify(milestone.metadata) : null,
      });
    }

    // Activity groups (boundary-based, replaces heuristic segments)
    const activityGroups = extractActivityGroups(transcript.exchanges, allMilestones);
    for (const group of activityGroups) {
      const allFiles = [...new Set([...group.files_read, ...group.files_written])];
      insertSegment({
        session_id: session.id,
        segment_type: deriveDisplayType(group),
        exchange_index_start: group.exchange_index_start,
        exchange_index_end: group.exchange_index_end,
        files_touched: JSON.stringify(allFiles),
        tool_counts: JSON.stringify(group.tool_counts),
        boundary_type: group.boundary,
        files_read: JSON.stringify(group.files_read),
        files_written: JSON.stringify(group.files_written),
        error_count: group.error_count,
        total_input_tokens: group.total_input_tokens,
        total_output_tokens: group.total_output_tokens,
        total_cache_read_tokens: group.total_cache_read_tokens,
        total_cache_write_tokens: group.total_cache_write_tokens,
        duration_ms: group.duration_ms,
        models: JSON.stringify(group.models),
        markers: JSON.stringify(group.markers),
        exchange_count: group.exchange_count,
        started_at: group.started_at,
        ended_at: group.ended_at,
      });
    }

    // Update title: custom_title > enriched derive (with plans/milestones) > first prompt
    if (transcript.custom_title) {
      db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(transcript.custom_title, session.id);
    } else {
      const enrichedTitle = deriveTitle(
        transcript.exchanges.map((e) => ({ user_prompt: e.user_prompt })),
        { plans, milestones: allMilestones, forkExchangeIndex: transcript.fork_exchange_index },
      );
      if (enrichedTitle) {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(enrichedTitle, session.id);
      }
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

    // Update session entrypoint
    if (transcript.entrypoint) {
      db.prepare("UPDATE sessions SET entrypoint = COALESCE(entrypoint, ?) WHERE id = ?")
        .run(transcript.entrypoint, session.id);
    }

    // Detect session links (shared files with recent sessions)
    const filesTouched = new Set<string>();
    for (const group of activityGroups) {
      for (const f of group.files_read) filesTouched.add(f);
      for (const f of group.files_written) filesTouched.add(f);
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

/**
 * Resolve the true session ID.
 * For forked sessions, Claude Code sends the PARENT's sessionId in hook stdin,
 * but the transcript filename contains the fork's own UUID. The filename is
 * the canonical identity, so prefer it when available.
 */
function resolveSessionId(input: HookStdin): string | undefined {
  if (input.transcript_path) {
    const filename = input.transcript_path.split("/").pop()?.replace(".jsonl", "") || "";
    if (filename && /^[0-9a-f]{8}-/.test(filename)) {
      return filename;
    }
  }
  return input.session_id;
}

// Main entry point
async function main(): Promise<void> {
  const hookType = process.argv[2];
  if (!hookType) {
    console.error("Usage: handler.js <SessionStart|Stop|PostCompact|SessionEnd>");
    process.exit(1);
  }

  const input = await readStdin();

  // Resolve fork session IDs: use filename UUID over hook-provided sessionId
  const resolvedId = resolveSessionId(input);
  if (resolvedId && resolvedId !== input.session_id) {
    input.session_id = resolvedId;
  }

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
