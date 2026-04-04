import { useState, useMemo } from "react";
import { cleanText } from "../../../lib/cleanText.js";
import type { Exchange, CompactionEvent, GitDetail, Plan } from "../../../lib/types.js";
import { TruncatedText } from "./TruncatedText.js";
import { ToolCallBlock } from "./ToolCallBlock.js";
import { GitDetailLine } from "./GitDetailLine.js";

// ── Constants ─────────────────────────────────────────────────
const SYSTEM_TOOLS = new Set([
  "EnterPlanMode", "ExitPlanMode", "TaskCreate", "TaskUpdate",
  "TaskStop", "TaskGet", "TaskList", "TaskOutput", "ToolSearch",
  "ExitWorktree", "EnterWorktree",
]);

// ── Helpers ───────────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// ── Main Component ────────────────────────────────────────────
interface ForkChild {
  session_id: string;
  title: string | null;
  fork_exchange_index: number | null;
}

interface TerminalViewProps {
  exchanges: Exchange[];
  milestones: Array<{ milestone_type: string; exchange_index: number; description: string }>;
  compactionEvents: CompactionEvent[];
  forkExchangeIndex?: number | null;
  parentTitle?: string | null;
  forkChildren?: ForkChild[];
  gitDetails?: GitDetail[];
  plans?: Plan[];
}

