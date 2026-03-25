import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { initDb, closeDb, getDb } from "../db/index.js";
import {
  upsertSession,
  insertExchange,
  insertToolCall,
  extractToolCallFields,
  insertPlan,
  insertSegment,
  insertMilestone,
  insertCompactionEvent,
  updateSessionEnd,
  getSession,
} from "../db/queries.js";
import { parseTranscript } from "../capture/parser.js";
import { extractPlans } from "../capture/plans.js";
import { extractActivityGroups, deriveDisplayType } from "../capture/activity-groups.js";
import { extractMilestones } from "../capture/milestones.js";
import { deriveTitle } from "../capture/titles.js";

function findJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip subagents directory — those are sub-sessions with limited context
        if (entry.name === "subagents") continue;
        files.push(...findJsonlFiles(fullPath));
      } else if (entry.name.endsWith(".jsonl") && !entry.name.startsWith("agent-")) {
        // Skip agent-*.jsonl files (subagent transcripts)
        files.push(fullPath);
      }
    }
  } catch {
    // Permission errors, etc.
  }

  return files;
}

export async function runImport(forceReimport = false): Promise<void> {
  const claudeDir = join(homedir(), ".claude");
  const projectsDir = join(claudeDir, "projects");

  if (!existsSync(projectsDir)) {
    console.log("No Claude Code projects found at ~/.claude/projects/");
    return;
  }

  console.log("Scanning for JSONL transcripts...");
  const jsonlFiles = findJsonlFiles(projectsDir);

  if (jsonlFiles.length === 0) {
    console.log("No JSONL files found.");
    return;
  }

  console.log(`Found ${jsonlFiles.length} transcript files.\n`);

  initDb();

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of jsonlFiles) {
    try {
      const transcript = parseTranscript(filePath);

      // The filename UUID is the true session identity.
      // For forked sessions, the JSONL's sessionId field contains the PARENT's ID,
      // so we must always prefer the filename UUID.
      const fileName = filePath.split("/").pop()?.replace(".jsonl", "") || "";
      if (fileName && /^[0-9a-f]{8}-/.test(fileName)) {
        // If filename differs from JSONL sessionId, this is a fork
        if (transcript.session_id && transcript.session_id !== fileName) {
          transcript.forked_from = transcript.forked_from || transcript.session_id;
        }
        transcript.session_id = fileName;
      } else if (!transcript.session_id) {
        skipped++;
        continue;
      }

      // Skip Agent SDK sessions — these are spawned by Keddy's notes generator
      // and contain analysis prompts, not real user sessions
      if (transcript.exchanges.length > 0) {
        const firstPrompt = transcript.exchanges[0].user_prompt || "";
        if (
          firstPrompt.startsWith("Analyze the coding session with session_id") ||
          firstPrompt.startsWith("Here is the complete session data")
        ) {
          skipped++;
          continue;
        }
      }

      // Check if already imported
      const existing = getSession(transcript.session_id);
      if (existing) {
        if (forceReimport) {
          // Delete and re-import with fresh data
          const db = getDb();
          db.prepare("DELETE FROM sessions WHERE id = ?").run(existing.id);
        } else {
          skipped++;
          continue;
        }
      }

      // Import session — ensure all values are strings or null (never undefined)
      upsertSession({
        session_id: transcript.session_id,
        project_path: transcript.project_path || deriveProjectPath(filePath),
        git_branch: transcript.git_branch || null,
        claude_version: transcript.claude_version || null,
        slug: transcript.slug || null,
        jsonl_path: filePath,
        forked_from: transcript.forked_from || null,
        started_at: transcript.started_at || null,
        title: transcript.custom_title || deriveTitle(transcript.exchanges, { forkExchangeIndex: transcript.fork_exchange_index }) || null,
        metadata: null,
      });

      const session = getSession(transcript.session_id);
      if (!session) continue;

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

      // Clear any previous analysis data (prevents duplicates on re-import)
      const db = getDb();
      db.prepare("DELETE FROM segments WHERE session_id = ?").run(session.id);
      db.prepare("DELETE FROM milestones WHERE session_id = ?").run(session.id);
      db.prepare("DELETE FROM plans WHERE session_id = ?").run(session.id);

      // Run analysis
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
      for (const milestone of milestones) {
        insertMilestone({
          session_id: session.id,
          milestone_type: milestone.milestone_type,
          exchange_index: milestone.exchange_index,
          description: milestone.description,
          metadata: milestone.metadata ? JSON.stringify(milestone.metadata) : null,
        });
      }

      // Activity groups (boundary-based)
      const activityGroups = extractActivityGroups(transcript.exchanges, milestones);
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

      for (const compaction of transcript.compactions) {
        insertCompactionEvent({
          session_id: session.id,
          exchange_index: compaction.exchange_index,
          summary: compaction.summary,
          pre_tokens: compaction.pre_tokens,
        });
      }

      // Extract and store tasks
      const { extractTasks } = await import("../capture/tasks.js");
      const tasks = extractTasks(transcript.exchanges);
      const { insertTask } = await import("../db/queries.js");
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

      updateSessionEnd(transcript.session_id, transcript.exchanges.length, transcript.ended_at ?? undefined);

      imported++;
      process.stdout.write(`\r  Imported: ${imported} | Skipped: ${skipped} | Errors: ${errors}`);
    } catch (err) {
      errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n") : "";
      process.stderr.write(`\n  Error importing ${filePath.split("/").pop()}: ${errMsg.substring(0, 100)}\n  ${stack}\n`);
      process.stdout.write(`\r  Imported: ${imported} | Skipped: ${skipped} | Errors: ${errors}`);
    }
  }

  closeDb();
  console.log(`\n\nDone! Imported ${imported} sessions (${skipped} skipped, ${errors} errors).`);
}

function deriveProjectPath(jsonlPath: string): string {
  // Fallback: extract encoded project path from the directory name.
  // Claude Code encodes paths as: /Users/foo/project → -Users-foo-project
  // Note: This is lossy — hyphens in real directory names are ambiguous.
  // The transcript's cwd field is always preferred over this fallback.
  const parts = jsonlPath.split("/");
  const projectsIdx = parts.indexOf("projects");
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    const encoded = parts[projectsIdx + 1];
    // Only replace leading dash (path separator), preserve internal structure
    return "/" + encoded.replace(/^-/, "").replace(/-/g, "/");
  }
  return jsonlPath;
}
