import { Hono } from "hono";
import { extractActivityGroups, deriveDisplayType } from "../../capture/activity-groups.js";
import { extractMilestones } from "../../capture/milestones.js";
import { extractPlans } from "../../capture/plans.js";
import { parseLatestExchanges } from "../../capture/parser.js";
import {
  searchSessions,
  getRecentSessions,
  getSession,
  getSessionById,
  getSessionExchanges,
  getSessionSegments,
  getSessionMilestones,
  getSessionCompactionEvents,
  getSessionPlans,
  insertExchange,
  insertToolCall,
  insertMilestone,
  insertPlan,
  insertTask,
  extractToolCallFields,
} from "../../db/queries.js";
import { getDb } from "../../db/index.js";

function extractPlanTitle(planText: string): string | null {
  if (!planText) return null;
  // Try markdown heading first
  for (const line of planText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      let title = trimmed.replace(/^#+\s*/, "");
      title = title.replace(/^Plan:\s*/i, "");
      return title || null;
    }
  }
  // Fallback: first non-empty, non-bullet line
  for (const line of planText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
      return trimmed.length > 60 ? trimmed.substring(0, 60) : trimmed;
    }
  }
  // Last resort: first bullet content
  for (const line of planText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      const content = trimmed.replace(/^[-*]\s*/, "");
      return content.length > 60 ? content.substring(0, 60) : content;
    }
  }
  return null;
}

/** Compute outcomes from milestones — shared between list and detail endpoints */
function computeOutcomes(milestones: Array<{ milestone_type: string; exchange_index: number }>) {
  const gitOps: Array<{ type: "push" | "pull"; idx: number }> = [];
  for (const m of milestones) {
    if (m.milestone_type === "push") gitOps.push({ type: "push", idx: m.exchange_index });
    if (m.milestone_type === "pull") gitOps.push({ type: "pull", idx: m.exchange_index });
  }
  const dedupedOps: Array<"push" | "pull"> = [];
  for (const op of gitOps) {
    if (dedupedOps[dedupedOps.length - 1] !== op.type) dedupedOps.push(op.type);
  }
  return {
    has_commits: milestones.some((m) => m.milestone_type === "commit"),
    git_ops: dedupedOps,
    has_pr: milestones.some((m) => m.milestone_type === "pr"),
  };
}

/** Parse git details from tool_calls for commit/push milestones */
function extractGitDetails(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  milestones: Array<{ milestone_type: string; exchange_index: number; description: string; metadata: string | null }>,
): Array<{
  type: string; exchange_index: number; timestamp: string; description: string;
  files?: string[]; stats?: { files_changed: number; insertions: number; deletions: number };
  hash?: string; push_range?: string; push_branch?: string;
}> {
  const gitTypes = new Set(["commit", "push", "pull", "pr", "branch"]);
  const gitMilestones = milestones.filter((m) => gitTypes.has(m.milestone_type) && m.exchange_index >= 0);
  if (gitMilestones.length === 0) return [];

  const details: Array<any> = [];
  const exchangeIndices = [...new Set(gitMilestones.map((m) => m.exchange_index))];

  // Batch query: get all git-related bash commands for these exchanges
  const placeholders = exchangeIndices.map(() => "?").join(",");
  const gitCalls = db.prepare(`
    SELECT tc.bash_command, tc.tool_result, e.exchange_index, e.timestamp
    FROM tool_calls tc
    JOIN exchanges e ON tc.exchange_id = e.id
    WHERE e.session_id = ? AND e.exchange_index IN (${placeholders})
    AND tc.tool_name = 'Bash'
    AND (tc.bash_command LIKE '%git commit%' OR tc.bash_command LIKE '%git add%'
      OR tc.bash_command LIKE '%git push%' OR tc.bash_command LIKE '%git pull%'
      OR tc.bash_command LIKE '%gh pr create%')
    ORDER BY tc.rowid
  `).all(sessionId, ...exchangeIndices) as any[];

  // Build lookup: exchange_index → git calls
  const callsByExchange = new Map<number, any[]>();
  for (const call of gitCalls) {
    if (!callsByExchange.has(call.exchange_index)) callsByExchange.set(call.exchange_index, []);
    callsByExchange.get(call.exchange_index)!.push(call);
  }

  for (const m of gitMilestones) {
    const calls = callsByExchange.get(m.exchange_index) || [];
    const timestamp = calls[0]?.timestamp || "";
    const detail: any = {
      type: m.milestone_type,
      exchange_index: m.exchange_index,
      timestamp,
      description: m.description,
    };

    if (m.milestone_type === "commit") {
      // Parse files from git add command
      const addCall = calls.find((c: any) => c.bash_command?.startsWith("git add "));
      if (addCall) {
        const filesStr = addCall.bash_command.replace(/^git add\s+/, "").split(/\s*&&\s*/)[0];
        detail.files = filesStr.split(/\s+/).filter((f: string) => f && !f.startsWith("-"));
      }
      // Parse stats and hash from commit result
      for (const call of calls) {
        if (!call.tool_result) continue;
        const statsMatch = call.tool_result.match(/(\d+) files? changed(?:,\s*(\d+) insertions?\(\+\))?(?:,\s*(\d+) deletions?\(-\))?/);
        if (statsMatch) {
          detail.stats = {
            files_changed: parseInt(statsMatch[1]) || 0,
            insertions: parseInt(statsMatch[2]) || 0,
            deletions: parseInt(statsMatch[3]) || 0,
          };
        }
        const hashMatch = call.tool_result.match(/\[[\w\/-]+\s+([a-f0-9]{7,})\]/);
        if (hashMatch) detail.hash = hashMatch[1];
      }
    }

    if (m.milestone_type === "push") {
      for (const call of calls) {
        if (!call.tool_result) continue;
        // Parse: "oldsha..newsha  branch -> branch"
        const rangeMatch = call.tool_result.match(/([a-f0-9]{7,})\.\.([a-f0-9]{7,})\s+(\S+)\s+->\s+(\S+)/);
        if (rangeMatch) {
          detail.push_range = `${rangeMatch[1]}..${rangeMatch[2]}`;
          detail.push_branch = rangeMatch[3];
        }
      }
    }

    details.push(detail);
  }

  return details;
}

export const sessionsRoutes = new Hono();

