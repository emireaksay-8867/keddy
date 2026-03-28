// ============================================================
// Keddy — Programmatic Mermaid Diagram Generator
//
// Zero AI cost. Generates a session flow diagram from
// pre-computed activity groups + milestones. Every node
// corresponds to real exchange ranges. Every label is factual.
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
}

export interface MermaidMilestone {
  milestone_type: string;
  exchange_index: number;
  description: string;
}

const MAX_NODES = 12;
const MAX_LABEL_LEN = 60;

/** Strip characters that break mermaid syntax */
function sanitize(text: string): string {
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

/** Determine node shape based on content */
function getNodeShape(group: MermaidGroup): "rect" | "diamond" | "stadium" | "hexagon" {
  const markerTypes = new Set(group.markers.map((m) => m.type));

  // Test results → diamond
  if (markerTypes.has("test_pass") || markerTypes.has("test_fail")) return "diamond";

  // Git milestones → stadium
  if (markerTypes.has("commit") || markerTypes.has("push") || markerTypes.has("pr") || markerTypes.has("branch")) return "stadium";

  // Interrupts or compaction → hexagon
  if (group.boundary === "interrupt" || group.boundary === "compaction") return "hexagon";

  return "rect";
}

/** Build label lines from group data */
function buildLabel(group: MermaidGroup): string {
  const lines: string[] = [];

  // Line 1: Exchange range
  if (group.exchange_start === group.exchange_end) {
    lines.push(`#${group.exchange_start}`);
  } else {
    lines.push(`#${group.exchange_start}-${group.exchange_end}`);
  }

  // Line 2: Files written (most important signal of what happened)
  if (group.files_written.length > 0) {
    const names = group.files_written.map(basename);
    if (names.length <= 2) {
      lines.push(names.join(", "));
    } else {
      lines.push(`${names[0]}, ${names[1]} +${names.length - 2} more`);
    }
  } else if (group.files_read.length > 0) {
    // Read-only group
    const count = group.files_read.length;
    if (count <= 2) {
      lines.push(`Read ${group.files_read.map(basename).join(", ")}`);
    } else {
      lines.push(`Read ${count} files`);
    }
  } else {
    // No file operations — show dominant tool
    const tools = Object.entries(group.tool_counts).sort((a, b) => b[1] - a[1]);
    if (tools.length > 0) {
      lines.push(`${tools[0][1]} ${tools[0][0]}`);
    } else {
      lines.push("discussion");
    }
  }

  // Line 3: Milestone descriptions (commit message, test result, PR title)
  const milestoneMarkers = group.markers.filter((m) =>
    ["commit", "push", "pr", "branch", "test_pass", "test_fail"].includes(m.type),
  );
  if (milestoneMarkers.length > 0) {
    // Show the most important milestone
    const ms = milestoneMarkers[0];
    lines.push(truncate(sanitize(ms.label), 50));
  }

  // Add error indicator if present
  if (group.error_count > 0 && !milestoneMarkers.some((m) => m.type === "test_fail")) {
    lines.push(`${group.error_count} error${group.error_count > 1 ? "s" : ""}`);
  }

  return truncate(sanitize(lines.join("<br/>")), MAX_LABEL_LEN * 3);
}

/** Wrap label in mermaid node shape syntax */
function wrapShape(id: string, label: string, shape: "rect" | "diamond" | "stadium" | "hexagon"): string {
  switch (shape) {
    case "diamond":
      return `    ${id}{"${label}"}`;
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
    boundary: a.boundary, // keep the first group's boundary
    files_written: [...new Set([...a.files_written, ...b.files_written])],
    files_read: [...new Set([...a.files_read, ...b.files_read])],
    tool_counts: Object.entries({ ...a.tool_counts }).reduce(
      (acc, [k, v]) => ({ ...acc, [k]: (acc[k] || 0) + v }),
      { ...b.tool_counts } as Record<string, number>,
    ),
    error_count: a.error_count + b.error_count,
    markers: [...a.markers, ...b.markers].sort((x, y) => x.exchange_index - y.exchange_index),
  };
}

/** Edge label for boundary transitions */
function edgeLabel(boundary: string | null): string {
  switch (boundary) {
    case "interrupt": return " -->|interrupted| ";
    case "compaction": return " -->|compacted| ";
    case "branch_change": return " -->|branch change| ";
    case "plan_mode": return " -->|plan mode| ";
    default: return " --> ";
  }
}

/**
 * Generate a mermaid flowchart from pre-computed activity groups and milestones.
 * Returns empty string if insufficient data.
 *
 * @param forkExchangeIndex - If set, filter out groups entirely before this exchange
 */
export function generateSessionMermaid(
  groups: MermaidGroup[],
  _milestones: MermaidMilestone[],
  forkExchangeIndex?: number | null,
): string {
  // Filter out inherited groups for forked sessions
  const filtered = forkExchangeIndex != null
    ? groups.filter((g) => g.exchange_end >= forkExchangeIndex)
    : groups;
  if (filtered.length === 0) return "";

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

  // A single node communicates no flow — let the AI generate from transcript instead
  if (merged.length <= 1) return "";

  // Phase 3: Generate mermaid
  const lines: string[] = ["graph LR"];

  // Node definitions
  for (let i = 0; i < merged.length; i++) {
    const group = merged[i];
    const id = `N${i}`;
    const label = buildLabel(group);
    const shape = getNodeShape(group);
    lines.push(wrapShape(id, label, shape));
  }

  // Edges
  lines.push("");
  for (let i = 0; i < merged.length - 1; i++) {
    const nextBoundary = merged[i + 1].boundary;
    lines.push(`    N${i}${edgeLabel(nextBoundary)}N${i + 1}`);
  }

  return lines.join("\n");
}
