import { useState } from "react";
import type { ToolCall } from "../../../lib/types.js";
import { DiffBlock } from "./DiffBlock.js";
import { SyntaxBlock } from "./SyntaxBlock.js";
import { detectLanguage, toolNameBg } from "./constants.js";

function safeParseInput(json: string): Record<string, unknown> {
  try { return JSON.parse(json || "{}"); } catch { return {}; }
}

function shortPath(fp: string): string {
  return fp.split("/").pop() || fp;
}

function countLines(s: string | null | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

/** One-line result description per tool type */
function resultSummary(tc: ToolCall): string {
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

/** Tool summary text for the ⏺ line */
function toolSummaryText(tc: ToolCall): { name: string; summary: string } {
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
      const cmd = tc.bash_command || (input.command as string) || "";
      const desc = tc.bash_desc || (input.description as string) || "";
      const text = cmd || desc;
      return { name: "Bash", summary: text.length > 80 ? text.substring(0, 80) + "\u2026" : text };
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
      const type = tc.subagent_type || (input.subagent_type as string) || "";
      const shortDesc = desc.length > 60 ? desc.substring(0, 60) + "\u2026" : desc;
      return { name: "Agent", summary: type ? `[${type}] ${shortDesc}` : shortDesc };
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

export function ToolCallBlock({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const isError = !!tc.is_error;
  const { name, summary } = toolSummaryText(tc);
  const result = resultSummary(tc);
  const input = safeParseInput(tc.tool_input);
  const bg = toolNameBg(name);

  // Edit diff — always visible at L1, now using proper DiffBlock
  const editDiff = tc.tool_name === "Edit" ? (() => {
    const oldStr = (input.old_string as string) || "";
    const newStr = (input.new_string as string) || "";
    if (!oldStr && !newStr) return null;
    return <DiffBlock oldStr={oldStr} newStr={newStr} />;
  })() : null;

  // L2 detail content (per tool type)
  const detailContent = expanded ? (() => {
    const fp = tc.file_path || (input.file_path as string) || "";
    switch (tc.tool_name) {
      case "Read": {
        const offset = input.offset ? `:${input.offset}` : "";
        const limit = input.limit ? `+${input.limit}` : "";
        return (
          <div className="text-[11px] ml-6" style={{ color: "var(--cc-dim)" }}>
            {fp}{offset}{limit}
            {fp && <a href={`vscode://file${fp}`} className="ml-2 hover:underline" style={{ color: "var(--cc-dim)" }}>&rarr; open</a>}
          </div>
        );
      }
      case "Edit":
      case "Write": {
        const replaceAll = input.replace_all ? " (replace all)" : "";
        return (
          <div className="text-[11px] ml-6" style={{ color: "var(--cc-dim)" }}>
            {fp}{replaceAll}
            {fp && <a href={`vscode://file${fp}`} className="ml-2 hover:underline" style={{ color: "var(--cc-dim)" }}>&rarr; open</a>}
          </div>
        );
      }
      case "Bash": {
        const cmd = tc.bash_command || (input.command as string) || "";
        const desc = tc.bash_desc || (input.description as string) || "";
        return (
          <div className="text-[11px] ml-6 my-0.5 px-2 py-1 whitespace-pre-wrap rounded"
            style={{ borderLeft: "2px solid var(--cc-bash-border)", color: "var(--cc-dim)" }}>
            {cmd && <div>$ {cmd}</div>}
            {desc && cmd && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{desc}</div>}
          </div>
        );
      }
      case "Grep": {
        const pattern = (input.pattern as string) || "";
        const path = (input.path as string) || "";
        const glob = (input.glob as string) || "";
        return (
          <div className="text-[11px] ml-6" style={{ color: "var(--cc-dim)" }}>
            pattern: /{pattern}/
            {path && <span> path: {path}</span>}
            {glob && <span> glob: {glob}</span>}
          </div>
        );
      }
      case "Glob":
        return (
          <div className="text-[11px] ml-6" style={{ color: "var(--cc-dim)" }}>
            pattern: {(input.pattern as string) || ""}{(input.path as string) ? ` in ${input.path}` : ""}
          </div>
        );
      case "Agent": {
        const desc = tc.subagent_desc || (input.description as string) || "";
        const type = tc.subagent_type || (input.subagent_type as string) || "";
        return (
          <div className="text-[11px] ml-6 whitespace-pre-wrap" style={{ color: "var(--cc-dim)" }}>
            {type && <div>type: {type}</div>}
            <div>{desc}</div>
          </div>
        );
      }
      case "WebSearch":
        return (
          <div className="text-[11px] ml-6" style={{ color: "var(--cc-dim)" }}>
            query: {tc.web_query || (input.query as string) || ""}
          </div>
        );
      case "WebFetch":
        return (
          <div className="text-[11px] ml-6" style={{ color: "var(--cc-dim)" }}>
            url: {tc.web_url || (input.url as string) || ""}
          </div>
        );
      default:
        return null;
    }
  })() : null;

  // L3 result content — with syntax highlighting for Read/Bash
  const resultContent = resultExpanded && tc.tool_result ? (() => {
    const cap = tc.tool_name === "Bash" || tc.tool_name === "Agent" || tc.tool_name === "Read" ? 10000
      : tc.tool_name === "Grep" || tc.tool_name === "Glob" ? 8000
      : 5000;
    const text = tc.tool_result.substring(0, cap);
    const truncated = tc.tool_result.length > cap;
    const fp = tc.file_path || (input.file_path as string) || "";

    // Use syntax highlighting for Read and Bash results
    if ((tc.tool_name === "Read" || tc.tool_name === "Bash") && fp) {
      const lang = tc.tool_name === "Bash" ? "bash" : detectLanguage(fp);
      return (
        <div className="ml-6 mt-0.5">
          <SyntaxBlock code={text + (truncated ? "\n\u2026 (truncated)" : "")} language={lang} />
        </div>
      );
    }

    return (
      <div className="ml-6 mt-0.5">
        <div className="text-[11px] whitespace-pre-wrap max-h-[400px] overflow-y-auto py-1.5 px-3 rounded"
          style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {text}
          {truncated && "\n\u2026 (truncated)"}
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="my-0.5">
      {/* ⏺ Tool summary line — green success, red error */}
      <div
        className="cursor-pointer select-none py-0.5 -mx-1 px-1 rounded hover:bg-[var(--bg-hover)]"
        onClick={() => { setExpanded(!expanded); if (expanded) setResultExpanded(false); }}
      >
        <span style={{ color: isError ? "var(--cc-error)" : "var(--cc-success)" }}>
          {"\u00A0\u00A0"}{"\u2B24"}{" "}
        </span>
        <span className="font-bold" style={{ color: "var(--text-secondary)", background: bg, borderRadius: bg ? "3px" : undefined, padding: bg ? "0 4px" : undefined }}>
          {name}
        </span>
        {summary && <span style={{ color: isError ? "var(--cc-error)" : "var(--text-tertiary)" }}>{" "}{summary}</span>}
      </div>

      {/* L2 detail */}
      {detailContent}

      {/* ⎿ Result line — always dimmed */}
      <div
        className={`py-0.5 -mx-1 px-1 rounded ${expanded && tc.tool_result ? "cursor-pointer hover:bg-[var(--bg-hover)]" : ""}`}
        onClick={expanded && tc.tool_result ? () => setResultExpanded(!resultExpanded) : undefined}
      >
        <span style={{ color: "var(--cc-dim)" }}>
          {"\u00A0\u00A0\u00A0\u00A0"}{"\u23BF"}{"\u00A0\u00A0"}
          <span style={{ color: isError ? "var(--cc-error)" : "var(--cc-dim)" }}>{result}</span>
        </span>
      </div>

      {/* Edit diff — always visible */}
      {editDiff}

      {/* L3 full result */}
      {resultContent}
    </div>
  );
}
