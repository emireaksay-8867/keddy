import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSession, getSessionExchanges, analyzeSession, getConfig, updateConfig } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS } from "../lib/constants.js";
import { cleanText } from "../lib/cleanText.js";
import { toolSummary } from "../lib/toolSummary.js";
import { ContentPanel } from "../components/ContentPanel.js";
import { ClaudeIcon } from "../components/ClaudeIcon.js";
import { GroupCard } from "../components/GroupCard.js";
import { ActivityStrip } from "../components/ActivityStrip.js";
import { StatsTab } from "../components/StatsTab.js";
import type { SessionDetail as SessionDetailType, Exchange, Segment, Milestone, Plan, CompactionEvent, Decision, ActivityGroupDetail } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function fmtShortTime(d: string) { return new Date(d).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtRelative(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return fmtTime(d);
}
function fmtDuration(a: string, b: string | null) {
  if (!b) return "";
  const m = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m < 1) return "<1m"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function safeJson<T>(s: string, d: T): T { try { return JSON.parse(s); } catch { return d; } }
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }
function planTitle(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) return t.replace(/^#+\s*/, "").replace(/^Plan:\s*/i, "");
  }
  return text.split("\n").find(l => l.trim().length > 3)?.trim().substring(0, 80) || "";
}

type PanelContent = {
  title: string;
  content: string;
  subtitle?: string;
  exchanges?: Exchange[];
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
} | null;

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  implemented: { bg: "#10b98120", fg: "#10b981", label: "Implemented" },
  approved: { bg: "#10b98115", fg: "#10b981", label: "Approved" },
  revised: { bg: "#f59e0b15", fg: "#f59e0b", label: "Revised" },
  rejected: { bg: "#ef444415", fg: "#ef4444", label: "Rejected" },
  drafted: { bg: "#71717a15", fg: "#71717a", label: "Draft" },
  superseded: { bg: "#71717a15", fg: "#71717a", label: "Superseded" },
};

const MS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  commit: { icon: "●", label: "Commit", color: "#818cf8" },
  push: { icon: "↑", label: "Push", color: "#60a5fa" },
  pull: { icon: "↓", label: "Pull", color: "#a78bfa" },
  pr: { icon: "⑂", label: "Pull Request", color: "#34d399" },
  branch: { icon: "⑃", label: "Branch", color: "#fbbf24" },
  test_pass: { icon: "✓", label: "Tests Passed", color: "#10b981" },
  test_fail: { icon: "✗", label: "Tests Failed", color: "#ef4444" },
};

