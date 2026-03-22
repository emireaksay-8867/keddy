import type { ParsedExchange } from "../types.js";
import type { SegmentType } from "../types.js";

export interface ExtractedSegment {
  segment_type: SegmentType;
  exchange_index_start: number;
  exchange_index_end: number;
  files_touched: string[];
  tool_counts: Record<string, number>;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);
const MCP_QUERY_PATTERN = /^mcp__/;
const TEST_PATTERNS = [/\btest\b/i, /\bjest\b/i, /\bvitest\b/i, /\bpytest\b/i, /\bmocha\b/i, /\bcargo test\b/i, /\bgo test\b/i];
const DEPLOY_PATTERNS = [/\bgit push\b/, /\bdeploy\b/i, /\bnpm publish\b/];

function classifyExchange(exchange: ParsedExchange): SegmentType {
  const toolCalls = exchange.tool_calls;
  if (toolCalls.length === 0) return "discussion";

  // Planning — definitive signal
  if (toolCalls.some((tc) => tc.name === "EnterPlanMode" || tc.name === "ExitPlanMode")) {
    return "planning";
  }

  // Pivot — user interrupted
  if (exchange.is_interrupt) return "pivot";

  const toolNames = toolCalls.map((tc) => tc.name);
  const hasEdits = toolNames.some((n) => EDIT_TOOLS.has(n));
  const hasErrors = toolCalls.some((tc) => tc.is_error);
  const editCount = toolNames.filter((n) => EDIT_TOOLS.has(n)).length;
  const readCount = toolNames.filter((n) => READ_TOOLS.has(n)).length;
  const mcpCount = toolNames.filter((n) => MCP_QUERY_PATTERN.test(n)).length;
  const agentCount = toolNames.filter((n) => n === "Agent").length;

  const bashInputs = toolCalls
    .filter((tc) => tc.name === "Bash")
    .map((tc) => {
      if (typeof tc.input === "object" && tc.input !== null && "command" in tc.input) {
        return String((tc.input as { command: unknown }).command);
      }
      return typeof tc.input === "string" ? tc.input : "";
    });

  // Testing — Bash with test commands
  if (bashInputs.some((cmd) => TEST_PATTERNS.some((p) => p.test(cmd)))) {
    return hasErrors ? "debugging" : "testing";
  }

  // Deploying — ONLY standalone deployment (no edits, few tools)
  const deployCommands = bashInputs.filter((cmd) => DEPLOY_PATTERNS.some((p) => p.test(cmd)));
  if (deployCommands.length > 0 && !hasEdits && toolCalls.length <= 5) return "deploying";

  // Debugging — errors + edits (fixing something that broke)
  if (hasErrors && hasEdits) return "debugging";

  // Implementing — ANY edit/write call means code is being changed
  if (editCount > 0) return "implementing";

  // Querying — MCP database/API calls as significant activity
  if (mcpCount > 0 && mcpCount >= toolNames.length * 0.3) return "querying";

  // Reviewing — Agent subagent calls + reads (code review, investigation)
  if (agentCount > 0 && readCount > 0) return "reviewing";

  // Exploring — mostly read/search tools, no edits
  if (readCount > 0 && readCount >= toolNames.length * 0.4) return "exploring";

  // Discussion — everything else
  return "discussion";
}

function extractFiles(exchange: ParsedExchange): string[] {
  const files = new Set<string>();
  for (const tc of exchange.tool_calls) {
    if (typeof tc.input !== "object" || tc.input === null) continue;
    const input = tc.input as Record<string, unknown>;
    if (typeof input.file_path === "string") files.add(input.file_path);
    if (typeof input.path === "string") files.add(input.path);
  }
  return Array.from(files);
}

function countTools(exchanges: ParsedExchange[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ex of exchanges) {
    for (const tc of ex.tool_calls) {
      counts[tc.name] = (counts[tc.name] || 0) + 1;
    }
  }
  return counts;
}

export function extractSegments(exchanges: ParsedExchange[]): ExtractedSegment[] {
  if (exchanges.length === 0) return [];

  const classifications = exchanges.map((ex) => ({
    exchange: ex,
    type: classifyExchange(ex),
  }));

  // Merge adjacent same-type
  const rawSegments: { type: SegmentType; exchanges: ParsedExchange[] }[] = [];
  let current = { type: classifications[0].type, exchanges: [classifications[0].exchange] };

  for (let i = 1; i < classifications.length; i++) {
    if (classifications[i].type === current.type) {
      current.exchanges.push(classifications[i].exchange);
    } else {
      rawSegments.push(current);
      current = { type: classifications[i].type, exchanges: [classifications[i].exchange] };
    }
  }
  rawSegments.push(current);

  // Merge small segments (< 2 exchanges) into neighbors
  const merged: typeof rawSegments = [];
  for (const seg of rawSegments) {
    if (seg.exchanges.length < 2 && merged.length > 0) {
      merged[merged.length - 1].exchanges.push(...seg.exchanges);
    } else {
      merged.push(seg);
    }
  }
  if (merged.length === 0 && rawSegments.length > 0) {
    merged.push(...rawSegments);
  }

  // Merge consecutive discussion blocks
  const final: typeof rawSegments = [];
  for (const seg of merged) {
    if (seg.type === "discussion" && final.length > 0 && final[final.length - 1].type === "discussion") {
      final[final.length - 1].exchanges.push(...seg.exchanges);
    } else {
      final.push(seg);
    }
  }

  return final.map((seg) => {
    const allFiles = seg.exchanges.flatMap(extractFiles);
    return {
      segment_type: seg.type,
      exchange_index_start: seg.exchanges[0].index,
      exchange_index_end: seg.exchanges[seg.exchanges.length - 1].index,
      files_touched: [...new Set(allFiles)],
      tool_counts: countTools(seg.exchanges),
    };
  });
}