// GET /api/sessions — list, search, paginate
sessionsRoutes.get("/", (c) => {
  const query = c.req.query("q");
  const project = c.req.query("project");
  const parsedDays = parseInt(c.req.query("days") ?? "", 10);
  const parsedLimit = parseInt(c.req.query("limit") ?? "", 10);
  const daysVal = !isNaN(parsedDays) && parsedDays > 0 ? parsedDays : undefined;
  const limitVal = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;

  let sessions;
  if (query) {
    sessions = searchSessions(query, {
      project: project ?? undefined,
      days: daysVal,
      limit: limitVal,
    });
  } else {
    sessions = getRecentSessions(daysVal ?? 365, limitVal);
    // Apply project filter — match exact path, repo directory name, or worktree repo name
    if (project) {
      const repoName = project.split("/").pop() || project;
      // Also extract worktree repo name from filter path (e.g. .../worktrees/mano/branch → mano)
      const filterParts = project.split("/");
      const filterWtIdx = filterParts.indexOf("worktrees");
      const filterWtRepo = filterWtIdx >= 0 ? filterParts[filterWtIdx + 1] : null;

      sessions = sessions.filter((s) => {
        if (s.project_path === project) return true;
        // Match by repo directory name
        const sessionRepo = s.project_path.split("/").pop() || "";
        if (sessionRepo === repoName) return true;
        // Match session worktree repo name against filter repo name
        const parts = s.project_path.split("/");
        const wtIdx = parts.indexOf("worktrees");
        if (wtIdx >= 0 && parts[wtIdx + 1] === repoName) return true;
        // Match if filter is a worktree path — match its repo name against session repo name
        if (filterWtRepo && sessionRepo === filterWtRepo) return true;
        if (filterWtRepo && wtIdx >= 0 && parts[wtIdx + 1] === filterWtRepo) return true;
        return false;
      });
    }
  }

  // Filter out ghost sessions (SessionStart fired but no exchanges ever captured)
  sessions = sessions.filter((s) => s.exchange_count > 0);

  const db = getDb();

  // Sync custom titles from JSONL for recently modified sessions
  // This catches /rename and auto-rename without waiting for Stop hook
  try {
    const { existsSync, statSync, readFileSync } = require("node:fs");
    const now = Date.now();
    const RECENT_THRESHOLD = 10 * 60 * 1000; // 10 minutes
    for (const s of sessions) {
      if (!s.jsonl_path || !existsSync(s.jsonl_path)) continue;
      const mtime = statSync(s.jsonl_path).mtimeMs;
      if (now - mtime > RECENT_THRESHOLD) continue;
      // Scan file for custom-title entries (they're small, ~50 bytes each)
      const content = readFileSync(s.jsonl_path, "utf8");
      let customTitle: string | null = null;
      for (const line of content.split("\n")) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "custom-title" && entry.customTitle) {
            customTitle = entry.customTitle;
          }
        } catch { /* skip malformed lines */ }
      }
      if (customTitle && customTitle !== s.title) {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(customTitle, s.id);
        s.title = customTitle;
      }
    }
  } catch { /* non-critical */ }

  // Live-sync: for recently modified sessions, pull new exchanges from JSONL
  // so plans, milestones, and timestamps stay current even if the Stop hook lags
  try {
    const { existsSync, statSync } = require("node:fs");
    const now = Date.now();
    const LIVE_THRESHOLD = 15 * 60 * 1000; // 15 minutes
    for (const s of sessions) {
      if (!s.jsonl_path || !existsSync(s.jsonl_path)) continue;
      const mtime = statSync(s.jsonl_path).mtimeMs;
      if (now - mtime > LIVE_THRESHOLD) continue;

      // Check if DB is stale: JSONL modified after last known exchange
      const endedMs = s.ended_at ? new Date(s.ended_at).getTime() : 0;
      if (mtime - endedMs < 5000) continue; // close enough, skip

      // Parse new exchanges from JSONL
      const existingExchanges = getSessionExchanges(s.id);
      const sinceIndex = existingExchanges.length;
      let latestExchanges;
      try {
        latestExchanges = parseLatestExchanges(s.jsonl_path, sinceIndex);
      } catch { continue; }
      if (latestExchanges.length === 0) continue;

      // Insert new exchanges
      for (const exchange of latestExchanges) {
        const exchangeId = insertExchange({
          session_id: s.id,
          exchange_index: exchange.index,
          user_prompt: exchange.user_prompt,
          assistant_response: exchange.assistant_response,
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
        });
        for (const tc of exchange.tool_calls) {
          const enriched = extractToolCallFields(tc.name, tc.input);
          insertToolCall({
            exchange_id: exchangeId,
            session_id: s.id,
            tool_name: tc.name,
            tool_input: JSON.stringify(tc.input),
            tool_result: tc.result ?? null,
            tool_use_id: tc.id,
            is_error: tc.is_error ?? false,
            ...enriched,
          });
        }
      }

      // Extract milestones from new exchanges
      const newMilestones = extractMilestones(latestExchanges);
      for (const m of newMilestones) {
        insertMilestone({
          session_id: s.id,
          milestone_type: m.milestone_type,
          exchange_index: m.exchange_index,
          description: m.description,
          metadata: m.metadata ? JSON.stringify(m.metadata) : null,
        });
      }

      // Re-extract plans from ALL exchanges (status depends on full context)
      const hasPlanTools = latestExchanges.some((ex) =>
        ex.tool_calls.some((tc) => tc.name === "EnterPlanMode" || tc.name === "ExitPlanMode"),
      );
      if (hasPlanTools) {
        const allExchanges = getSessionExchanges(s.id);
        const parsedForPlans = allExchanges.map((e: any) => {
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
        db.prepare("DELETE FROM plans WHERE session_id = ?").run(s.id);
        for (const plan of plans) {
          insertPlan({
            session_id: s.id,
            version: plan.version,
            plan_text: plan.plan_text,
            status: plan.status,
            user_feedback: plan.user_feedback,
            exchange_index_start: plan.exchange_index_start,
            exchange_index_end: plan.exchange_index_end,
          });
        }
      }

      // Update session timestamp and exchange count
      const lastEx = latestExchanges[latestExchanges.length - 1];
      db.prepare(`
        UPDATE sessions SET
          ended_at = COALESCE(?, ended_at),
          exchange_count = (SELECT COUNT(*) FROM exchanges WHERE session_id = ?)
        WHERE id = ?
      `).run(lastEx.timestamp || new Date().toISOString(), s.id, s.id);
      s.ended_at = lastEx.timestamp || s.ended_at;
      s.exchange_count = existingExchanges.length + latestExchanges.length;
    }
  } catch { /* non-critical — live sync is best-effort */ }

  // Enrich with segment data + plans + AI status + fork info
  const enriched = sessions.map((s) => {
    const segments = getSessionSegments(s.id);
    const milestones = getSessionMilestones(s.id);
    const plans = getSessionPlans(s.id);
    const hasAiSummaries = segments.some((seg) => seg.summary);

    // Resolve parent session title and ID for forks
    let parentTitle: string | null = null;
    let parentSessionId: string | null = null;
    if (s.forked_from) {
      try {
        const forkData = JSON.parse(s.forked_from);
        if (forkData.sessionId) {
          parentSessionId = forkData.sessionId;
          const parent = db.prepare("SELECT title FROM sessions WHERE session_id = ?").get(forkData.sessionId) as { title: string | null } | undefined;
          parentTitle = parent?.title ?? null;
        }
      } catch { /* invalid JSON */ }
    }

    // For forked sessions, strip auto-generated "(Branch)"/"(Fork)" suffix
    const forkIdx = (s as any).fork_exchange_index ?? null;
    if (s.title && /\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/.test(s.title)) {
      s.title = s.title.replace(/\s*\S?\s*\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/, "").trim();
    }
    const ownMilestones = forkIdx != null
      ? milestones.filter((m: any) => m.exchange_index >= forkIdx)
      : milestones;

    // Compute outcomes from own milestones only
    const outcomes = computeOutcomes(ownMilestones);

    // Find best plan: only show approved or implemented in the session list
    // For forked sessions, exclude inherited plans (from parent session)
    const ownPlans = forkIdx != null
      ? plans.filter((p: any) => p.exchange_index_start >= forkIdx)
      : plans;
    const acceptedPlan = ownPlans.find((p: any) => p.status === "implemented")
      ?? ownPlans.find((p: any) => p.status === "approved")
      ?? null;
    const latestPlan = acceptedPlan;

    // Facts-first: activity group summaries for the activity strip
    const activityGroups = segments
      .filter((seg) => seg.boundary_type != null)
      .map((seg) => {
        const toolCounts = (() => { try { return JSON.parse(seg.tool_counts); } catch { return {}; } })() as Record<string, number>;
        // Classify dominant tool category
        const readTools = new Set(["Read", "Grep", "Glob"]);
        const editTools = new Set(["Edit", "Write", "NotebookEdit"]);
        let readC = 0, editC = 0, bashC = 0, planC = 0, total = 0;
        for (const [tool, count] of Object.entries(toolCounts)) {
          total += count;
          if (readTools.has(tool)) readC += count;
          else if (editTools.has(tool)) editC += count;
          else if (tool === "Bash") bashC += count;
          else if (tool === "EnterPlanMode" || tool === "ExitPlanMode") planC += count;
        }
        let dominant = "none";
        if (total > 0) {
          if (planC > 0) dominant = "plan";
          else {
            const max = Math.max(readC, editC, bashC);
            if (max > 0) {
              if (max === editC && editC >= total * 0.4) dominant = "edit";
              else if (max === readC && readC >= total * 0.5) dominant = "read";
              else if (max === bashC && bashC >= total * 0.5) dominant = "bash";
              else dominant = "mixed";
            }
          }
        }
        return {
          exchange_start: seg.exchange_index_start,
          exchange_end: seg.exchange_index_end,
          exchange_count: seg.exchange_count || (seg.exchange_index_end - seg.exchange_index_start + 1),
          dominant_tool_category: dominant,
          has_errors: (seg.error_count || 0) > 0,
          boundary: seg.boundary_type,
        };
      });

    // Token summary (only if we have facts-first data)
    let tokenSummary = null;
    let dominantModel: string | null = null;
    let fileCount = 0;
    if (activityGroups.length > 0) {
      try {
        const tokenRow = db.prepare(`
          SELECT SUM(input_tokens) as ti, SUM(output_tokens) as to2, SUM(cache_read_tokens) as tcr
          FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL
        `).get(s.id) as { ti: number | null; to2: number | null; tcr: number | null };
        if (tokenRow && tokenRow.ti != null) {
          tokenSummary = {
            total_input: tokenRow.ti || 0,
            total_output: tokenRow.to2 || 0,
            total_cache_read: tokenRow.tcr || 0,
            total: (tokenRow.ti || 0) + (tokenRow.to2 || 0),
          };
        }
        const modelRow = db.prepare(`
          SELECT model, COUNT(*) as cnt FROM exchanges
          WHERE session_id = ? AND model IS NOT NULL
          GROUP BY model ORDER BY cnt DESC LIMIT 1
        `).get(s.id) as { model: string; cnt: number } | undefined;
        dominantModel = modelRow?.model ?? null;
        const fileRow = db.prepare(`
          SELECT COUNT(DISTINCT file_path) as cnt FROM tool_calls
          WHERE session_id = ? AND file_path IS NOT NULL
        `).get(s.id) as { cnt: number };
        fileCount = fileRow?.cnt ?? 0;
      } catch { /* non-critical */ }
    }

    return {
      ...s,
      segments: segments.map((seg) => ({
        type: seg.segment_type,
        start: seg.exchange_index_start,
        end: seg.exchange_index_end,
        has_summary: !!seg.summary,
      })),
      milestone_count: ownMilestones.length,
      outcomes,
      latest_plan: latestPlan ? {
        version: latestPlan.version,
        status: latestPlan.status,
        total_versions: ownPlans.length,
        plan_title: extractPlanTitle(latestPlan.plan_text),
      } : null,
      has_ai: hasAiSummaries,
      compaction_count: s.compaction_count,
      forked_from: s.forked_from,
      fork_exchange_index: (s as any).fork_exchange_index ?? null,
      parent_title: parentTitle,
      parent_session_id: parentSessionId,
      // Facts-first additions
      activity_groups: activityGroups,
      milestones: ownMilestones.map((m) => ({
        type: m.milestone_type,
        exchange_index: m.exchange_index,
        description: m.description,
      })),
      token_summary: tokenSummary,
      model: dominantModel,
      file_count: fileCount,
      total_tool_calls: (() => {
        try {
          const row = db.prepare("SELECT COUNT(*) as cnt FROM tool_calls WHERE session_id = ?").get(s.id) as { cnt: number };
          return row.cnt;
        } catch { return 0; }
      })(),
    };
  });

  return c.json(enriched);
});

