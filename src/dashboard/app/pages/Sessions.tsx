import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router";
import { useAppContext } from "../App.js";
import { getSessions } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_SHORT_LABELS } from "../lib/constants.js";
import type { SessionListItem } from "../lib/types.js";
import {
  Compass,
  Code,
  ListChecks,
  Bug,
  Rocket,
  Search,
  FileSearch,
  Database,
  CornerDownRight,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const SEGMENT_ICONS: Record<string, LucideIcon> = {
  planning: Compass,
  implementing: Code,
  testing: ListChecks,
  debugging: Bug,
  deploying: Rocket,
  exploring: Search,
  reviewing: FileSearch,
  querying: Database,
  pivot: CornerDownRight,
  discussion: MessageCircle,
};

function formatDuration(start: string, end: string | null): string {
  if (!end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60000) return "<1m";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Segment flow — icon + label for each segment, connected by chevrons. Max 5 shown. */
function SegmentFlow({
  segments,
}: {
  segments: SessionListItem["segments"];
}) {
  if (!segments.length) return null;

  const maxShow = 5;
  const visible = segments.slice(0, maxShow);
  const overflow = segments.length - maxShow;

  return (
    <span className="inline-flex items-center gap-1.5">
      {visible.map((seg, i) => {
        const Icon = SEGMENT_ICONS[seg.type] || MessageCircle;
        const label = SEGMENT_SHORT_LABELS[seg.type] || seg.type;
        const iconColor = SEGMENT_COLORS[seg.type] || "var(--text-muted)";
        const count = seg.end - seg.start + 1;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRight
                size={12}
                strokeWidth={2.5}
                style={{ color: "var(--text-secondary)" }}
                className="shrink-0"
              />
            )}
            <span
              className="inline-flex items-center gap-1 text-[12px]"
              title={`${SEGMENT_SHORT_LABELS[seg.type] || seg.type} · ${count} exchange${count !== 1 ? "s" : ""}`}
            >
              <Icon size={14} className="shrink-0" style={{ color: iconColor }} />
              <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
            </span>
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="text-[10px] ml-0.5" style={{ color: "var(--text-muted)" }}>
          +{overflow}
        </span>
      )}
    </span>
  );
}


function SessionRow({
  session,
  showProject,
}: {
  session: SessionListItem;
  showProject: boolean;
}) {
  const title = session.title || session.session_id.substring(0, 20);
  const lastActivity = session.ended_at || session.started_at;
  const duration = formatDuration(session.started_at, session.ended_at);
  const project = session.project_path.split("/").slice(-2).join("/");

  // Build metadata items for line 2
  const meta: Array<{ text: string; mono?: boolean; color?: string }> = [];

  if (showProject) {
    meta.push({ text: project });
  }
  if (session.git_branch) {
    meta.push({ text: session.git_branch, mono: true });
  }
  if (duration) {
    meta.push({ text: duration });
  }
  meta.push({ text: `${session.exchange_count} exchanges` });

  return (
    <Link
      to={`/sessions/${session.session_id}`}
      className="block px-5 py-2.5 transition-colors hover:bg-[var(--bg-hover)] border-b"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Line 1: Title + Meta pills + Time */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 shrink">
          <p
            className="text-[13.5px] font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {meta.map((item, i) => (
            <span
              key={i}
              className={`text-[11px] px-2 py-0.5 rounded${item.mono ? " font-mono" : ""}`}
              style={{
                border: "1px solid var(--border)",
                color: item.color || "var(--text-tertiary)",
              }}
            >
              {item.text}
            </span>
          ))}
          <span
            className="text-[11px] tabular-nums ml-1"
            style={{ color: "var(--text-muted)" }}
          >
            {formatRelative(lastActivity)}
          </span>
        </div>
      </div>

      {/* Line 2: Segment flow — always rendered for consistent height */}
      <div className="mt-1" style={{ minHeight: 20 }}>
        {session.segments.length > 0 && (
          <SegmentFlow segments={session.segments} />
        )}
      </div>
    </Link>
  );
}

