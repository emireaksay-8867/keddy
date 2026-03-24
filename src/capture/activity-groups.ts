import type { ParsedExchange, ActivityGroup, BoundaryType, GroupMarker, MarkerType, SegmentType } from "../types.js";
import type { ExtractedMilestone } from "./milestones.js";

const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const LONG_PAUSE_MS = 10 * 60 * 1000; // 10 minutes

// Milestone type priority for boundary selection (higher = more important)
const MILESTONE_PRIORITY: Record<string, number> = {
  pr: 6, push: 5, commit: 4, test_fail: 3, test_pass: 2, branch: 1,
};

/** Extract files_read and files_written from a single exchange's tool calls */
function extractFilesForExchange(exchange: ParsedExchange): { read: string[]; written: string[] } {
  const read = new Set<string>();
  const written = new Set<string>();

  for (const tc of exchange.tool_calls) {
    if (typeof tc.input !== "object" || tc.input === null) continue;
    const input = tc.input as Record<string, unknown>;
    const filePath = (typeof input.file_path === "string" ? input.file_path : null)
                  || (typeof input.path === "string" ? input.path : null);
    if (!filePath) continue;

    if (WRITE_TOOLS.has(tc.name)) {
      written.add(filePath);
    } else if (READ_TOOLS.has(tc.name)) {
      read.add(filePath);
    }
  }

  return { read: [...read], written: [...written] };
}

/** Count tools across a set of exchanges */
function countTools(exchanges: ParsedExchange[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ex of exchanges) {
    for (const tc of ex.tool_calls) {
      counts[tc.name] = (counts[tc.name] || 0) + 1;
    }
  }
  return counts;
}

/** Count tool calls that returned is_error=true — factual, no interpretation */
function countErrors(exchanges: ParsedExchange[]): number {
  let count = 0;
  for (const ex of exchanges) {
    for (const tc of ex.tool_calls) {
      if (tc.is_error) count++;
    }
  }
  return count;
}

/** Build markers from exchanges in a group */
function buildMarkers(
  exchanges: ParsedExchange[],
  milestoneMap: Map<number, ExtractedMilestone[]>,
): GroupMarker[] {
  const markers: GroupMarker[] = [];

  for (const ex of exchanges) {
    // Milestones
    const ms = milestoneMap.get(ex.index);
    if (ms) {
      for (const m of ms) {
        markers.push({
          exchange_index: ex.index,
          type: m.milestone_type as MarkerType,
          label: m.description,
          metadata: m.metadata ?? undefined,
        });
      }
    }

    for (const tc of ex.tool_calls) {
      // Plan mode
      if (tc.name === "EnterPlanMode") {
        markers.push({ exchange_index: ex.index, type: "plan_enter", label: "Entered plan mode" });
      }
      if (tc.name === "ExitPlanMode") {
        markers.push({ exchange_index: ex.index, type: "plan_exit", label: "Exited plan mode" });
      }

      // Skills
      if (tc.name === "Skill") {
        const input = tc.input as Record<string, unknown> | null;
        const skill = typeof input?.skill === "string" ? input.skill : "unknown";
        markers.push({ exchange_index: ex.index, type: "skill", label: `/${skill}` });
      }

      // Subagents
      if (tc.name === "Agent") {
        const input = tc.input as Record<string, unknown> | null;
        const subType = typeof input?.subagent_type === "string" ? input.subagent_type : "general-purpose";
        const desc = typeof input?.description === "string" ? (input.description as string).substring(0, 100) : "";
        markers.push({
          exchange_index: ex.index,
          type: "subagent",
          label: `${subType}: ${desc}`.trim(),
        });
      }

      // Web research
      if (tc.name === "WebSearch") {
        const input = tc.input as Record<string, unknown> | null;
        const query = typeof input?.query === "string" ? input.query : "";
        markers.push({ exchange_index: ex.index, type: "web_research", label: query });
      }
    }

    // Interrupts
    if (ex.is_interrupt) {
      markers.push({ exchange_index: ex.index, type: "interrupt", label: "User interrupted" });
    }
  }

  return markers;
}