export function TerminalView({ exchanges, milestones, compactionEvents, forkExchangeIndex, parentTitle, forkChildren, gitDetails = [], plans = [] }: TerminalViewProps) {
  const [showInherited, setShowInherited] = useState(false);

  const milestonesByIdx = useMemo(() => {
    const m = new Map<number, Array<{ type: string; desc: string }>>();
    for (const ms of milestones) {
      if (!m.has(ms.exchange_index)) m.set(ms.exchange_index, []);
      m.get(ms.exchange_index)!.push({ type: ms.milestone_type, desc: ms.description });
    }
    return m;
  }, [milestones]);

  const gitDetailsByIdx = useMemo(() => {
    const m = new Map<number, GitDetail[]>();
    for (const gd of gitDetails) {
      if (!m.has(gd.exchange_index)) m.set(gd.exchange_index, []);
      m.get(gd.exchange_index)!.push(gd);
    }
    return m;
  }, [gitDetails]);

  const planEventsByIdx = useMemo(() => {
    const m = new Map<number, Array<{ action: string; plan: Plan }>>();
    for (const p of plans) {
      if (!m.has(p.exchange_index_start)) m.set(p.exchange_index_start, []);
      m.get(p.exchange_index_start)!.push({ action: "entered", plan: p });
      if (p.exchange_index_end !== p.exchange_index_start) {
        if (!m.has(p.exchange_index_end)) m.set(p.exchange_index_end, []);
        m.get(p.exchange_index_end)!.push({ action: p.status, plan: p });
      }
    }
    return m;
  }, [plans]);

  const compactionsByIdx = useMemo(() => {
    const m = new Map<number, CompactionEvent>();
    for (const c of compactionEvents) m.set(c.exchange_index, c);
    return m;
  }, [compactionEvents]);

  const inheritedCount = forkExchangeIndex != null ? exchanges.filter(e => e.exchange_index < forkExchangeIndex).length : 0;

  return (
    <div className="font-mono text-[12px] leading-relaxed">
      {/* Collapsed inherited exchanges for forked sessions */}
      {forkExchangeIndex != null && inheritedCount > 0 && (
        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowInherited(!showInherited)}
            className="flex items-center gap-2 text-[11px] w-full"
            style={{ color: "#a78bfa", fontFamily: "var(--font-sans, system-ui)" }}
          >
            <span>{showInherited ? "\u25BC" : "\u25B6"}</span>
            <span>{inheritedCount} inherited exchanges from {parentTitle ? `"${parentTitle.length > 35 ? parentTitle.substring(0, 35) + "\u2026" : parentTitle}"` : "parent session"}</span>
          </button>
        </div>
      )}
      {exchanges.map((ex) => {
        const isInherited = forkExchangeIndex != null && ex.exchange_index < forkExchangeIndex;
        const isFirstNew = forkExchangeIndex != null && ex.exchange_index === forkExchangeIndex;

        if (isInherited && !showInherited) return null;

        const { cleaned: userText, wasInterrupted } = cleanText(ex.user_prompt);
        const { cleaned: claudeText } = cleanText(ex.assistant_response || "");
        const { cleaned: preText } = cleanText(ex.assistant_response_pre || "");
        const tools = (ex.tool_calls || []).filter(tc => !SYSTEM_TOOLS.has(tc.tool_name));
        const time = ex.timestamp ? fmtTime(ex.timestamp) : "";
        const model = ex.model?.replace("claude-", "").replace(/-\d{8}$/, "") ?? "";
        const compaction = compactionsByIdx.get(ex.exchange_index);
        const exchangeGitDetails = gitDetailsByIdx.get(ex.exchange_index) || [];
        const planEvents = planEventsByIdx.get(ex.exchange_index) || [];

        const metaParts: string[] = [];
        if (model && !model.startsWith("<")) metaParts.push(model);
        if (ex.input_tokens) metaParts.push(`${fmtTokens(ex.input_tokens)} in / ${fmtTokens(ex.output_tokens || 0)} out`);
        if (ex.turn_duration_ms) metaParts.push(fmtMs(ex.turn_duration_ms));
        if (ex.has_thinking) metaParts.push("thinking");
        if (ex.is_sidechain) metaParts.push("sidechain");
        if (ex.stop_reason && !["end_turn", "stop_sequence", "tool_use"].includes(ex.stop_reason)) metaParts.push(`stop: ${ex.stop_reason}`);

        const isInterrupt = !!ex.is_interrupt || wasInterrupted;

        if (!userText && !claudeText && !preText && tools.length === 0 && !ex.is_compact_summary && !compaction) return null;

        return (
          <div key={ex.exchange_index} id={`terminal-${ex.exchange_index}`} className="scroll-mt-16">
            {/* Fork divider */}
            {isFirstNew && (
              <div className="flex items-center gap-3 py-3 px-5">
                <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                <span className="text-[11px] font-medium shrink-0" style={{ color: "#a78bfa", fontFamily: "var(--font-sans, system-ui)" }}>
                  {parentTitle ? `Forked from "${parentTitle.length > 40 ? parentTitle.substring(0, 40) + "\u2026" : parentTitle}"` : "Fork point \u2014 new content below"}
                </span>
                <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
              </div>
            )}

            {/* Milestones */}
            {milestonesByIdx.get(ex.exchange_index)?.map((ms, i) => (
              <div key={i} className="px-5 py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{ms.desc}</span>
              </div>
            ))}

            {/* Compaction */}
            {(!!ex.is_compact_summary || compaction) && (
              <div className="px-5 py-2 text-center text-[11px]" style={{ color: "#f59e0b" }}>
                {"\u2500\u2500\u2500"} context compacted{compaction?.exchanges_before ? ` \u00B7 ${compaction.exchanges_before} exchanges summarized` : ""} {"\u2500\u2500\u2500"}
              </div>
            )}

            {/* Exchange */}
            <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)", opacity: isInherited ? 0.35 : 1 }}>
              {/* Header */}
              <div className="flex items-center gap-2 mb-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                <span className="font-bold">#{ex.exchange_index}</span>
                {time && <span>{time}</span>}
                {ex.cwd && <span className="truncate max-w-[300px]">{ex.cwd.split("/").slice(-3).join("/")}</span>}
                {metaParts.length > 0 && <span className="ml-auto shrink-0">{metaParts.join(" \u00B7 ")}</span>}
              </div>

              {/* User prompt — grey background matching Claude Code's userMessageBackground */}
              {userText && !ex.is_compact_summary && (
                <div className="-mx-2 mb-2 px-3 py-1.5 rounded" style={{ background: "var(--cc-user-bg)" }}>
                  <TruncatedText
                    text={userText}
                    maxLines={4}
                    prefix=">"
                    prefixStyle={{ color: "var(--text-primary)", fontWeight: 600 }}
                    textStyle={{ color: "var(--text-primary)" }}
                  />
                </div>
              )}

              {/* Claude pre-tool text (or main response when no tools and claudeText is empty) */}
              {preText && (tools.length > 0 || !claudeText) && (
                <div className="mb-1">
                  <TruncatedText
                    text={preText}
                    maxLines={4}
                    prefix={"\u25CF"}
                    prefixStyle={{ color: "var(--text-primary)" }}
                    textStyle={{ color: "var(--text-secondary)" }}
                  />
                </div>
              )}

              {/* Tool calls */}
              {tools.length > 0 && (
                <div className="my-1">
                  {tools.map((tc) => <ToolCallBlock key={tc.id} tc={tc} />)}
                </div>
              )}

              {/* Git details */}
              {exchangeGitDetails.length > 0 && (
                <div className="my-1">
                  {exchangeGitDetails.map((gd, i) => <GitDetailLine key={i} gd={gd} />)}
                </div>
              )}

              {/* Plan events */}
              {planEvents.length > 0 && (
                <div className="my-1">
                  {planEvents.map((pe, i) => {
                    let title = "";
                    if (pe.plan.plan_text) {
                      for (const line of pe.plan.plan_text.split("\n")) {
                        const t = line.trim();
                        if (t.startsWith("#")) { title = t.replace(/^#+\s*/, "").replace(/^Plan:\s*/i, ""); break; }
                      }
                    }
                    const statusLabel = pe.action === "entered" ? "Plan mode entered" : `Plan ${pe.plan.status}`;
                    return (
                      <div key={i}>
                        <div className="py-0.5">
                          <span style={{ color: "#a78bfa" }}>{"\u00A0\u00A0"}{"\u25CF"}{" "}{statusLabel}</span>
                          {title && <span style={{ color: "var(--cc-dim)" }}>{" \u2014 "}{title.length > 60 ? title.substring(0, 57) + "\u2026" : title}</span>}
                        </div>
                        {pe.plan.user_feedback && (
                          <div className="text-[11px] ml-6 mt-0.5" style={{ color: "var(--cc-dim)" }}>
                            feedback: "{pe.plan.user_feedback.length > 100 ? pe.plan.user_feedback.substring(0, 97) + "\u2026" : pe.plan.user_feedback}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Claude response */}
              {claudeText && (
                <div className="mt-2">
                  <TruncatedText
                    text={claudeText}
                    maxLines={6}
                    prefix={"\u25CF"}
                    prefixStyle={{ color: "var(--text-primary)" }}
                    textStyle={{ color: "var(--text-secondary)" }}
                  />
                </div>
              )}

              {/* Interrupted */}
              {isInterrupt && (
                <div className="text-[10px] mt-1" style={{ color: "var(--cc-dim)" }}>[interrupted]</div>
              )}
            </div>

            {/* Fork-out markers */}
            {forkChildren?.filter((fc) => fc.fork_exchange_index === ex.exchange_index).map((fc) => (
              <div key={fc.session_id} className="flex items-center gap-3 py-2 px-5">
                <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                <a
                  href={`/sessions/${fc.session_id}`}
                  className="text-[11px] font-medium shrink-0 hover:underline"
                  style={{ color: "#a78bfa", fontFamily: "var(--font-sans, system-ui)" }}
                >
                  {"\u2192"} Forked into "{fc.title && fc.title.length > 40 ? fc.title.substring(0, 40) + "\u2026" : fc.title || fc.session_id.substring(0, 12)}"
                </a>
                <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
