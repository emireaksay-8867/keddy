import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS } from "../lib/constants.js";
import { ContentPanel } from "../components/ContentPanel.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SessionDetail as SessionDetailType, Exchange, Segment, Milestone, Plan, CompactionEvent } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function fmtDuration(a: string, b: string | null) {
  if (!b) return "";
  const m = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m < 1) return "<1m"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function safeJson<T>(s: string, d: T): T { try { return JSON.parse(s); } catch { return d; } }
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }
function toolSummary(input: string) { try { const o = JSON.parse(input); return o.file_path || o.command || o.pattern || o.query || input.substring(0, 60); } catch { return input.substring(0, 60); } }

type PanelContent = { title: string; content: string; subtitle?: string } | null;

// ── Transcript ─────────────────────────────────────────────────
function TranscriptView({ exchanges, openPanel }: { exchanges: Exchange[]; openPanel: (t: string, c: string, s?: string) => void }) {
  if (!exchanges.length) return <div className="p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>No exchanges</div>;
  return (
    <div className="divide-y" style={{ borderColor: "var(--border)" }}>
      {exchanges.map((ex) => <ExchangeRow key={ex.id} ex={ex} openPanel={openPanel} />)}
    </div>
  );
}

function ExchangeRow({ ex, openPanel }: { ex: Exchange; openPanel: (t: string, c: string, s?: string) => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const longPrompt = ex.user_prompt.length > 280;
  const longResponse = (ex.assistant_response || "").length > 400;
  const hasMarkdown = /^#{1,6}\s|^\*\*|^-\s|```/m.test(ex.assistant_response || "");

  return (
    <div id={`exchange-${ex.exchange_index}`} className="scroll-mt-16 animate-in">
      {!!ex.is_compact_summary && (
        <div className="flex items-center gap-3 px-6 py-2">
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
          <span className="text-[11px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context Compacted</span>
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
        </div>
      )}

      {/* User */}
      {ex.user_prompt && !ex.is_compact_summary && (
        <div className="px-6 py-4" style={{ background: "var(--user-bg)" }}>
          <div className="max-w-3xl flex gap-3">
            <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: "var(--user-accent)", color: "white" }}>Y</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold">You</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>#{ex.exchange_index}</span>
                {!!ex.is_interrupt && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>}
              </div>
              <div className="text-[13px] leading-[1.7]">
                {longPrompt ? (
                  <><span>{trunc(ex.user_prompt, 280)}</span>{" "}<button onClick={() => openPanel("Your Message", ex.user_prompt, `Exchange #${ex.exchange_index}`)} className="text-[12px] font-medium hover:underline" style={{ color: "var(--accent)" }}>Show full →</button></>
                ) : <pre className="whitespace-pre-wrap font-[inherit]">{ex.user_prompt}</pre>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools */}
      {tools.length > 0 && (
        <div className="px-6 py-2 border-y" style={{ borderColor: "var(--border)", background: "var(--bg-root)" }}>
          <div className="max-w-3xl ml-10">
            <button onClick={() => setToolsOpen(!toolsOpen)} className="text-[12px] flex items-center gap-1.5 py-0.5 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-tertiary)" }}>
              <span className="text-[10px]">{toolsOpen ? "▾" : "▸"}</span>
              <span className="font-medium">{tools.length} tool {tools.length === 1 ? "call" : "calls"}</span>
              <span className="font-mono opacity-60 text-[11px]">{[...new Set(tools.map((t) => t.tool_name))].join(", ")}</span>
            </button>
            {toolsOpen && (
              <div className="mt-1.5 space-y-1">
                {tools.map((tc) => (
                  <button key={tc.id} onClick={() => {
                    let c = `**Input:**\n\`\`\`json\n${(() => { try { return JSON.stringify(JSON.parse(tc.tool_input), null, 2); } catch { return tc.tool_input; } })()}\n\`\`\``;
                    if (tc.tool_result) c += `\n\n**Result:**\n\`\`\`\n${tc.tool_result.substring(0, 3000)}\n\`\`\``;
                    openPanel(tc.tool_name, c, tc.is_error ? "Error" : undefined);
                  }} className="w-full text-left text-[12px] font-mono px-3 py-1.5 rounded flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors" style={{ background: "var(--bg-elevated)" }}>
                    <span className="font-semibold" style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>{tc.tool_name}</span>
                    <span className="truncate flex-1 opacity-50">{toolSummary(tc.tool_input)}</span>
                    {!!tc.is_error && <span className="text-[10px] px-1 rounded" style={{ background: `${SEGMENT_COLORS.debugging}20`, color: SEGMENT_COLORS.debugging }}>err</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Claude */}
      {ex.assistant_response && (
        <div className="px-6 py-4">
          <div className="max-w-3xl flex gap-3">
            <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: `${SEGMENT_COLORS.testing}20`, color: "var(--claude-accent)" }}>C</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold" style={{ color: "var(--claude-accent)" }}>Claude</span>
              </div>
              {longResponse ? (
                <div className="text-[13px] leading-[1.7]" style={{ color: "var(--text-secondary)" }}>
                  {trunc(ex.assistant_response, 400)}{" "}
                  <button onClick={() => openPanel("Claude's Response", ex.assistant_response, `Exchange #${ex.exchange_index}`)} className="text-[12px] font-medium hover:underline" style={{ color: "var(--accent)" }}>Show full →</button>
                </div>
              ) : hasMarkdown ? (
                <div className="md-content text-[13px]"><Markdown remarkPlugins={[remarkGfm]}>{ex.assistant_response}</Markdown></div>
              ) : (
                <pre className="text-[13px] leading-[1.7] whitespace-pre-wrap font-[inherit]" style={{ color: "var(--text-secondary)" }}>{ex.assistant_response}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Plan Versions ──────────────────────────────────────────────
const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  approved: { bg: "#10b98115", fg: "#10b981", label: "Approved" },
  rejected: { bg: "#ef444415", fg: "#ef4444", label: "Rejected" },
  drafted: { bg: "#f59e0b15", fg: "#f59e0b", label: "Draft" },
  superseded: { bg: "#71717a15", fg: "#71717a", label: "Superseded" },
};

function PlanVersions({ plans, openPanel }: { plans: Plan[]; openPanel: (t: string, c: string, s?: string) => void }) {
  if (!plans.length) return null;
  return (
    <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <span className="text-[14px] font-semibold">Plans</span>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{plans.length} version{plans.length > 1 ? "s" : ""}</span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {plans.map((plan) => {
          const st = STATUS_STYLE[plan.status] || STATUS_STYLE.drafted;
          return (
            <button key={plan.id} onClick={() => {
              let content = plan.plan_text;
              if (plan.user_feedback) content += `\n\n---\n\n**User Feedback:**\n> ${plan.user_feedback}`;
              openPanel(`Plan v${plan.version}`, content, `${st.label} · Exchanges #${plan.exchange_index_start}–${plan.exchange_index_end}`);
            }} className="w-full text-left px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors group">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[14px] font-semibold">Version {plan.version}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                <span className="text-[12px] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>View plan →</span>
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>{trunc(plan.plan_text, 150)}</p>
              {plan.user_feedback && <p className="text-[12px] mt-1 italic" style={{ color: "#ef4444" }}>"{trunc(plan.user_feedback, 80)}"</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────

// Milestone icons and labels
const MS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  commit: { icon: "●", label: "Commit", color: "#818cf8" },
  push: { icon: "↑", label: "Push", color: "#60a5fa" },
  pr: { icon: "⑂", label: "Pull Request", color: "#34d399" },
  branch: { icon: "⑃", label: "Branch", color: "#fbbf24" },
  test_pass: { icon: "✓", label: "Tests Passed", color: "#10b981" },
  test_fail: { icon: "✗", label: "Tests Failed", color: "#ef4444" },
};

function TimelineView({ segments, milestones, compactionEvents, exchanges, plans, openPanel }: {
  segments: Segment[]; milestones: Milestone[]; compactionEvents: CompactionEvent[]; exchanges: Exchange[]; plans: Plan[];
  openPanel: (t: string, c: string, s?: string) => void;
}) {
  // Build timeline items, grouping consecutive milestones
  type TI =
    | { kind: "segment"; data: Segment; idx: number }
    | { kind: "milestones"; data: Milestone[]; idx: number }
    | { kind: "compaction"; data: CompactionEvent; idx: number };

  // First, create raw sorted items
  const raw: Array<{ kind: "segment" | "milestone" | "compaction"; data: any; idx: number }> = [];
  segments.forEach((s) => raw.push({ kind: "segment", data: s, idx: s.exchange_index_start }));
  milestones.forEach((m) => raw.push({ kind: "milestone", data: m, idx: m.exchange_index }));
  compactionEvents.forEach((c) => raw.push({ kind: "compaction", data: c, idx: c.exchange_index }));
  raw.sort((a, b) => a.idx - b.idx);

  // Group consecutive milestones
  const items: TI[] = [];
  let pendingMs: Milestone[] = [];
  for (const r of raw) {
    if (r.kind === "milestone") {
      pendingMs.push(r.data);
    } else {
      if (pendingMs.length > 0) {
        items.push({ kind: "milestones", data: pendingMs, idx: pendingMs[0].exchange_index });
        pendingMs = [];
      }
      if (r.kind === "segment") items.push({ kind: "segment", data: r.data, idx: r.idx });
      else items.push({ kind: "compaction", data: r.data, idx: r.idx });
    }
  }
  if (pendingMs.length > 0) items.push({ kind: "milestones", data: pendingMs, idx: pendingMs[0].exchange_index });

  return (
    <div className="space-y-4 py-4">
      {plans.length > 0 && <PlanVersions plans={plans} openPanel={openPanel} />}

      {items.length > 0 ? (
        <div className="relative pl-7">
          <div className="absolute left-[7px] top-3 bottom-3 w-px" style={{ background: "var(--border)" }} />
          {items.map((item, i) => {
            if (item.kind === "segment") {
              const seg = item.data as Segment;
              const color = SEGMENT_COLORS[seg.segment_type] || "#555";
              const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
              const files = safeJson<string[]>(seg.files_touched || "[]", []);
              const tools = safeJson<Record<string, number>>(seg.tool_counts || "{}", {});
              const segEx = exchanges.filter((e) => e.exchange_index >= seg.exchange_index_start && e.exchange_index <= seg.exchange_index_end);
              const range = seg.exchange_index_start === seg.exchange_index_end ? `#${seg.exchange_index_start}` : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;

              // Build panel content for this segment
              const buildSegmentContent = () => {
                let content = "";
                for (const e of segEx) {
                  content += `### Exchange #${e.exchange_index}\n\n`;
                  content += `**You:** ${e.user_prompt}\n\n`;
                  if (e.assistant_response) content += `**Claude:** ${e.assistant_response}\n\n`;
                  if (e.tool_call_count > 0) content += `*${e.tool_call_count} tool calls*\n\n`;
                  content += "---\n\n";
                }
                return content;
              };

              return (
                <div key={`s${i}`} className="relative pb-4 animate-in" style={{ animationDelay: `${i * 20}ms` }}>
                  <div className="absolute -left-[20px] top-3 w-[9px] h-[9px] rounded-full" style={{ background: color }} />
                  <button onClick={() => openPanel(`${label} — ${range}`, buildSegmentContent(), `${segEx.length} exchanges · ${Object.entries(tools).map(([k,v])=>`${v} ${k}`).join(", ")}`)}
                    className="w-full text-left rounded-lg border p-4 hover:border-[var(--border-bright)] transition-all group" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[13px] font-semibold px-2.5 py-1 rounded-full" style={{ background: `${color}15`, color }}>{label}</span>
                      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{range} · {segEx.length} exchange{segEx.length !== 1 ? "s" : ""}</span>
                      <span className="text-[12px] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>View details →</span>
                    </div>
                    {segEx.slice(0, 3).map((e) => (
                      <div key={e.id} className="text-[13px] rounded px-3 py-2 mb-1 truncate" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                        {trunc(e.user_prompt, 100)}
                        {e.tool_call_count > 0 && <span className="ml-2 text-[11px]" style={{ color: "var(--text-muted)" }}>({e.tool_call_count} tools)</span>}
                      </div>
                    ))}
                    {segEx.length > 3 && <span className="text-[12px] px-3 block mt-1" style={{ color: "var(--text-muted)" }}>+{segEx.length - 3} more exchanges</span>}
                    {files.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {files.slice(0, 5).map((f) => <span key={f} className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>{f.split("/").pop()}</span>)}
                        {files.length > 5 && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>+{files.length - 5}</span>}
                      </div>
                    )}
                  </button>
                </div>
              );
            }

            if (item.kind === "milestones") {
              const group = item.data as Milestone[];
              // Summarize the group
              const summary = new Map<string, number>();
              for (const m of group) {
                const key = m.milestone_type;
                summary.set(key, (summary.get(key) || 0) + 1);
              }

              return (
                <div key={`mg${i}`} className="relative pb-3 animate-in" style={{ animationDelay: `${i * 20}ms` }}>
                  <div className="absolute -left-[20px] top-2 w-[5px] h-[5px] rounded-full" style={{ background: "var(--accent)" }} />
                  <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    {/* Summary badges */}
                    <div className="flex flex-wrap gap-2 mb-2">
                      {Array.from(summary.entries()).map(([type, count]) => {
                        const cfg = MS_CONFIG[type] || { icon: "·", label: type, color: "#888" };
                        return (
                          <span key={type} className="text-[12px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1.5" style={{ background: `${cfg.color}12`, color: cfg.color }}>
                            <span>{cfg.icon}</span>
                            {count > 1 ? `${count}× ${cfg.label}` : cfg.label}
                          </span>
                        );
                      })}
                    </div>
                    {/* Individual items — collapsed if > 4 */}
                    <MilestoneList milestones={group} openPanel={openPanel} />
                  </div>
                </div>
              );
            }

            // compaction
            const ce = item.data as CompactionEvent;
            return (
              <div key={`c${i}`} className="relative pb-3">
                <div className="absolute -left-[20px] top-2 w-[5px] h-[5px] rounded-full" style={{ background: SEGMENT_COLORS.exploring }} />
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "30" }} />
                  <span className="text-[12px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context compacted ({ce.exchanges_before} → {ce.exchanges_after} exchanges)</span>
                  <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "30" }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: "var(--text-muted)" }}>No timeline data — switch to Transcript tab</div>
      ) : null}
    </div>
  );
}

function MilestoneList({ milestones, openPanel }: { milestones: Milestone[]; openPanel: (t: string, c: string, s?: string) => void }) {
  const [expanded, setExpanded] = useState(milestones.length <= 4);
  const visible = expanded ? milestones : milestones.slice(0, 3);

  return (
    <div className="space-y-1">
      {visible.map((m, i) => {
        const cfg = MS_CONFIG[m.milestone_type] || { icon: "·", label: m.milestone_type, color: "#888" };
        return (
          <div key={i} className="text-[12px] flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: cfg.color }}>{cfg.icon}</span>
            <span>{m.description}</span>
          </div>
        );
      })}
      {!expanded && milestones.length > 3 && (
        <button onClick={() => setExpanded(true)} className="text-[12px] px-2 py-1 hover:underline" style={{ color: "var(--accent)" }}>
          +{milestones.length - 3} more
        </button>
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

  useEffect(() => {
    if (!id) return;
    setLoading(true); setTab("timeline");
    Promise.all([getSession(id) as Promise<SessionDetailType>, getSessionExchanges(id, true) as Promise<Exchange[]>])
      .then(([s, e]) => { setSession(s); setExchanges(e); })
      .catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const openPanel = (title: string, content: string, subtitle?: string) => setPanel({ title, content, subtitle });

  if (loading) return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (!session) return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Session not found</div>;

  const title = session.title || session.session_id.substring(0, 24);
  const project = session.project_path.split("/").slice(-2).join("/");
  const dur = fmtDuration(session.started_at, session.ended_at);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button onClick={() => navigate("/")} className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>← Sessions</button>
        <h1 className="text-[16px] font-semibold leading-snug mb-1">{trunc(title, 100)}</h1>
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

      <div className="flex border-b px-6 gap-1" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        {(["timeline", "transcript"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-2.5 text-[13px] transition-colors relative font-medium" style={{ color: tab === t ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t === "transcript" ? `Transcript (${exchanges.length})` : `Timeline (${session.segments.length})`}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "timeline" ? (
          <div className="px-6"><TimelineView segments={session.segments} milestones={session.milestones} compactionEvents={session.compaction_events} exchanges={exchanges} plans={session.plans} openPanel={openPanel} /></div>
        ) : (
          <TranscriptView exchanges={exchanges} openPanel={openPanel} />
        )}
      </div>

      {panel && <ContentPanel title={panel.title} content={panel.content} subtitle={panel.subtitle} onClose={() => setPanel(null)} />}
    </div>
  );
}
