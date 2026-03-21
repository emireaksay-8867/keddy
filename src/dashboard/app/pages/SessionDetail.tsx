import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS } from "../lib/constants.js";
import { ContentPanel } from "../components/ContentPanel.js";
import { ClaudeIcon } from "../components/ClaudeIcon.js";
import type { SessionDetail as SessionDetailType, Exchange, Segment, Milestone, Plan, CompactionEvent } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function fmtShortTime(d: string) { return new Date(d).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDuration(a: string, b: string | null) {
  if (!b) return "";
  const m = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m < 1) return "<1m"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function safeJson<T>(s: string, d: T): T { try { return JSON.parse(s); } catch { return d; } }
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }
function toolSummary(input: string) { try { const o = JSON.parse(input); return o.file_path || o.command || o.pattern || o.query || input.substring(0, 60); } catch { return input.substring(0, 60); } }

function cleanText(text: string): { cleaned: string; wasInterrupted: boolean } {
  let wasInterrupted = false;
  let cleaned = text;
  if (/\[Request interrupted by user(?:\s+for tool use)?\]/.test(cleaned)) {
    wasInterrupted = true;
    cleaned = cleaned.replace(/\[Request interrupted by user(?:\s+for tool use)?\]/g, "").trim();
  }
  cleaned = cleaned.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  cleaned = cleaned.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "");
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  cleaned = cleaned.replace(/<bash-input>[\s\S]*?<\/bash-input>/g, "");
  cleaned = cleaned.replace(/<bash-stdout>[\s\S]*?<\/bash-stdout>/g, "");
  cleaned = cleaned.replace(/<bash-stderr>[\s\S]*?<\/bash-stderr>/g, "");
  return { cleaned: cleaned.trim(), wasInterrupted };
}

type PanelContent = { title: string; content: string; subtitle?: string; exchanges?: Exchange[] } | null;

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  approved: { bg: "#10b98115", fg: "#10b981", label: "Approved" },
  rejected: { bg: "#ef444415", fg: "#ef4444", label: "Rejected" },
  drafted: { bg: "#f59e0b15", fg: "#f59e0b", label: "Draft" },
  superseded: { bg: "#71717a15", fg: "#71717a", label: "Superseded" },
};

const MS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  commit: { icon: "●", label: "Commit", color: "#818cf8" },
  push: { icon: "↑", label: "Push", color: "#60a5fa" },
  pr: { icon: "⑂", label: "Pull Request", color: "#34d399" },
  branch: { icon: "⑃", label: "Branch", color: "#fbbf24" },
  test_pass: { icon: "✓", label: "Tests Passed", color: "#10b981" },
  test_fail: { icon: "✗", label: "Tests Failed", color: "#ef4444" },
};

