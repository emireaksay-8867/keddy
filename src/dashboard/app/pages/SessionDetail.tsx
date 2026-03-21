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

// ── Exchange Bubble (used in transcript & panel) ───────────────
function ExchangeBubble({ ex, openPanel }: { ex: Exchange; openPanel: (t: string, c: string, s?: string) => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const { cleaned: userText, wasInterrupted: userInt } = cleanText(ex.user_prompt);
  const { cleaned: claudeText, wasInterrupted: claudeInt } = cleanText(ex.assistant_response || "");
  const isInterrupted = !!ex.is_interrupt || userInt || claudeInt;
  // Show much more text before truncating
  const PREVIEW_LEN = 1200;

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
                {userText.length > PREVIEW_LEN ? (
                  <>
                    <pre className="whitespace-pre-wrap font-[inherit]">{userText.substring(0, PREVIEW_LEN)}</pre>
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

      {/* Tools */}
      {tools.length > 0 && (
        <div className="flex justify-start mb-3 ml-8">
          <div>
            <button onClick={() => setToolsOpen(!toolsOpen)} className="text-[12px] flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-tertiary)", background: "var(--bg-elevated)" }}>
              <span className="text-[10px]">{toolsOpen ? "▾" : "▸"}</span>
              <span className="font-medium">{tools.length} tool{tools.length !== 1 ? "s" : ""}</span>
              <span className="font-mono opacity-60 text-[11px]">{[...new Set(tools.map((t) => t.tool_name))].slice(0, 4).join(", ")}</span>
            </button>
            {toolsOpen && (
              <div className="mt-1.5 space-y-1 max-w-lg">
                {tools.map((tc) => (
                  <button key={tc.id} onClick={() => {
                    let c = `**Input:**\n\`\`\`json\n${(() => { try { return JSON.stringify(JSON.parse(tc.tool_input), null, 2); } catch { return tc.tool_input; } })()}\n\`\`\``;
                    if (tc.tool_result) c += `\n\n**Result:**\n\`\`\`\n${tc.tool_result.substring(0, 5000)}\n\`\`\``;
                    openPanel(tc.tool_name, c, tc.is_error ? "Error" : undefined);
                  }} className="w-full text-left text-[12px] font-mono px-3 py-1.5 rounded flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors" style={{ background: "var(--bg-elevated)" }}>
                    <span className="font-semibold" style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>{tc.tool_name}</span>
                    <span className="truncate flex-1 opacity-50">{toolSummary(tc.tool_input)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Claude — left-aligned with official logo */}
      {claudeText && (
        <div className="flex justify-start mb-4">
          <div className="flex gap-3 max-w-[85%]">
            <div className="shrink-0 mt-1"><ClaudeIcon size={20} /></div>
            <div className="flex-1 min-w-0 text-[14px] leading-[1.8]" style={{ color: "var(--text-secondary)" }}>
              {claudeText.length > PREVIEW_LEN ? (
                <>
                  <pre className="whitespace-pre-wrap font-[inherit]">{claudeText.substring(0, PREVIEW_LEN)}</pre>
                  <button onClick={() => openPanel("Claude's Response", ex.assistant_response, `Exchange #${ex.exchange_index}`)} className="text-[13px] font-medium hover:underline mt-2 block" style={{ color: "var(--accent)" }}>
                    Show full response ({Math.ceil(claudeText.length / 1000)}k chars)
                  </button>
                </>
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
  const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
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
function TimelineView({ session, exchanges, openPanel }: {
  session: SessionDetailType; exchanges: Exchange[];
  openPanel: (t: string, c: string, s?: string, exs?: Exchange[]) => void;
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
                <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>{trunc(plan.plan_text, 120)}</p>
                {plan.user_feedback && <p className="text-[12px] mt-1 italic" style={{ color: "#ef4444" }}>"{trunc(plan.user_feedback, 80)}"</p>}
              </button>
            );
          })}
        </div>
      )}

      {/* Timeline */}
      {items.length > 0 && (
        <div className="relative pl-8">
          <div className="absolute left-[8px] top-4 bottom-4 w-px" style={{ background: "var(--border)" }} />
          {items.map((item, i) => {
            if (item.kind === "segment") {
              const seg = item.data as Segment;
              const color = SEGMENT_COLORS[seg.segment_type] || "#555";
              const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
              const files = safeJson<string[]>(seg.files_touched || "[]", []);
              const tools = safeJson<Record<string, number>>(seg.tool_counts || "{}", {});
              const segEx = exchanges.filter(e => e.exchange_index >= seg.exchange_index_start && e.exchange_index <= seg.exchange_index_end);
              const ts = segEx[0]?.timestamp;
              const range = seg.exchange_index_start === seg.exchange_index_end ? `#${seg.exchange_index_start}` : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;

              return (
                <div key={`s${i}`} className="relative pb-5">
                  <div className="absolute -left-[21px] top-[14px] w-[10px] h-[10px] rounded-full border-2" style={{ borderColor: color, background: color }} />
                  <button
                    onClick={() => openPanel(`${label} — ${range}`, "", `${segEx.length} exchanges`, segEx)}
                    className="w-full text-left rounded-xl border p-5 hover:border-[var(--border-bright)] transition-all group"
                    style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[13px] font-semibold px-3 py-1 rounded-full" style={{ background: `${color}12`, color }}>{label}</span>
                      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{segEx.length} exchange{segEx.length !== 1 ? "s" : ""}</span>
                      {ts && <span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ts)}</span>}
                      <span className="text-[12px] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>View conversation →</span>
                    </div>

                    {/* Exchange previews */}
                    <div className="space-y-2">
                      {segEx.slice(0, 3).map(e => {
                        const { cleaned } = cleanText(e.user_prompt);
                        return (
                          <div key={e.id} className="text-[13px] rounded-lg px-4 py-2.5" style={{ background: "var(--bg-elevated)" }}>
                            <span style={{ color: "var(--text-primary)" }}>{trunc(cleaned, 120)}</span>
                            {e.tool_call_count > 0 && <span className="ml-2 text-[11px]" style={{ color: "var(--text-muted)" }}>· {e.tool_call_count} tools</span>}
                          </div>
                        );
                      })}
                      {segEx.length > 3 && <span className="text-[12px] px-4 block" style={{ color: "var(--text-muted)" }}>+{segEx.length - 3} more</span>}
                    </div>

                    {/* Files & tools */}
                    {(files.length > 0 || Object.keys(tools).length > 0) && (
                      <div className="flex items-center flex-wrap gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                        {Object.entries(tools).slice(0, 5).map(([k, v]) => (
                          <span key={k} className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>{k}:{v}</span>
                        ))}
                        {files.slice(0, 4).map(f => (
                          <span key={f} className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>{f.split("/").pop()}</span>
                        ))}
                        {files.length > 4 && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>+{files.length - 4}</span>}
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

              return (
                <div key={`mg${i}`} className="relative pb-4">
                  <div className="absolute -left-[21px] top-[10px] w-[6px] h-[6px] rounded-full" style={{ background: "var(--accent)" }} />
                  <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(summary.entries()).map(([type, count]) => {
                        const cfg = MS_CONFIG[type] || { icon: "·", label: type, color: "#888" };
                        return <span key={type} className="text-[12px] font-medium px-2.5 py-1 rounded-full" style={{ background: `${cfg.color}10`, color: cfg.color }}>{cfg.icon} {count > 1 ? `${count}× ${cfg.label}` : cfg.label}</span>;
                      })}
                    </div>
                    {group.length <= 4 && (
                      <div className="mt-2 space-y-0.5">
                        {group.map((m, j) => (
                          <div key={j} className="text-[12px] px-2 py-0.5" style={{ color: "var(--text-secondary)" }}>{m.description}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // compaction
            const ce = item.data as CompactionEvent;
            return (
              <div key={`c${i}`} className="relative pb-4">
                <div className="absolute -left-[21px] top-[10px] w-[6px] h-[6px] rounded-full" style={{ background: SEGMENT_COLORS.exploring }} />
                <div className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "25" }} />
                  <span className="text-[12px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context compacted ({ce.exchanges_before} → {ce.exchanges_after})</span>
                  <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "25" }} />
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
  const [tab, setTab] = useState<"timeline" | "transcript">("timeline");
  const [panel, setPanel] = useState<PanelContent>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback((isInitial = false) => {
    if (!id) return;
    if (isInitial) { setLoading(true); setTab("timeline"); }
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
          {session.milestones.length > 0 && <span>{session.milestones.length} milestones</span>}
          {session.plans.length > 0 && <span style={{ color: SEGMENT_COLORS.planning }}>{session.plans.length} plans</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        {(["timeline", "transcript"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className="px-4 py-2.5 text-[13px] transition-colors relative font-medium" style={{ color: tab === t ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t === "timeline" ? "Timeline" : "Full Transcript"}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{exchanges.length} exchanges · {session.segments.length} segments</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "timeline" ? (
          <TimelineView session={session} exchanges={exchanges} openPanel={openPanel} />
        ) : (
          <TranscriptView exchanges={exchanges} segments={session.segments} milestones={session.milestones} compactionEvents={session.compaction_events} openPanel={openPanel} />
        )}
      </div>

      {panel && <ContentPanel title={panel.title} content={panel.content} subtitle={panel.subtitle} onClose={() => setPanel(null)} chatExchanges={panel.exchanges} />}
    </div>
  );
}
