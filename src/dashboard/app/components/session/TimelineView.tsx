import { useState, useEffect, useMemo, type ReactNode } from "react";
import type { SessionDetail, Exchange, ActivityGroupDetail, Plan, GitDetail, Milestone, CompactionEvent, ToolCall } from "../../lib/types.js";
import { cleanText } from "../../lib/cleanText.js";
import { getSessionNotes, getSessionMermaid } from "../../lib/api.js";
import { MermaidDiagram } from "./NotesTab.js";
import { GitCommitHorizontal, GitPullRequest, ArrowUp, GitBranch, SquareArrowOutUpRight } from "lucide-react";
import { ClaudeIcon } from "../ClaudeIcon.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

// ── Pill types ────────────────────────────────────────────────
interface Pill {
  type: "edit" | "bash" | "agent" | "mcp" | "web" | "commit" | "push" | "pr" | "branch" | "test_pass" | "test_fail" | "error" | "plan";
  count?: number;
  gitDetail?: GitDetail;
  milestone?: Milestone;
  hasErrors?: boolean;
  plan?: Plan;
}

const SYSTEM_TOOLS = new Set(["EnterPlanMode", "ExitPlanMode", "TaskCreate", "TaskUpdate", "TaskStop", "TaskGet", "TaskList", "TaskOutput", "ToolSearch", "ExitWorktree", "EnterWorktree", "ExitPlanMode"]);

function computePills(exchange: Exchange, gitDetails: GitDetail[], testMilestones: Milestone[], plans: Plan[] = []): Pill[] {
  const tools = exchange.tool_calls || [];
  const actionTools = tools.filter(t => !SYSTEM_TOOLS.has(t.tool_name));
  const pills: Pill[] = [];

  const editCount = actionTools.filter(t => ["Edit", "Write", "NotebookEdit"].includes(t.tool_name)).length;
  const bashCount = actionTools.filter(t => t.tool_name === "Bash").length;
  const bashErrors = actionTools.some(t => t.tool_name === "Bash" && t.is_error);
  const agentCount = actionTools.filter(t => t.tool_name === "Agent").length;
  const mcpCount = actionTools.filter(t => t.tool_name.startsWith("mcp__")).length;
  const webCount = actionTools.filter(t => ["WebSearch", "WebFetch"].includes(t.tool_name)).length;
  const errorCount = actionTools.filter(t => t.is_error).length;

  if (editCount > 0) pills.push({ type: "edit", count: editCount });
  if (bashCount > 0) pills.push({ type: "bash", count: bashCount, hasErrors: bashErrors });
  if (agentCount > 0) pills.push({ type: "agent", count: agentCount });
  if (mcpCount > 0) pills.push({ type: "mcp", count: mcpCount });
  if (webCount > 0) pills.push({ type: "web", count: webCount });

  for (const gd of gitDetails) {
    if (gd.type === "commit") pills.push({ type: "commit", gitDetail: gd });
    else if (gd.type === "push") pills.push({ type: "push", gitDetail: gd });
    else if (gd.type === "pr") pills.push({ type: "pr", gitDetail: gd });
    else if (gd.type === "branch") pills.push({ type: "branch", gitDetail: gd });
  }

  for (const m of testMilestones) {
    pills.push({ type: m.milestone_type === "test_pass" ? "test_pass" : "test_fail", milestone: m });
  }

  if (errorCount > 0) pills.push({ type: "error", count: errorCount });

  for (const plan of plans) {
    pills.push({ type: "plan", plan });
  }

  return pills;
}

