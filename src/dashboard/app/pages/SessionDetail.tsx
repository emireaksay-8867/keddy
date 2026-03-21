import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS, MILESTONE_ICONS } from "../lib/constants.js";
import { ContentPanel } from "../components/ContentPanel.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SessionDetail as SessionDetailType, Exchange, Segment, Plan } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────

function fmtTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function fmtDuration(a: string, b: string | null) {
  if (!b) return "";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function safeJson<T>(s: string, d: T): T { try { return JSON.parse(s); } catch { return d; } }
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }
function toolSummary(input: string) { try { const o = JSON.parse(input); return o.file_path || o.command || o.pattern || o.query || input.substring(0, 60); } catch { return input.substring(0, 60); } }

// ── Transcript ─────────────────────────────────────────────────

function TranscriptView({ exchanges, onOpenContent }: { exchanges: Exchange[]; onOpenContent: (title: string, content: string, subtitle?: string) => void }) {
  if (!exchanges.length) return <div className="p-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>No exchanges</div>;

  return (
    <div className="divide-y" style={{ borderColor: "var(--border)" }}>
      {exchanges.map((ex) => (
        <ExchangeRow key={ex.id} exchange={ex} onOpenContent={onOpenContent} />
      ))}
    </div>
  );
}

function ExchangeRow({ exchange: ex, onOpenContent }: { exchange: Exchange; onOpenContent: (t: string, c: string, s?: string) => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const promptPreview = trunc(ex.user_prompt, 280);
  const responsePreview = trunc(ex.assistant_response || "", 400);
  const longPrompt = ex.user_prompt.length > 280;
  const longResponse = (ex.assistant_response || "").length > 400;
  const hasMarkdownResponse = /^#{1,6}\s|^\*\*|^-\s|```/m.test(ex.assistant_response || "");

  return (
    <div id={`exchange-${ex.exchange_index}`} className="scroll-mt-16 animate-in">
      {/* Compaction */}
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
            <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: "var(--user-accent)", color: "white" }}>
              Y
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold">You</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>#{ex.exchange_index}</span>
                {!!ex.is_interrupt && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>}
              </div>
              <div className="text-[13px] leading-[1.7]" style={{ color: "var(--text-primary)" }}>
                {promptPreview}
                {longPrompt && (
                  <button onClick={() => onOpenContent("Your Message", ex.user_prompt, `Exchange #${ex.exchange_index}`)} className="ml-1 text-[12px] font-medium hover:underline" style={{ color: "var(--accent)" }}>
                    Show full →
                  </button>
                )}
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
              <span className="font-mono opacity-60">{[...new Set(tools.map((t) => t.tool_name))].join(", ")}</span>
            </button>
            {toolsOpen && (
              <div className="mt-1.5 space-y-1">
                {tools.map((tc) => (
                  <ToolChip key={tc.id} tc={tc} onOpenContent={onOpenContent} />
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
            <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: `${SEGMENT_COLORS.testing}20`, color: "var(--claude-accent)" }}>
              C
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[13px] font-semibold" style={{ color: "var(--claude-accent)" }}>Claude</span>
              </div>
              {hasMarkdownResponse && !longResponse ? (
                <div className="md-content text-[13px]">
                  <Markdown remarkPlugins={[remarkGfm]}>{ex.assistant_response}</Markdown>
                </div>
              ) : (
                <div className="text-[13px] leading-[1.7]" style={{ color: "var(--text-secondary)" }}>
                  {responsePreview}
                  {longResponse && (
                    <button onClick={() => onOpenContent("Claude's Response", ex.assistant_response, `Exchange #${ex.exchange_index}`)} className="ml-1 text-[12px] font-medium hover:underline" style={{ color: "var(--accent)" }}>
                      Show full →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolChip({ tc, onOpenContent }: { tc: { id: string; tool_name: string; tool_input: string; tool_result: string | null; is_error: number }; onOpenContent: (t: string, c: string, s?: string) => void }) {
  return (
    <button
      onClick={() => {
        let content = `**Input:**\n\`\`\`json\n${(() => { try { return JSON.stringify(JSON.parse(tc.tool_input), null, 2); } catch { return tc.tool_input; } })()}\n\`\`\``;
        if (tc.tool_result) content += `\n\n**Result:**\n\`\`\`\n${tc.tool_result.substring(0, 3000)}\n\`\`\``;
        onOpenContent(tc.tool_name, content, tc.is_error ? "Error" : undefined);
      }}
      className="w-full text-left text-[12px] font-mono px-3 py-1.5 rounded flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
      style={{ background: "var(--bg-elevated)" }}
    >
      <span className="font-semibold" style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>{tc.tool_name}</span>
      <span className="truncate flex-1 opacity-50">{toolSummary(tc.tool_input)}</span>
      {!!tc.is_error && <span className="text-[10px] px-1 rounded" style={{ background: `${SEGMENT_COLORS.debugging}20`, color: SEGMENT_COLORS.debugging }}>err</span>}
    </button>
  );
}

// ── Plan Versions ──────────────────────────────────────────────

function PlanVersions({ plans, onOpenContent }: { plans: Plan[]; onOpenContent: (t: string, c: string, s?: string) => void }) {
  if (!plans.length) return null;
  const statusColor: Record<string, string> = { approved: "#10b981", rejected: "#ef4444", drafted: "#f59e0b", superseded: "#71717a" };

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <span className="text-[13px] font-semibold">Plans</span>
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{plans.length} version{plans.length > 1 ? "s" : ""}</span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => onOpenContent(`Plan v${plan.version}`, plan.plan_text, `Status: ${plan.status}${plan.user_feedback ? ` · Feedback: ${plan.user_feedback}` : ""}`)}
            className="w-full text-left px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-semibold">v{plan.version}</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${statusColor[plan.status] || "#555"}18`, color: statusColor[plan.status] || "#555" }}>
                {plan.status}
              </span>
              <span className="text-[12px] ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>View →</span>
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
              {trunc(plan.plan_text, 150)}
            </p>
            {plan.user_feedback && (
              <p className="text-[12px] mt-1 italic" style={{ color: SEGMENT_COLORS.debugging }}>
                Feedback: {trunc(plan.user_feedback, 100)}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────

function TimelineView({ segments, milestones, compactionEvents, exchanges, plans, onJump, onOpenContent }: {
  segments: Segment[]; milestones: any[]; compactionEvents: any[]; exchanges: Exchange[]; plans: Plan[];
  onJump: (idx: number) => void; onOpenContent: (t: string, c: string, s?: string) => void;
}) {
  type TI = { kind: string; data: any; idx: number };
  const items: TI[] = [];
  segments.forEach((s) => items.push({ kind: "segment", data: s, idx: s.exchange_index_start }));
  milestones.forEach((m) => items.push({ kind: "milestone", data: m, idx: m.exchange_index }));
  compactionEvents.forEach((c) => items.push({ kind: "compaction", data: c, idx: c.exchange_index }));
  items.sort((a, b) => a.idx - b.idx);

  return (
    <div className="space-y-6 py-4">
      {/* Plans section */}
      {plans.length > 0 && (
        <PlanVersions plans={plans} onOpenContent={onOpenContent} />
      )}

      {/* Timeline */}
      {items.length > 0 && (
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

              return (
                <div key={`s${i}`} className="relative pb-4 animate-in" style={{ animationDelay: `${i * 20}ms` }}>
                  <div className="absolute -left-[20px] top-3 w-[9px] h-[9px] rounded-full" style={{ background: color }} />
                  <button onClick={() => onJump(seg.exchange_index_start)} className="w-full text-left rounded-lg border p-4 hover:border-[var(--border-bright)] transition-all group" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${color}15`, color }}>{label}</span>
                      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{range}</span>
                      {Object.keys(tools).length > 0 && (
                        <span className="text-[11px] font-mono ml-auto" style={{ color: "var(--text-muted)" }}>
                          {Object.entries(tools).slice(0, 4).map(([k, v]) => `${k}:${v}`).join("  ")}
                        </span>
                      )}
                      <span className="text-[12px] opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>View →</span>
                    </div>
                    {segEx.slice(0, 3).map((e) => (
                      <div key={e.id} className="text-[12px] rounded px-3 py-1.5 mb-1 truncate" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                        {trunc(e.user_prompt, 100)}
                        {e.tool_call_count > 0 && <span className="ml-2" style={{ color: "var(--text-muted)" }}>({e.tool_call_count} tools)</span>}
                      </div>
                    ))}
                    {segEx.length > 3 && <span className="text-[11px] px-3" style={{ color: "var(--text-muted)" }}>+{segEx.length - 3} more</span>}
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
            if (item.kind === "milestone") {
              const ms = item.data;
              return (
                <div key={`m${i}`} className="relative pb-2 animate-in" style={{ animationDelay: `${i * 20}ms` }}>
                  <div className="absolute -left-[20px] top-2 w-[5px] h-[5px] rounded-full" style={{ background: "var(--accent)" }} />
                  <button onClick={() => onJump(ms.exchange_index)} className="flex items-center gap-2 py-1 hover:underline text-left">
                    <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--accent-dim)", color: "var(--accent-hover)" }}>{ms.milestone_type}</span>
                    <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{ms.description}</span>
                  </button>
                </div>
              );
            }
            // compaction
            const ce = item.data;
            return (
              <div key={`c${i}`} className="relative pb-2">
                <div className="absolute -left-[20px] top-2 w-[5px] h-[5px] rounded-full" style={{ background: SEGMENT_COLORS.exploring }} />
                <div className="text-[12px] py-1 font-medium" style={{ color: SEGMENT_COLORS.exploring }}>
                  Context compacted ({ce.exchanges_before} → {ce.exchanges_after} exchanges)
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && plans.length === 0 && (
        <div className="text-center py-8 text-sm" style={{ color: "var(--text-muted)" }}>No timeline data — switch to transcript</div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────

export function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "transcript">("timeline");
  const [panel, setPanel] = useState<{ title: string; content: string; subtitle?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setTab("timeline");
    Promise.all([getSession(id) as Promise<SessionDetailType>, getSessionExchanges(id, true) as Promise<Exchange[]>])
      .then(([s, e]) => { setSession(s); setExchanges(e); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const jumpTo = (idx: number) => {
    setTab("transcript");
    setTimeout(() => document.getElementById(`exchange-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const openContent = (title: string, content: string, subtitle?: string) => setPanel({ title, content, subtitle });

  if (loading) return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (!session) return <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>Session not found</div>;

  const title = session.title || session.session_id.substring(0, 24);
  const project = session.project_path.split("/").slice(-2).join("/");
  const dur = fmtDuration(session.started_at, session.ended_at);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button onClick={() => navigate("/")} className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>
          ← Sessions
        </button>
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

      {/* Tabs */}
      <div className="flex border-b px-6 gap-1" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        {(["timeline", "transcript"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-2.5 text-[13px] transition-colors relative font-medium" style={{ color: tab === t ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t === "transcript" ? `Transcript (${exchanges.length})` : `Timeline (${session.segments.length})`}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "timeline" ? (
          <div className="px-6">
            <TimelineView segments={session.segments} milestones={session.milestones} compactionEvents={session.compaction_events} exchanges={exchanges} plans={session.plans} onJump={jumpTo} onOpenContent={openContent} />
          </div>
        ) : (
          <TranscriptView exchanges={exchanges} onOpenContent={openContent} />
        )}
      </div>

      {/* Content Panel */}
      {panel && <ContentPanel title={panel.title} content={panel.content} subtitle={panel.subtitle} onClose={() => setPanel(null)} />}
    </div>
  );
}