/** Derive a legacy SegmentType from tool counts for backward compatibility */
export function deriveDisplayType(group: ActivityGroup): SegmentType {
  const tools = group.tool_counts;
  const editCount = (tools["Edit"] || 0) + (tools["Write"] || 0) + (tools["NotebookEdit"] || 0);
  const readCount = (tools["Read"] || 0) + (tools["Grep"] || 0) + (tools["Glob"] || 0);
  const totalTools = Object.values(tools).reduce((a, b) => a + b, 0);

  if (group.markers.some(m => m.type === "plan_enter" || m.type === "plan_exit")) return "planning";
  if (group.markers.some(m => m.type === "interrupt")) return "pivot";
  if (group.markers.some(m => m.type === "test_pass") && group.error_count === 0) return "testing";
  if (group.markers.some(m => m.type === "test_fail")) return "debugging";
  if (group.error_count > 0 && editCount > 0) return "debugging";
  if (editCount > 0) return "implementing";
  if (readCount > 0 && readCount >= totalTools * 0.4) return "exploring";
  if (totalTools === 0) return "discussion";
  return "discussion";
}

/** Build a group from a slice of exchanges */
function buildGroup(
  exchanges: ParsedExchange[],
  boundary: BoundaryType,
  milestoneMap: Map<number, ExtractedMilestone[]>,
): ActivityGroup {
  const filesRead = new Set<string>();
  const filesWritten = new Set<string>();

  for (const ex of exchanges) {
    const { read, written } = extractFilesForExchange(ex);
    for (const f of read) filesRead.add(f);
    for (const f of written) filesWritten.add(f);
  }

  const startTs = exchanges[0].timestamp;
  const endTs = exchanges[exchanges.length - 1].timestamp;
  const durationMs = new Date(endTs).getTime() - new Date(startTs).getTime();

  const models = [...new Set(
    exchanges.map(e => e.model).filter((m): m is string => m != null && m !== ""),
  )];

  return {
    exchange_index_start: exchanges[0].index,
    exchange_index_end: exchanges[exchanges.length - 1].index,
    started_at: startTs,
    ended_at: endTs,
    exchange_count: exchanges.length,
    tool_counts: countTools(exchanges),
    error_count: countErrors(exchanges),
    files_read: [...filesRead],
    files_written: [...filesWritten],
    total_input_tokens: exchanges.reduce((s, e) => s + (e.input_tokens ?? 0), 0),
    total_output_tokens: exchanges.reduce((s, e) => s + (e.output_tokens ?? 0), 0),
    total_cache_read_tokens: exchanges.reduce((s, e) => s + (e.cache_read_tokens ?? 0), 0),
    total_cache_write_tokens: exchanges.reduce((s, e) => s + (e.cache_write_tokens ?? 0), 0),
    duration_ms: Math.max(0, durationMs),
    models,
    markers: buildMarkers(exchanges, milestoneMap),
    boundary,
    ai_summary: null,
    ai_label: null,
  };
}

/**
 * Extract activity groups from parsed exchanges using boundary-based splitting.
 * Replaces the heuristic-based extractSegments().
 */