// ── Exchange Bubble (used in transcript & panel) ───────────────
function ExchangeBubble({ ex, openPanel }: { ex: Exchange; openPanel: (t: string, c: string, s?: string) => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const { cleaned: userText, wasInterrupted: userInt } = cleanText(ex.user_prompt);
  const { cleaned: claudeText, wasInterrupted: claudeInt } = cleanText(ex.assistant_response || "");
  const isInterrupted = !!ex.is_interrupt || userInt || claudeInt;
  // Different preview lengths: user messages are shorter, Claude responses longer
  const USER_PREVIEW_LEN = 1200;
  const CLAUDE_PREVIEW_LEN = 2000;

  return (
    <div id={`exchange-${ex.exchange_index}`} className="scroll-mt-16">
      {!!ex.is_compact_summary && (
        <div className="flex items-center gap-3 py-3 my-2">
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
          <span className="text-[11px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context Compacted</span>
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
        </div>
      )}

      {/* User — right-aligned bubble */}
      {userText && !ex.is_compact_summary && (
        <div className="flex justify-end mb-3">
          <div className="max-w-[78%]">
            <div className="rounded-2xl rounded-br-sm px-5 py-3.5" style={{ background: "var(--user-bubble-bg)" }}>
              <div className="text-[14px] leading-[1.75]" style={{ color: "var(--text-primary)" }}>
                {userText.length > USER_PREVIEW_LEN ? (
                  <>
                    <pre className="whitespace-pre-wrap font-[inherit]">{userText.substring(0, USER_PREVIEW_LEN)}</pre>
                    <button onClick={() => openPanel("Your Message", ex.user_prompt, `Exchange #${ex.exchange_index}`)} className="text-[13px] font-medium hover:underline mt-2 block" style={{ color: "var(--accent-hover)" }}>
                      Show full message ({Math.ceil(userText.length / 1000)}k chars)
                    </button>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap font-[inherit]">{userText}</pre>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1.5 px-1">
              {ex.timestamp && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ex.timestamp)}</span>}
              {isInterrupted && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>}
            </div>
          </div>
        </div>
      )}

      {/* Tools — shown inline like Claude Code */}
      {tools.length > 0 && (
        <div className="mb-3 ml-7 mr-4">
          {/* Always show first few tools visually */}
          <div className="space-y-0.5">
            {tools.slice(0, toolsOpen ? tools.length : Math.min(tools.length, 3)).map((tc) => {
              const summary = toolSummary(tc.tool_name, tc.tool_input);
              return (
                <button key={tc.id} onClick={() => {
                  let c = `**Input:**\n\`\`\`json\n${(() => { try { return JSON.stringify(JSON.parse(tc.tool_input), null, 2); } catch { return tc.tool_input; } })()}\n\`\`\``;
                  if (tc.tool_result) c += `\n\n**Result:**\n\`\`\`\n${tc.tool_result.substring(0, 5000)}\n\`\`\``;
                  openPanel(tc.tool_name, c, tc.is_error ? "Error" : undefined);
                }} className="w-full text-left text-[12px] flex items-center gap-2 py-1 px-3 rounded-md hover:bg-[var(--bg-hover)] transition-colors group" style={{ color: "var(--text-tertiary)" }}>
                  <span className="w-1 h-1 rounded-full shrink-0" style={{ background: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }} />
                  <span className="font-mono font-medium" style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>{tc.tool_name}</span>
                  <span className="font-mono truncate flex-1 opacity-50">{summary}</span>
                  {!!tc.is_error && <span className="text-[10px] px-1 rounded" style={{ background: `${SEGMENT_COLORS.debugging}20`, color: SEGMENT_COLORS.debugging }}>error</span>}
                </button>
              );
            })}
          </div>
          {tools.length > 3 && !toolsOpen && (
            <button onClick={() => setToolsOpen(true)} className="text-[11px] mt-1 ml-3 hover:underline" style={{ color: "var(--text-muted)" }}>
              +{tools.length - 3} more tools
            </button>
          )}
          {toolsOpen && tools.length > 3 && (
            <button onClick={() => setToolsOpen(false)} className="text-[11px] mt-1 ml-3 hover:underline" style={{ color: "var(--text-muted)" }}>
              show less
            </button>
          )}
        </div>
      )}

      {/* Claude — left-aligned with official logo */}
      {claudeText && (
        <div className="flex justify-start mb-4">
          <div className="flex gap-3 max-w-[85%]">
            <div className="shrink-0 mt-1"><ClaudeIcon size={20} /></div>
            <div className="flex-1 min-w-0 text-[14px] leading-[1.8]" style={{ color: "var(--text-secondary)" }}>
              {claudeText.length > CLAUDE_PREVIEW_LEN ? (
                <>
                  <pre className="whitespace-pre-wrap font-[inherit]">{claudeText.substring(0, CLAUDE_PREVIEW_LEN)}</pre>
                  <button onClick={() => openPanel("Claude's Response", ex.assistant_response, `Exchange #${ex.exchange_index}`)} className="text-[13px] font-medium hover:underline mt-2 block" style={{ color: "var(--accent)" }}>
                    Show full response ({Math.ceil(claudeText.length / 1000)}k chars)
                  </button>
                </>
              ) : /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s|```/m.test(claudeText) ? (
                <div className="md-content">
                  <Markdown remarkPlugins={[remarkGfm]}>{claudeText}</Markdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-[inherit]">{claudeText}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline Segment Marker (for transcript view) ────────────────
function InlineSegmentMarker({ seg, exchanges }: { seg: Segment; exchanges: Exchange[] }) {
  const color = SEGMENT_COLORS[seg.segment_type] || "#555";
  const aiLabel = seg.summary?.includes("|||") ? seg.summary.split("|||")[0].trim() : "";
  const label = aiLabel || SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
  const ts = exchanges.find(e => e.exchange_index === seg.exchange_index_start)?.timestamp;
  return (
    <div className="flex items-center gap-2.5 py-3 my-2">
      <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: `${color}12`, color }}>{label}</span>
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        #{seg.exchange_index_start}{seg.exchange_index_end !== seg.exchange_index_start ? `–${seg.exchange_index_end}` : ""}
      </span>
      {ts && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ts)}</span>}
      <div className="h-px flex-1" style={{ background: `${color}20` }} />
    </div>
  );
}

// ── Full Transcript View ───────────────────────────────────────
function TranscriptView({ exchanges, segments, milestones, compactionEvents, openPanel }: {
  exchanges: Exchange[]; segments: Segment[]; milestones: Milestone[]; compactionEvents: CompactionEvent[];
  openPanel: (t: string, c: string, s?: string) => void;
}) {
  // Build a unified stream with segment markers inline
  type Item =
    | { kind: "exchange"; data: Exchange; idx: number }
    | { kind: "segment"; data: Segment; idx: number }
    | { kind: "milestones"; data: Milestone[]; idx: number };

  const items: Item[] = [];
  exchanges.forEach(ex => items.push({ kind: "exchange", data: ex, idx: ex.exchange_index * 10 }));
  segments.forEach(seg => items.push({ kind: "segment", data: seg, idx: seg.exchange_index_start * 10 - 1 }));

  // Group milestones
  const rawMs = [...milestones].sort((a, b) => a.exchange_index - b.exchange_index);
  const msGroups: Milestone[][] = [];
  let cur: Milestone[] = [];
  for (const m of rawMs) {
    if (cur.length > 0 && m.exchange_index !== cur[cur.length - 1].exchange_index) { msGroups.push(cur); cur = [m]; } else cur.push(m);
  }
  if (cur.length > 0) msGroups.push(cur);
  msGroups.forEach(g => items.push({ kind: "milestones", data: g, idx: g[0].exchange_index * 10 + 5 }));

  items.sort((a, b) => a.idx - b.idx);

  return (
    <div className="py-4 px-8">
      {items.map((item, i) => {
        if (item.kind === "segment") return <InlineSegmentMarker key={`seg-${i}`} seg={item.data as Segment} exchanges={exchanges} />;
        if (item.kind === "milestones") {
          const group = item.data as Milestone[];
          return (
            <div key={`ms-${i}`} className="flex flex-wrap gap-1.5 py-2 my-1 ml-8">
              {group.map((m, j) => {
                const cfg = MS_CONFIG[m.milestone_type] || { icon: "·", label: m.milestone_type, color: "#888" };
                return <span key={j} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}10`, color: cfg.color }}>{cfg.icon} {trunc(m.description, 50)}</span>;
              })}
            </div>
          );
        }
        return <ExchangeBubble key={`ex-${(item.data as Exchange).id}`} ex={item.data as Exchange} openPanel={openPanel} />;
      })}
    </div>
  );
}

