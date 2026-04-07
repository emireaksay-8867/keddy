import { useState, useMemo, type ReactNode } from "react";
import type { SessionDetail, Exchange, Plan, GitDetail, Milestone, CompactionEvent, ToolCall, ContentBlockRef } from "../../lib/types.js";
import { cleanText } from "../../lib/cleanText.js";
import { GitCommitHorizontal, GitPullRequest, ArrowUp, GitBranch, SquareArrowOutUpRight, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { ClaudeIcon } from "../ClaudeIcon.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SYSTEM_TOOLS, PLAN_MODE_TOOLS, toolSummaryText, resultSummary, safeParseInput, shortPath, editSummaryText } from "./terminal/utils.js";
import { DiffBlock } from "./terminal/DiffBlock.js";
import { SyntaxBlock } from "./terminal/SyntaxBlock.js";
import { detectLanguage } from "./terminal/constants.js";

// ── Helpers ────────────────────────────────────────────────────
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }

const MS_CONFIG: Record<string, { symbol: string; color: string }> = {
  test_pass: { symbol: "\u2713", color: "#10b981" },
  test_fail: { symbol: "\u2717", color: "#ef4444" },
};


// ── Markdown stripping (for card previews — always clean text) ─
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")           // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")        // bold
    .replace(/\*(.+?)\*/g, "$1")            // italic
    .replace(/_(.+?)_/g, "$1")              // italic alt
    .replace(/`{3}[\s\S]*?`{3}/g, "")       // code blocks (remove entirely)
    .replace(/`([^`]+)`/g, "$1")            // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")     // links → keep text
    .replace(/^\s*[-*+]\s+/gm, "")          // list markers
    .replace(/^\s*\d+\.\s+/gm, "")          // numbered list markers
    .replace(/\|[^|]*\|/g, "")              // table rows
    .replace(/^[-|:\s]+$/gm, "")            // table separators
    .replace(/^>\s+/gm, "")                 // blockquotes
    .replace(/---+/g, "")                   // horizontal rules
    .replace(/\n{3,}/g, "\n\n")             // collapse excess newlines
    .trim();
}

// ── Subtitle extraction (uses stripped text) ──────────────────
function extractSubtitle(response: string | null): string | null {
  if (!response) return null;
  const { cleaned } = cleanText(response);
  if (!cleaned || cleaned.length < 15) return null;
  const stripped = stripMarkdown(cleaned);
  for (const line of stripped.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 15) continue;
    if (/^(continue|ok|okay|sure|yes|no|done|good)\b/i.test(trimmed)) continue;
    if (/^no response/i.test(trimmed) || /^please run/i.test(trimmed)) continue;
    return trimmed.length > 120 ? trimmed.substring(0, 117) + "..." : trimmed;
  }
  return null;
}

// ── Collapse label for grouped tool calls ────────────────────
function collapseLabel(toolName: string, count: number): string {
  switch (toolName) {
    case "Read": return `Read ${count} files`;
    case "Edit": return `Edited ${count} files`;
    case "Write": return `Wrote ${count} files`;
    case "Bash": return `Ran ${count} commands`;
    case "Grep": return `Searched ${count} patterns`;
    case "Glob": return `Matched ${count} patterns`;
    case "Agent": return `${count} subagents`;
    case "WebSearch": return `${count} searches`;
    case "WebFetch": return `Fetched ${count} pages`;
    default:
      if (toolName.startsWith("mcp__")) {
        const server = toolName.split("__")[1] || "MCP";
        return `${server} ${count} calls`;
      }
      return `${count} calls`;
  }
}

// ── Tool dot color — matches Claude Code's terminal colors ──
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

function toolDotColor(toolName: string, isError: boolean): string {
  if (isError) return "#ff6b80";           // red — error
  if (WRITE_TOOLS.has(toolName)) return "#10b981"; // green — write/mutation
  if (toolName === "Bash") return "#10b981";       // green — shell execution
  return "var(--text-muted)";                       // gray — read-only
}

// ── Conversation Flow Components ──────────────────────────────

function ThinkingLine() {
  return (
    <div className="flex items-start gap-1.5 py-1">
      <span className="text-[10px] mt-[2px] shrink-0" style={{ color: "var(--text-muted)" }}>{"\u25CF"}</span>
      <span className="text-[11px] italic" style={{ color: "var(--text-muted)", opacity: 0.7 }}>Thinking</span>
    </div>
  );
}

function PlanEventLine({ tc }: { tc: ToolCall }) {
  const input = safeParseInput(tc.tool_input);
  const isEnter = tc.tool_name === "EnterPlanMode";
  const result = tc.tool_result || "";

  let statusText = "Plan mode entered";
  if (!isEnter) {
    if (result.includes("approved")) statusText = "Plan approved";
    else if (result.includes("doesn't want to proceed") || result.includes("rejected")) statusText = "Plan rejected";
    else statusText = "Plan mode exited";
  }

  return (
    <div className="flex items-center gap-3 my-2">
      <div className="flex-1 h-px" style={{ background: "#a78bfa", opacity: 0.3 }} />
      <span className="text-[11px] font-medium shrink-0 px-2" style={{ color: "#a78bfa" }}>
        {statusText}
      </span>
      <div className="flex-1 h-px" style={{ background: "#a78bfa", opacity: 0.3 }} />
    </div>
  );
}

function TextLine({ text, compact = true }: { text?: string; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!text?.trim()) return null;
  const { cleaned } = cleanText(text);
  if (!cleaned.trim()) return null;
  const isLong = cleaned.length > 300;

  return (
    <div className="flex items-start gap-1.5 py-1">
      <span className="text-[10px] mt-[2px] shrink-0" style={{ color: "var(--text-muted)" }}>{"\u25CF"}</span>
      <div className="min-w-0 flex-1">
        {compact && !expanded ? (
          <div className="relative overflow-hidden" style={{ maxHeight: isLong ? "180px" : "none" }}>
            <div className="text-[12px] leading-[1.6] md-content" style={{ color: "var(--text-tertiary)" }}>
              <Markdown remarkPlugins={[remarkGfm]}>{cleaned}</Markdown>
            </div>
            {isLong && (
              <div className="absolute bottom-0 left-0 right-0 h-8" style={{ background: "linear-gradient(transparent, var(--bg-surface))" }} />
            )}
          </div>
        ) : (
          <div className="text-[12px] leading-[1.6] md-content" style={{ color: compact ? "var(--text-tertiary)" : "var(--text-secondary)" }}>
            <Markdown remarkPlugins={[remarkGfm]}>{cleaned}</Markdown>
          </div>
        )}
        {compact && isLong && (
          <button className="text-[10px] mt-0.5 hover:underline" style={{ color: "var(--text-muted)" }}
            onClick={() => setExpanded(!expanded)}>{expanded ? "show less" : "show more"}</button>
        )}
      </div>
    </div>
  );
}

function CollapsedToolGroup({ toolCalls, label, toolName, onSelectTool }: {
  toolCalls: ToolCall[];
  label: string;
  toolName: string;
  onSelectTool?: (tc: ToolCall) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = toolCalls.some(tc => !!tc.is_error);
  const dotColor = hasErrors ? "#ff6b80" : toolDotColor(toolName, false);
  const isMcp = toolName.startsWith("mcp__");
  const mcpServer = isMcp ? toolName.split("__")[1] : null;
  const displayName = isMcp ? mcpServer : toolName;

  return (
    <div className="py-1">
      <div className="flex items-start gap-1.5 text-[11px] cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className="text-[10px] mt-[2px] shrink-0" style={{ color: dotColor }}>{"\u25CF"}</span>
        {isMcp ? (
          <span className="shrink-0 font-semibold text-[11px] px-1 rounded font-mono" style={{ color: "#a78bfa", background: "rgba(167,139,250,0.08)" }}>{displayName}</span>
        ) : (
          <span className="font-semibold" style={{ color: hasErrors ? "#ff6b80" : "var(--text-secondary)" }}>{displayName}</span>
        )}
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span className="text-[9px] mt-[1px]" style={{ color: "var(--text-muted)" }}>{expanded ? "\u25B4" : "\u25BE"}</span>
      </div>
      {expanded && (
        <div className="ml-[18px] mt-0.5">
          {toolCalls.map((tc) => (
            <ToolTreeLine key={tc.id} tc={tc} isLast={false} compact={true} onSelect={onSelectTool ? () => onSelectTool(tc) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolTreeLine({ tc, isLast, compact = true, onSelect }: { tc: ToolCall; isLast: boolean; compact?: boolean; onSelect?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isError = !!tc.is_error;
  const dotColor = toolDotColor(tc.tool_name, isError);
  const { name, summary } = toolSummaryText(tc);
  const result = resultSummary(tc);
  const input = safeParseInput(tc.tool_input);

  // Subagent type label
  const isSubagent = tc.tool_name === "Agent";
  const subagentType = isSubagent ? (tc.subagent_type || "Subagent") : null;

  // MCP server name
  const isMcp = tc.tool_name.startsWith("mcp__");
  const mcpParts = isMcp ? tc.tool_name.split("__") : [];
  const mcpServer = isMcp ? mcpParts[1] : null;
  const mcpTool = isMcp ? mcpParts.slice(2).join("__") : null;

  // Build display label: "ToolName(description)" matching Claude Code style
  let label: string;
  if (isSubagent) label = `${subagentType}(${tc.subagent_desc || summary})`;
  else if (isMcp) label = `${mcpServer}(${mcpTool || summary})`;
  else label = summary ? `${name}(${summary})` : name;

  // Compact result text for the └ line
  const resultText = isError
    ? (tc.tool_result?.split("\n")[0]?.substring(0, 80) || "Error")
    : result;

  return (
    <div className="py-1">
      {/* ● Tool header — matches Claude Code's dot-block style */}
      <div
        className={`flex items-start gap-1.5 text-[11px] ${!compact ? "cursor-pointer hover:bg-[var(--bg-hover)] -mx-1 px-1 rounded" : ""}`}
        onClick={!compact ? () => setExpanded(!expanded) : onSelect}
        style={{ cursor: compact && onSelect ? "pointer" : undefined }}
      >
        <span className="text-[10px] mt-[2px] shrink-0" style={{ color: dotColor }}>{"\u25CF"}</span>
        {isSubagent && subagentType && (
          <span className="shrink-0 font-semibold text-[11px] px-1 rounded font-mono" style={{ color: "#d97757", background: "rgba(215,119,87,0.10)" }}>{subagentType}</span>
        )}
        {isMcp && mcpServer && (
          <span className="shrink-0 font-semibold text-[11px] px-1 rounded font-mono" style={{ color: "#a78bfa", background: "rgba(167,139,250,0.08)" }}>{mcpServer}</span>
        )}
        {!isSubagent && !isMcp && (
          <span className="shrink-0 font-semibold" style={{ color: isError ? "#ff6b80" : "var(--text-secondary)" }}>{name}</span>
        )}
        <span className="flex-1 truncate font-mono" style={{ color: isError ? "#ff6b80" : "var(--text-muted)" }}>
          {isSubagent ? `(${tc.subagent_desc || summary})` : isMcp ? `(${mcpTool || summary})` : summary ? `(${summary})` : ""}
        </span>
      </div>

      {/* └ Result line — indented under the tool, matching Claude Code style */}
      {compact && resultText && resultText !== "(no output)" && (
        <div className="flex items-center gap-1 ml-[18px] text-[10px] font-mono" style={{ color: isError ? "#ff6b80" : dotColor, opacity: 0.7 }}>
          <span>{"\u2514"}</span>
          <span className="truncate">{resultText}</span>
        </div>
      )}

      {/* Expanded detail (detail pane mode only) */}
      {!compact && expanded && (
        <div className="ml-6 mt-1 mb-2">
          {tc.tool_name === "Bash" && (
            <div className="space-y-1">
              {(tc.bash_command || (input.command as string)) && (
                <div>
                  <div className="text-[10px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>IN</div>
                  <div className="rounded px-3 py-2 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    {tc.bash_command || (input.command as string) || ""}
                  </div>
                </div>
              )}
              {tc.tool_result && (
                <div>
                  <div className="text-[10px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>OUT</div>
                  <div className="rounded px-3 py-2 font-mono text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto" style={{ background: isError ? "color-mix(in srgb, #ff6b80 5%, var(--bg-elevated))" : "var(--bg-elevated)", border: isError ? "1px solid rgba(255,107,128,0.2)" : "1px solid var(--border)", color: isError ? "#ff6b80" : "var(--text-secondary)" }}>
                    {tc.tool_result.substring(0, 8000)}
                  </div>
                </div>
              )}
            </div>
          )}
          {tc.tool_name === "Edit" && (
            <div>
              <div className="text-[10px] mb-0.5" style={{ color: "var(--text-muted)" }}>{editSummaryText((input.old_string as string) || "", (input.new_string as string) || "")}</div>
              {((input.old_string as string) || (input.new_string as string)) && (
                <DiffBlock oldStr={(input.old_string as string) || ""} newStr={(input.new_string as string) || ""} />
              )}
            </div>
          )}
          {tc.tool_name === "Read" && tc.tool_result && (
            <SyntaxBlock code={tc.tool_result.substring(0, 8000)} language={tc.file_path ? detectLanguage(tc.file_path) : "text"} />
          )}
          {tc.tool_name === "Agent" && tc.tool_result && (
            <div className="rounded px-3 py-2 text-[11px] font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
              {tc.tool_result.substring(0, 5000)}
            </div>
          )}
          {!["Bash", "Edit", "Read", "Agent"].includes(tc.tool_name) && tc.tool_result && (
            <div className="rounded px-3 py-2 text-[11px] font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
              {tc.tool_result.substring(0, 5000)}
            </div>
          )}
        </div>
      )}

      {/* └ Result line in detail pane (when not expanded) */}
      {!compact && !expanded && resultText && resultText !== "(no output)" && (
        <div className="flex items-center gap-1 ml-[18px] text-[10px] font-mono" style={{ color: isError ? "#ff6b80" : dotColor, opacity: 0.7 }}>
          <span>{"\u2514"}</span>
          <span className="truncate">{resultText}</span>
        </div>
      )}
    </div>
  );
}

function ConversationFlow({ blocks, toolMap, compact = true, allTools, onSelectTool }: {
  blocks: ContentBlockRef[];
  toolMap: Map<string, ToolCall>;
  compact?: boolean;
  allTools?: ToolCall[];
  onSelectTool?: (tc: ToolCall) => void;
}) {
  // Filter out system tools but keep plan mode tools (they render as dividers)
  const rendered = blocks.filter(b => {
    if (b.type === "tool_use") {
      const tc = toolMap.get(b.tool_use_id!);
      if (!tc) return false;
      if (SYSTEM_TOOLS.has(tc.tool_name)) return false;
      return true; // Keeps plan mode tools + regular tools
    }
    return true;
  });

  // Collapse consecutive blocks in compact mode:
  // 1. Merge consecutive thinking blocks into one
  // 2. Collapse 2+ consecutive same-type tool calls into expandable group
  type CollapsedItem =
    | { kind: "block"; block: ContentBlockRef }
    | { kind: "group"; toolName: string; label: string; toolCalls: ToolCall[] };

  const items: CollapsedItem[] = [];
  if (compact) {
    let i = 0;
    while (i < rendered.length) {
      const b = rendered[i];

      // 1. Merge consecutive thinking blocks — show one, skip the rest
      if (b.type === "thinking") {
        items.push({ kind: "block", block: b });
        let j = i + 1;
        while (j < rendered.length && rendered[j].type === "thinking") j++;
        i = j;
        continue;
      }

      // 2. Collapse consecutive same-name tool calls
      if (b.type === "tool_use") {
        const tc = toolMap.get(b.tool_use_id!);
        if (tc && !PLAN_MODE_TOOLS.has(tc.tool_name)) {
          // Gather consecutive same-name tools
          const group: ToolCall[] = [tc];
          let j = i + 1;
          while (j < rendered.length && rendered[j].type === "tool_use") {
            const next = toolMap.get(rendered[j].tool_use_id!);
            if (!next || next.tool_name !== tc.tool_name) break;
            group.push(next);
            j++;
          }
          if (group.length >= 2) {
            items.push({ kind: "group", toolName: tc.tool_name, label: collapseLabel(tc.tool_name, group.length), toolCalls: group });
            i = j;
            continue;
          }
        }
      }

      items.push({ kind: "block", block: b });
      i++;
    }
  } else {
    for (const b of rendered) items.push({ kind: "block", block: b });
  }

  // Cap visible items in compact mode
  const maxVisible = compact ? 20 : items.length;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible && !showAll;

  return (
    <div className="mt-1">
      {visible.map((item, i) => {
        if (item.kind === "group") {
          return <CollapsedToolGroup key={i} toolCalls={item.toolCalls} label={item.label} toolName={item.toolName} onSelectTool={onSelectTool} />;
        }
        const b = item.block;
        if (b.type === "thinking") return <ThinkingLine key={i} />;
        if (b.type === "text") return <TextLine key={i} text={b.text} compact={compact} />;
        if (b.type === "tool_use") {
          const tc = toolMap.get(b.tool_use_id!);
          if (!tc) return null;
          if (PLAN_MODE_TOOLS.has(tc.tool_name)) {
            return <PlanEventLine key={i} tc={tc} />;
          }
          return <ToolTreeLine key={i} tc={tc} isLast={false} compact={compact} onSelect={onSelectTool ? () => onSelectTool(tc) : undefined} />;
        }
        return null;
      })}
      {hasMore && (
        <button className="text-[10px] ml-6 mt-0.5 hover:underline" style={{ color: "var(--text-muted)" }} onClick={() => setShowAll(true)}>
          +{items.length - maxVisible} more
        </button>
      )}
    </div>
  );
}

// Fallback for old exchanges without content_blocks
function FallbackFlow({ exchange, compact = true, onSelectTool }: { exchange: Exchange; compact?: boolean; onSelectTool?: (tc: ToolCall) => void }) {
  const tools = (exchange.tool_calls || []).filter(tc => !SYSTEM_TOOLS.has(tc.tool_name));
  const { cleaned: preText } = cleanText(exchange.assistant_response_pre || "");
  const { cleaned: postText } = cleanText(exchange.assistant_response || "");

  // Collapse consecutive same-type tools in compact mode
  const collapsedTools: Array<{ kind: "single"; tc: ToolCall } | { kind: "group"; toolName: string; label: string; toolCalls: ToolCall[] }> = [];
  if (compact) {
    let i = 0;
    while (i < tools.length) {
      const tc = tools[i];
      if (!PLAN_MODE_TOOLS.has(tc.tool_name)) {
        let j = i + 1;
        while (j < tools.length && tools[j].tool_name === tc.tool_name && !PLAN_MODE_TOOLS.has(tools[j].tool_name)) j++;
        if (j - i >= 2) {
          collapsedTools.push({ kind: "group", toolName: tc.tool_name, label: collapseLabel(tc.tool_name, j - i), toolCalls: tools.slice(i, j) });
          i = j;
          continue;
        }
      }
      collapsedTools.push({ kind: "single", tc });
      i++;
    }
  } else {
    for (const tc of tools) collapsedTools.push({ kind: "single", tc });
  }

  return (
    <div className="mt-1">
      {preText && <TextLine text={preText} compact={compact} />}
      {!!exchange.has_thinking && <ThinkingLine />}
      {collapsedTools.map((item, i) => {
        if (item.kind === "group") {
          return <CollapsedToolGroup key={i} toolCalls={item.toolCalls} label={item.label} toolName={item.toolName} onSelectTool={onSelectTool} />;
        }
        if (PLAN_MODE_TOOLS.has(item.tc.tool_name)) {
          return <PlanEventLine key={item.tc.id} tc={item.tc} />;
        }
        return <ToolTreeLine key={item.tc.id} tc={item.tc} isLast={false} compact={compact} onSelect={onSelectTool ? () => onSelectTool(item.tc) : undefined} />;
      })}
      {postText && <TextLine text={postText} compact={compact} />}
    </div>
  );
}

// ── Legacy pill code removed — conversation flow replaces pills ──

// ── Commit Card (exchange-level git detail) ─────────────────
function CommitCard({ gd }: { gd: GitDetail }) {
  const isCommit = gd.type === "commit";
  const isPr = gd.type === "pr";
  const isPush = gd.type === "push";
  const isBranch = gd.type === "branch";

  const Icon = isCommit ? GitCommitHorizontal : isPr ? GitPullRequest : isPush ? ArrowUp : GitBranch;
  const iconColor = isCommit ? "#818cf8" : isPr ? "#34d399" : isPush ? "#60a5fa" : isBranch ? "#fbbf24" : "var(--text-tertiary)";
  const shortHash = isCommit && gd.hash ? gd.hash.substring(0, 7) : null;

  const inner = (
    <div className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
      <Icon size={11} className="shrink-0" style={{ color: iconColor }} />
      {shortHash && <span className="font-mono" style={{ color: "var(--text-muted)" }}>{shortHash}</span>}
      <span className="flex-1 min-w-0 truncate">{gd.description}</span>
      {gd.url && <SquareArrowOutUpRight size={10} className="shrink-0" style={{ color: "var(--text-muted)" }} />}
    </div>
  );

  if (gd.url) {
    return (
      <a href={gd.url} target="_blank" rel="noopener noreferrer"
        className="block -mx-1 px-1 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        title={isCommit ? "View commit on GitHub" : isPr ? "View PR on GitHub" : "View on GitHub"}>
        {inner}
      </a>
    );
  }
  return <div>{inner}</div>;
}

// ── Compaction Marker ─────────────────────────────────────────
function CompactionMarker({ event }: { event: CompactionEvent }) {
  return (
    <div className="flex items-center gap-3 my-2 px-2">
      <div className="flex-1 h-px" style={{ background: "#f59e0b40", borderTop: "1px dashed #f59e0b40" }} />
      <span className="text-[10px] shrink-0" style={{ color: "#f59e0b" }}>
        Context compacted{event.exchanges_before ? ` \u00B7 ${event.exchanges_before} exchanges summarized` : ""}
      </span>
      <div className="flex-1 h-px" style={{ background: "#f59e0b40", borderTop: "1px dashed #f59e0b40" }} />
    </div>
  );
}

// ── Exchange summary for collapsed cards ────────────────────
function useExchangeSummary(exchange: Exchange) {
  return useMemo(() => {
    const tools = (exchange.tool_calls || []).filter(tc => !SYSTEM_TOOLS.has(tc.tool_name));
    const blocks: ContentBlockRef[] | null = exchange.content_blocks
      ? (() => { try { return JSON.parse(exchange.content_blocks as string); } catch { return null; } })()
      : null;

    // Find last meaningful text block from content_blocks
    let summaryText: string | null = null;
    if (blocks) {
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === "text" && blocks[i].text) {
          const stripped = stripMarkdown(cleanText(blocks[i].text!).cleaned);
          if (stripped.length >= 20) {
            summaryText = stripped.length > 160 ? stripped.substring(0, 157) + "..." : stripped;
            break;
          }
        }
      }
    }
    // Fallback to assistant_response
    if (!summaryText) {
      summaryText = extractSubtitle(exchange.assistant_response);
    }

    // Tool stats: "Read 3 · Edit 5 · Bash 2"
    let toolStats: string | null = null;
    if (tools.length > 0) {
      const counts: Record<string, number> = {};
      for (const tc of tools) {
        const name = tc.tool_name.startsWith("mcp__") ? tc.tool_name.split("__")[1] : tc.tool_name;
        counts[name] = (counts[name] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      toolStats = sorted.map(([name, count]) => `${name} ${count}`).join(" \u00B7 ");
    }

    const hasContent = (blocks && blocks.length > 0) || tools.length > 0;
    const toolMap = new Map(tools.map(tc => [tc.tool_use_id || tc.id, tc]));

    return { summaryText, toolStats, hasContent, blocks, tools, toolMap };
  }, [exchange]);
}

// ── Plan title extraction ────────────────────────────────────
function extractPlanTitle(planText: string): string {
  for (const line of planText.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) return t.replace(/^#+\s*/, "").replace(/^Plan:\s*/i, "") || "Plan";
  }
  return "Plan";
}

// ── Plan status display — matches PlanSection.tsx ────────────
function planStatusLabel(status: string): string | null {
  if (status === "implemented") return "Implemented";
  if (status === "approved") return "Approved";
  if (status === "superseded") return "Approved";
  if (status === "drafted") return "In progress";
  if (status === "rejected") return "Rejected";
  if (status === "revised") return "Revised";
  return null;
}

// ── Prompt Card — the primary timeline unit ───────────────────
function PromptCard({ exchange, onViewDetail, wasQueued, plans, enterOnly, onViewPlan, gitDetails }: {
  exchange: Exchange;
  onViewDetail: (exchange: Exchange) => void;
  wasQueued?: boolean;
  plans?: Plan[];
  enterOnly?: boolean;
  onViewPlan?: (plan: Plan) => void;
  gitDetails?: GitDetail[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const { cleaned: prompt, wasInterrupted } = cleanText(exchange.user_prompt || "");
  const isInterrupt = !!exchange.is_interrupt || wasInterrupted;
  const isCompaction = !!exchange.is_compact_summary;
  const time = exchange.timestamp ? new Date(exchange.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  const isLongPrompt = prompt.length > 180;
  const summary = useExchangeSummary(exchange);

  if (isCompaction) return null;
  if (!prompt) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.03)", background: "var(--bg-surface)" }}>
      {/* User prompt — gray background like terminal prompt */}
      <div className="px-4 py-3" style={{ background: "rgba(255,255,255,0.03)" }}>
        {/* Timestamp + expand toggle + detail link */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{time}</span>
            {wasQueued && (
              <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: "#60a5fa", background: "rgba(96,165,250,0.1)" }}>queued</span>
            )}
            {/* Git event pills */}
            {gitDetails && gitDetails.map((gd, i) => {
              const Icon = gd.type === "commit" ? GitCommitHorizontal : gd.type === "pr" ? GitPullRequest : gd.type === "push" ? ArrowUp : GitBranch;
              const color = gd.type === "commit" ? "#818cf8" : gd.type === "pr" ? "#34d399" : gd.type === "push" ? "#60a5fa" : "#fbbf24";
              const label = gd.type === "commit" && gd.hash ? gd.hash.substring(0, 7)
                : gd.type === "pr" ? "PR"
                : gd.type === "push" ? "push"
                : gd.type === "branch" ? gd.description : gd.type;
              if (gd.url) {
                return (
                  <a key={i} href={gd.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-mono hover:opacity-80 transition-opacity"
                    style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
                    title={gd.description}>
                    <Icon size={10} />
                    {label}
                  </a>
                );
              }
              return (
                <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-mono"
                  style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
                  title={gd.description}>
                  <Icon size={10} />
                  {label}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-0.5">
            {summary.hasContent && (
              <button onClick={() => setExpanded(!expanded)}
                className="w-5 h-5 flex items-center justify-center rounded hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.08)] transition-all"
                style={{ color: "var(--text-muted)" }} title={expanded ? "Collapse" : "Expand"}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            <button onClick={() => onViewDetail(exchange)}
              className="w-5 h-5 flex items-center justify-center rounded hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.08)] transition-all"
              style={{ color: "var(--text-muted)" }} title="View full exchange">
              <SquareArrowOutUpRight size={12} />
            </button>
          </div>
        </div>

        {/* Prompt text */}
        <div className="text-[13px] leading-[1.6]" style={{ color: "#cccccc" }}>
          {showFullPrompt ? prompt : trunc(prompt, 180)}
          {isLongPrompt && (
            <button className="ml-1 text-[11px] hover:underline" style={{ color: "var(--text-muted)" }}
              onClick={() => setShowFullPrompt(!showFullPrompt)}>{showFullPrompt ? "show less" : "show more"}</button>
          )}
        </div>
      </div>

      {/* Claude's response area */}
      <div className="px-4 py-3">
        {/* Plan indicators — matches PlanSection style */}
        {!expanded && ((plans && plans.length > 0) || enterOnly) && (
          <div className="flex flex-col gap-1.5 mb-2">
            {plans && plans.map(p => {
              const title = extractPlanTitle(p.plan_text);
              const status = planStatusLabel(p.status);
              const isClickable = !!onViewPlan && !!p.plan_text;
              // Use the exchange timestamp (when user entered plan mode), not plan.created_at (DB insert time)
              const planTime = exchange.timestamp
                ? new Date(exchange.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                : null;
              return (
                <div key={p.id}
                  className="rounded-md px-3 py-2"
                  style={{ borderLeft: "3px solid rgba(167,139,250,0.4)", background: "var(--bg-surface)" }}>
                  <div className="flex items-center">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Plan</span>
                        {status && (
                          <>
                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u00B7"}</span>
                            <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>{status}</span>
                          </>
                        )}
                        {planTime && (
                          <>
                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u00B7"}</span>
                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{planTime}</span>
                          </>
                        )}
                      </div>
                      <p className="text-[12px] font-medium flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                        <FileText size={12} className="shrink-0" style={{ color: "#6dab7a" }} />
                        {trunc(title, 80)}
                      </p>
                    </div>
                    {isClickable && (
                      <button
                        className="text-[10px] font-medium hover:underline transition-colors shrink-0 flex items-center gap-1"
                        style={{ color: "var(--text-secondary)" }}
                        onClick={() => onViewPlan!(p)}>
                        View plan
                        <SquareArrowOutUpRight size={10} style={{ color: "var(--text-muted)" }} />
                      </button>
                    )}
                  </div>
                  {p.user_feedback && (
                    <div className="text-[10px] mt-1.5 italic" style={{ color: "var(--text-muted)" }}>
                      {trunc(p.user_feedback, 120)}
                    </div>
                  )}
                </div>
              );
            })}
            {enterOnly && (!plans || plans.length === 0) && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: "#a78bfa", opacity: 0.3 }} />
                <span className="text-[11px] font-medium shrink-0 px-2" style={{ color: "#a78bfa" }}>Plan mode entered</span>
                <div className="flex-1 h-px" style={{ background: "#a78bfa", opacity: 0.3 }} />
              </div>
            )}
          </div>
        )}

        {/* Collapsed: summary (tool stats + Claude's response) */}
        {!expanded && (summary.hasContent || (plans && plans.length > 0) || enterOnly) && (
          <div>
            {summary.toolStats && (
              <div className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                {summary.toolStats}
              </div>
            )}
            {summary.summaryText && (
              <div className="flex items-start gap-2 mt-1.5">
                <ClaudeIcon size={14} />
                <div className="text-[12px] leading-[1.5] min-w-0 flex-1" style={{ color: "var(--text-tertiary)" }}>
                  {summary.summaryText}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expanded: full conversation flow */}
        {expanded && (() => {
          if (summary.blocks && summary.blocks.length > 0) {
            return <ConversationFlow blocks={summary.blocks} toolMap={summary.toolMap} compact={true} />;
          }
          return <FallbackFlow exchange={exchange} compact={true} />;
        })()}

        {/* Interrupt badge */}
        {isInterrupt && (
          <div className="mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)" }}>interrupted</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Timeline View ─────────────────────────────────────────
interface TimelineViewProps {
  session: SessionDetail;
  exchanges: Exchange[];
  onViewPlan: (plan: Plan) => void;
  onViewGroup: (title: string, subtitle: string, content: ReactNode, rawData: unknown) => void;
  sortOrder?: "oldest" | "newest";
  searchQuery?: string;
}

/** Search exchanges by structured data only — prompts, file paths, commands, tool names, timestamps.
 *  Excludes assistant_response (too verbose, matches everything).
 *  Multi-word queries use AND logic. */
function exchangeMatchesSearch(exchange: Exchange, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 2) return true;

  const words = trimmed.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return true;

  const parts: string[] = [];

  // User prompt — what was asked
  if (exchange.user_prompt) parts.push(exchange.user_prompt);

  // Timestamp — "9:17 PM", "21:17", "917"
  if (exchange.timestamp) {
    const d = new Date(exchange.timestamp);
    parts.push(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    parts.push(d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false }));
    const h = d.getHours(); const m = d.getMinutes();
    parts.push(`${h}${m < 10 ? "0" : ""}${m}`);
  }

  // Tool calls — structured action data
  for (const tc of exchange.tool_calls || []) {
    if (tc.tool_name) parts.push(tc.tool_name);
    if (tc.file_path) parts.push(tc.file_path);
    if (tc.bash_command) parts.push(tc.bash_command);
    if (tc.bash_desc) parts.push(tc.bash_desc);
    if (tc.web_query) parts.push(tc.web_query);
    if (tc.subagent_desc) parts.push(tc.subagent_desc);
    if (tc.skill_name) parts.push(tc.skill_name);
  }

  const corpus = parts.join(" ").toLowerCase();
  return words.every(w => corpus.includes(w));
}

export function TimelineView({ session, exchanges, onViewPlan, onViewGroup, sortOrder = "oldest", searchQuery = "" }: TimelineViewProps) {
  const [showInherited, setShowInherited] = useState(false);
  const milestones = session.milestones || [];
  const gitDetails = session.git_details || [];
  const compactionEvents = session.compaction_events || [];
  const forkIdx = session.fork_exchange_index;
  const inheritedCount = forkIdx != null ? exchanges.filter(e => e.exchange_index < forkIdx).length : 0;

  // ── Event lookup maps ──────────────────────────────────────
  const gitDetailsByIdx = useMemo(() => {
    const map = new Map<number, GitDetail[]>();
    for (const gd of gitDetails) {
      if (gd.exchange_index < 0) continue;
      const arr = map.get(gd.exchange_index);
      if (arr) arr.push(gd); else map.set(gd.exchange_index, [gd]);
    }
    return map;
  }, [gitDetails]);

  const testsByIdx = useMemo(() => {
    const map = new Map<number, Milestone[]>();
    for (const m of milestones) {
      if (m.milestone_type !== "test_pass" && m.milestone_type !== "test_fail") continue;
      const arr = map.get(m.exchange_index);
      if (arr) arr.push(m); else map.set(m.exchange_index, [m]);
    }
    return map;
  }, [milestones]);

  const compactionsByIdx = useMemo(() => {
    const map = new Map<number, CompactionEvent>();
    for (const c of compactionEvents) map.set(c.exchange_index, c);
    return map;
  }, [compactionEvents]);

  // Plan mapping — driven by actual tool calls, not plans table indices
  // Also collects revisions: earlier plan versions that were revised/rejected before the final
  const planInfoByIdx = useMemo(() => {
    const map = new Map<number, { exitPlans: Plan[]; enterOnly: boolean }>();
    const plans = [...(session.plans || [])].sort((a, b) => a.version - b.version);

    const exitLocations: number[] = [];
    let pendingEnter: number | null = null;

    for (const ex of exchanges) {
      for (const tc of ex.tool_calls || []) {
        if (tc.tool_name === "EnterPlanMode") pendingEnter = ex.exchange_index;
        if (tc.tool_name === "ExitPlanMode") {
          exitLocations.push(ex.exchange_index);
          pendingEnter = null;
        }
      }
    }

    // Match plans with plan_text to exit locations 1:1 in version order
    const withText = plans.filter(p => p.plan_text);
    for (let i = 0; i < Math.min(withText.length, exitLocations.length); i++) {
      const idx = exitLocations[i];
      const entry = map.get(idx);
      if (entry) entry.exitPlans.push(withText[i]);
      else map.set(idx, { exitPlans: [withText[i]], enterOnly: false });
    }

    // Unpaired enter = plan mode still active
    if (pendingEnter !== null) {
      const entry = map.get(pendingEnter);
      if (entry) entry.enterOnly = true;
      else map.set(pendingEnter, { exitPlans: [], enterOnly: true });
    }

    return map;
  }, [session.plans, exchanges]);

  // ── Search + Sort ──────────────────────────────────────────
  const displayExchanges = useMemo(() => {
    const filtered = searchQuery
      ? exchanges.filter(ex => exchangeMatchesSearch(ex, searchQuery))
      : exchanges;
    return sortOrder === "newest" ? [...filtered].reverse() : filtered;
  }, [exchanges, sortOrder, searchQuery]);

  // ── Detail panel for single exchange ───────────────────────
  const handleViewDetail = (exchange: Exchange) => {
    const { cleaned: prompt } = cleanText(exchange.user_prompt || "");
    const { cleaned: response } = cleanText(exchange.assistant_response || "");
    const tools = exchange.tool_calls || [];
    const time = exchange.timestamp ? new Date(exchange.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    const exGitDetails = gitDetailsByIdx.get(exchange.exchange_index) || [];
    const exTests = testsByIdx.get(exchange.exchange_index) || [];

    const title = trunc(prompt, 60);
    const subtitle = `#${exchange.exchange_index} \u00B7 ${time}`;

    const actionTools = tools.filter(tc => !SYSTEM_TOOLS.has(tc.tool_name));
    const toolMap = new Map(actionTools.map(tc => [tc.tool_use_id || tc.id, tc]));
    const blocks: ContentBlockRef[] | null = exchange.content_blocks
      ? (() => { try { return JSON.parse(exchange.content_blocks as string); } catch { return null; } })()
      : null;

    const content = (
      <div className="space-y-3">
        {/* User prompt */}
        <div className="rounded-md px-3 py-2.5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>You</div>
          <div className="text-[13px] whitespace-pre-wrap leading-[1.6]" style={{ color: "#cccccc" }}>{prompt}</div>
        </div>

        {/* Full conversation flow — expanded with IN/OUT, diffs, etc. */}
        {blocks && blocks.length > 0 ? (
          <ConversationFlow blocks={blocks} toolMap={toolMap} compact={false} />
        ) : (
          <FallbackFlow exchange={exchange} compact={false} />
        )}

        {/* Git events */}
        {exGitDetails.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Git</div>
            <div className="flex flex-col gap-1">
              {exGitDetails.map((gd, i) => <CommitCard key={i} gd={gd} />)}
            </div>
          </div>
        )}

        {/* Test results */}
        {exTests.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>Tests</div>
            {exTests.map((m, i) => {
              const cfg = MS_CONFIG[m.milestone_type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
              return <div key={i} className="text-[12px] flex items-center gap-1.5"><span style={{ color: cfg.color }}>{cfg.symbol}</span><span style={{ color: cfg.color }}>{m.description}</span></div>;
            })}
          </div>
        )}
      </div>
    );
    onViewGroup(title, subtitle, content, exchange);
  };

  if (exchanges.length === 0) {
    return <div className="px-6 py-8 text-[13px]" style={{ color: "var(--text-muted)" }}>No activity data available.</div>;
  }

  return (
    <div className="px-6 pb-4 pt-1">
      {/* Search result count */}
      {searchQuery && (
        <div className="mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {displayExchanges.length === 0
            ? `No exchanges match "${searchQuery}"`
            : `${displayExchanges.length} of ${exchanges.length} exchanges`}
        </div>
      )}

      {/* Inherited exchanges toggle */}
      {forkIdx != null && inheritedCount > 0 && (
        <div className="mb-3 px-2">
          <button onClick={() => setShowInherited(!showInherited)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{ color: "#a78bfa", background: "rgba(167, 139, 250, 0.08)", border: "1px solid rgba(167, 139, 250, 0.15)" }}>
            {showInherited ? "Hide" : "Show"} {inheritedCount} inherited exchange{inheritedCount > 1 ? "s" : ""}
            {session.parent_title ? ` from "${trunc(session.parent_title, 30)}"` : ""}
          </button>
        </div>
      )}

      {/* Exchange list — activity block cards */}
      <div className="flex flex-col gap-2">
        {displayExchanges.map((ex, i) => {
          const isInherited = forkIdx != null && ex.exchange_index < forkIdx;
          const isFirstNew = forkIdx != null && ex.exchange_index >= forkIdx && (ex.exchange_index === 0 || exchanges[ex.exchange_index - 1]?.exchange_index < forkIdx);
          if (isInherited && !showInherited) return null;

          const compaction = compactionsByIdx.get(ex.exchange_index);

          // Detect queued message: this prompt was sent before the previous exchange's response finished
          let wasQueued = false;
          const prevEx = i > 0 ? displayExchanges[sortOrder === "newest" ? i + 1 : i - 1] : null;
          if (prevEx && prevEx.turn_duration_ms && prevEx.timestamp && ex.timestamp) {
            const prevResponseEnd = new Date(prevEx.timestamp).getTime() + prevEx.turn_duration_ms;
            const thisPromptTime = new Date(ex.timestamp).getTime();
            wasQueued = thisPromptTime < prevResponseEnd;
          }

          return (
            <div key={ex.exchange_index} data-exchange-index={ex.exchange_index} style={{ opacity: isInherited ? 0.4 : 1 }}>
              {/* Compaction marker */}
              {compaction && <CompactionMarker event={compaction} />}

              {/* Fork divider */}
              {isFirstNew && (
                <div className="flex items-center gap-3 my-3 px-2">
                  <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                  <span className="text-[11px] font-medium shrink-0" style={{ color: "#a78bfa" }}>
                    {session.parent_title ? `Forked from "${trunc(session.parent_title, 40)}"` : "Fork point"}
                  </span>
                  <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                </div>
              )}

              {/* Activity block card */}
              <PromptCard
                exchange={ex}
                onViewDetail={handleViewDetail}
                wasQueued={wasQueued}
                plans={planInfoByIdx.get(ex.exchange_index)?.exitPlans}
                enterOnly={planInfoByIdx.get(ex.exchange_index)?.enterOnly}
                onViewPlan={onViewPlan}
                gitDetails={gitDetailsByIdx.get(ex.exchange_index)}
              />

              {/* Fork-out markers */}
              {session.fork_children?.filter(fc => fc.fork_exchange_index === ex.exchange_index).map(fc => (
                <div key={fc.session_id} className="flex items-center gap-3 my-2 px-2">
                  <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                  <a href={`/sessions/${fc.session_id}`} className="text-[11px] font-medium shrink-0 hover:underline" style={{ color: "#a78bfa" }}>
                    {"\u2192"} Forked into "{fc.title && fc.title.length > 35 ? fc.title.substring(0, 35) + "\u2026" : fc.title || fc.session_id.substring(0, 12)}"
                  </a>
                  <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