// ── Exchange Bubble ────────────────────────────────────────────
function ExchangeBubble({ ex, openPanel, compact = false }: { ex: Exchange; openPanel: (t: string, c: string, s?: string) => void; compact?: boolean }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const { cleaned: userText, wasInterrupted: userInt } = cleanText(ex.user_prompt);
  const { cleaned: claudeText, wasInterrupted: claudeInt } = cleanText(ex.assistant_response || "");
  const isInterrupted = !!ex.is_interrupt || userInt || claudeInt;
  const previewLen = compact ? 200 : 600;

  return (
    <div id={`exchange-${ex.exchange_index}`} className="scroll-mt-16">
      {!!ex.is_compact_summary && (
        <div className="flex items-center gap-3 py-2 my-1">
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
          <span className="text-[11px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context Compacted</span>
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
        </div>
      )}

      {/* User — right-aligned bubble */}
      {userText && !ex.is_compact_summary && (
        <div className="flex justify-end mb-2">
          <div className="max-w-[75%]">
            <div className="rounded-2xl rounded-br-md px-4 py-3" style={{ background: "var(--user-bubble-bg)" }}>
              <div className="text-[13px] leading-[1.7]" style={{ color: "var(--text-primary)" }}>
                {userText.length > previewLen ? (
                  <><span>{trunc(userText, previewLen)}</span>{" "}<button onClick={() => openPanel("Your Message", ex.user_prompt, `Exchange #${ex.exchange_index}`)} className="text-[12px] font-medium hover:underline" style={{ color: "var(--accent-hover)" }}>Show full</button></>
                ) : (
                  <pre className="whitespace-pre-wrap font-[inherit]">{userText}</pre>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1 px-1">
              <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>#{ex.exchange_index}</span>
              {ex.timestamp && <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ex.timestamp)}</span>}
              {isInterrupted && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>}
            </div>
          </div>
        </div>
      )}

      {/* Tools */}
      {tools.length > 0 && (
        <div className="flex justify-start mb-2 ml-7">
          <div className="max-w-[75%]">
            <button onClick={() => setToolsOpen(!toolsOpen)} className="text-[11px] flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-tertiary)" }}>
              <span className="text-[9px]">{toolsOpen ? "▾" : "▸"}</span>
              <span className="font-medium">{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
              <span className="font-mono opacity-60 text-[10px]">{[...new Set(tools.map((t) => t.tool_name))].slice(0, 4).join(", ")}</span>
            </button>
            {toolsOpen && (
              <div className="mt-1 space-y-0.5">
                {tools.map((tc) => (
                  <button key={tc.id} onClick={() => {
                    let c = `**Input:**\n\`\`\`json\n${(() => { try { return JSON.stringify(JSON.parse(tc.tool_input), null, 2); } catch { return tc.tool_input; } })()}\n\`\`\``;
                    if (tc.tool_result) c += `\n\n**Result:**\n\`\`\`\n${tc.tool_result.substring(0, 3000)}\n\`\`\``;
                    openPanel(tc.tool_name, c, tc.is_error ? "Error" : undefined);
                  }} className="w-full text-left text-[11px] font-mono px-2.5 py-1 rounded flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors" style={{ background: "var(--bg-elevated)" }}>
                    <span className="font-semibold" style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>{tc.tool_name}</span>
                    <span className="truncate flex-1 opacity-50">{toolSummary(tc.tool_input)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Claude — left-aligned with logo */}
      {claudeText && (
        <div className="flex justify-start mb-3">
          <div className="flex gap-2 max-w-[85%]">
            <div className="shrink-0 mt-0.5"><ClaudeIcon size={18} /></div>
            <div className="flex-1 min-w-0 text-[13px] leading-[1.7]" style={{ color: "var(--text-secondary)" }}>
              {claudeText.length > previewLen ? (
                <><span>{trunc(claudeText, previewLen)}</span>{" "}<button onClick={() => openPanel("Claude's Response", ex.assistant_response, `Exchange #${ex.exchange_index}`)} className="text-[12px] font-medium hover:underline" style={{ color: "var(--accent)" }}>Show full</button></>
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

// ── Merged Timeline+Transcript View ────────────────────────────
function MergedView({ session, exchanges, openPanel, sortNewest }: {
  session: SessionDetailType; exchanges: Exchange[];
  openPanel: (t: string, c: string, s?: string, exs?: Exchange[]) => void;
  sortNewest: boolean;
}) {
  // Build a unified stream: exchanges + segment markers + milestone markers + compaction markers
  type StreamItem =
    | { kind: "exchange"; data: Exchange; sortIdx: number }
    | { kind: "segment-start"; data: Segment; sortIdx: number }
    | { kind: "milestones"; data: Milestone[]; sortIdx: number }
    | { kind: "compaction"; data: CompactionEvent; sortIdx: number }
    | { kind: "plans"; data: Plan[]; sortIdx: number };

  const items: StreamItem[] = [];

  // Add exchanges
  for (const ex of exchanges) {
    items.push({ kind: "exchange", data: ex, sortIdx: ex.exchange_index * 10 });
  }

  // Add segment start markers (just before the first exchange of each segment)
  for (const seg of session.segments) {
    items.push({ kind: "segment-start", data: seg, sortIdx: seg.exchange_index_start * 10 - 1 });
  }

  // Group consecutive milestones
  const rawMs = [...session.milestones].sort((a, b) => a.exchange_index - b.exchange_index);
  const msGroups: Milestone[][] = [];
  let currentGroup: Milestone[] = [];
  for (const m of rawMs) {
    if (currentGroup.length > 0 && m.exchange_index !== currentGroup[currentGroup.length - 1].exchange_index) {
      msGroups.push(currentGroup);
      currentGroup = [m];
    } else {
      currentGroup.push(m);
    }
  }
  if (currentGroup.length > 0) msGroups.push(currentGroup);

  for (const group of msGroups) {
    items.push({ kind: "milestones", data: group, sortIdx: group[0].exchange_index * 10 + 5 });
  }

  // Add compaction events
  for (const ce of session.compaction_events) {
    items.push({ kind: "compaction", data: ce, sortIdx: ce.exchange_index * 10 + 3 });
  }

  // Add plans at the top
  if (session.plans.length > 0) {
    items.push({ kind: "plans", data: session.plans, sortIdx: -1 });
  }

  // Sort
  items.sort((a, b) => sortNewest ? b.sortIdx - a.sortIdx : a.sortIdx - b.sortIdx);

  if (items.length === 0) {
    return <div className="p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>No data for this session</div>;
  }

  return (
    <div className="py-4 px-4 space-y-1">
      {items.map((item, i) => {
        if (item.kind === "plans") {
          return (
            <div key="plans" className="mb-4 rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
                <span className="text-[13px] font-semibold">Plans</span>
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{item.data.length} version{item.data.length > 1 ? "s" : ""}</span>
              </div>
              {item.data.map((plan) => {
                const st = STATUS_STYLE[plan.status] || STATUS_STYLE.drafted;
                return (
                  <button key={plan.id} onClick={() => {
                    let c = plan.plan_text;
                    if (plan.user_feedback) c += `\n\n---\n\n**User Feedback:**\n> ${plan.user_feedback}`;
                    openPanel(`Plan v${plan.version}`, c, `${st.label}`);
                  }} className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors border-t group" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">v{plan.version}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                      {plan.user_feedback && <span className="text-[11px] italic truncate flex-1" style={{ color: "#ef4444" }}>"{trunc(plan.user_feedback, 60)}"</span>}
                      <span className="text-[11px] opacity-0 group-hover:opacity-100" style={{ color: "var(--accent)" }}>View →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        }

        if (item.kind === "segment-start") {
          const seg = item.data;
          const color = SEGMENT_COLORS[seg.segment_type] || "#555";
          const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
          const range = seg.exchange_index_start === seg.exchange_index_end ? `#${seg.exchange_index_start}` : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;
          const ts = exchanges.find(e => e.exchange_index === seg.exchange_index_start)?.timestamp;
          return (
            <div key={`seg-${i}`} className="flex items-center gap-2 py-2 my-1">
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${color}12`, color }}>{label}</span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{range}</span>
              {ts && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ts)}</span>}
              <div className="h-px flex-1" style={{ background: "var(--border)" }} />
            </div>
          );
        }

        if (item.kind === "milestones") {
          const group = item.data;
          return (
            <div key={`ms-${i}`} className="flex flex-wrap gap-1.5 py-1.5 my-1 ml-7">
              {group.map((m, j) => {
                const cfg = MS_CONFIG[m.milestone_type] || { icon: "·", label: m.milestone_type, color: "#888" };
                return (
                  <span key={j} className="text-[11px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: `${cfg.color}10`, color: cfg.color }}>
                    {cfg.icon} {m.description.length > 40 ? trunc(m.description, 40) : m.description}
                  </span>
                );
              })}
            </div>
          );
        }

        if (item.kind === "compaction") {
          const ce = item.data;
          return (
            <div key={`ce-${i}`} className="flex items-center gap-3 py-2 my-1">
              <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "30" }} />
              <span className="text-[11px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context compacted ({ce.exchanges_before} → {ce.exchanges_after})</span>
              <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "30" }} />
            </div>
          );
        }

        // exchange
        return <ExchangeBubble key={`ex-${item.data.id}`} ex={item.data as Exchange} openPanel={openPanel} />;
      })}
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
  const [panel, setPanel] = useState<PanelContent>(null);
  const [sortNewest, setSortNewest] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback((isInitial = false) => {
    if (!id) return;
    if (isInitial) setLoading(true);
    Promise.all([getSession(id) as Promise<SessionDetailType>, getSessionExchanges(id, true) as Promise<Exchange[]>])
      .then(([s, e]) => { setSession(s); setExchanges(e); })
      .catch(console.error).finally(() => { if (isInitial) setLoading(false); });
  }, [id]);

  useEffect(() => { fetchData(true); }, [fetchData]);
  useEffect(() => {
    pollRef.current = setInterval(() => fetchData(false), 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  const openPanel = (title: string, content: string, subtitle?: string, exs?: Exchange[]) => setPanel({ title, content, subtitle, exchanges: exs });

  if (loading) return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (!session) return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Session not found</div>;

  const title = session.title || session.session_id.substring(0, 24);
  const project = session.project_path.split("/").slice(-2).join("/");
  const dur = fmtDuration(session.started_at, session.ended_at);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button onClick={() => navigate("/")} className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>← Sessions</button>
        <h1 className="text-[16px] font-semibold leading-snug mb-1">{trunc(cleanText(title).cleaned, 100)}</h1>
        <div className="flex items-center gap-2.5 text-[12px] flex-wrap" style={{ color: "var(--text-tertiary)" }}>
          <span>{project}</span>
          {session.git_branch && <span className="px-1.5 py-0.5 rounded font-mono text-[11px]" style={{ background: "var(--bg-elevated)" }}>{session.git_branch}</span>}
          <span>{fmtTime(session.started_at)}{session.ended_at ? ` → ${fmtTime(session.ended_at)}` : ""}</span>
          {dur && <span>({dur})</span>}
          <span>{exchanges.length} exchanges</span>
          {session.milestones.length > 0 && <span>{session.milestones.length} milestones</span>}
          {session.plans.length > 0 && <span style={{ color: SEGMENT_COLORS.planning }}>{session.plans.length} plans</span>}
        </div>
      </div>

      {/* Sort toggle */}
      <div className="flex items-center gap-2 px-6 py-2 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button
          onClick={() => setSortNewest(!sortNewest)}
          className="text-[12px] flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
          style={{ color: "var(--text-tertiary)" }}
        >
          <span>{sortNewest ? "↓ Newest first" : "↑ Oldest first"}</span>
        </button>
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{exchanges.length} exchanges · {session.segments.length} segments</span>
      </div>

      {/* Merged view */}
      <div className="flex-1 overflow-y-auto">
        <MergedView session={session} exchanges={exchanges} openPanel={openPanel} sortNewest={sortNewest} />
      </div>

      {panel && (
        <ContentPanel
          title={panel.title}
          content={panel.content}
          subtitle={panel.subtitle}
          onClose={() => setPanel(null)}
          chatExchanges={panel.exchanges}
        />
      )}
    </div>
  );
}
