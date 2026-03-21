import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { initDb, closeDb, getDb } from "../db/index.js";
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
} from "../db/queries.js";
import { parseTranscript } from "../capture/parser.js";
import { extractPlans } from "../capture/plans.js";
import { extractSegments } from "../capture/segments.js";
import { extractMilestones } from "../capture/milestones.js";

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

export async function runImport(): Promise<void> {
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

      // Use filename as session ID fallback (filenames are UUIDs)
      if (!transcript.session_id) {
        const fileName = filePath.split("/").pop()?.replace(".jsonl", "") || "";
        if (fileName && /^[0-9a-f]{8}-/.test(fileName)) {
          transcript.session_id = fileName;
        } else {
          skipped++;
          continue;
        }
      }

      // Check if already imported
      const existing = getSession(transcript.session_id);
      if (existing) {
        skipped++;
        continue;
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
        title: transcript.exchanges[0]?.user_prompt.substring(0, 80) || null,
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

      for (const boundary of transcript.compaction_boundaries) {
        insertCompactionEvent({
          session_id: session.id,
          exchange_index: boundary,
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
