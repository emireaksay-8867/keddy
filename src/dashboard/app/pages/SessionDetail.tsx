import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS, MILESTONE_ICONS } from "../lib/constants.js";
import type {
  SessionDetail as SessionDetailType,
  Exchange,
  Segment,
  Milestone,
  CompactionEvent,
} from "../lib/types.js";

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

// ── Transcript View (chat-style) ──────────────────────────────

function TranscriptView({ exchanges }: { exchanges: Exchange[] }) {
  if (exchanges.length === 0) {
    return (
      <div className="p-8 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
        No exchanges in this session
      </div>
    );
  }

  return (
    <div className="space-y-1 py-2">
      {exchanges.map((ex, i) => (
        <TranscriptExchange key={ex.id} exchange={ex} index={i} />
      ))}
    </div>
  );
}

function TranscriptExchange({ exchange, index }: { exchange: Exchange; index: number }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const hasTools = exchange.tool_calls && exchange.tool_calls.length > 0;

  return (
    <div
      className="animate-in"
      style={{ animationDelay: `${Math.min(index * 20, 300)}ms` }}
    >
      {/* User message */}
      {exchange.user_prompt && !exchange.is_compact_summary && (
        <div className="flex gap-3 px-5 py-3">
          <div className="shrink-0 mt-0.5">
            <div
              className="w-5 h-5 rounded flex items-center justify-center text-xs font-medium"
              style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
            >
              U
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <pre
              className="text-xs whitespace-pre-wrap leading-relaxed"
              style={{ color: "var(--text-primary)", fontFamily: "inherit" }}
            >
              {exchange.user_prompt}
            </pre>
          </div>
          <span className="text-xs tabular-nums shrink-0 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            #{exchange.exchange_index}
          </span>
        </div>
      )}

      {/* Compact summary marker */}
      {!!exchange.is_compact_summary && (
        <div className="flex items-center gap-3 px-5 py-2">
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
          <span className="text-xs px-2" style={{ color: SEGMENT_COLORS.exploring }}>
            context compacted
          </span>
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
        </div>
      )}

      {/* Interrupt marker */}
      {!!exchange.is_interrupt && (
        <div className="flex items-center gap-2 px-5 py-1 ml-8">
          <span className="text-xs" style={{ color: SEGMENT_COLORS.pivot }}>
            interrupted by user
          </span>
        </div>
      )}

      {/* Tool calls summary */}
      {hasTools && (
        <div className="px-5 py-1 ml-8">
          <button
            onClick={() => setToolsOpen(!toolsOpen)}
            className="text-xs flex items-center gap-1.5 py-1 px-2 rounded transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-tertiary)" }}
          >
            <span style={{ fontSize: 9 }}>{toolsOpen ? "▼" : "▶"}</span>
            <span>{exchange.tool_calls!.length} tool calls</span>
            <span style={{ color: "var(--text-tertiary)", opacity: 0.5 }}>
              ({[...new Set(exchange.tool_calls!.map((t) => t.tool_name))].join(", ")})
            </span>
          </button>
          {toolsOpen && (
            <div className="mt-1 ml-1 space-y-0.5">
              {exchange.tool_calls!.map((tc) => (
                <div
                  key={tc.id}
                  className="text-xs rounded px-2.5 py-1.5 flex items-start gap-2"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <span
                    className="shrink-0 font-medium"
                    style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}
                  >
                    {tc.tool_name}
                  </span>
                  <span className="truncate" style={{ color: "var(--text-tertiary)" }}>
                    {(() => {
                      try {
                        const input = JSON.parse(tc.tool_input);
                        return input.file_path || input.command || input.pattern || input.query || tc.tool_input.substring(0, 100);
                      } catch {
                        return tc.tool_input.substring(0, 100);
                      }
                    })()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assistant response */}
      {exchange.assistant_response && (
        <div className="flex gap-3 px-5 py-3" style={{ background: "var(--bg-surface)" }}>
          <div className="shrink-0 mt-0.5">
            <div
              className="w-5 h-5 rounded flex items-center justify-center text-xs font-medium"
              style={{ background: `${SEGMENT_COLORS.testing}18`, color: SEGMENT_COLORS.testing }}
            >
              A
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <pre
              className="text-xs whitespace-pre-wrap leading-relaxed"
              style={{ color: "var(--text-secondary)", fontFamily: "inherit" }}
            >
              {exchange.assistant_response.length > 2000
                ? exchange.assistant_response.substring(0, 2000) + "\n\n... (truncated)"
                : exchange.assistant_response}
            </pre>
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
}: {
  segments: Segment[];
  milestones: Milestone[];
  compactionEvents: CompactionEvent[];
  exchanges: Exchange[];
}) {
  type TimelineItem =
    | { kind: "segment"; data: Segment; idx: number }
    | { kind: "milestone"; data: Milestone; idx: number }
    | { kind: "compaction"; data: CompactionEvent; idx: number };

  const items: TimelineItem[] = [];
  segments.forEach((s) => items.push({ kind: "segment", data: s, idx: s.exchange_index_start }));
  milestones.forEach((m) => items.push({ kind: "milestone", data: m, idx: m.exchange_index }));
  compactionEvents.forEach((c) =>
    items.push({ kind: "compaction", data: c, idx: c.exchange_index }),
  );
  items.sort((a, b) => a.idx - b.idx);

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
        No timeline data — switch to transcript view
      </div>
    );
  }

  return (
    <div className="relative pl-6 space-y-0 py-2">
      <div
        className="absolute left-[9px] top-4 bottom-4 w-px"
        style={{ background: "var(--border)" }}
      />
      {items.map((item, i) => {
        if (item.kind === "segment") {
          const seg = item.data;
          const color = SEGMENT_COLORS[seg.segment_type] || "#555";
          const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
          const files: string[] = (() => {
            try { return JSON.parse(seg.files_touched || "[]"); } catch { return []; }
          })();
          const tools: Record<string, number> = (() => {
            try { return JSON.parse(seg.tool_counts || "{}"); } catch { return {}; }
          })();
          const range =
            seg.exchange_index_start === seg.exchange_index_end
              ? `#${seg.exchange_index_start}`
              : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;

          // Get exchange previews for this segment
          const segExchanges = exchanges.filter(
            (e) =>
              e.exchange_index >= seg.exchange_index_start &&
              e.exchange_index <= seg.exchange_index_end,
          );

          return (
            <div key={`s-${i}`} className="relative pb-4 animate-in" style={{ animationDelay: `${i * 30}ms` }}>
              <div
                className="absolute left-[-18px] top-2 w-[7px] h-[7px] rounded-full"
                style={{ background: color }}
              />
              <div
                className="ml-3 rounded border p-3"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-medium"
                    style={{ background: `${color}18`, color }}
                  >
                    {label}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {range}
                  </span>
                  {Object.keys(tools).length > 0 && (
                    <span className="text-xs ml-auto" style={{ color: "var(--text-tertiary)" }}>
                      {Object.entries(tools)
                        .map(([k, v]) => `${k}:${v}`)
                        .join("  ")}
                    </span>
                  )}
                </div>

                {/* Exchange previews inside segment */}
                {segExchanges.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {segExchanges.slice(0, 5).map((ex) => (
                      <div key={ex.id} className="text-xs rounded px-2.5 py-1.5" style={{ background: "var(--bg-elevated)" }}>
                        <span style={{ color: "var(--text-primary)" }}>
                          {ex.user_prompt.substring(0, 120)}
                          {ex.user_prompt.length > 120 ? "..." : ""}
                        </span>
                        {ex.tool_call_count > 0 && (
                          <span className="ml-2" style={{ color: "var(--text-tertiary)" }}>
                            ({ex.tool_call_count} tools)
                          </span>
                        )}
                      </div>
                    ))}
                    {segExchanges.length > 5 && (
                      <span className="text-xs px-2.5" style={{ color: "var(--text-tertiary)" }}>
                        +{segExchanges.length - 5} more exchanges
                      </span>
                    )}
                  </div>
                )}

                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {files.slice(0, 6).map((f) => (
                      <span
                        key={f}
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
                      >
                        {f.split("/").pop()}
                      </span>
                    ))}
                    {files.length > 6 && (
                      <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        +{files.length - 6}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        }

        if (item.kind === "milestone") {
          const ms = item.data;
          const icon = MILESTONE_ICONS[ms.milestone_type] || "\u00B7";
          return (
            <div key={`m-${i}`} className="relative pb-2 animate-in" style={{ animationDelay: `${i * 30}ms` }}>
              <div
                className="absolute left-[-18px] top-1.5 w-[7px] h-[7px] rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <div className="ml-3 flex items-center gap-2 py-1">
                <span style={{ color: "var(--accent)" }}>{icon}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "var(--accent-dim)", color: "var(--accent-hover)" }}
                >
                  {ms.milestone_type}
                </span>
                <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                  {ms.description}
                </span>
              </div>
            </div>
          );
        }

        const ce = item.data;
        return (
          <div key={`c-${i}`} className="relative pb-2 animate-in" style={{ animationDelay: `${i * 30}ms` }}>
            <div
              className="absolute left-[-18px] top-1.5 w-[7px] h-[7px] rounded-full"
              style={{ background: SEGMENT_COLORS.exploring }}
            />
            <div className="ml-3 py-1">
              <span className="text-xs" style={{ color: SEGMENT_COLORS.exploring }}>
                context compacted ({ce.exchanges_before} → {ce.exchanges_after} exchanges)
              </span>
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
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"transcript" | "timeline">("transcript");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      getSession(id) as Promise<SessionDetailType>,
      getSessionExchanges(id, true) as Promise<Exchange[]>,
    ])
      .then(([s, e]) => {
        setSession(s);
        setExchanges(e);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 text-xs" style={{ color: "var(--text-tertiary)" }}>
        loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8 text-xs" style={{ color: "var(--text-tertiary)" }}>
        session not found
      </div>
    );
  }

  const title = session.title || session.session_id.substring(0, 24);
  const project = session.project_path.split("/").slice(-2).join("/");
  const duration = formatDuration(session.started_at, session.ended_at);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="px-5 py-3 border-b"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Link
            to="/"
            className="text-xs transition-colors hover:text-[var(--text-primary)]"
            style={{ color: "var(--text-tertiary)" }}
          >
            ← back
          </Link>
        </div>
        <h1 className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>
          {title}
        </h1>
        <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: "var(--text-tertiary)" }}>
          <span>{project}</span>
          {session.git_branch && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)" }}>
              {session.git_branch}
            </span>
          )}
          <span>{formatTime(session.started_at)}</span>
          {session.ended_at && <span>→ {formatTime(session.ended_at)}</span>}
          {duration && <span>({duration})</span>}
          <span>{exchanges.length} exchanges</span>
          {session.milestones.length > 0 && (
            <span>{session.milestones.length} milestones</span>
          )}
          {session.plans.length > 0 && (
            <span style={{ color: SEGMENT_COLORS.planning }}>
              {session.plans.length} plans
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b px-5"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        {(["transcript", "timeline"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-2 text-xs transition-colors relative"
            style={{ color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)" }}
          >
            {t === "transcript" ? `transcript (${exchanges.length})` : `timeline (${session.segments.length})`}
            {tab === t && (
              <div
                className="absolute bottom-0 left-0 right-0 h-px"
                style={{ background: "var(--accent)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "transcript" ? (
          <TranscriptView exchanges={exchanges} />
        ) : (
          <div className="p-5">
            <TimelineView
              segments={session.segments}
              milestones={session.milestones}
              compactionEvents={session.compaction_events}
              exchanges={exchanges}
            />
          </div>
        )}
      </div>
    </div>
  );
}
