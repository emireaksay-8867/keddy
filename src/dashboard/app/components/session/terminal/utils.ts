import type { ToolCall } from "../../../lib/types.js";

// ── System tools filtered from activity view ─────────────────
export const SYSTEM_TOOLS = new Set([
  "TaskCreate", "TaskUpdate",
  "TaskStop", "TaskGet", "TaskList", "TaskOutput", "ToolSearch",
  "ExitWorktree", "EnterWorktree",
]);

// Plan mode tools — shown as special dividers, not regular tool tree lines
export const PLAN_MODE_TOOLS = new Set(["EnterPlanMode", "ExitPlanMode"]);

// ── Parsing helpers ──────────────────────────────────────────
export function safeParseInput(json: string): Record<string, unknown> {
  try { return JSON.parse(json || "{}"); } catch { return {}; }
}

export function shortPath(fp: string): string {
  return fp.split("/").pop() || fp;
}

export function countLines(s: string | null | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

// ── Formatting helpers ───────────────────────────────────────
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// ── Tool result summary ──────────────────────────────────────
export function resultSummary(tc: ToolCall): string {
  if (!tc.tool_result && !tc.is_error) return "(no output)";
  if (tc.is_error && tc.tool_result) {
    const first = tc.tool_result.split("\n")[0]?.substring(0, 80) || "Error";
    return `\u2717 ${first}`;
  }
  const result = tc.tool_result || "";
  const lines = countLines(result);
  const input = safeParseInput(tc.tool_input);

  switch (tc.tool_name) {
    case "Read":
      return `Read ${lines} line${lines !== 1 ? "s" : ""}`;
    case "Edit": {
      const newStr = (input.new_string as string) || "";
      const n = countLines(newStr);
      return `Edited ${n} line${n !== 1 ? "s" : ""}`;
    }
    case "Write": {
      const content = (input.content as string) || "";
      const n = countLines(content);
      return `Wrote ${n} line${n !== 1 ? "s" : ""}`;
    }
    case "Bash":
      return "\u2713";
    case "Grep": {
      const match = result.match(/^(\d+) /);
      if (match) return `${match[1]} files matched`;
      return `${lines} line${lines !== 1 ? "s" : ""}`;
    }
    case "Glob":
      return `${lines} file${lines !== 1 ? "s" : ""} found`;
    case "Agent": {
      if (result) {
        for (const line of result.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && trimmed.length > 10 && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
            return trimmed.length > 80 ? trimmed.substring(0, 77) + "\u2026" : trimmed;
          }
        }
      }
      return "Done";
    }
    case "WebSearch": return "Results";
    case "WebFetch": return "Fetched";
    case "Skill": return "Done";
    default:
      if (tc.tool_name.startsWith("mcp__")) return "Done";
      return lines > 1 ? `${lines} lines` : result.substring(0, 60) || "Done";
  }
}

// ── Tool summary for header line ─────────────────────────────
export function toolSummaryText(tc: ToolCall): { name: string; summary: string } {
  const input = safeParseInput(tc.tool_input);
  const name = tc.tool_name.startsWith("mcp__")
    ? `MCP ${tc.tool_name.replace(/^mcp__\w+__/, "")}`
    : tc.tool_name;

  switch (tc.tool_name) {
    case "Read": {
      const fp = tc.file_path || (input.file_path as string) || "";
      return { name: "Read", summary: shortPath(fp) };
    }
    case "Edit": {
      const fp = tc.file_path || (input.file_path as string) || "";
      const replaceAll = input.replace_all ? " (replace all)" : "";
      return { name: "Edit", summary: `${shortPath(fp)}${replaceAll}` };
    }
    case "Write": {
      const fp = tc.file_path || (input.file_path as string) || "";
      return { name: "Write", summary: shortPath(fp) };
    }
    case "Bash": {
      const desc = tc.bash_desc || (input.description as string) || "";
      return { name: "Bash", summary: desc };
    }
    case "Grep": {
      const pattern = (input.pattern as string) || "";
      const path = (input.path as string) || "";
      return { name: "Grep", summary: `/${pattern}/${path ? ` in ${shortPath(path)}` : ""}` };
    }
    case "Glob":
      return { name: "Glob", summary: (input.pattern as string) || "" };
    case "Agent": {
      const desc = tc.subagent_desc || (input.description as string) || "";
      const shortDesc = desc.length > 60 ? desc.substring(0, 60) + "\u2026" : desc;
      return { name: "Agent", summary: shortDesc };
    }
    case "WebSearch":
      return { name: "WebSearch", summary: `"${tc.web_query || (input.query as string) || ""}"` };
    case "WebFetch":
      return { name: "WebFetch", summary: tc.web_url || (input.url as string) || "" };
    case "Skill":
      return { name: "Skill", summary: tc.skill_name || (input.skill as string) || "" };
    default:
      if (tc.tool_name.startsWith("mcp__")) {
        const toolName = tc.tool_name.replace(/^mcp__\w+__/, "");
        return { name: "MCP", summary: toolName };
      }
      return { name, summary: tc.bash_desc || Object.keys(input).slice(0, 3).join(", ") || "" };
  }
}

// ── Edit summary text ────────────────────────────────────────
export function editSummaryText(oldStr: string, newStr: string): string {
  const oldLines = oldStr ? oldStr.split("\n").length : 0;
  const newLines = newStr ? newStr.split("\n").length : 0;
  const diff = newLines - oldLines;
  if (oldLines === 0 && newLines > 0) return `Added ${newLines} line${newLines !== 1 ? "s" : ""}`;
  if (newLines === 0 && oldLines > 0) return `Removed ${oldLines} line${oldLines !== 1 ? "s" : ""}`;
  if (diff > 0) return `Added ${diff} line${diff !== 1 ? "s" : ""}`;
  if (diff < 0) return `Removed ${Math.abs(diff)} line${Math.abs(diff) !== 1 ? "s" : ""}`;
  return "Modified";
}

// ── Result cap per tool type ─────────────────────────────────
export function resultCap(toolName: string): number {
  if (toolName === "Bash" || toolName === "Agent" || toolName === "Read") return 10000;
  if (toolName === "Grep" || toolName === "Glob") return 8000;
  return 5000;
}