export function extractActivityGroups(
  exchanges: ParsedExchange[],
  milestones: ExtractedMilestone[],
): ActivityGroup[] {
  if (exchanges.length === 0) return [];

  // Build milestone lookup: exchange_index → milestones
  const milestoneMap = new Map<number, ExtractedMilestone[]>();
  for (const m of milestones) {
    if (!milestoneMap.has(m.exchange_index)) {
      milestoneMap.set(m.exchange_index, []);
    }
    milestoneMap.get(m.exchange_index)!.push(m);
  }

  // Phase 1: Detect boundary indices
  // Each boundary records: the exchange index where a new group starts, and why
  const boundaries: Array<{ index: number; type: BoundaryType }> = [];

  for (let i = 1; i < exchanges.length; i++) {
    const prev = exchanges[i - 1];
    const curr = exchanges[i];
    let boundaryType: BoundaryType | null = null;

    // Definitive boundaries (priority order — first match wins)

    // Plan mode
    if (curr.tool_calls.some(tc => tc.name === "EnterPlanMode" || tc.name === "ExitPlanMode")) {
      boundaryType = "plan_mode";
    }

    // Compaction
    if (!boundaryType && curr.is_compact_summary) {
      boundaryType = "compaction";
    }

    // Interrupt on previous exchange (split after it)
    if (!boundaryType && prev.is_interrupt) {
      boundaryType = "interrupt";
    }

    // Milestone at previous exchange
    if (!boundaryType) {
      const prevMs = milestoneMap.get(prev.index);
      if (prevMs && prevMs.length > 0) {
        // Pick highest priority milestone for boundary type
        const sorted = [...prevMs].sort((a, b) =>
          (MILESTONE_PRIORITY[b.milestone_type] || 0) - (MILESTONE_PRIORITY[a.milestone_type] || 0),
        );
        if (sorted.length > 0) {
          boundaryType = "milestone";
        }
      }
    }

    // Skill invocation
    if (!boundaryType && curr.tool_calls.some(tc => tc.name === "Skill")) {
      boundaryType = "skill";
    }

    // Branch change
    if (!boundaryType && prev.git_branch && curr.git_branch && prev.git_branch !== curr.git_branch) {
      boundaryType = "branch_change";
    }

    // Model switch
    if (!boundaryType && prev.model && curr.model && prev.model !== curr.model) {
      boundaryType = "model_switch";
    }

    // Soft boundaries

    // Long pause (>10 min gap)
    if (!boundaryType) {
      const prevTime = new Date(prev.timestamp).getTime();
      const currTime = new Date(curr.timestamp).getTime();
      if (currTime - prevTime > LONG_PAUSE_MS) {
        boundaryType = "long_pause";
      }
    }

    // File focus shift (completely new set of written files)
    if (!boundaryType) {
      const prevFiles = new Set(extractFilesForExchange(prev).written);
      const currFiles = new Set(extractFilesForExchange(curr).written);
      if (prevFiles.size > 0 && currFiles.size > 0) {
        let hasOverlap = false;
        for (const f of currFiles) {
          if (prevFiles.has(f)) { hasOverlap = true; break; }
        }
        if (!hasOverlap) {
          boundaryType = "file_focus_shift";
        }
      }
    }

    if (boundaryType) {
      boundaries.push({ index: i, type: boundaryType });
    }
  }

  // Phase 2: Split into groups
  const groups: ActivityGroup[] = [];
  let groupStart = 0;

  for (const boundary of boundaries) {
    const groupExchanges = exchanges.slice(groupStart, boundary.index);
    if (groupExchanges.length > 0) {
      groups.push(buildGroup(
        groupExchanges,
        boundary.type,
        milestoneMap,
      ));
    }
    groupStart = boundary.index;
  }

  // Final group
  const finalExchanges = exchanges.slice(groupStart);
  if (finalExchanges.length > 0) {
    groups.push(buildGroup(
      finalExchanges,
      "session_end",
      milestoneMap,
    ));
  }

  // Phase 3: Merge 1-exchange groups from soft boundaries into predecessor
  const SOFT_BOUNDARIES = new Set<BoundaryType>(["file_focus_shift", "long_pause"]);
  const merged: ActivityGroup[] = [];

  for (const group of groups) {
    if (
      group.exchange_count === 1 &&
      merged.length > 0 &&
      SOFT_BOUNDARIES.has(merged[merged.length - 1].boundary)
    ) {
      // Merge into predecessor
      const prev = merged[merged.length - 1];
      const combined = exchanges.filter(
        e => e.index >= prev.exchange_index_start && e.index <= group.exchange_index_end,
      );
      merged[merged.length - 1] = buildGroup(combined, group.boundary, milestoneMap);
    } else {
      merged.push(group);
    }
  }

  // Set first group boundary to session_start
  if (merged.length > 0) {
    merged[0] = { ...merged[0], boundary: "session_start" as BoundaryType };
  }

  return merged;
}
