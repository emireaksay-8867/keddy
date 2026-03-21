import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router";
import { useAppContext } from "../App.js";
import { getSessions } from "../lib/api.js";
import { SEGMENT_COLORS, SEGMENT_LABELS } from "../lib/constants.js";
import type { SessionListItem } from "../lib/types.js";

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
  return formatTime(dateStr);
}

function SegmentBar({ segments, total }: { segments: SessionListItem["segments"]; total: number }) {
  if (!segments.length || total === 0) return null;
  return (
    <div className="flex h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
      {segments.map((seg, i) => {
        const width = Math.max(((seg.end - seg.start + 1) / total) * 100, 3);
        return (
          <div
            key={i}
            style={{ width: `${width}%`, background: SEGMENT_COLORS[seg.type] || "#555" }}
            title={SEGMENT_LABELS[seg.type] || seg.type}
          />
        );
      })}
    </div>
  );
}

function SessionRow({ session }: { session: SessionListItem }) {
  const title = session.title || session.session_id.substring(0, 20);
  const project = session.project_path.split("/").slice(-2).join("/");
  const lastActivity = session.ended_at || session.started_at;
  const duration = formatDuration(session.started_at, session.ended_at);

  return (
    <Link
      to={`/sessions/${session.session_id}`}
      className="block px-5 py-3 border-b transition-colors hover:bg-[var(--bg-hover)] animate-in"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium truncate mb-1" style={{ color: "var(--text-primary)" }}>
            {title}
          </p>
          <div className="flex items-center gap-2.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            <span>{project}</span>
            {session.git_branch && (
              <span
                className="px-1.5 py-0.5 rounded font-mono text-[11px]"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              >
                {session.git_branch}
              </span>
            )}
            {duration && <span>{duration}</span>}
            <span>{session.exchange_count} exchanges</span>
            {session.milestone_count > 0 && <span>{session.milestone_count} milestones</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            {formatRelative(lastActivity)}
          </span>
        </div>
      </div>
      <div className="mt-2">
        <SegmentBar segments={session.segments} total={session.exchange_count} />
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

  const fetchSessions = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true);
    const params: Record<string, string | number> = { days: 365, limit: 500 };
    if (selectedProject) params.project = selectedProject;
    if (searchQuery) params.q = searchQuery;
    getSessions(params as any)
      .then((data) => {
        setSessions(data as SessionListItem[]);
        if (isInitial) setVisibleCount(50);
        setLastUpdated(new Date());
      })
      .catch(console.error)
      .finally(() => { if (isInitial) setLoading(false); });
  }, [selectedProject, searchQuery]);

  // Initial fetch + refetch on filter changes
  useEffect(() => {
    fetchSessions(true);
  }, [fetchSessions]);

  // 30-second polling
  useEffect(() => {
    intervalRef.current = setInterval(() => fetchSessions(false), 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchSessions]);

  // Update "Updated X ago" text every 5 seconds
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
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
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
  const projectName = selectedProject
    ? selectedProject.split("/").slice(-2).join("/")
    : "All Sessions";

  // Group sessions by date
  const grouped = new Map<string, SessionListItem[]>();
  for (const s of visible) {
    const lastActivity = s.ended_at || s.started_at;
    const date = new Date(lastActivity);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let key: string;
    if (date.toDateString() === today.toDateString()) {
      key = "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      key = "Yesterday";
    } else {
      key = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    }

    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="px-5 py-3 border-b flex items-center gap-4"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        <h1 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {projectName}
        </h1>
        <span className="text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
          {filtered.length} sessions
        </span>
        {updateAgo && (
          <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {updateAgo}
          </span>
        )}
        <div className="flex-1" />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="filter..."
          className="px-3 py-1.5 rounded text-xs w-48 outline-none transition-colors"
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
          <div className="p-8 text-center" style={{ color: "var(--text-tertiary)" }}>
            <span className="text-xs">loading sessions...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm mb-1">No sessions found</p>
            <p className="text-xs">
              {selectedProject ? "Try selecting a different project" : "Run keddy init to start capturing"}
            </p>
          </div>
        ) : (
          <>
            {Array.from(grouped.entries()).map(([date, dateSessions], groupIdx) => (
              <div key={date}>
                <div
                  className="px-5 py-3 text-xs tracking-wider sticky top-0 z-10 flex items-center gap-3"
                  style={{
                    color: "var(--text-secondary)",
                    background: "var(--bg-root)",
                    borderBottom: "1px solid var(--border)",
                    borderTop: groupIdx > 0 ? "1px solid var(--border-bright)" : undefined,
                    marginTop: groupIdx > 0 ? 8 : 0,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  <span>{date}</span>
                  <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>
                    {dateSessions.length} {dateSessions.length === 1 ? "session" : "sessions"}
                  </span>
                  <div className="flex-1 h-px ml-2" style={{ background: "var(--border)" }} />
                </div>
                {dateSessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </div>
            ))}
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