// GET /api/sessions/:id — detail
sessionsRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  // Try by session_id first, then by id
  let session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  let segments = getSessionSegments(session.id);
  let milestones = getSessionMilestones(session.id);
  let plans = getSessionPlans(session.id);
  const compactions = getSessionCompactionEvents(session.id);

  // Generate analysis on-the-fly for live sessions or sessions without segments
  // For active sessions: re-analyze when new exchanges arrive (keeps milestones/segments fresh)
  // For ended sessions: only analyze once if segments are missing (SessionEnd is authoritative)
  const isActive = !session.ended_at;
  const maxSegmentIdx = segments.length > 0 ? Math.max(...segments.map((s: any) => s.exchange_index_end)) : -1;
  const hasNewExchanges = session.exchange_count - 1 > maxSegmentIdx;
  const needsAnalysis = (segments.length === 0 || (isActive && hasNewExchanges)) && session.exchange_count > 0;

  if (needsAnalysis) {
    try {
      const exchanges = getSessionExchanges(session.id);
      const parsedExchanges = exchanges.map((e: any) => ({
        index: e.exchange_index,
        user_prompt: e.user_prompt,
        assistant_response: e.assistant_response,
        tool_calls: (() => {
          try {
            const db = getDb();
            return db.prepare("SELECT tool_name as name, tool_input as input, tool_result as result, tool_use_id as id, is_error FROM tool_calls WHERE exchange_id = ?").all(e.id).map((tc: any) => ({
              ...tc,
              input: tc.input ? JSON.parse(tc.input) : {},
              is_error: !!tc.is_error,
            }));
          } catch { return []; }
        })(),
        timestamp: e.timestamp,
        is_interrupt: !!e.is_interrupt,
        is_compact_summary: !!e.is_compact_summary,
      }));

      const newMilestones = extractMilestones(parsedExchanges);
      const newPlans = extractPlans(parsedExchanges);
      const newGroups = extractActivityGroups(parsedExchanges, newMilestones);
      const db = getDb();
      const { insertSegment, insertMilestone, insertPlan } = require("../../db/queries.js");

      // Clear stale data before re-inserting (prevents duplicates from Stop hook + on-the-fly overlap)
      db.prepare("DELETE FROM segments WHERE session_id = ?").run(session.id);
      db.prepare("DELETE FROM milestones WHERE session_id = ?").run(session.id);
      if (!isActive) {
        // Only clear plans for ended sessions — Stop hook manages plans for active sessions
        db.prepare("DELETE FROM plans WHERE session_id = ?").run(session.id);
      }

      for (const group of newGroups) {
        const { deriveDisplayType: ddt } = require("../../capture/activity-groups.js");
        const allFiles = [...new Set([...group.files_read, ...group.files_written])];
        insertSegment({
          session_id: session.id,
          segment_type: ddt(group),
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
      for (const m of newMilestones) {
        insertMilestone({
          session_id: session.id,
          milestone_type: m.milestone_type,
          exchange_index: m.exchange_index,
          description: m.description,
          metadata: m.metadata ? JSON.stringify(m.metadata) : null,
        });
      }
      for (const p of newPlans) {
        insertPlan({
          session_id: session.id,
          version: p.version,
          plan_text: p.plan_text,
          status: p.status,
          user_feedback: p.user_feedback,
          exchange_index_start: p.exchange_index_start,
          exchange_index_end: p.exchange_index_end,
        });
      }

      // Extract tasks for on-the-fly analysis
      const hasTaskToolsInParsed = parsedExchanges.some((ex: any) =>
        ex.tool_calls.some((tc: any) => tc.name === "TaskCreate" || tc.name === "TaskUpdate" || tc.name === "TaskStop"),
      );
      if (hasTaskToolsInParsed) {
        const { extractTasks } = require("../../capture/tasks.js");
        db.prepare("DELETE FROM tasks WHERE session_id = ?").run(session.id);
        const newTasks = extractTasks(parsedExchanges);
        for (const task of newTasks) {
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
      }

      // Re-read after insert
      segments = getSessionSegments(session.id);
      milestones = getSessionMilestones(session.id);
      plans = getSessionPlans(session.id);
    } catch (e) {
      // Non-critical — timeline just stays empty
      console.error("[keddy] On-the-fly analysis failed:", e);
    }
  }

  // Get tasks from DB (stored during import/capture)
  const db = getDb();
  const tasks = db.prepare(`
    SELECT id, task_index, subject, description, status, exchange_index_created as exchange_created, exchange_index_completed as exchange_completed
    FROM tasks WHERE session_id = ? ORDER BY task_index
  `).all(session.id);

  // Get decisions (from AI analysis)
  const decisions = db.prepare(`
    SELECT id, exchange_index, decision_text, context, alternatives
    FROM decisions WHERE session_id = ? ORDER BY exchange_index
  `).all(session.id);

  // For forked sessions, strip auto-generated "(Branch)"/"(Fork)" suffix
  const forkExIdx = (session as any).fork_exchange_index as number | null;
  if (session.title && /\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/.test(session.title)) {
    (session as any).title = session.title.replace(/\s*\S?\s*\((?:Fork|Branch)(?:\s*\d*)?\)\s*$/, "").trim();
  }
  const ownMilestones = forkExIdx != null
    ? milestones.filter((m: any) => m.exchange_index >= forkExIdx)
    : milestones;

  // Outcomes (shared computation) — from own milestones only
  const outcomes = computeOutcomes(ownMilestones);

  // Git details with file/stats/hash parsing — from own milestones only
  const gitDetails = extractGitDetails(db, session.id, ownMilestones);

  // Resolve GitHub repo for URL construction
  try {
    const { execSync } = require("node:child_process");
    const { parseGitRemote, commitUrl: mkCommitUrl, branchUrl: mkBranchUrl, prUrl: mkPrUrl } = require("../../capture/github.js");
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: session.project_path,
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const ghRepo = parseGitRemote(remoteUrl);
    if (ghRepo) {
      for (const gd of gitDetails) {
        if (gd.type === "commit" && gd.hash) {
          (gd as any).url = mkCommitUrl(ghRepo, gd.hash);
        } else if (gd.type === "push" && gd.push_branch) {
          (gd as any).url = mkBranchUrl(ghRepo, gd.push_branch);
        } else if (gd.type === "pr" && gd.description) {
          const prMatch = gd.description.match(/#(\d+)/);
          if (prMatch) (gd as any).url = mkPrUrl(ghRepo, parseInt(prMatch[1]));
        }
      }
    }
  } catch { /* no git remote or not a git repo — URLs just won't be added */ }

  // Test status — final state only (last test milestone, fork-filtered)
  let testStatus: { passing: boolean; description: string; exchange_index: number } | null = null;
  try {
    const forkTestFilter = forkExIdx != null ? `AND exchange_index >= ${forkExIdx}` : "";
    const lastTest = db.prepare(`
      SELECT milestone_type, description, exchange_index
      FROM milestones WHERE session_id = ? AND milestone_type IN ('test_pass', 'test_fail')
      ${forkTestFilter}
      ORDER BY exchange_index DESC LIMIT 1
    `).get(session.id) as any;
    if (lastTest) {
      testStatus = {
        passing: lastTest.milestone_type === "test_pass",
        description: lastTest.description,
        exchange_index: lastTest.exchange_index,
      };
    }
  } catch { /* non-critical */ }

  // Facts-first: build activity group details from segments with boundary_type
  // Note: NOT fork-filtered here — frontend handles inherited vs new display (like Terminal view)
  const activityGroups = segments
    .filter((seg) => seg.boundary_type != null)
    .map((seg) => {
      const exStart = seg.exchange_index_start;
      const exEnd = seg.exchange_index_end;

      // key_actions: top bash_desc + subagent_desc for this group (computed at read time)
      let keyActions: string[] = [];
      try {
        const bashDescs = db.prepare(`
          SELECT DISTINCT tc.bash_desc FROM tool_calls tc
          JOIN exchanges e ON tc.exchange_id = e.id
          WHERE e.session_id = ? AND e.exchange_index BETWEEN ? AND ?
          AND tc.bash_desc IS NOT NULL AND tc.bash_desc != ''
          LIMIT 5
        `).all(session.id, exStart, exEnd) as any[];
        const agentDescs = db.prepare(`
          SELECT tc.subagent_type, tc.subagent_desc FROM tool_calls tc
          JOIN exchanges e ON tc.exchange_id = e.id
          WHERE e.session_id = ? AND e.exchange_index BETWEEN ? AND ?
          AND tc.subagent_desc IS NOT NULL
        `).all(session.id, exStart, exEnd) as any[];

        keyActions = [
          ...bashDescs.map((r: any) => r.bash_desc),
          ...agentDescs.map((r: any) => `${r.subagent_type || "Agent"}: ${r.subagent_desc}`),
        ];
      } catch { /* non-critical */ }

      // first_prompt: user prompt from first exchange in group
      let firstPrompt: string | null = null;
      try {
        const row = db.prepare(`
          SELECT substr(user_prompt, 1, 120) as prompt FROM exchanges
          WHERE session_id = ? AND exchange_index = ?
        `).get(session.id, exStart) as any;
        firstPrompt = row?.prompt ?? null;
      } catch { /* non-critical */ }

      return {
        exchange_start: exStart,
        exchange_end: exEnd,
        exchange_count: seg.exchange_count || (exEnd - exStart + 1),
        started_at: seg.started_at,
        ended_at: seg.ended_at,
        tool_counts: (() => { try { return JSON.parse(seg.tool_counts); } catch { return {}; } })(),
        error_count: seg.error_count || 0,
        files_read: (() => { try { return JSON.parse(seg.files_read || "[]"); } catch { return []; } })(),
        files_written: (() => { try { return JSON.parse(seg.files_written || "[]"); } catch { return []; } })(),
        total_input_tokens: seg.total_input_tokens || 0,
        total_output_tokens: seg.total_output_tokens || 0,
        total_cache_read_tokens: seg.total_cache_read_tokens || 0,
        total_cache_write_tokens: seg.total_cache_write_tokens || 0,
        duration_ms: seg.duration_ms || 0,
        models: (() => { try { return JSON.parse(seg.models || "[]"); } catch { return []; } })(),
        markers: (() => { try { return JSON.parse(seg.markers || "[]"); } catch { return []; } })(),
        boundary: seg.boundary_type,
        ai_summary: seg.ai_summary,
        ai_label: seg.ai_label,
        key_actions: keyActions,
        first_prompt: firstPrompt,
      };
    });

  // Token summary
  let tokenSummary = null;
  try {
    const tokenRow = db.prepare(`
      SELECT SUM(input_tokens) as ti, SUM(output_tokens) as to2,
        SUM(cache_read_tokens) as tcr, SUM(cache_write_tokens) as tcw
      FROM exchanges WHERE session_id = ? AND input_tokens IS NOT NULL
    `).get(session.id) as any;
    if (tokenRow && tokenRow.ti != null) {
      const total = (tokenRow.ti || 0) + (tokenRow.to2 || 0);
      const cacheRead = tokenRow.tcr || 0;
      tokenSummary = {
        total_input: tokenRow.ti || 0,
        total_output: tokenRow.to2 || 0,
        total_cache_read: cacheRead,
        total_cache_write: tokenRow.tcw || 0,
        total,
        cache_hit_rate: total > 0 ? Math.round((cacheRead / (tokenRow.ti || 1)) * 100) : 0,
      };
    }
  } catch { /* non-critical */ }

  // Model breakdown
  let modelBreakdown: Array<{ model: string; exchange_count: number; total_tokens: number }> = [];
  try {
    modelBreakdown = db.prepare(`
      SELECT model, COUNT(*) as exchange_count,
        SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as total_tokens
      FROM exchanges WHERE session_id = ? AND model IS NOT NULL
      GROUP BY model ORDER BY exchange_count DESC
    `).all(session.id) as any[];
  } catch { /* non-critical */ }

  // Fork metadata for detail view
  let detailParentTitle: string | null = null;
  let detailParentSessionId: string | null = null;
  if (session.forked_from) {
    try {
      const forkData = JSON.parse(session.forked_from);
      if (forkData.sessionId) {
        detailParentSessionId = forkData.sessionId;
        const parent = db.prepare("SELECT title FROM sessions WHERE session_id = ?").get(forkData.sessionId) as { title: string | null } | undefined;
        detailParentTitle = parent?.title ?? null;
      }
    } catch (e) {
      console.error("[keddy] Fork metadata parse error:", e);
    }
  }

  // File operations (for forked sessions, only show post-fork file ops)
  let fileOperations: Array<{ file_path: string; short_name: string; reads: number; edits: number; writes: number }> = [];
  try {
    const forkFilter = forkExIdx != null
      ? `AND tc.exchange_id IN (SELECT id FROM exchanges WHERE session_id = tc.session_id AND exchange_index >= ${forkExIdx})`
      : "";
    const rows = db.prepare(`
      SELECT tc.file_path,
        SUM(CASE WHEN tc.tool_name IN ('Read', 'Grep', 'Glob') THEN 1 ELSE 0 END) as reads,
        SUM(CASE WHEN tc.tool_name = 'Edit' THEN 1 ELSE 0 END) as edits,
        SUM(CASE WHEN tc.tool_name = 'Write' THEN 1 ELSE 0 END) as writes
      FROM tool_calls tc WHERE tc.session_id = ? AND tc.file_path IS NOT NULL ${forkFilter}
      GROUP BY tc.file_path ORDER BY (edits + writes) DESC, reads DESC
    `).all(session.id) as any[];
    fileOperations = rows.map((r: any) => ({
      ...r,
      short_name: r.file_path.split("/").pop() || r.file_path,
    }));
  } catch { /* non-critical */ }

  // Fork children: sessions that were forked FROM this session
  let forkChildren: Array<{ session_id: string; title: string | null; fork_exchange_index: number | null }> = [];
  try {
    const childLinks = db.prepare(
      "SELECT source_session_id FROM session_links WHERE target_session_id = ? AND link_type = 'fork'",
    ).all(session.id) as Array<{ source_session_id: string }>;
    for (const link of childLinks) {
      const child = db.prepare(
        "SELECT session_id, title, fork_exchange_index FROM sessions WHERE id = ?",
      ).get(link.source_session_id) as { session_id: string; title: string | null; fork_exchange_index: number | null } | undefined;
      if (child) forkChildren.push(child);
    }
    // Sort by fork_exchange_index so they appear in order
    forkChildren.sort((a, b) => (a.fork_exchange_index ?? 0) - (b.fork_exchange_index ?? 0));
  } catch { /* non-critical */ }

  return c.json({
    ...session,
    fork_exchange_index: forkExIdx,
    parent_title: detailParentTitle,
    parent_session_id: detailParentSessionId,
    fork_children: forkChildren.length > 0 ? forkChildren : undefined,
    segments,
    milestones: ownMilestones,
    plans: (forkExIdx != null ? plans.filter((p: any) => p.exchange_index_start >= forkExIdx) : plans).map((p: any) => {
      // Enrich with real timestamps from exchanges (created_at is reimport time, not useful)
      try {
        const startRow = db.prepare("SELECT timestamp FROM exchanges WHERE session_id = ? AND exchange_index = ?").get(session.id, p.exchange_index_start) as any;
        const endRow = db.prepare("SELECT timestamp FROM exchanges WHERE session_id = ? AND exchange_index = ?").get(session.id, p.exchange_index_end) as any;
        return {
          ...p,
          started_at: startRow?.timestamp || p.created_at,
          ended_at: endRow?.timestamp || startRow?.timestamp || p.created_at,
        };
      } catch { return { ...p, started_at: p.created_at, ended_at: p.created_at }; }
    }),
    compaction_events: compactions,
    tasks,
    decisions,
    // Facts-first additions
    outcomes,
    git_details: gitDetails,
    test_status: testStatus,
    activity_groups: activityGroups,
    token_summary: tokenSummary,
    model_breakdown: modelBreakdown,
    file_operations: fileOperations,
  });
});

// GET /api/sessions/:id/file/:encodedPath — all tool_calls on a specific file with diffs
sessionsRoutes.get("/:id/file/:filePath", (c) => {
  const id = c.req.param("id");
  const filePath = decodeURIComponent(c.req.param("filePath"));
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const db = getDb();
  const rows = db.prepare(`
    SELECT tc.id, tc.tool_name, tc.tool_input, tc.is_error, e.exchange_index, e.timestamp
    FROM tool_calls tc
    JOIN exchanges e ON tc.exchange_id = e.id
    WHERE tc.session_id = ? AND tc.file_path = ?
    ORDER BY e.exchange_index, tc.rowid
  `).all(session.id, filePath) as any[];

  const result = rows.map((r: any) => {
    const entry: any = {
      id: r.id,
      exchange_index: r.exchange_index,
      timestamp: r.timestamp,
      tool_name: r.tool_name,
      is_error: !!r.is_error,
    };
    // Parse tool_input for Edit diffs
    try {
      const input = JSON.parse(r.tool_input);
      if (r.tool_name === "Edit") {
        entry.old_string = input.old_string ?? null;
        entry.new_string = input.new_string ?? null;
      }
      if (r.tool_name === "Write") {
        entry.content_length = typeof input.content === "string" ? input.content.length : null;
      }
    } catch { /* invalid JSON */ }
    return entry;
  });

  return c.json(result);
});

// GET /api/sessions/:id/tool-call/:toolCallId — full raw tool call data
sessionsRoutes.get("/:id/tool-call/:toolCallId", (c) => {
  const id = c.req.param("id");
  const toolCallId = c.req.param("toolCallId");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const db = getDb();
  const row = db.prepare(`
    SELECT tc.id, tc.tool_name, tc.tool_input, tc.tool_result, tc.is_error,
      tc.bash_desc, tc.bash_command, tc.skill_name, tc.subagent_type, tc.subagent_desc,
      tc.file_path, tc.web_query, tc.web_url,
      e.exchange_index, e.timestamp
    FROM tool_calls tc
    JOIN exchanges e ON tc.exchange_id = e.id
    WHERE tc.id = ? AND tc.session_id = ?
  `).get(toolCallId, session.id) as any;

  if (!row) return c.json({ error: "Tool call not found" }, 404);

  let toolInput: unknown = row.tool_input;
  try { toolInput = JSON.parse(row.tool_input); } catch { /* keep as string */ }

  return c.json({
    id: row.id,
    tool_name: row.tool_name,
    tool_input: toolInput,
    tool_result: row.tool_result,
    is_error: !!row.is_error,
    bash_desc: row.bash_desc,
    bash_command: row.bash_command,
    skill_name: row.skill_name,
    subagent_type: row.subagent_type,
    subagent_desc: row.subagent_desc,
    file_path: row.file_path,
    web_query: row.web_query,
    web_url: row.web_url,
    exchange_index: row.exchange_index,
    timestamp: row.timestamp,
  });
});

// GET /api/sessions/:id/stats — token, tool, file, model, timing stats
sessionsRoutes.get("/:id/stats", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const db = getDb();

  // Per-exchange token data
  const perExchange = db.prepare(`
    SELECT exchange_index as index, timestamp, model,
      input_tokens as input, output_tokens as output,
      cache_read_tokens as cache_read, cache_write_tokens as cache_write
    FROM exchanges WHERE session_id = ? ORDER BY exchange_index
  `).all(session.id) as any[];

  const totalInput = perExchange.reduce((s: number, e: any) => s + (e.input || 0), 0);
  const totalOutput = perExchange.reduce((s: number, e: any) => s + (e.output || 0), 0);
  const totalCacheRead = perExchange.reduce((s: number, e: any) => s + (e.cache_read || 0), 0);
  const totalCacheWrite = perExchange.reduce((s: number, e: any) => s + (e.cache_write || 0), 0);

  // Tool usage
  const toolRows = db.prepare(`
    SELECT tool_name, COUNT(*) as count,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as errors
    FROM tool_calls WHERE session_id = ?
    GROUP BY tool_name ORDER BY count DESC
  `).all(session.id) as any[];
  const toolCounts: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  let toolTotal = 0, errorTotal = 0;
  for (const r of toolRows) {
    toolCounts[r.tool_name] = r.count;
    if (r.errors > 0) toolErrors[r.tool_name] = r.errors;
    toolTotal += r.count;
    errorTotal += r.errors;
  }

  // File operations
  const fileRows = db.prepare(`
    SELECT file_path,
      SUM(CASE WHEN tool_name IN ('Read', 'Grep', 'Glob') THEN 1 ELSE 0 END) as reads,
      SUM(CASE WHEN tool_name = 'Edit' THEN 1 ELSE 0 END) as edits,
      SUM(CASE WHEN tool_name = 'Write' THEN 1 ELSE 0 END) as writes
    FROM tool_calls WHERE session_id = ? AND file_path IS NOT NULL
    GROUP BY file_path ORDER BY (edits + writes) DESC, reads DESC
  `).all(session.id) as any[];

  // Model breakdown
  const modelRows = db.prepare(`
    SELECT model, COUNT(*) as exchange_count,
      SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as total_tokens
    FROM exchanges WHERE session_id = ? AND model IS NOT NULL
    GROUP BY model ORDER BY exchange_count DESC
  `).all(session.id) as any[];
  const totalExchangesWithModel = modelRows.reduce((s: number, r: any) => s + r.exchange_count, 0);

  // Timing
  const timestamps = perExchange.filter((e: any) => e.timestamp).map((e: any) => ({
    index: e.index, timestamp: e.timestamp,
  }));
  let totalDurationMs = 0, avgTurnMs = 0;
  let longestTurn: { index: number; duration_ms: number } | null = null;
  if (timestamps.length >= 2) {
    totalDurationMs = new Date(timestamps[timestamps.length - 1].timestamp).getTime() -
      new Date(timestamps[0].timestamp).getTime();
    avgTurnMs = Math.round(totalDurationMs / timestamps.length);
    for (let i = 1; i < timestamps.length; i++) {
      const gap = new Date(timestamps[i].timestamp).getTime() - new Date(timestamps[i - 1].timestamp).getTime();
      if (!longestTurn || gap > longestTurn.duration_ms) {
        longestTurn = { index: timestamps[i].index, duration_ms: gap };
      }
    }
  }

  return c.json({
    tokens: {
      total_input: totalInput,
      total_output: totalOutput,
      total_cache_read: totalCacheRead,
      total_cache_write: totalCacheWrite,
      total: totalInput + totalOutput,
      cache_hit_rate: totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 100) : 0,
      per_exchange: perExchange,
    },
    tools: { counts: toolCounts, errors: toolErrors, total: toolTotal, error_total: errorTotal },
    files: fileRows.map((r: any) => ({
      file_path: r.file_path,
      short_name: r.file_path.split("/").pop() || r.file_path,
      reads: r.reads, edits: r.edits, writes: r.writes,
    })),
    models: modelRows.map((r: any) => ({
      model: r.model, exchange_count: r.exchange_count,
      total_tokens: r.total_tokens,
      percentage: totalExchangesWithModel > 0 ? Math.round((r.exchange_count / totalExchangesWithModel) * 100) : 0,
    })),
    timing: { total_duration_ms: totalDurationMs, avg_turn_ms: avgTurnMs, longest_turn: longestTurn, exchange_timestamps: timestamps },
  });
});

// GET /api/sessions/:id/exchanges
sessionsRoutes.get("/:id/exchanges", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Live sync from JSONL — the Stop hook can miss exchanges, so the server
  // checks the source-of-truth JSONL on every poll and syncs any missing data.
  // Only runs for sessions with a recent JSONL file (active or recently ended).
  try {
    const { existsSync, statSync } = require("node:fs");
    if (session.jsonl_path && existsSync(session.jsonl_path)) {
      const mtime = statSync(session.jsonl_path).mtimeMs;
      const RECENT_THRESHOLD = 30 * 60 * 1000; // 30 minutes
      const now = Date.now();

      if (now - mtime < RECENT_THRESHOLD) {
        // Check if DB is stale: JSONL modified after last known exchange
        const endedMs = session.ended_at ? new Date(session.ended_at).getTime() : 0;
        if (mtime - endedMs > 2000) {
          const existingExchanges = getSessionExchanges(session.id);
          const sinceIndex = Math.max(0, existingExchanges.length - 1);

          let latestExchanges;
          try {
            latestExchanges = parseLatestExchanges(session.jsonl_path, sinceIndex);
          } catch { latestExchanges = null; }

          if (latestExchanges && latestExchanges.length > 0) {
            const db = getDb();

            for (const exchange of latestExchanges) {
              const existing = existingExchanges.find((e: any) => e.exchange_index === exchange.index);

              if (existing) {
                // UPDATE existing exchange — it might have been captured with incomplete response
                db.prepare(`
                  UPDATE exchanges SET
                    assistant_response = ?,
                    tool_call_count = ?,
                    is_interrupt = ?,
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
                  exchange.assistant_response ?? "",
                  exchange.tool_calls.length,
                  exchange.is_interrupt ? 1 : 0,
                  exchange.model ?? null,
                  exchange.input_tokens ?? null,
                  exchange.output_tokens ?? null,
                  exchange.cache_read_tokens ?? null,
                  exchange.cache_write_tokens ?? null,
                  exchange.stop_reason ?? null,
                  exchange.has_thinking ? 1 : null,
                  exchange.turn_duration_ms ?? null,
                  existing.id,
                );

                // Re-insert tool calls with enriched fields
                db.prepare("DELETE FROM tool_calls WHERE exchange_id = ?").run(existing.id);
                for (const tc of exchange.tool_calls) {
                  const enriched = extractToolCallFields(tc.name, tc.input);
                  insertToolCall({
                    exchange_id: existing.id,
                    session_id: session.id,
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
                  session_id: session.id,
                  exchange_index: exchange.index,
                  user_prompt: exchange.user_prompt,
                  assistant_response: exchange.assistant_response,
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
            }

            // Extract milestones from ALL exchanges in DB (not just tail) —
            // catches commits/pushes from any exchange, even if older than sinceIndex
            const allDbExchanges = getSessionExchanges(session.id);
            const parsedForMilestones = allDbExchanges.map((e: any) => {
              const tcs = db.prepare(
                "SELECT tool_name as name, tool_input as input FROM tool_calls WHERE exchange_id = ?",
              ).all(e.id).map((tc: any) => ({
                ...tc,
                input: tc.input ? (() => { try { return JSON.parse(tc.input); } catch { return {}; } })() : {},
              }));
              return { index: e.exchange_index, tool_calls: tcs };
            });
            const allMilestones = extractMilestones(parsedForMilestones as any);
            for (const m of allMilestones) {
              insertMilestone({
                session_id: session.id,
                milestone_type: m.milestone_type,
                exchange_index: m.exchange_index,
                description: m.description,
                metadata: m.metadata ? JSON.stringify(m.metadata) : null,
              });
            }

            // Update session metadata
            const lastEx = latestExchanges[latestExchanges.length - 1];
            db.prepare(`
              UPDATE sessions SET
                ended_at = COALESCE(?, ended_at),
                exchange_count = (SELECT COUNT(*) FROM exchanges WHERE session_id = ?)
              WHERE id = ?
            `).run(lastEx.timestamp || new Date().toISOString(), session.id, session.id);
          }
        }
      }
    }
  } catch (e) { console.error("[keddy] Live sync error:", e); }

  // Read fresh data after sync
  const exchanges = getSessionExchanges(session.id);

  // Optionally include tool calls
  const withTools = c.req.query("tools") === "true";
  if (withTools) {
    const db = getDb();
    const enriched = exchanges.map((e) => {
      const tools = db
        .prepare("SELECT * FROM tool_calls WHERE exchange_id = ?")
        .all(e.id);
      return { ...e, tool_calls: tools };
    });
    return c.json(enriched);
  }

  return c.json(exchanges);
});

// POST /api/sessions/:id/title — rename
sessionsRoutes.post("/:id/title", async (c) => {
  const id = c.req.param("id");
  let body: { title?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.title !== "string" || body.title.length === 0) {
    return c.json({ error: "title must be a non-empty string" }, 400);
  }
  const session = getSession(id) ?? getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  const db = getDb();
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(
    body.title,
    session.id,
  );

  return c.json({ ok: true });
});

// POST /api/sessions/:id/sync — re-sync a session from its JSONL file
sessionsRoutes.post("/:id/sync", (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);
  if (!session.jsonl_path) return c.json({ error: "No JSONL file path" }, 400);

  try {
    const { existsSync } = require("node:fs");
    if (!existsSync(session.jsonl_path)) return c.json({ error: "JSONL file not found" }, 404);

    const { parseTranscript } = require("../../capture/parser.js");
    const transcript = parseTranscript(session.jsonl_path);

    const db = getDb();

    // Update session metadata
    db.prepare(`
      UPDATE sessions SET
        git_branch = COALESCE(?, git_branch),
        ended_at = COALESCE(?, ended_at),
        exchange_count = ?
      WHERE id = ?
    `).run(
      transcript.git_branch,
      transcript.ended_at,
      transcript.exchanges.length,
      session.id,
    );

    // Clear and re-insert all exchanges — sync does a full re-parse from JSONL (source of truth)
    const { insertExchange, insertToolCall } = require("../../db/queries.js");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM exchanges WHERE session_id = ?").run(session.id);
    let added = 0;
    for (const exchange of transcript.exchanges) {
      const eid = insertExchange({
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
        try {
          const enriched = extractToolCallFields(tc.name, tc.input);
          insertToolCall({
            exchange_id: eid,
            session_id: session.id,
            tool_name: tc.name,
            tool_input: JSON.stringify(tc.input),
            tool_result: tc.result ?? null,
            tool_use_id: tc.id,
            is_error: tc.is_error ?? false,
            ...enriched,
          });
        } catch { /* duplicate tool call */ }
      }
      added++;
    }

    // Clear and re-extract ALL derived data (milestones, segments, plans, tasks)
    // Same as SessionEnd — sync is a full re-parse, derived data must match
    db.prepare("DELETE FROM milestones WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM segments WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM plans WHERE session_id = ?").run(session.id);
    db.prepare("DELETE FROM tasks WHERE session_id = ?").run(session.id);

    const { extractMilestones: extractMs } = require("../../capture/milestones.js");
    const { extractPlans: extractPs } = require("../../capture/plans.js");
    const { extractActivityGroups: extractAg, deriveDisplayType: ddt } = require("../../capture/activity-groups.js");
    const { insertMilestone: insertMs, insertSegment: insertSeg, insertPlan: insertPl } = require("../../db/queries.js");

    const milestones = extractMs(transcript.exchanges);
    for (const m of milestones) {
      insertMs({
        session_id: session.id,
        milestone_type: m.milestone_type,
        exchange_index: m.exchange_index,
        description: m.description,
        metadata: m.metadata ? JSON.stringify(m.metadata) : null,
      });
    }

    const plans = extractPs(transcript.exchanges);
    for (const p of plans) {
      insertPl({
        session_id: session.id,
        version: p.version,
        plan_text: p.plan_text,
        status: p.status,
        user_feedback: p.user_feedback,
        exchange_index_start: p.exchange_index_start,
        exchange_index_end: p.exchange_index_end,
      });
    }

    const groups = extractAg(transcript.exchanges, milestones);
    for (const group of groups) {
      const allFiles = [...new Set([...group.files_read, ...group.files_written])];
      insertSeg({
        session_id: session.id,
        segment_type: ddt(group),
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

    return c.json({
      ok: true,
      exchanges: transcript.exchanges.length,
      milestones: milestones.length,
      branch: transcript.git_branch,
      ended_at: transcript.ended_at,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});