// ── Summary Timeline View (overview cards) ─────────────────────
function TimelineView({ session, exchanges, openPanel, sortNewest = false }: {
  session: SessionDetailType; exchanges: Exchange[];
  openPanel: (t: string, c: string, s?: string, exs?: Exchange[], nav?: { onPrev?: () => void; onNext?: () => void; prevLabel?: string; nextLabel?: string }) => void;
  sortNewest?: boolean;
}) {
  const { segments, milestones, compaction_events: compactionEvents, plans } = session;

  // Build items
  type TI = { kind: "segment" | "milestones" | "compaction"; data: any; idx: number };
  const raw: Array<{ kind: "segment" | "milestone" | "compaction"; data: any; idx: number }> = [];
  segments.forEach(s => raw.push({ kind: "segment", data: s, idx: s.exchange_index_start }));
  milestones.forEach(m => raw.push({ kind: "milestone", data: m, idx: m.exchange_index }));
  compactionEvents.forEach(c => raw.push({ kind: "compaction", data: c, idx: c.exchange_index }));
  raw.sort((a, b) => a.idx - b.idx);

  const items: TI[] = [];
  let pendingMs: Milestone[] = [];
  for (const r of raw) {
    if (r.kind === "milestone") { pendingMs.push(r.data); }
    else { if (pendingMs.length) { items.push({ kind: "milestones", data: pendingMs, idx: pendingMs[0].exchange_index }); pendingMs = []; } items.push({ kind: r.kind as any, data: r.data, idx: r.idx }); }
  }
  if (pendingMs.length) items.push({ kind: "milestones", data: pendingMs, idx: pendingMs[0].exchange_index });

  // Apply sort
  const displayItems = sortNewest ? [...items].reverse() : items;

  // Get only segment items for navigation
  const segmentItems = items.filter(it => it.kind === "segment");

  // Open a segment panel with prev/next navigation
  function openSegment(segIdx: number) {
    const seg = segmentItems[segIdx]?.data as Segment | undefined;
    if (!seg) return;
    const color = SEGMENT_COLORS[seg.segment_type] || "#555";
    const aiLabel = seg.summary?.includes("|||") ? seg.summary.split("|||")[0].trim() : "";
    const label = aiLabel || SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
    const segEx = exchanges.filter(e => e.exchange_index >= seg.exchange_index_start && e.exchange_index <= seg.exchange_index_end);
    const ts = segEx[0]?.timestamp;
    const tsEnd = segEx[segEx.length - 1]?.timestamp;
    const dur = ts && tsEnd ? fmtDuration(ts, tsEnd) : "";
    const range = seg.exchange_index_start === seg.exchange_index_end ? `#${seg.exchange_index_start}` : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;

    const title = `${label} — ${range}`;
    const subtitle = [
      `${segEx.length} exchanges`,
      dur,
      ts ? fmtShortTime(ts) : "",
      ts ? fmtRelative(ts) : "",
    ].filter(Boolean).join(" · ");

    const prevSeg = segIdx > 0 ? segmentItems[segIdx - 1]?.data as Segment : null;
    const nextSeg = segIdx < segmentItems.length - 1 ? segmentItems[segIdx + 1]?.data as Segment : null;

    openPanel(title, "", subtitle, segEx, {
      onPrev: prevSeg ? () => openSegment(segIdx - 1) : undefined,
      onNext: nextSeg ? () => openSegment(segIdx + 1) : undefined,
      prevLabel: prevSeg ? SEGMENT_LABELS[prevSeg.segment_type] || prevSeg.segment_type : undefined,
      nextLabel: nextSeg ? SEGMENT_LABELS[nextSeg.segment_type] || nextSeg.segment_type : undefined,
    });
  }

  return (
    <div className="py-4 px-8">
      {/* Plans */}
      {plans.length > 0 && (
        <div className="mb-6 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
            <span className="text-[14px] font-semibold">Plans</span>
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{plans.length} version{plans.length > 1 ? "s" : ""}</span>
          </div>
          {plans.map(plan => {
            const st = STATUS_STYLE[plan.status] || STATUS_STYLE.drafted;
            return (
              <button key={plan.id} onClick={() => {
                let c = plan.plan_text;
                if (plan.user_feedback) c += `\n\n---\n\n**User Feedback:**\n> ${plan.user_feedback}`;
                openPanel(`Plan v${plan.version}`, c, st.label);
              }} className="w-full text-left px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors border-t group" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-semibold">Version {plan.version}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  <span className="text-[12px] ml-auto opacity-0 group-hover:opacity-100" style={{ color: "var(--accent)" }}>View →</span>
                </div>
                <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{trunc(planTitle(plan.plan_text), 120)}</p>
                {plan.user_feedback && <p className="text-[12px] mt-1 italic" style={{ color: "#ef4444" }}>"{trunc(plan.user_feedback, 80)}"</p>}
              </button>
            );
          })}
        </div>
      )}

      {/* Tasks */}
      {session.tasks && session.tasks.length > 0 && (
        <div className="mb-6 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
            <span className="text-[14px] font-semibold">Tasks</span>
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              {session.tasks.filter(t => t.status === "completed").length}/{session.tasks.length} completed
            </span>
            {/* Progress bar */}
            <div className="flex-1 h-1.5 rounded-full ml-2" style={{ background: "var(--bg-elevated)" }}>
              <div className="h-full rounded-full transition-all" style={{
                width: `${(session.tasks.filter(t => t.status === "completed").length / session.tasks.length) * 100}%`,
                background: session.tasks.every(t => t.status === "completed") ? "#10b981" : "var(--accent)",
              }} />
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {session.tasks.map(task => {
              const statusIcon = task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : task.status === "stopped" ? "✗" : "○";
              const statusColor = task.status === "completed" ? "#10b981" : task.status === "in_progress" ? "var(--accent)" : task.status === "stopped" ? "#ef4444" : "var(--text-muted)";
              return (
                <div key={task.id} className="px-5 py-2.5 flex items-start gap-3">
                  <span className="text-[14px] mt-0.5 shrink-0" style={{ color: statusColor }}>{statusIcon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium" style={{ color: task.status === "completed" ? "var(--text-tertiary)" : "var(--text-primary)", textDecoration: task.status === "completed" ? "line-through" : "none" }}>
                      {task.subject}
                    </p>
                    {task.description && task.description !== task.subject && (
                      <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>{trunc(task.description, 120)}</p>
                    )}
                  </div>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--text-muted)" }}>
                    #{task.exchange_created}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Decisions (from AI analysis) */}
      {session.decisions && session.decisions.length > 0 && (
        <div className="mb-6 rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
            <span className="text-[14px] font-semibold">Key Decisions</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>AI</span>
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{session.decisions.length} found</span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {session.decisions.map((d: Decision) => {
              const alts = (() => { try { return JSON.parse(d.alternatives || "[]"); } catch { return []; } })() as string[];
              return (
                <button key={d.id} onClick={() => {
                  let content = `**Decision:** ${d.decision_text}`;
                  if (d.context) content += `\n\n**Context:** ${d.context}`;
                  if (alts.length > 0) content += `\n\n**Alternatives considered:**\n${alts.map(a => `- ${a}`).join("\n")}`;
                  openPanel("Decision", content, `Exchange #${d.exchange_index}`);
                }} className="w-full text-left px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors group">
                  <div className="flex items-start gap-3">
                    <span className="text-[14px] mt-0.5 shrink-0" style={{ color: "var(--accent)" }}>◆</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{d.decision_text}</p>
                      {d.context && <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>{trunc(d.context, 120)}</p>}
                      {alts.length > 0 && (
                        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                          {alts.length} alternative{alts.length !== 1 ? "s" : ""} considered
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--text-muted)" }}>#{d.exchange_index}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      {items.length > 0 && (
        <div className="relative pl-9">
          <div className="absolute left-[14px] top-4 bottom-4 w-px" style={{ background: "var(--border)" }} />
          {displayItems.map((item, i) => {
            if (item.kind === "segment") {
              const seg = item.data as Segment;
              const color = SEGMENT_COLORS[seg.segment_type] || "#555";
              const baseLabel = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;

              // Parse AI label|||summary format
              let aiLabel = "";
              let aiSummary = "";
              if (seg.summary) {
                const parts = seg.summary.split("|||");
                if (parts.length === 2) {
                  aiLabel = parts[0].trim();
                  aiSummary = parts[1].trim();
                } else {
                  // Old format — no label, just summary
                  aiSummary = seg.summary;
                }
              }
              const label = aiLabel || baseLabel;
              const hasSummary = !!aiSummary;

              const files = safeJson<string[]>(seg.files_touched || "[]", []);
              const tools = safeJson<Record<string, number>>(seg.tool_counts || "{}", {});
              const segEx = exchanges.filter(e => e.exchange_index >= seg.exchange_index_start && e.exchange_index <= seg.exchange_index_end);
              const ts = segEx[0]?.timestamp;
              const tsEnd = segEx[segEx.length - 1]?.timestamp;
              const segDur = ts && tsEnd ? fmtDuration(ts, tsEnd) : "";
              const range = seg.exchange_index_start === seg.exchange_index_end ? `#${seg.exchange_index_start}` : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;

              const flowPairs: Array<{ user: string; claude: string; tools: number }> = [];
              for (const e of segEx) {
                const { cleaned: u } = cleanText(e.user_prompt);
                const { cleaned: c } = cleanText(e.assistant_response || "");
                if (u || c) flowPairs.push({ user: u, claude: c, tools: e.tool_call_count });
              }
              const toolSummaryLine = Object.entries(tools).slice(0, 3).map(([k, v]) => `${v} ${k}`).join(" · ");
              const fileCount = files.length;
              const previewCount = hasSummary ? 2 : 3;
              const totalTools = Object.values(tools).reduce((a, b) => a + b, 0);

              return (
                <div key={`s${i}`} className="relative pb-4">
                  <div className="absolute left-[-27px] top-[14px] w-[10px] h-[10px] rounded-full" style={{ background: color, boxShadow: `0 0 0 2px var(--bg-root)` }} />
                  <button
                    onClick={() => { const sIdx = segmentItems.findIndex(si => si.data === seg); openSegment(sIdx >= 0 ? sIdx : 0); }}
                    className="w-full text-left rounded-xl border hover:border-[var(--border-bright)] transition-all group overflow-hidden"
                    style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                      <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: `${color}12`, color }}>{label}</span>
                      <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {segEx.length} exchange{segEx.length !== 1 ? "s" : ""}{segDur ? ` · ${segDur}` : ""}{ts ? ` · ${fmtShortTime(ts)}` : ""}
                      </span>
                      <span className="text-[11px] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>View →</span>
                    </div>

                    {/* AI summary — styled card with gradient accent */}
                    {hasSummary && (
                      <div className="mx-5 mb-3 rounded-lg px-4 py-3 flex items-start gap-2.5" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(168,85,247,0.04))", border: "1px solid rgba(99,102,241,0.1)" }}>
                        <span className="text-[14px] shrink-0 mt-0.5" style={{ color: "#8b5cf6" }}>✦</span>
                        <p className="text-[13px] leading-[1.65]" style={{ color: "var(--text-primary)" }}>
                          {aiSummary}
                        </p>
                      </div>
                    )}

                    {/* Conversation preview — compact but readable with user/claude indicators */}
                    <div className="mx-5 mb-3 rounded-lg overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
                      {flowPairs.slice(0, previewCount).map((pair, j) => (
                        <div key={j} className="px-3.5 py-2 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                          {pair.user && (
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-semibold shrink-0 mt-0.5" style={{ color: "var(--user-accent)" }}>You</span>
                              <p className="text-[12px] leading-[1.5] line-clamp-1" style={{ color: "var(--text-primary)" }}>
                                {trunc(pair.user, hasSummary ? 120 : 200)}
                              </p>
                            </div>
                          )}
                          {pair.claude && (
                            <div className="flex items-start gap-2 mt-1">
                              <span className="shrink-0 mt-0.5"><ClaudeIcon size={11} /></span>
                              <p className="text-[12px] leading-[1.5] line-clamp-1" style={{ color: "var(--text-tertiary)" }}>
                                {trunc(pair.claude, hasSummary ? 80 : 140)}
                              </p>
                            </div>
                          )}
                          {pair.tools > 0 && (
                            <span className="text-[10px] font-mono ml-5 mt-0.5 inline-block" style={{ color: "var(--text-muted)" }}>{pair.tools} tool{pair.tools !== 1 ? "s" : ""}</span>
                          )}
                        </div>
                      ))}
                      {flowPairs.length > previewCount && (
                        <div className="px-3.5 py-1.5 text-center">
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>+{flowPairs.length - previewCount} more exchange{flowPairs.length - previewCount !== 1 ? "s" : ""}</span>
                        </div>
                      )}
                    </div>

                    {/* Footer — files + tools summary */}
                    {(totalTools > 0 || fileCount > 0) && (
                      <div className="flex items-center flex-wrap gap-2 text-[11px] px-5 pb-3" style={{ color: "var(--text-muted)" }}>
                        {totalTools > 0 && <span className="font-mono">{totalTools} tools</span>}
                        {fileCount > 0 && <span>{fileCount} file{fileCount !== 1 ? "s" : ""}</span>}
                        {files.slice(0, 3).map(f => (
                          <span key={f} className="font-mono px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-root)" }}>{f.split("/").pop()}</span>
                        ))}
                        {files.length > 3 && <span>+{files.length - 3}</span>}
                      </div>
                    )}
                  </button>
                </div>
              );
            }

            if (item.kind === "milestones") {
              const group = item.data as Milestone[];
              const summary = new Map<string, number>();
              for (const m of group) summary.set(m.milestone_type, (summary.get(m.milestone_type) || 0) + 1);

              const handleMilestoneClick = () => {
                const grouped = new Map<string, Milestone[]>();
                for (const m of group) {
                  const list = grouped.get(m.milestone_type) || [];
                  list.push(m);
                  grouped.set(m.milestone_type, list);
                }
                const lines: string[] = [];
                for (const [type, ms] of grouped.entries()) {
                  const cfg = MS_CONFIG[type] || { icon: "·", label: type, color: "#888" };
                  lines.push(`## ${cfg.icon} ${cfg.label}${ms.length > 1 ? ` (${ms.length})` : ""}\n`);
                  for (const m of ms) {
                    lines.push(`- ${m.description}`);
                  }
                  lines.push("");
                }
                openPanel("Milestones", lines.join("\n"), `${group.length} milestone${group.length !== 1 ? "s" : ""}`);
              };

              return (
                <div key={`mg${i}`} className="relative pb-3">
                  <div className="absolute left-[-25px] top-[10px] w-[5px] h-[5px] rounded-full" style={{ background: "var(--accent)" }} />
                  <button
                    onClick={handleMilestoneClick}
                    className="w-full text-left rounded-lg border px-3.5 py-2.5 hover:border-[var(--border-bright)] transition-all group"
                    style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {Array.from(summary.entries()).map(([type, count]) => {
                        const cfg = MS_CONFIG[type] || { icon: "·", label: type, color: "#888" };
                        return <span key={type} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}10`, color: cfg.color }}>{cfg.icon} {count > 1 ? `${count}× ${cfg.label}` : cfg.label}</span>;
                      })}
                      {(() => {
                        const msTs = exchanges.find(e => e.exchange_index === group[0].exchange_index)?.timestamp;
                        return msTs ? <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(msTs)}</span> : null;
                      })()}
                    </div>
                  </button>
                </div>
              );
            }

            // compaction — show token count, continuation summary, and analysis
            const ce = item.data as CompactionEvent;
            const ceTs = exchanges.find(e => e.exchange_index === ce.exchange_index)?.timestamp;
            const tokenInfo = ce.pre_tokens ? `${Math.round(ce.pre_tokens / 1000)}K tokens` : null;
            const cleanedSummary = ce.summary ? cleanText(ce.summary).cleaned : null;
            const cleanedAnalysis = ce.analysis_summary ? cleanText(ce.analysis_summary).cleaned : null;
            const hasContinuation = cleanedSummary && cleanedSummary !== "Conversation compacted";
            const hasAnalysis = !!cleanedAnalysis;
            const hasContent = hasContinuation || hasAnalysis;
            return (
              <div key={`c${i}`} className="relative pb-3">
                <div className="absolute left-[-25px] top-[10px] w-[5px] h-[5px] rounded-full" style={{ background: SEGMENT_COLORS.exploring }} />
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: hasContent ? "1px solid var(--border)" : "none" }}>
                    <span className="text-[11px] font-semibold" style={{ color: SEGMENT_COLORS.exploring }}>Context Compacted</span>
                    {tokenInfo && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{tokenInfo}</span>}
                    {ceTs && <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ceTs)}</span>}
                  </div>

                  {/* Analysis summary */}
                  {hasAnalysis && (
                    <button
                      onClick={() => openPanel("Compaction Analysis", cleanedAnalysis!, tokenInfo ? `Analysis of ${tokenInfo} before compaction` : "Analysis of compacted context")}
                      className="w-full text-left px-3.5 py-2 hover:bg-[var(--bg-hover)] transition-colors group"
                      style={{ borderBottom: hasContinuation ? "1px solid var(--border)" : "none" }}
                    >
                      <p className="text-[11px] line-clamp-2" style={{ color: "var(--text-tertiary)" }}>{trunc(cleanedAnalysis!, 150)}</p>
                    </button>
                  )}

                  {/* Continuation context */}
                  {hasContinuation && (
                    <button
                      onClick={() => openPanel("Continuation Context", cleanedSummary!, tokenInfo ? `Context carried forward after ${tokenInfo} compacted` : "Context carried forward")}
                      className="w-full text-left px-3.5 py-2 hover:bg-[var(--bg-hover)] transition-colors group"
                    >
                      <p className="text-[11px] line-clamp-1" style={{ color: "var(--text-muted)" }}>{trunc(cleanedSummary!, 120)}</p>
                    </button>
                  )}

                  {!hasContent && (
                    <div className="px-4 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>No summary available</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && plans.length === 0 && (
        <div className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>No timeline data for this session</div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────
export function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "transcript" | "stats">("timeline");
  const [stats, setStats] = useState<any>(null);
  const [panel, setPanel] = useState<PanelContent>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState("");
  const [showAiSetup, setShowAiSetup] = useState(false);
  const [aiKey, setAiKey] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [sortNewest, setSortNewest] = useState(false);
  const [newExchangeCount, setNewExchangeCount] = useState(0);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback((isInitial = false) => {
    if (!id) return;
    if (isInitial) { setLoading(true); setTab("timeline"); }

    // Save scroll position before refresh
    const scrollPos = contentRef.current?.scrollTop ?? 0;

    Promise.all([getSession(id) as Promise<SessionDetailType>, getSessionExchanges(id, true) as Promise<Exchange[]>])
      .then(([s, e]) => {
        setSession(s);
        if (isInitial) {
          setExchanges(e);
          setLastSeenCount(e.length);
          setNewExchangeCount(0);
        } else {
          // Background poll — only update count, preserve scroll
          const prevLen = exchanges.length;
          setExchanges(e);
          if (e.length > prevLen) {
            setNewExchangeCount(e.length - lastSeenCount);
          }
          // Restore scroll position after render
          requestAnimationFrame(() => {
            if (contentRef.current) {
              contentRef.current.scrollTop = scrollPos;
            }
          });
        }
      })
      .catch(console.error).finally(() => { if (isInitial) setLoading(false); });
  }, [id, lastSeenCount, exchanges.length]);

  useEffect(() => { fetchData(true); }, [fetchData]);
  useEffect(() => {
    pollRef.current = setInterval(() => fetchData(false), 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  const openPanel = (title: string, content: string, subtitle?: string, exs?: Exchange[], nav?: { onPrev?: () => void; onNext?: () => void; prevLabel?: string; nextLabel?: string }) =>
    setPanel({ title, content, subtitle, exchanges: exs, ...nav });

  if (loading) return <div className="p-8 text-[14px]" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (!session) return <div className="p-8 text-[14px]" style={{ color: "var(--text-muted)" }}>Session not found</div>;

  const title = cleanText(session.title || session.session_id.substring(0, 24)).cleaned;
  const project = session.project_path.split("/").slice(-2).join("/");
  const dur = fmtDuration(session.started_at, session.ended_at);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button onClick={() => navigate("/")} className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>← Sessions</button>
        <h1 className="text-[17px] font-semibold leading-snug mb-1.5">{trunc(title, 100)}</h1>
        <div className="flex items-center gap-2.5 text-[12px] flex-wrap" style={{ color: "var(--text-tertiary)" }}>
          <span>{project}</span>
          {session.git_branch && <span className="px-1.5 py-0.5 rounded font-mono text-[11px]" style={{ background: "var(--bg-elevated)" }}>{session.git_branch}</span>}
          <span>{fmtTime(session.started_at)}{session.ended_at ? ` → ${fmtTime(session.ended_at)}` : ""}</span>
          {dur && <span>({dur})</span>}
          <span>{exchanges.length} exchanges</span>
          {session.model_breakdown && session.model_breakdown.length > 0 && (
            <span className="font-mono text-[11px]">{session.model_breakdown[0].model.replace("claude-", "")}</span>
          )}
          {session.token_summary && session.token_summary.total > 0 && (
            <span>{session.token_summary.total >= 1_000_000 ? `${(session.token_summary.total / 1_000_000).toFixed(1)}M` : `${Math.round(session.token_summary.total / 1000)}k`} tokens</span>
          )}
          {session.file_operations && session.file_operations.length > 0 && (
            <span>{session.file_operations.length} files</span>
          )}
          {session.milestones.length > 0 && <span>{session.milestones.length} milestones</span>}
          {session.plans.length > 0 && <span style={{ color: SEGMENT_COLORS.planning }}>{session.plans.length} plans</span>}
          {(() => {
            const hasAiSummaries = session.segments.some(s => s.summary);
            const isAiTitle = session.title && session.title.length < 80 && !session.title.startsWith("[") && !session.title.includes("implement the following") && !/^[a-f0-9-]{20,}$/.test(session.title);

            const runAnalysis = async () => {
              if (!id) return;
              try {
                const cfg = await getConfig() as any;
                if (!cfg.analysis?.enabled || !cfg.analysis?.apiKey) {
                  setAiKey(cfg.analysis?.apiKey || "");
                  setShowAiSetup(true);
                  return;
                }
                setAnalyzing(true);
                setAnalyzeStep("Generating title...");
                const steps = ["Generating title...", "Summarizing segments...", "Extracting decisions..."];
                let step = 0;
                const stepTimer = setInterval(() => {
                  step = Math.min(step + 1, steps.length - 1);
                  setAnalyzeStep(steps[step]);
                }, 4000);
                await analyzeSession(id);
                clearInterval(stepTimer);
                setAnalyzeStep("");
                setAnalyzing(false);
                fetchData(true);
              } catch (e: any) {
                if (e.message?.includes("not enabled") || e.message?.includes("No API key")) {
                  setShowAiSetup(true);
                }
                setAnalyzeStep("");
              } finally { setAnalyzing(false); }
            };

            if (analyzing) {
              return (
                <span className="text-[11px] font-medium px-3 py-1.5 rounded-lg ml-2 flex items-center gap-2" style={{ color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--accent)" }}>
                  <span className="w-3 h-3 border-2 border-current rounded-full animate-spin" style={{ borderTopColor: "transparent" }} />
                  {analyzeStep || "Analyzing..."}
                </span>
              );
            }

            if (hasAiSummaries) {
              return (
                <button onClick={runAnalysis}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-lg ml-2 transition-colors hover:bg-[var(--bg-hover)] flex items-center gap-1"
                  style={{ color: "#10b981", border: "1px solid var(--border)" }}
                >
                  ✓ AI Analyzed
                  <span className="opacity-50 ml-0.5">· Re-run</span>
                </button>
              );
            }

            return (
              <button onClick={runAnalysis}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg ml-2 transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                ✦ AI Analyze
              </button>
            );
          })()}
        </div>
      </div>

      {/* Tabs + sort */}
      <div className="flex items-center border-b px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        {(["timeline", "transcript", "stats"] as const).map(t => (
          <button key={t} onClick={() => {
            setTab(t);
            if (t === "stats" && !stats) {
              fetch(`/api/sessions/${session.session_id}/stats`).then(r => r.json()).then(setStats).catch(() => {});
            }
          }} className="px-4 py-2.5 text-[13px] transition-colors relative font-medium" style={{ color: tab === t ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t === "timeline" ? "Timeline" : t === "transcript" ? "Full Transcript" : "Stats"}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
        <div className="flex-1" />
        {tab === "timeline" && (
          <div className="flex rounded-lg overflow-hidden border mr-3" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={() => setSortNewest(false)}
              className="px-2.5 py-1 text-[11px] transition-colors"
              style={{ background: !sortNewest ? "var(--accent)" : "transparent", color: !sortNewest ? "white" : "var(--text-muted)" }}
            >
              Oldest first
            </button>
            <button
              onClick={() => setSortNewest(true)}
              className="px-2.5 py-1 text-[11px] transition-colors"
              style={{ background: sortNewest ? "var(--accent)" : "transparent", color: sortNewest ? "white" : "var(--text-muted)" }}
            >
              Latest first
            </button>
          </div>
        )}
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{exchanges.length} exchanges · {session.segments.length} segments</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto relative" ref={contentRef}>
        {tab === "timeline" ? (
          <>
            {/* Activity strip at top for new-style data */}
            {session.activity_groups && session.activity_groups.length > 0 && (
              <div className="px-8 pt-4 pb-2">
                <ActivityStrip
                  groups={session.activity_groups.map(g => ({
                    exchange_start: g.exchange_start,
                    exchange_end: g.exchange_end,
                    exchange_count: g.exchange_count,
                    dominant_tool_category: (() => {
                      const tc = g.tool_counts;
                      const readTools = new Set(["Read", "Grep", "Glob"]);
                      const editTools = new Set(["Edit", "Write", "NotebookEdit"]);
                      let readC = 0, editC = 0, bashC = 0, planC = 0, total = 0;
                      for (const [tool, count] of Object.entries(tc)) {
                        total += count;
                        if (readTools.has(tool)) readC += count;
                        else if (editTools.has(tool)) editC += count;
                        else if (tool === "Bash") bashC += count;
                        else if (tool === "EnterPlanMode" || tool === "ExitPlanMode") planC += count;
                      }
                      if (total === 0) return "none";
                      if (planC > 0) return "plan";
                      const max = Math.max(readC, editC, bashC);
                      if (max > 0) {
                        if (max === editC && editC >= total * 0.4) return "edit";
                        if (max === readC && readC >= total * 0.5) return "read";
                        if (max === bashC && bashC >= total * 0.5) return "bash";
                        return "mixed";
                      }
                      return "none";
                    })(),
                    has_errors: g.error_count > 0,
                    boundary: g.boundary,
                  }))}
                  milestones={session.milestones.map(m => ({ type: m.milestone_type, exchange_index: m.exchange_index, description: m.description }))}
                  totalExchanges={session.exchange_count}
                />
              </div>
            )}
            {/* GroupCard timeline for new data, legacy TimelineView for old */}
            {session.activity_groups && session.activity_groups.length > 0 ? (
              <div className="py-4 px-8 space-y-1">
                {/* Plans section */}
                {session.plans.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Plans</div>
                    {session.plans.map(p => (
                      <div key={p.id} className="text-[12px] px-3 py-1.5 rounded mb-1" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                        <span className="font-medium" style={{ color: p.status === "approved" || p.status === "implemented" ? "#10b981" : "var(--text-tertiary)" }}>v{p.version} [{p.status}]</span>
                        {" "}{trunc(planTitle(p.plan_text), 80)}
                      </div>
                    ))}
                  </div>
                )}
                {/* Activity groups */}
                {(sortNewest ? [...session.activity_groups].reverse() : session.activity_groups).map((g, i) => (
                  <GroupCard key={i} group={g} />
                ))}
              </div>
            ) : (
              <TimelineView session={session} exchanges={exchanges} openPanel={openPanel} sortNewest={sortNewest} />
            )}
          </>
        ) : tab === "transcript" ? (
          <TranscriptView exchanges={exchanges} segments={session.segments} milestones={session.milestones} compactionEvents={session.compaction_events} openPanel={openPanel} />
        ) : (
          <div className="p-8">
            <StatsTab stats={stats} />
          </div>
        )}

        {/* New updates notification */}
        {newExchangeCount > 0 && (
          <div className="sticky bottom-4 flex justify-center pointer-events-none">
            <button
              onClick={() => {
                setLastSeenCount(exchanges.length);
                setNewExchangeCount(0);
                // Scroll to the latest exchange — direction depends on sort
                setTimeout(() => {
                  if (sortNewest) {
                    // Latest first = new content at top → scroll to top
                    if (contentRef.current) {
                      contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  } else {
                    // Oldest first = new content at bottom → scroll to bottom
                    const lastEx = document.getElementById(`exchange-${exchanges.length - 1}`);
                    if (lastEx) {
                      lastEx.scrollIntoView({ behavior: "smooth", block: "center" });
                    } else if (contentRef.current) {
                      contentRef.current.scrollTo({ top: contentRef.current.scrollHeight, behavior: "smooth" });
                    }
                  }
                }, 100);
              }}
              className="pointer-events-auto text-[13px] font-medium px-5 py-2.5 rounded-full shadow-lg transition-all hover:scale-105"
              style={{ background: "var(--accent)", color: "white", boxShadow: "0 4px 20px rgba(99, 102, 241, 0.4)" }}
            >
              {sortNewest ? "↑" : "↓"} {newExchangeCount} new exchange{newExchangeCount !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>

      {panel && <ContentPanel title={panel.title} content={panel.content} subtitle={panel.subtitle} onClose={() => setPanel(null)} chatExchanges={panel.exchanges} onPrev={panel.onPrev} onNext={panel.onNext} prevLabel={panel.prevLabel} nextLabel={panel.nextLabel} />}

      {/* AI Setup Popup */}
      {showAiSetup && (
        <>
          <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} onClick={() => setShowAiSetup(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] rounded-2xl border overflow-hidden slide-in" style={{ background: "var(--bg-surface)", borderColor: "var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            <div className="px-6 pt-5 pb-3">
              <h3 className="text-[16px] font-semibold mb-1">Enable AI Analysis</h3>
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Uses Claude to generate titles, summaries, and extract decisions from your sessions.</p>
            </div>

            {/* API Key */}
            <div className="px-6 pb-3">
              <label className="text-[13px] font-medium block mb-2">Anthropic API Key</label>
              <input
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition-colors"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                placeholder="sk-ant-api03-..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && aiKey) {
                    e.preventDefault();
                    document.getElementById("ai-setup-save")?.click();
                  }
                }}
              />
              <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>Stored locally · Never sent to Keddy servers</p>
            </div>

            {/* Features that will be enabled */}
            <div className="px-6 pb-3">
              <div className="text-[12px] font-medium mb-2" style={{ color: "var(--text-muted)" }}>Features included</div>
              <div className="space-y-1.5 text-[12px]">
                {[
                  { name: "Session Titles", desc: "Descriptive titles for each session", model: "Haiku" },
                  { name: "Segment Summaries", desc: "What happened in each timeline block", model: "Haiku" },
                  { name: "Decision Extraction", desc: "Key technical decisions and rationale", model: "Haiku" },
                  { name: "Plan Analysis", desc: "Analyze plan versions and evolution", model: "Sonnet" },
                  { name: "Session Notes", desc: "Retrospective notes for sessions", model: "Sonnet" },
                ].map(f => (
                  <div key={f.name} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "var(--bg-elevated)" }}>
                    <span style={{ color: "#10b981" }}>✓</span>
                    <span className="flex-1" style={{ color: "var(--text-secondary)" }}>{f.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--bg-root)", color: "var(--text-muted)" }}>{f.model}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>Configure individual features in Settings</p>
            </div>

            <div className="px-6 pb-5 flex items-center gap-3">
              <button
                id="ai-setup-save"
                disabled={!aiKey || aiSaving}
                onClick={async () => {
                  if (!aiKey || !id) return;
                  setAiSaving(true);
                  try {
                    await updateConfig({ analysis: { enabled: true, provider: "anthropic", apiKey: aiKey } });
                    setShowAiSetup(false);
                    setAnalyzing(true);
                    await analyzeSession(id);
                    fetchData(false);
                  } catch (e: any) {
                    alert(e.message || "Failed to save");
                  } finally { setAiSaving(false); setAnalyzing(false); }
                }}
                className="text-[13px] font-medium px-5 py-2.5 rounded-lg transition-all"
                style={{ background: aiKey ? "var(--accent)" : "var(--bg-active)", color: "white", opacity: aiSaving ? 0.7 : 1 }}
              >
                {aiSaving ? "Saving & Analyzing..." : "Save & Analyze"}
              </button>
              <button onClick={() => setShowAiSetup(false)} className="text-[13px] px-4 py-2.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
