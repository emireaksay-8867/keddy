import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS, MILESTONE_ICONS } from "../lib/constants.js";
import type { SessionDetail as SessionDetailType, Exchange, Segment, Milestone, CompactionEvent } from "../lib/types.js";

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

function ExchangeCard({ exchange }: { exchange: Exchange }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border rounded transition-colors cursor-pointer"
      style={{
        background: "var(--bg-surface)",
        borderColor: open ? "var(--border-bright)" : "var(--border)",
      }}
      onClick={() => setOpen(!open)}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-xs tabular-nums mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {String(exchange.exchange_index).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
            {exchange.user_prompt || "(empty)"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exchange.tool_call_count > 0 && (
            <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              {exchange.tool_call_count} tools
            </span>
          )}
          {!!exchange.is_interrupt && (
            <span className="text-xs" style={{ color: SEGMENT_COLORS.pivot }}>interrupted</span>
          )}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="pt-3">
            <div className="text-xs mb-1 font-medium" style={{ color: "var(--accent)" }}>prompt</div>
            <pre
              className="text-xs whitespace-pre-wrap rounded p-3 max-h-48 overflow-y-auto"
              style={{ background: "var(--bg-root)", color: "var(--text-secondary)" }}
            >
              {exchange.user_prompt}
            </pre>
          </div>
          {exchange.assistant_response && (
            <div>
              <div className="text-xs mb-1 font-medium" style={{ color: SEGMENT_COLORS.testing }}>response</div>
              <pre
                className="text-xs whitespace-pre-wrap rounded p-3 max-h-48 overflow-y-auto"
                style={{ background: "var(--bg-root)", color: "var(--text-secondary)" }}
              >
                {exchange.assistant_response}
              </pre>
            </div>
          )}
          {exchange.tool_calls && exchange.tool_calls.length > 0 && (
            <div>
              <div className="text-xs mb-1 font-medium" style={{ color: "var(--text-tertiary)" }}>tools</div>
              <div className="space-y-1">
                {exchange.tool_calls.map((tc) => (
                  <div
                    key={tc.id}
                    className="text-xs rounded px-3 py-2 flex items-center gap-2"
                    style={{ background: "var(--bg-root)" }}
                  >
                    <span style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>
                      {tc.tool_name}
                    </span>
                    <span className="truncate" style={{ color: "var(--text-tertiary)" }}>
                      {tc.tool_input.substring(0, 120)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineView({
  segments,
  milestones,
  compactionEvents,
}: {
  segments: Segment[];
  milestones: Milestone[];
  compactionEvents: CompactionEvent[];
}) {
  // Build timeline items sorted by exchange index
  type TimelineItem =
    | { kind: "segment"; data: Segment; idx: number }
    | { kind: "milestone"; data: Milestone; idx: number }
    | { kind: "compaction"; data: CompactionEvent; idx: number };

  const items: TimelineItem[] = [];
  segments.forEach((s) => items.push({ kind: "segment", data: s, idx: s.exchange_index_start }));
  milestones.forEach((m) => items.push({ kind: "milestone", data: m, idx: m.exchange_index }));
  compactionEvents.forEach((c) => items.push({ kind: "compaction", data: c, idx: c.exchange_index }));
  items.sort((a, b) => a.idx - b.idx);

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
        No timeline data for this session
      </div>
    );
  }

  return (
    <div className="relative pl-6 space-y-0">
      {/* Vertical line */}
      <div
        className="absolute left-[9px] top-2 bottom-2 w-px"
        style={{ background: "var(--border)" }}
      />

      {items.map((item, i) => {
        if (item.kind === "segment") {
          const seg = item.data;
          const color = SEGMENT_COLORS[seg.segment_type] || "#555";
          const label = SEGMENT_LABELS[seg.segment_type] || seg.segment_type;
          const files: string[] = (() => { try { return JSON.parse(seg.files_touched || "[]"); } catch { return []; } })();
          const tools: Record<string, number> = (() => { try { return JSON.parse(seg.tool_counts || "{}"); } catch { return {}; } })();
          const range = seg.exchange_index_start === seg.exchange_index_end
            ? `#${seg.exchange_index_start}`
            : `#${seg.exchange_index_start}–${seg.exchange_index_end}`;

          return (
            <div key={`s-${i}`} className="relative pb-4 animate-in" style={{ animationDelay: `${i * 30}ms` }}>
              <div
                className="absolute left-[-18px] top-1.5 w-[7px] h-[7px] rounded-full border-2"
                style={{ borderColor: color, background: color }}
              />
              <div className="ml-3 rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-medium"
                    style={{ background: `${color}18`, color }}
                  >
                    {label}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {range}
                  </span>
                  {Object.entries(tools).length > 0 && (
                    <span className="text-xs ml-auto" style={{ color: "var(--text-tertiary)" }}>
                      {Object.entries(tools)
                        .map(([k, v]) => `${k}:${v}`)
                        .join(" ")}
                    </span>
                  )}
                </div>
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1">
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
                className="absolute left-[-18px] top-1 w-[7px] h-[7px] rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <div className="ml-3 flex items-center gap-2 py-1">
                <span className="text-xs" style={{ color: "var(--accent)" }}>{icon}</span>
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

        // compaction
        const ce = item.data;
        return (
          <div key={`c-${i}`} className="relative pb-2 animate-in" style={{ animationDelay: `${i * 30}ms` }}>
            <div
              className="absolute left-[-18px] top-1 w-[7px] h-[7px] rounded-full"
              style={{ background: SEGMENT_COLORS.exploring }}
            />
            <div className="ml-3 flex items-center gap-2 py-1">
              <span className="text-xs" style={{ color: SEGMENT_COLORS.exploring }}>
                compacted {ce.exchanges_before} → {ce.exchanges_after}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SessionDetail() {
  const { id } = useParams();
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "exchanges">("timeline");

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
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
          <span>{project}</span>
          {session.git_branch && (
            <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)" }}>
              {session.git_branch}
            </span>
          )}
          <span>{formatTime(session.started_at)}</span>
          {session.ended_at && (
            <span>→ {formatTime(session.ended_at)}</span>
          )}
          {duration && <span>({duration})</span>}
          <span>{session.exchange_count} exchanges</span>
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
        {(["timeline", "exchanges"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-2 text-xs transition-colors relative"
            style={{ color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)" }}
          >
            {t === "exchanges" ? `exchanges (${exchanges.length})` : t}
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
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "timeline" ? (
          <TimelineView
            segments={session.segments}
            milestones={session.milestones}
            compactionEvents={session.compaction_events}
          />
        ) : (
          <div className="space-y-2">
            {exchanges.map((exchange) => (
              <ExchangeCard key={exchange.id} exchange={exchange} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
