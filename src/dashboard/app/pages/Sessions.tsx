import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router";
import { useAppContext } from "../App.js";
import { getSessions } from "../lib/api.js";
import type { SessionListItem } from "../lib/types.js";
import {
  ClipboardList,
  GitCommitHorizontal,
  ArrowUpToLine,
  CircleCheck,
  CircleX,
  GitPullRequestArrow,
  MessageSquare,
} from "lucide-react";

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

/** Factual session chips — shows what actually happened based on observable data */
function SessionChips({ session }: { session: SessionListItem }) {
  const chips: Array<{ icon: typeof ClipboardList; label: string; color: string }> = [];
  const outcomes = session.outcomes;

  // Plan chip
  if (session.latest_plan) {
    const v = session.latest_plan.total_versions;
    const status = session.latest_plan.status;
    const isGood = status === "approved" || status === "implemented";
    chips.push({
      icon: ClipboardList,
      label: `plan v${v} ${isGood ? "✓" : "✗"}`,
      color: isGood ? "#10b981" : "#ef4444",
    });
  }

  // Commits
  if (outcomes && outcomes.commits > 0) {
    chips.push({
      icon: GitCommitHorizontal,
      label: outcomes.commits === 1 ? "1 commit" : `${outcomes.commits} commits`,
      color: "#818cf8",
    });
  }

  // Pushed
  if (outcomes?.has_push) {
    chips.push({
      icon: ArrowUpToLine,
      label: "pushed",
      color: "#60a5fa",
    });
  }

  // Tests (last result wins)
  if (outcomes?.tests_passed) {
    chips.push({
      icon: CircleCheck,
      label: "tests passed",
      color: "#10b981",
    });
  } else if (outcomes?.tests_failed) {
    chips.push({
      icon: CircleX,
      label: "tests failed",
      color: "#ef4444",
    });
  }

  // PR
  if (outcomes?.has_pr) {
    chips.push({
      icon: GitPullRequestArrow,
      label: "pull request",
      color: "#34d399",
    });
  }

  // Discussion fallback (zero tool calls, no plan, no milestones)
  if (chips.length === 0 && (session.total_tool_calls ?? 0) === 0) {
    chips.push({
      icon: MessageSquare,
      label: "discussion",
      color: "#9ca3af",
    });
  }

  if (chips.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-2.5">
      {chips.map((chip, i) => {
        const Icon = chip.icon;
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-[12px]"
          >
            <Icon size={13} className="shrink-0" style={{ color: chip.color }} />
            <span style={{ color: chip.color }}>{chip.label}</span>
          </span>
        );
      })}
    </span>
  );
}


function SessionRow({
  session,
  showProject,
  isLast,
}: {
  session: SessionListItem;
  showProject: boolean;
  isLast: boolean;
}) {
  const title = session.title || session.session_id.substring(0, 20);
  const lastActivity = session.ended_at || session.started_at;
  const duration = formatDuration(session.started_at, session.ended_at);
  const project = session.project_path.split("/").slice(-2).join("/");

  // Build metadata items
  const meta: Array<{ text: string; mono?: boolean }> = [];
  if (showProject) meta.push({ text: project });
  if (session.git_branch) meta.push({ text: session.git_branch, mono: true });
  if (duration) meta.push({ text: duration });

  return (
    <Link
      to={`/sessions/${session.session_id}`}
      className={`block px-5 py-2 transition-colors hover:bg-[var(--bg-hover)]${isLast ? "" : " border-b"}`}
      style={isLast ? undefined : { borderColor: "var(--border)" }}
    >
      <div className="flex gap-2">
        {/* Left: Title + Factual chips */}
        <div className="flex-1 min-w-0">
          <p
            className="text-[13.5px] font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </p>
          <div className="mt-1" style={{ minHeight: 20 }}>
            <SessionChips session={session} />
          </div>
        </div>

        {/* Right: Meta + Time */}
        <div className="flex items-center gap-1.5 shrink-0">
          {meta.map((item, i) => (
            <span
              key={i}
              className={`text-[11px] px-2 py-0.5 rounded${item.mono ? " font-mono" : ""}`}
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-tertiary)",
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
    </Link>
  );
}

export function Sessions() {
  const { selectedProject, projects, searchQuery, setSearchQuery } = useAppContext();
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
    ? (projects.find(p => p.project_path === selectedProject)?.repo || selectedProject.split("/").pop() || selectedProject)
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
        className="px-5 pt-5 pb-3 flex items-center gap-4"
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
                <div key={date} className="px-4" style={{ marginTop: groupIdx > 0 ? 12 : 0 }}>
                  {/* Date label */}
                  <div
                    className="px-2 py-1.5 sticky top-0 z-10"
                    style={{ background: "var(--bg-root)" }}
                  >
                    <span
                      className="text-[11px] uppercase"
                      style={{ color: "var(--text-tertiary)", fontWeight: 500, letterSpacing: "0.06em" }}
                    >
                      {date}
                    </span>
                  </div>
                  {/* Card container */}
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{ border: "1px solid var(--border)" }}
                  >
                    {dateSessions.map((session, idx) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        showProject={showProject}
                        isLast={idx === dateSessions.length - 1}
                      />
                    ))}
                  </div>
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
