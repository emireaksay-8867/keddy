import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS, MILESTONE_ICONS } from "../lib/constants.js";
import type {
  SessionDetail as SessionDetailType,
  Exchange,
  Segment,
  Milestone,
  CompactionEvent,
} from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60000) return "<1 min";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try { return JSON.parse(str); } catch { return fallback; }
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.substring(0, len) + "..." : s;
}

function extractToolSummary(input: string): string {
  try {
    const obj = JSON.parse(input);
    return obj.file_path || obj.command || obj.pattern || obj.query || obj.path || input.substring(0, 80);
  } catch {
    return input.substring(0, 80);
  }
}

// ── Tool Call Chip ─────────────────────────────────────────────

function ToolCallChip({ tc }: { tc: { tool_name: string; tool_input: string; tool_result: string | null; is_error: number } }) {
  const [open, setOpen] = useState(false);
  const isErr = !!tc.is_error;

  return (
    <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-[var(--bg-hover)] transition-colors"
        style={{ background: "var(--bg-elevated)" }}
      >
        <span className="opacity-40 text-[10px]">{open ? "▼" : "▶"}</span>
        <span className="font-medium" style={{ color: isErr ? SEGMENT_COLORS.debugging : "var(--accent)" }}>
          {tc.tool_name}
        </span>
        <span className="truncate flex-1 opacity-50">{extractToolSummary(tc.tool_input)}</span>
        {isErr && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.debugging}20`, color: SEGMENT_COLORS.debugging }}>error</span>}
      </button>
      {open && (
        <div className="px-3 py-2 space-y-2 border-t" style={{ borderColor: "var(--border)", background: "var(--bg-root)" }}>
          <div>
            <span className="text-[10px] uppercase tracking-wider opacity-40">input</span>
            <pre className="text-xs mt-1 whitespace-pre-wrap break-all max-h-32 overflow-y-auto" style={{ color: "var(--text-secondary)" }}>
              {(() => { try { return JSON.stringify(JSON.parse(tc.tool_input), null, 2); } catch { return tc.tool_input; } })()}
            </pre>
          </div>
          {tc.tool_result && (
            <div>
              <span className="text-[10px] uppercase tracking-wider opacity-40">result</span>
              <pre className="text-xs mt-1 whitespace-pre-wrap break-all max-h-32 overflow-y-auto" style={{ color: "var(--text-tertiary)" }}>
                {tc.tool_result.substring(0, 1000)}{tc.tool_result.length > 1000 ? "\n..." : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Transcript Exchange ────────────────────────────────────────

function TranscriptExchange({ exchange }: { exchange: Exchange }) {
  const [expanded, setExpanded] = useState(false);
  const hasTools = exchange.tool_calls && exchange.tool_calls.length > 0;
  const isLongPrompt = exchange.user_prompt.length > 300;
  const isLongResponse = (exchange.assistant_response || "").length > 500;
  const [toolsVisible, setToolsVisible] = useState(false);

  return (
    <div id={`exchange-${exchange.exchange_index}`} className="scroll-mt-20">
      {/* Compaction marker */}
      {!!exchange.is_compact_summary && (
        <div className="flex items-center gap-3 px-6 py-3 my-1">
          <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "40" }} />
          <span className="text-[10px] uppercase tracking-wider px-2" style={{ color: SEGMENT_COLORS.exploring }}>context compacted</span>
          <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "40" }} />
        </div>
      )}

      {/* User message */}
      {exchange.user_prompt && !exchange.is_compact_summary && (
        <div className="px-6 py-4" style={{ background: "var(--bg-elevated)" }}>
          <div className="flex items-start gap-3 max-w-4xl">
            <div className="shrink-0 mt-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: "var(--accent)", color: "white" }}>
              Y
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>You</span>
                <span className="text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>#{exchange.exchange_index}</span>
                {!!exchange.is_interrupt && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>
                )}
              </div>
              <div className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                {isLongPrompt && !expanded ? (
                  <>
                    <pre className="whitespace-pre-wrap font-[inherit]">{exchange.user_prompt.substring(0, 300)}</pre>
                    <button
                      onClick={() => setExpanded(true)}
                      className="text-xs mt-1 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      show more ({Math.ceil(exchange.user_prompt.length / 1000)}k chars)
                    </button>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap font-[inherit]">{exchange.user_prompt}</pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tool calls */}
      {hasTools && (
        <div className="px-6 py-2" style={{ borderLeft: "3px solid var(--border)" , marginLeft: 30 }}>
          <button
            onClick={() => setToolsVisible(!toolsVisible)}
            className="text-xs flex items-center gap-2 py-1 px-2 rounded transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-tertiary)" }}
          >
            <span className="text-[10px]">{toolsVisible ? "▼" : "▶"}</span>
            <span className="font-medium">{exchange.tool_calls!.length} tool {exchange.tool_calls!.length === 1 ? "call" : "calls"}</span>
            <span className="opacity-50">
              {[...new Set(exchange.tool_calls!.map((t) => t.tool_name))].join(", ")}
            </span>
          </button>
          {toolsVisible && (
            <div className="mt-1.5 space-y-1 ml-1">
              {exchange.tool_calls!.map((tc) => (
                <ToolCallChip key={tc.id} tc={tc} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assistant message */}
      {exchange.assistant_response && (
        <div className="px-6 py-4">
          <div className="flex items-start gap-3 max-w-4xl">
            <div className="shrink-0 mt-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: `${SEGMENT_COLORS.testing}25`, color: SEGMENT_COLORS.testing }}>
              C
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium" style={{ color: SEGMENT_COLORS.testing }}>Claude</span>
              </div>
              <div className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {isLongResponse && !expanded ? (
                  <>
                    <pre className="whitespace-pre-wrap font-[inherit]">{exchange.assistant_response.substring(0, 500)}</pre>
                    <button
                      onClick={() => setExpanded(true)}
                      className="text-xs mt-1 hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      show full response ({Math.ceil(exchange.assistant_response.length / 1000)}k chars)
                    </button>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap font-[inherit]">{exchange.assistant_response}</pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Timeline View ──────────────────────────────────────────────

function TimelineView({
  segments,
  milestones,
  compactionEvents,
  exchanges,
  onJumpToExchange,
}: {
  segments: Segment[];
  milestones: Milestone[];
  compactionEvents: CompactionEvent[];
  exchanges: Exchange[];
  onJumpToExchange: (idx: number) => void;
}) {
  type TItem =
    | { kind: "segment"; data: Segment; idx: number }
    | { kind: "milestone"; data: Milestone; idx: number }
    | { kind: "compaction"; data: CompactionEvent; idx: number };

  const items: TItem[] = [];
  segments.forEach((s) => items.push({ kind: "segment", data: s, idx: s.exchange_index_start }));
  milestones.forEach((m) => items.push({ kind: "milestone", data: m, idx: m.exchange_index }));
  compactionEvents.forEach((c) => items.push({ kind: "compaction", data: c, idx: c.exchange_index }));
  items.sort((a, b) => a.idx - b.idx);

  if (items.length === 0) return (
    <div className="p-8 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
      No timeline data — switch to transcript
    </div>
  );

  return (
    <div className="relative pl-8 py-4">
      <div className="absolute left-[11px] top-6 bottom-6 w-px" style={{ background: "var(--border)" }} />

      {items.map((item, i) => {
        if (item.kind === "segment") {
          const seg = item.data;
          const color = SEGMENT_COLORS[seg.segment_type] || "#555";
          const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
          const files = safeJsonParse<string[]>(seg.files_touched || "[]", []);
          const tools = safeJsonParse<Record<string, number>>(seg.tool_counts || "{}", {});
          const range = seg.exchange_index_start === seg.exchange_index_end
            ? `#${seg.exchange_index_start}`
            : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;
          const segExchanges = exchanges.filter(
            (e) => e.exchange_index >= seg.exchange_index_start && e.exchange_index <= seg.exchange_index_end,
          );

          return (
            <div key={`s-${i}`} className="relative pb-5 animate-in" style={{ animationDelay: `${i * 25}ms` }}>
              <div className="absolute left-[-22px] top-2.5 w-[9px] h-[9px] rounded-full border-2" style={{ borderColor: color, background: color }} />
              <button
                onClick={() => onJumpToExchange(seg.exchange_index_start)}
                className="w-full text-left rounded-lg border p-4 transition-all hover:border-[var(--border-bright)] hover:shadow-lg hover:shadow-black/10 group"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}18`, color }}>{label}</span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>{range}</span>
                  <span className="text-xs ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--accent)" }}>
                    view transcript →
                  </span>
                </div>

                {/* Exchange previews */}
                <div className="space-y-1.5 mb-2">
                  {segExchanges.slice(0, 4).map((ex) => (
                    <div key={ex.id} className="text-xs px-3 py-2 rounded flex items-start gap-2" style={{ background: "var(--bg-elevated)" }}>
                      <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5"
                        style={{ background: "var(--accent)", color: "white" }}>Y</span>
                      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                        {truncate(ex.user_prompt, 120)}
                      </span>
                      {ex.tool_call_count > 0 && (
                        <span className="shrink-0 tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                          {ex.tool_call_count} tools
                        </span>
                      )}
                    </div>
                  ))}
                  {segExchanges.length > 4 && (
                    <span className="text-xs px-3 block" style={{ color: "var(--text-tertiary)" }}>
                      +{segExchanges.length - 4} more
                    </span>
                  )}
                </div>

                {/* Tool summary + files */}
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(tools).length > 0 && (
                    <span className="text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                      {Object.entries(tools).map(([k, v]) => `${k}:${v}`).join("  ")}
                    </span>
                  )}
                </div>
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {files.slice(0, 5).map((f) => (
                      <span key={f} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
                        {f.split("/").pop()}
                      </span>
                    ))}
                    {files.length > 5 && <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>+{files.length - 5}</span>}
                  </div>
                )}
              </button>
            </div>
          );
        }

        if (item.kind === "milestone") {
          const ms = item.data;
          const icon = MILESTONE_ICONS[ms.milestone_type] || "·";
          return (
            <div key={`m-${i}`} className="relative pb-3 animate-in" style={{ animationDelay: `${i * 25}ms` }}>
              <div className="absolute left-[-20px] top-1.5 w-[5px] h-[5px] rounded-full" style={{ background: "var(--accent)" }} />
              <button
                onClick={() => onJumpToExchange(ms.exchange_index)}
                className="flex items-center gap-2 py-1 hover:underline"
              >
                <span className="text-xs" style={{ color: "var(--accent)" }}>{icon}</span>
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--accent-dim)", color: "var(--accent-hover)" }}>{ms.milestone_type}</span>
                <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{ms.description}</span>
              </button>
            </div>
          );
        }

        const ce = item.data;
        return (
          <div key={`c-${i}`} className="relative pb-3 animate-in" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="absolute left-[-20px] top-1.5 w-[5px] h-[5px] rounded-full" style={{ background: SEGMENT_COLORS.exploring }} />
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "30" }} />
              <span className="text-[10px] uppercase tracking-wider" style={{ color: SEGMENT_COLORS.exploring }}>
                compacted ({ce.exchanges_before} → {ce.exchanges_after})
              </span>
              <div className="h-px flex-1" style={{ background: SEGMENT_COLORS.exploring + "30" }} />
            </div>
          </div>
        );
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
  const [tab, setTab] = useState<"timeline" | "transcript">("timeline");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setTab("timeline");
    Promise.all([
      getSession(id) as Promise<SessionDetailType>,
      getSessionExchanges(id, true) as Promise<Exchange[]>,
    ])
      .then(([s, e]) => { setSession(s); setExchanges(e); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  function jumpToExchange(idx: number) {
    setTab("transcript");
    setTimeout(() => {
      const el = document.getElementById(`exchange-${idx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  if (loading) return <div className="p-8 text-xs" style={{ color: "var(--text-tertiary)" }}>loading...</div>;
  if (!session) return <div className="p-8 text-xs" style={{ color: "var(--text-tertiary)" }}>session not found</div>;

  const title = session.title || session.session_id.substring(0, 24);
  const project = session.project_path.split("/").slice(-2).join("/");
  const duration = formatDuration(session.started_at, session.ended_at);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button onClick={() => navigate("/")} className="text-xs mb-2 transition-colors hover:text-[var(--text-primary)] flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
          ← back to sessions
        </button>
        <h1 className="text-sm font-medium mb-1.5 leading-snug" style={{ color: "var(--text-primary)" }}>
          {truncate(title, 120)}
        </h1>
        <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: "var(--text-tertiary)" }}>
          <span>{project}</span>
          {session.git_branch && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{session.git_branch}</span>
          )}
          <span>{formatTime(session.started_at)}</span>
          {session.ended_at && <span>→ {formatTime(session.ended_at)}</span>}
          {duration && <span>({duration})</span>}
          <span>{exchanges.length} exchanges</span>
          {session.milestones.length > 0 && <span>{session.milestones.length} milestones</span>}
          {session.plans.length > 0 && <span style={{ color: SEGMENT_COLORS.planning }}>{session.plans.length} plans</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        {(["timeline", "transcript"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-2.5 text-xs transition-colors relative"
            style={{ color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)" }}
          >
            {t === "transcript" ? `transcript (${exchanges.length})` : `timeline (${session.segments.length})`}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" ref={contentRef}>
        {tab === "timeline" ? (
          <div className="px-6">
            <TimelineView
              segments={session.segments}
              milestones={session.milestones}
              compactionEvents={session.compaction_events}
              exchanges={exchanges}
              onJumpToExchange={jumpToExchange}
            />
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {exchanges.map((ex) => (
              <TranscriptExchange key={ex.id} exchange={ex} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
