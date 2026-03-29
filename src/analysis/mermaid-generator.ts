// ============================================================
// Keddy — Programmatic Mermaid Diagram Generator
//
// Zero AI cost. Generates a session flow diagram from
// pre-computed activity groups + milestones. Every node
// corresponds to real exchange ranges. Every label is factual.
//
// Label priority: commit > PR > plan title > push > branch >
// subagent > web_research > skill > bash_desc > files > tools
// ============================================================

export interface MermaidGroup {
  exchange_start: number;
  exchange_end: number;
  exchange_count: number;
  boundary: string | null;
  files_written: string[];
  files_read: string[];
  tool_counts: Record<string, number>;
  error_count: number;
  markers: Array<{ exchange_index: number; type: string; label: string }>;
  // Enriched fields:
  duration_ms: number;
  bash_descs: string[];
  plan_title: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface MermaidMilestone {
  milestone_type: string;
  exchange_index: number;
  description: string;
}

export interface MermaidNodeMeta {
  index: number;
  exchange_start: number;
  exchange_end: number;
}

export interface MermaidResult {
  mermaid: string;
  nodes: MermaidNodeMeta[];
}

const MAX_NODES = 12;

/** Strip characters that break mermaid syntax (applied per-line, NOT to joined output) */
function sanitizeLine(text: string): string {
  return text
    .replace(/["\[\]{}()<>|#&]/g, "")
    .replace(/`/g, "'")
    .replace(/\n/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + "...";
}

function basename(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

function formatDuration(ms: number): string | null {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  if (ms >= 10000) return `${Math.round(ms / 1000)}s`;
  return null;
}

/** Exchange range prefix */
function rangePrefix(group: MermaidGroup): string {
  if (group.exchange_start === group.exchange_end) {
    return `${group.exchange_start}`;
  }
  return `${group.exchange_start}-${group.exchange_end}`;
}

/** Determine node shape based on content */
function getNodeShape(group: MermaidGroup): "rect" | "stadium" | "hexagon" {
  const markerTypes = new Set(group.markers.map((m) => m.type));

  // Git output → stadium (rounded)
  if (markerTypes.has("commit") || markerTypes.has("push") || markerTypes.has("pr") || markerTypes.has("branch")) return "stadium";

  // Context break → hexagon
  if (group.boundary === "interrupt" || group.boundary === "compaction") return "hexagon";

  return "rect";
}

/** Determine node style class */
function getNodeClass(group: MermaidGroup): string {
  const types = new Set(group.markers.map((m) => m.type));

  if (types.has("commit") || types.has("push") || types.has("pr") || types.has("branch")) return "gitop";
  if (types.has("plan_enter") || types.has("plan_exit")) return "planning";
  if (types.has("test_fail") || group.error_count >= 3) return "failure";
  if (group.boundary === "interrupt" || group.boundary === "compaction") return "breakpoint";
  return "normal";
}

/** Build label lines from group data using priority chain */
function buildLabel(group: MermaidGroup, expanded = false): string {
  const lines: string[] = [];
  const range = rangePrefix(group);
  const maxLabel = expanded ? 90 : 45;
  const maxLabelShort = expanded ? 70 : 35;
  let primarySource: "milestone" | "plan" | "subagent" | "action" | "files" | "fallback" = "fallback";

  // === LINE 1: Primary label — walk priority chain, first match wins ===

  // Priority 1: commit message
  const commit = group.markers.find((m) => m.type === "commit");
  if (commit) {
    lines.push(`${range} · ${truncate(commit.label, maxLabel)}`);
    primarySource = "milestone";
  }

  // Priority 2: PR title
  if (!lines.length) {
    const pr = group.markers.find((m) => m.type === "pr");
    if (pr) {
      lines.push(`${range} · ${truncate(pr.label, maxLabel)}`);
      primarySource = "milestone";
    }
  }

  // Priority 3: plan title (matched from plans table)
  if (!lines.length && group.plan_title) {
    lines.push(`${range} · ${truncate(group.plan_title, maxLabel)}`);
    primarySource = "plan";
  }

  // Priority 4: push
  if (!lines.length) {
    const push = group.markers.find((m) => m.type === "push");
    if (push) {
      lines.push(`${range} · ${truncate(push.label, maxLabel)}`);
      primarySource = "milestone";
    }
  }

  // Priority 5: branch
  if (!lines.length) {
    const branch = group.markers.find((m) => m.type === "branch");
    if (branch) {
      lines.push(`${range} · ${truncate(branch.label, maxLabel)}`);
      primarySource = "milestone";
    }
  }

  // Priority 6: subagent description (strip type prefix like "general-purpose: ")
  if (!lines.length) {
    const subagents = group.markers.filter((m) => m.type === "subagent");
    if (subagents.length > 0) {
      const stripPrefix = (label: string) => {
        const colonIdx = label.indexOf(": ");
        return colonIdx >= 0 ? label.substring(colonIdx + 2) : label;
      };
      if (subagents.length === 1) {
        lines.push(`${range} · ${truncate(stripPrefix(subagents[0].label), maxLabel)}`);
      } else {
        lines.push(`${range} · ${truncate(stripPrefix(subagents[0].label), maxLabelShort)} +${subagents.length - 1}`);
      }
      primarySource = "subagent";
    }
  }

  // Priority 7: web_research
  if (!lines.length) {
    const web = group.markers.find((m) => m.type === "web_research");
    if (web) {
      lines.push(`${range} · ${truncate(web.label, maxLabel)}`);
      primarySource = "action";
    }
  }

  // Priority 8: skill
  if (!lines.length) {
    const skill = group.markers.find((m) => m.type === "skill");
    if (skill) {
      lines.push(`${range} · ${skill.label}`);
      primarySource = "action";
    }
  }

  // Priority 9: bash_desc
  if (!lines.length && group.bash_descs.length > 0) {
    lines.push(`${range} · ${truncate(group.bash_descs[0], maxLabel)}`);
    primarySource = "action";
  }

  // Priority 10: files_written
  if (!lines.length && group.files_written.length > 0) {
    const names = group.files_written.map(basename);
    if (names.length <= 2) {
      lines.push(`${range} · ${names.join(", ")}`);
    } else {
      lines.push(`${range} · ${names[0]}, ${names[1]} +${names.length - 2} more`);
    }
    primarySource = "files";
  }

  // Priority 11: files_read (read-only)
  if (!lines.length && group.files_read.length > 0) {
    if (group.files_read.length <= 2) {
      lines.push(`${range} · Read ${group.files_read.map(basename).join(", ")}`);
    } else {
      lines.push(`${range} · Read ${group.files_read.length} files`);
    }
    primarySource = "files";
  }

  // Priority 12: dominant tool
  if (!lines.length) {
    const tools = Object.entries(group.tool_counts).sort((a, b) => b[1] - a[1]);
    if (tools.length > 0) {
      lines.push(`${range} · ${tools[0][1]} ${tools[0][0]}`);
    } else {
      lines.push(`${range} · discussion`);
    }
    primarySource = "fallback";
  }

  // === LINE 2: Context ===
  if (primarySource === "milestone" || primarySource === "plan") {
    // Show files that were changed (context for the milestone/plan)
    if (group.files_written.length > 0) {
      const names = group.files_written.map(basename);
      if (names.length <= 2) {
        lines.push(names.join(", "));
      } else {
        lines.push(`${names[0]} +${names.length - 1} more`);
      }
    }
  } else if (primarySource === "files" || primarySource === "fallback") {
    if (group.error_count >= 3) {
      lines.push(`${group.error_count} errors`);
    }
  }

  // === LINE 3: Duration ===
  const dur = formatDuration(group.duration_ms);
  if (dur) {
    lines.push(dur);
  }

  return lines.map(sanitizeLine).join("<br/>");
}

/** Wrap label in mermaid node shape syntax */
function wrapShape(id: string, label: string, shape: "rect" | "stadium" | "hexagon"): string {
  switch (shape) {
    case "stadium":
      return `    ${id}(["${label}"])`;
    case "hexagon":
      return `    ${id}{{"${label}"}}`;
    default:
      return `    ${id}["${label}"]`;
  }
}

/** Merge two adjacent groups into one */
function mergeGroups(a: MermaidGroup, b: MermaidGroup): MermaidGroup {
  return {
    exchange_start: Math.min(a.exchange_start, b.exchange_start),
    exchange_end: Math.max(a.exchange_end, b.exchange_end),
    exchange_count: a.exchange_count + b.exchange_count,
    boundary: a.boundary,
    files_written: [...new Set([...a.files_written, ...b.files_written])],
    files_read: [...new Set([...a.files_read, ...b.files_read])],
    tool_counts: Object.entries({ ...a.tool_counts }).reduce(
      (acc, [k, v]) => ({ ...acc, [k]: (acc[k] || 0) + v }),
      { ...b.tool_counts } as Record<string, number>,
    ),
    error_count: a.error_count + b.error_count,
    markers: [...a.markers, ...b.markers].sort((x, y) => x.exchange_index - y.exchange_index),
    duration_ms: a.duration_ms + b.duration_ms,
    bash_descs: [...a.bash_descs, ...b.bash_descs],
    plan_title: a.plan_title || b.plan_title,
    started_at: a.started_at || b.started_at,
    ended_at: b.ended_at || a.ended_at,
  };
}

/** Edge between two groups — dotted for soft boundaries, solid for hard */
function buildEdge(current: MermaidGroup, next: MermaidGroup, currentIdx: number, nextIdx: number): string {
  const boundary = next.boundary;

  // Soft boundaries → dotted edges
  if (boundary === "long_pause") {
    if (current.ended_at && next.started_at) {
      const gap = new Date(next.started_at).getTime() - new Date(current.ended_at).getTime();
      if (gap > 0) {
        const label = formatDuration(gap);
        if (label) return `    N${currentIdx} -.->|"${label} pause"| N${nextIdx}`;
      }
    }
    return `    N${currentIdx} -.-> N${nextIdx}`;
  }
  if (boundary === "file_focus_shift") return `    N${currentIdx} -.-> N${nextIdx}`;

  // Hard boundaries → solid edges with labels
  if (boundary === "interrupt") return `    N${currentIdx} -->|"interrupted"| N${nextIdx}`;
  if (boundary === "compaction") return `    N${currentIdx} -->|"compacted"| N${nextIdx}`;
  if (boundary === "branch_change") return `    N${currentIdx} -->|"branch change"| N${nextIdx}`;
  if (boundary === "plan_mode") return `    N${currentIdx} -->|"plan mode"| N${nextIdx}`;

  return `    N${currentIdx} --> N${nextIdx}`;
}

/** Generate classDef block for node styling */
function buildClassDefs(): string {
  return [
    '    classDef gitop fill:#1a1a0a,stroke:#ca8a04,color:#fbbf24',
    '    classDef planning fill:#1a1a2e,stroke:#6366f1,color:#a5b4fc',
    '    classDef failure fill:#2d0f0f,stroke:#dc2626,color:#f87171',
    '    classDef breakpoint fill:#1c1917,stroke:#78716c,color:#d6d3d1',
    '    classDef normal fill:#18181b,stroke:#3f3f46,color:#fafafa',
  ].join("\n");
}

/**
 * Generate a mermaid flowchart from pre-computed activity groups and milestones.
 * Returns empty result if insufficient data.
 *
 * @param forkExchangeIndex - If set, filter out groups entirely before this exchange
 */
export function generateSessionMermaid(
  groups: MermaidGroup[],
  _milestones: MermaidMilestone[],
  forkExchangeIndex?: number | null,
  expanded?: boolean,
): MermaidResult {
  const empty: MermaidResult = { mermaid: "", nodes: [] };

  // Filter out inherited groups for forked sessions
  const filtered = forkExchangeIndex != null
    ? groups.filter((g) => g.exchange_end >= forkExchangeIndex)
    : groups;
  if (filtered.length === 0) return empty;

  // Phase 1: Merge small groups (1 exchange, no markers, no files_written)
  let merged: MermaidGroup[] = [];
  for (const group of filtered) {
    const isSmall = group.exchange_count <= 1
      && group.markers.length === 0
      && group.files_written.length === 0;

    if (isSmall && merged.length > 0) {
      merged[merged.length - 1] = mergeGroups(merged[merged.length - 1], group);
    } else {
      merged.push({ ...group });
    }
  }

  // Phase 2: Cap at MAX_NODES by merging smallest adjacent pairs
  while (merged.length > MAX_NODES) {
    let minSize = Infinity;
    let minIdx = 0;
    for (let i = 0; i < merged.length - 1; i++) {
      const combined = merged[i].exchange_count + merged[i + 1].exchange_count;
      if (combined < minSize) {
        minSize = combined;
        minIdx = i;
      }
    }
    const mergedGroup = mergeGroups(merged[minIdx], merged[minIdx + 1]);
    merged.splice(minIdx, 2, mergedGroup);
  }

  // A single node communicates no flow
  if (merged.length <= 1) return empty;

  // Phase 3: Generate mermaid
  const lines: string[] = [expanded ? "graph TD" : "graph LR"];

  // ClassDef declarations
  lines.push("");
  lines.push(buildClassDefs());
  lines.push('    classDef startend fill:#18181b,stroke:#52525b,color:#a1a1aa,font-size:11px');

  // Start node
  lines.push("");
  lines.push('    S(["Start"])');

  // Node definitions
  lines.push("");
  const nodeClasses: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    const group = merged[i];
    const id = `N${i}`;
    const label = buildLabel(group, expanded);
    const shape = getNodeShape(group);
    lines.push(wrapShape(id, label, shape));
    nodeClasses.push(`    class ${id} ${getNodeClass(group)}`);
  }

  // End node
  lines.push('    E(["End"])');

  // Edges: Start → N0, then normal flow, then last → End
  lines.push("");
  lines.push("    S --> N0");
  for (let i = 0; i < merged.length - 1; i++) {
    lines.push(buildEdge(merged[i], merged[i + 1], i, i + 1));
  }
  lines.push(`    N${merged.length - 1} --> E`);

  // Class assignments
  lines.push("");
  lines.push("    class S startend");
  lines.push("    class E startend");
  for (const cls of nodeClasses) {
    lines.push(cls);
  }

  // Build node metadata for click-to-expand
  const nodes: MermaidNodeMeta[] = merged.map((g, i) => ({
    index: i,
    exchange_start: g.exchange_start,
    exchange_end: g.exchange_end,
  }));

  return { mermaid: lines.join("\n"), nodes };
}