export function Sessions() {
  const { selectedProject, searchQuery, setSearchQuery } = useAppContext();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);
  const [localSearch, setLocalSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [updateAgo, setUpdateAgo] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(
    (isInitial = false) => {
      if (isInitial) setLoading(true);
      const params: Record<string, string | number> = {
        days: 365,
        limit: 500,
      };
      if (selectedProject) params.project = selectedProject;
      if (searchQuery) params.q = searchQuery;
      getSessions(params as any)
        .then((data) => {
          setSessions(data as SessionListItem[]);
          if (isInitial) setVisibleCount(50);
          setLastUpdated(new Date());
        })
        .catch(console.error)
        .finally(() => {
          if (isInitial) setLoading(false);
        });
    },
    [selectedProject, searchQuery],
  );

  useEffect(() => {
    fetchSessions(true);
  }, [fetchSessions]);

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchSessions(false), 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchSessions]);

  useEffect(() => {
    const tick = () => {
      if (!lastUpdated) return;
      const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (secs < 5) setUpdateAgo("Updated just now");
      else if (secs < 60) setUpdateAgo(`Updated ${secs}s ago`);
      else setUpdateAgo(`Updated ${Math.floor(secs / 60)}m ago`);
    };
    tick();
    tickRef.current = setInterval(tick, 5000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [lastUpdated]);

  const filtered = useMemo(() => {
    if (!localSearch) return sessions;
    const q = localSearch.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        s.project_path.toLowerCase().includes(q) ||
        (s.git_branch || "").toLowerCase().includes(q),
    );
  }, [sessions, localSearch]);

  const visible = filtered.slice(0, visibleCount);
  const showProject = !selectedProject;
  const projectName = selectedProject
    ? selectedProject.split("/").slice(-2).join("/")
    : "All Sessions";

  // Compute header stats from loaded sessions
  const lastActive = sessions.length > 0
    ? sessions[0].ended_at || sessions[0].started_at
    : null;

  // Group sessions by last activity date (matches Claude Code ordering)
  const groupMap = new Map<string, { dateVal: number; sessions: SessionListItem[] }>();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const s of visible) {
    const date = new Date(s.ended_at || s.started_at);

    let key: string;
    if (date.toDateString() === today.toDateString()) {
      key = "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = "Yesterday";
    } else {
      key = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }

    if (!groupMap.has(key)) {
      groupMap.set(key, { dateVal: date.getTime(), sessions: [] });
    }
    groupMap.get(key)!.sessions.push(s);
  }

  // Sort groups by date descending (Today first)
  const grouped = [...groupMap.entries()]
    .sort((a, b) => b[1].dateVal - a[1].dateVal)
    .map(([key, val]) => [key, val.sessions] as [string, SessionListItem[]]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="px-5 py-3 flex items-center gap-4"
        style={{ background: "var(--bg-root)" }}
      >
        <h1
          style={{
            color: "var(--text-primary)",
            fontSize: 15,
            fontWeight: 450,
            letterSpacing: "0.03em",
          }}
        >
          {projectName}
        </h1>
        <span
          className="text-[11px] tabular-nums px-2.5 py-0.5 rounded-full"
          style={{ border: "1px solid var(--border-bright)", color: "var(--text-secondary)" }}
        >
          {filtered.length} sessions
        </span>
        {lastActive && (
          <span
            className="text-[11px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            last active {formatRelative(lastActive)}
          </span>
        )}
        <div className="flex-1" />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Filter sessions..."
          className="px-3 py-1.5 rounded text-xs w-52 outline-none transition-colors"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div
            className="p-8 text-center"
            style={{ color: "var(--text-tertiary)" }}
          >
            <span className="text-xs">loading sessions...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="p-12 text-center"
            style={{ color: "var(--text-tertiary)" }}
          >
            <p className="text-sm mb-1">No sessions found</p>
            <p className="text-xs">
              {selectedProject
                ? "Try selecting a different project"
                : "Run keddy init to start capturing"}
            </p>
          </div>
        ) : (
          <>
            {grouped.map(
              ([date, dateSessions], groupIdx) => (
                <div key={date}>
                  <div
                    className="px-5 py-3 sticky top-0 z-10 flex items-center gap-3"
                    style={{
                      background: "var(--bg-root)",
                      marginTop: groupIdx > 0 ? 4 : 0,
                    }}
                  >
                    <div
                      className="flex-1 h-px"
                      style={{ background: "var(--border-bright)" }}
                    />
                    <span
                      className="text-[12px] shrink-0"
                      style={{ color: "var(--text-secondary)", fontWeight: 500 }}
                    >
                      {date}
                    </span>
                    <div
                      className="flex-1 h-px"
                      style={{ background: "var(--border-bright)" }}
                    />
                  </div>
                  {dateSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      showProject={showProject}
                    />
                  ))}
                </div>
              ),
            )}
            {visibleCount < filtered.length && (
              <div className="p-4 text-center">
                <button
                  onClick={() => setVisibleCount((c) => c + 50)}
                  className="text-xs px-4 py-2 rounded transition-colors"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  load more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