// ── Pill rendering config ─────────────────────────────────────
const PILL_CONFIG: Record<string, { label: (p: Pill) => string; bg: string; color: string; Icon?: any }> = {
  edit: { label: (p) => `Edit ${p.count}`, bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  bash: { label: (p) => `Bash ${p.count}`, bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  agent: { label: (p) => `Agent ${p.count}`, bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  mcp: { label: (p) => `MCP ${p.count}`, bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  web: { label: (p) => `Web ${p.count}`, bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  commit: { label: (p) => p.gitDetail?.hash?.substring(0, 7) || "commit", bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  push: { label: () => "Pushed", bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  pr: { label: () => "PR", bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  branch: { label: (p) => p.gitDetail?.description?.replace("Created branch ", "") || "branch", bg: "rgba(99,102,241,0.10)", color: "#818cf8" },
  test_pass: { label: (p) => { const m = p.milestone?.description?.match(/\((\d+\/\d+)\)/); return m ? `\u2713 ${m[1]}` : "\u2713 passed"; }, bg: "rgba(16,185,129,0.12)", color: "#10b981" },
  test_fail: { label: (p) => { const m = p.milestone?.description?.match(/\((\d+\/\d+)\)/); return m ? `\u2717 ${m[1]}` : "\u2717 failed"; }, bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
  error: { label: (p) => `${p.count} error${(p.count || 0) > 1 ? "s" : ""}`, bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
  plan: { label: () => "Plan", bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
};

// ── Outcome Pills ─────────────────────────────────────────────
function OutcomePills({ pills, expandedSections, onToggle, isInterrupt }: {
  pills: Pill[]; expandedSections: Set<string>; onToggle: (type: string) => void; isInterrupt?: boolean;
}) {
  if (pills.length === 0 && !isInterrupt) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
      {pills.map((pill, i) => {
        const cfg = PILL_CONFIG[pill.type];
        if (!cfg) return null;
        const pillKey = `${pill.type}:${i}`;
        const isActive = expandedSections.has(pillKey);
        const Icon = pill.type === "commit" ? GitCommitHorizontal : pill.type === "push" ? ArrowUp : pill.type === "pr" ? GitPullRequest : pill.type === "branch" ? GitBranch : null;
        return (
          <button key={i} onClick={() => onToggle(pillKey)}
            className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 transition-colors"
            style={{ background: isActive ? cfg.bg.replace("0.12", "0.25").replace("0.06", "0.15").replace("0.10", "0.20") : cfg.bg, color: cfg.color, border: isActive ? `1px solid ${cfg.color}33` : "1px solid transparent" }}>
            {Icon && <Icon size={10} />}
            {cfg.label(pill)}
            {isActive && <span style={{ fontWeight: 700, fontSize: "13px", lineHeight: 1, marginLeft: "2px" }}>&minus;</span>}
          </button>
        );
      })}
      {isInterrupt && (
        <span className="text-[10px] px-1.5 py-0.5 rounded ml-auto" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)" }}>interrupted</span>
      )}
    </div>
  );
}

// ── Error Row (expandable error message) ─────────────────────
function ErrorRow({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const target = tool.file_path?.split("/").pop() || tool.bash_desc || tool.bash_command?.substring(0, 50) || "";
  const fullError = tool.tool_result?.trim() || null;
  const isLong = fullError ? fullError.length > 120 : false;
  const displayError = fullError ? (expanded ? fullError : trunc(fullError, 120)) : null;

  return (
    <div className="text-[11px]">
      <div className="flex items-center gap-1.5" style={{ color: "#ef4444" }}>
        <span>{"\u2717"}</span>
        <span className="font-medium">{tool.tool_name}</span>
        {target && tool.file_path ? (
          <a href={`vscode://file${tool.file_path}`} title={tool.file_path}
            className="font-mono inline-flex items-center gap-1 cursor-pointer hover:brightness-150 transition-all"
            style={{ color: "#ef444480" }}>{target}<SquareArrowOutUpRight size={9} /></a>
        ) : target ? (
          <span className="font-mono" style={{ color: "#ef444480" }}>{target}</span>
        ) : null}
      </div>
      {displayError && (
        <div className="ml-3.5 mt-0.5 font-mono text-[10px]" style={{ color: "#ef444460", whiteSpace: expanded ? "pre-wrap" : undefined }}>
          {displayError}
          {isLong && (
            <button className="ml-1 hover:underline" style={{ color: "#ef444480" }}
              onClick={() => setExpanded(!expanded)}>{expanded ? "show less" : "show more"}</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expanded Tool Sections ────────────────────────────────────
function ExpandedToolSection({ type, tools, gitDetails, testMilestones, onClose }: {
  type: string; tools: ToolCall[]; gitDetails: GitDetail[]; testMilestones: Milestone[]; onClose?: () => void;
}) {
  const content = useMemo(() => {
    if (type === "edit") {
      const fileMap = new Map<string, string>();
      for (const t of tools) if (["Edit", "Write", "NotebookEdit"].includes(t.tool_name) && t.file_path) fileMap.set(t.file_path, t.file_path.split("/").pop()!);
      return Array.from(fileMap.entries()).map(([fullPath, shortName], i) => (
        <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
          <span className="shrink-0 w-[32px] text-right font-medium" style={{ color: "var(--text-muted)" }}>Edit</span>
          <a href={`vscode://file${fullPath}`} title={fullPath}
            className="font-mono inline-flex items-center gap-1 cursor-pointer hover:brightness-150 transition-all"
            style={{ color: "var(--text-tertiary)" }}>{shortName}<SquareArrowOutUpRight size={9} /></a>
        </div>
      ));
    }
    if (type === "bash") {
      return tools.filter(t => t.tool_name === "Bash").map((t, i) => {
        const label = t.bash_desc || (t.bash_command ? trunc(t.bash_command, 60) : "command");
        return (
          <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
            {t.is_error ? <span style={{ color: "#ef4444" }}>{"\u2717"}</span> : <span style={{ color: "#10b981" }}>{"\u2713"}</span>}
            <span className="flex-1 font-mono truncate">{label}</span>
          </div>
        );
      });
    }
    if (type === "agent") {
      return tools.filter(t => t.tool_name === "Agent").map((t, i) => (
        <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
          <span className="shrink-0 w-[32px] text-right font-medium" style={{ color: "var(--text-muted)" }}>Agent</span>
          <span className="flex-1 truncate">{t.subagent_type || "Agent"}: {t.subagent_desc || ""}</span>
        </div>
      ));
    }
    if (type === "mcp") {
      const items = new Set<string>();
      for (const t of tools) if (t.tool_name.startsWith("mcp__")) items.add(t.tool_name.replace(/^mcp__\w+__/, ""));
      return Array.from(items).map((name, i) => (
        <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
          <span className="shrink-0 w-[32px] text-right font-medium" style={{ color: "var(--text-muted)" }}>MCP</span>
          <span className="font-mono">{name}</span>
        </div>
      ));
    }
    if (type === "web") {
      return tools.filter(t => ["WebSearch", "WebFetch"].includes(t.tool_name)).map((t, i) => (
        <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
          <span className="shrink-0 w-[32px] text-right font-medium" style={{ color: "var(--text-muted)" }}>Web</span>
          <span className="flex-1 truncate font-mono">{t.web_query || t.web_url || ""}</span>
        </div>
      ));
    }
    if (type === "commit" || type === "push" || type === "pr" || type === "branch") {
      return gitDetails.filter(gd => gd.type === type).map((gd, i) => <CommitCard key={i} gd={gd} />);
    }
    if (type === "test_pass" || type === "test_fail") {
      return testMilestones.map((m, i) => {
        const cfg = MS_CONFIG[m.milestone_type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
        return (
          <div key={i} className="text-[11px] flex items-center gap-1.5">
            <span style={{ color: cfg.color }}>{cfg.symbol}</span>
            <span style={{ color: cfg.color }}>{m.description}</span>
          </div>
        );
      });
    }
    if (type === "error") {
      return tools.filter(t => t.is_error).map((t, i) => <ErrorRow key={i} tool={t} />);
    }
    return null;
  }, [type, tools, gitDetails, testMilestones]);

  if (!content || (Array.isArray(content) && content.length === 0)) return null;

  return (
    <div className="mt-2 pt-2 flex flex-col gap-0.5" style={{ borderTop: "1px solid var(--border)" }}>
      {content}
    </div>
  );
}

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

// ── Detail Panel Tools Section (same pills + expand as cards) ─
function DetailToolsSection({ tools, gitDetails, testMilestones }: {
  tools: ToolCall[]; gitDetails: GitDetail[]; testMilestones: Milestone[];
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const pills = useMemo(() => {
    // Reuse the same pill computation logic as PromptCard
    const actionTools = tools.filter(t => !SYSTEM_TOOLS.has(t.tool_name));
    const result: Pill[] = [];
    const editCount = actionTools.filter(t => ["Edit", "Write", "NotebookEdit"].includes(t.tool_name)).length;
    const bashCount = actionTools.filter(t => t.tool_name === "Bash").length;
    const bashErrors = actionTools.some(t => t.tool_name === "Bash" && t.is_error);
    const agentCount = actionTools.filter(t => t.tool_name === "Agent").length;
    const mcpCount = actionTools.filter(t => t.tool_name.startsWith("mcp__")).length;
    const webCount = actionTools.filter(t => ["WebSearch", "WebFetch"].includes(t.tool_name)).length;
    const errorCount = actionTools.filter(t => t.is_error).length;
    if (editCount > 0) result.push({ type: "edit", count: editCount });
    if (bashCount > 0) result.push({ type: "bash", count: bashCount, hasErrors: bashErrors });
    if (agentCount > 0) result.push({ type: "agent", count: agentCount });
    if (mcpCount > 0) result.push({ type: "mcp", count: mcpCount });
    if (webCount > 0) result.push({ type: "web", count: webCount });
    for (const gd of gitDetails) {
      if (gd.type === "commit") result.push({ type: "commit", gitDetail: gd });
      else if (gd.type === "push") result.push({ type: "push", gitDetail: gd });
      else if (gd.type === "pr") result.push({ type: "pr", gitDetail: gd });
      else if (gd.type === "branch") result.push({ type: "branch", gitDetail: gd });
    }
    for (const m of testMilestones) {
      result.push({ type: m.milestone_type === "test_pass" ? "test_pass" : "test_fail", milestone: m });
    }
    if (errorCount > 0) result.push({ type: "error", count: errorCount });
    return result;
  }, [tools, gitDetails, testMilestones]);

  if (pills.length === 0) return null;

  const toggleSection = (type: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Tools ({tools.length})</div>
      <OutcomePills pills={pills} expandedSections={expandedSections} onToggle={toggleSection} />
      {Array.from(expandedSections).map(key => {
        const idx = parseInt(key.split(":")[1]);
        const pill = pills[idx];
        if (!pill) return null;
        return (
          <ExpandedToolSection key={key} type={pill.type} tools={tools}
            gitDetails={pill.gitDetail ? [pill.gitDetail] : gitDetails}
            testMilestones={pill.milestone ? [pill.milestone] : testMilestones}
            onClose={() => toggleSection(key)} />
        );
      })}
    </div>
  );
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

// ── Prompt Card — the primary timeline unit ───────────────────
function PromptCard({ exchange, gitDetails, testMilestones, plans, onViewDetail, onViewPlan }: {
  exchange: Exchange; gitDetails: GitDetail[]; testMilestones: Milestone[]; plans: Plan[];
  onViewDetail: (exchange: Exchange) => void; onViewPlan?: (plan: Plan) => void;
}) {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [showFullResponse, setShowFullResponse] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const { cleaned: prompt, wasInterrupted } = cleanText(exchange.user_prompt || "");
  const isInterrupt = !!exchange.is_interrupt || wasInterrupted;
  const isCompaction = !!exchange.is_compact_summary;
  const tools = exchange.tool_calls || [];
  const time = exchange.timestamp ? new Date(exchange.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  const subtitle = extractSubtitle(exchange.assistant_response);
  const { cleaned: fullResponse } = cleanText(exchange.assistant_response || "");
  const strippedResponse = useMemo(() => stripMarkdown(fullResponse), [fullResponse]);
  const pills = useMemo(() => computePills(exchange, gitDetails, testMilestones, plans), [exchange, gitDetails, testMilestones, plans]);
  const isLongPrompt = prompt.length > 180;
  const isLongResponse = strippedResponse.length > 150;
  const showPills = true;

  const toggleSection = (type: string) => {
    if (type === "plan") {
      const planPill = pills.find(p => p.type === "plan");
      if (planPill?.plan && onViewPlan) onViewPlan(planPill.plan);
      return;
    }
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  if (isCompaction) return null; // Compaction exchanges handled by CompactionMarker
  if (!prompt) return null;

  return (
    <div className="rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.03)", background: "var(--bg-surface)" }}>
      <div className="px-4 py-3">
        {/* Timestamp + detail link */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{time}</span>
          <button onClick={() => onViewDetail(exchange)}
            className="w-5 h-5 flex items-center justify-center rounded hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.08)] transition-all"
            style={{ color: "var(--text-muted)" }} title="View in terminal">
            <SquareArrowOutUpRight size={12} />
          </button>
        </div>

        {/* Prompt text */}
        <div className="text-[13px] leading-[1.6]" style={{ color: "#cccccc" }}>
          {showFullPrompt ? prompt : trunc(prompt, 180)}
          {isLongPrompt && (
            <button className="ml-1 text-[11px] hover:underline" style={{ color: "var(--text-muted)" }}
              onClick={() => setShowFullPrompt(!showFullPrompt)}>{showFullPrompt ? "show less" : "show more"}</button>
          )}
        </div>

        {/* Claude response — capped preview on card, full in detail panel */}
        {(subtitle || strippedResponse) && (
          <div className="mt-1.5">
            <div className="flex items-start gap-1.5">
              <ClaudeIcon size={13} />
              <div className="text-[12px] italic leading-[1.6] min-w-0" style={{ color: "var(--text-tertiary)" }}>
                {showFullResponse ? trunc(strippedResponse, 500) : (subtitle || strippedResponse)}
              </div>
            </div>
            {/* Response actions — separated below text */}
            {isLongResponse && (
              <div className="mt-1 pl-[19px] flex items-center justify-between">
                <button className="text-[10px] hover:underline" style={{ color: "var(--text-muted)" }}
                  onClick={() => setShowFullResponse(!showFullResponse)}>{showFullResponse ? "show less" : "show more"}</button>
                {showFullResponse && fullResponse.length > 500 && (
                  <button className="text-[10px] hover:underline flex items-center gap-1" style={{ color: "var(--text-muted)" }}
                    onClick={() => onViewDetail(exchange)}>full response <SquareArrowOutUpRight size={9} /></button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Outcome pills (with interrupt badge on the right if applicable) */}
        {(showPills || isInterrupt) && <OutcomePills pills={showPills ? pills : []} expandedSections={expandedSections} onToggle={toggleSection} isInterrupt={isInterrupt} />}

        {/* Expanded sections (below pills, on click) */}
        {showPills && Array.from(expandedSections).map(key => {
          const idx = parseInt(key.split(":")[1]);
          const pill = pills[idx];
          if (!pill) return null;
          return (
            <ExpandedToolSection key={key} type={pill.type} tools={tools}
              gitDetails={pill.gitDetail ? [pill.gitDetail] : gitDetails}
              testMilestones={pill.milestone ? [pill.milestone] : testMilestones}
              onClose={() => toggleSection(key)} />
          );
        })}
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
}

export function TimelineView({ session, exchanges, onViewPlan, onViewGroup, sortOrder = "oldest" }: TimelineViewProps) {
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

  const plansByIdx = useMemo(() => {
    const map = new Map<number, Plan[]>();
    for (const p of session.plans || []) {
      const arr = map.get(p.exchange_index_end);
      if (arr) arr.push(p); else map.set(p.exchange_index_end, [p]);
    }
    return map;
  }, [session.plans]);

  // ── Sort ───────────────────────────────────────────────────
  const displayExchanges = useMemo(() =>
    sortOrder === "newest" ? [...exchanges].reverse() : exchanges,
    [exchanges, sortOrder],
  );

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
    const content = (
      <div className="space-y-5">
        {/* User prompt */}
        <div className="rounded-md px-3 py-2.5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>You</div>
          <div className="text-[13px] whitespace-pre-wrap leading-[1.6]" style={{ color: "#cccccc" }}>{prompt}</div>
        </div>

        {/* Claude response — full markdown rendering */}
        {response && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}><ClaudeIcon size={13} /> Claude</div>
            <div className="md-content text-[12px]">
              <Markdown remarkPlugins={[remarkGfm]}>{response}</Markdown>
            </div>
          </div>
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

        {/* Tools — same pills + expand pattern as cards */}
        {tools.length > 0 && (
          <DetailToolsSection tools={tools} gitDetails={exGitDetails} testMilestones={exTests} />
        )}
      </div>
    );
    onViewGroup(title, subtitle, content, exchange);
  };

  if (exchanges.length === 0) {
    return <div className="px-6 py-8 text-[13px]" style={{ color: "var(--text-muted)" }}>No activity data available. Try the Terminal tab for the full conversation.</div>;
  }

  return (
    <div className="px-6 pb-4 pt-1">
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

      {/* Flat exchange list */}
      <div className="flex flex-col gap-2">
        {displayExchanges.map((ex) => {
          const isInherited = forkIdx != null && ex.exchange_index < forkIdx;
          const isFirstNew = forkIdx != null && ex.exchange_index >= forkIdx && (ex.exchange_index === 0 || exchanges[ex.exchange_index - 1]?.exchange_index < forkIdx);
          if (isInherited && !showInherited) return null;

          const compaction = compactionsByIdx.get(ex.exchange_index);
          const exGitDetails = gitDetailsByIdx.get(ex.exchange_index) || [];
          const exTests = testsByIdx.get(ex.exchange_index) || [];
          const exPlans = plansByIdx.get(ex.exchange_index) || [];

          return (
            <div key={ex.exchange_index}>
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

              {/* The card */}
              <div style={{ opacity: isInherited ? 0.4 : 1 }}>
                <PromptCard exchange={ex} gitDetails={exGitDetails} testMilestones={exTests} plans={exPlans}
                  onViewDetail={handleViewDetail} onViewPlan={onViewPlan} />
              </div>

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

// ── Session Flow Diagram ──────────────────────────────────────

interface FlowSource {
  id: string;
  label: string;
  mermaid: string;
  isAi: boolean;
}

export function SessionFlowDiagram({ sessionId }: { sessionId: string }) {
  const [sources, setSources] = useState<FlowSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedMermaid, setExpandedMermaid] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) { setExpandedMermaid(null); return; }
    const source = sources.find((s) => s.id === activeSourceId);
    if (!source?.mermaid) return;
    if (source.isAi) { setExpandedMermaid(source.mermaid.replace(/^graph\s+LR/m, "graph TD")); return; }
    getSessionMermaid(sessionId, "expanded")
      .then((data) => setExpandedMermaid(data?.mermaid || source.mermaid))
      .catch(() => setExpandedMermaid(source.mermaid));
  }, [expanded, activeSourceId, sessionId, sources]);

  useEffect(() => {
    let activitySource: FlowSource | null = null;
    const aiSources: FlowSource[] = [];
    const progPromise = getSessionMermaid(sessionId).then((data) => {
      activitySource = { id: "activity", label: "Activity data", mermaid: data?.mermaid || "", isAi: false };
    }).catch(() => { activitySource = { id: "activity", label: "Activity data", mermaid: "", isAi: false }; });

    const notesPromise = getSessionNotes(sessionId).then((notes: any[]) => {
      if (!notes) return;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (!n.mermaid) continue;
        const date = new Date(n.generated_at);
        const timeStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const modelStr = n.model ? ` \u00B7 ${n.model.replace(/^claude-/, "").split("-20")[0]}` : "";
        aiSources.push({ id: `note-${n.id}`, label: `AI \u00B7 ${timeStr}${modelStr}${i === 0 ? " (latest)" : ""}`, mermaid: n.mermaid, isAi: true });
      }
    }).catch(() => {});

    Promise.all([progPromise, notesPromise]).then(() => {
      const all: FlowSource[] = [];
      if (activitySource) all.push(activitySource);
      all.push(...aiSources);
      if (all.length === 0) return;
      setSources(all);
      if (activitySource?.mermaid) setActiveSourceId("activity");
      else if (aiSources.length > 0) setActiveSourceId(aiSources[0].id);
      else setActiveSourceId(all[0].id);
    });
  }, [sessionId]);

  const activeSource = sources.find((s) => s.id === activeSourceId) || null;
  const hasMultipleSources = sources.filter((s) => s.mermaid).length > 1 || (sources.some((s) => s.isAi) && sources.some((s) => !s.isAi));

  if (!activeSource) return null;
  if (!activeSource.mermaid && sources.every((s) => !s.mermaid)) return null;

  const header = (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>Session Flow</span>
      {hasMultipleSources ? (
        <select value={activeSourceId || ""} onChange={(e) => setActiveSourceId(e.target.value)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-transparent outline-none"
          style={{ color: activeSource.isAi ? "#a78bfa" : "var(--text-muted)", border: `1px solid ${activeSource.isAi ? "#a78bfa33" : "var(--border)"}` }}>
          {sources.map((s) => (<option key={s.id} value={s.id} disabled={!s.mermaid} style={{ background: "#18181b", color: s.mermaid ? "#fafafa" : "#52525b" }}>{s.label}{!s.mermaid ? " (no data)" : ""}</option>))}
        </select>
      ) : (
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: activeSource.isAi ? "#a78bfa" : "var(--text-muted)", border: `1px solid ${activeSource.isAi ? "#a78bfa33" : "var(--border)"}` }}>
          {activeSource.isAi ? "AI-enhanced" : "from activity data"}
        </span>
      )}
      {activeSource.mermaid && (
        <button onClick={() => setExpanded((v) => !v)} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }} title={expanded ? "Collapse diagram" : "Expand diagram"}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? (<><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>) : (<><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>)}
          </svg>
        </button>
      )}
    </div>
  );

  if (expanded && activeSource.mermaid) {
    return (
      <div className="mb-2 pb-2">
        <div style={{ height: 60 }} />
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }} onClick={() => setExpanded(false)} />
          <div className="relative rounded-xl overflow-y-auto" style={{ width: "96vw", maxWidth: "1800px", maxHeight: "90vh", padding: "1.5rem 2rem", background: "var(--bg-root)", border: "1px solid rgba(63, 63, 70, 0.3)" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setExpanded(false)} className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
            </button>
            {expandedMermaid ? <MermaidDiagram chart={expandedMermaid} /> : (
              <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}><div className="animate-spin w-3 h-3 rounded-full mr-2" style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} /><span className="text-[11px]">Loading expanded view...</span></div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 pb-2">
      {header}
      {activeSource.mermaid ? <MermaidDiagram chart={activeSource.mermaid} /> : (
        <div className="rounded-lg p-4 text-center text-[12px]" style={{ background: "var(--bg-root)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>Not enough activity data for a flow diagram</div>
      )}
    </div>
  );
}
