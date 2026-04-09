import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAppContext } from "../App.js";
import { getSessions } from "../lib/api.js";
import type { SessionListItem } from "../lib/types.js";
import { Search } from "lucide-react";
import { SessionRow, SessionChips, formatRelative } from "../components/SessionRow.js";

// Re-export for backward compatibility
export { SessionRow, SessionChips, formatRelative };

function resolveRepoName(
  projectPath: string,
  projects: Array<{ project_path: string; repo: string }>,
): string {
  const direct = projects.find((p) => p.project_path === projectPath);
  if (direct) return direct.repo;

  const parts = projectPath.split("/");
  const wtIdx = parts.indexOf("worktrees");
  if (wtIdx >= 0 && wtIdx + 1 < parts.length) return parts[wtIdx + 1];

  return parts[parts.length - 1] || projectPath;
}

export function Sessions() {
  const { selectedProject, projects, searchQuery, setSearchQuery } = useAppContext();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);
  const [localSearch, setLocalSearch] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "7d" | "30d" | "all">("all");
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
    let result = sessions;

    if (localSearch) {
      const words = localSearch.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((s) => {
        const text = `${s.title || ""} ${s.project_path} ${s.git_branch || ""}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
    }

    if (dateRange !== "all") {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === "today") {
        cutoff.setHours(0, 0, 0, 0);
      } else if (dateRange === "7d") {
        cutoff.setDate(now.getDate() - 7);
      } else if (dateRange === "30d") {
        cutoff.setDate(now.getDate() - 30);
      }
      result = result.filter((s) => {
        const d = new Date(s.ended_at || s.started_at);
        return d >= cutoff;
      });
    }

    return result;
  }, [sessions, localSearch, dateRange]);

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
        className="px-5 pt-8 pb-3 flex items-center gap-4"
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
          style={{ border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-secondary)" }}
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
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-shadow focus-within:shadow-[0_0_0_2px_rgba(56,139,253,0.75)]"
          style={{ background: "rgba(255,255,255,0.09)" }}
        >
          <Search size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search sessions..."
            className="text-xs w-32 outline-none bg-transparent"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
      </div>

      {/* Date range filter */}
      <div className="px-5 pb-2 flex gap-1" style={{ background: "var(--bg-root)" }}>
        {(["all", "today", "7d", "30d"] as const).map((range) => (
          <button
            key={range}
            onClick={() => { setDateRange(range); setVisibleCount(50); }}
            className="text-[11px] px-2.5 py-1 rounded-md transition-colors"
            style={{
              background: dateRange === range ? "rgba(255,255,255,0.1)" : "transparent",
              color: dateRange === range ? "var(--text-primary)" : "var(--text-muted)",
              border: "none",
            }}
          >
            {range === "all" ? "All" : range === "today" ? "Today" : range === "7d" ? "7 days" : "30 days"}
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto pb-4">
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
                      className="text-[11px]"
                      style={{ color: "var(--text-tertiary)", fontWeight: 500, letterSpacing: "0.02em" }}
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
                        repoName={resolveRepoName(session.project_path, projects)}
                        isLast={idx === dateSessions.length - 1}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
            {visibleCount < filtered.length && (
              <div className="py-4 text-center">
                <button
                  onClick={() => setVisibleCount((c) => c + 50)}
                  className="text-xs px-4 py-2 rounded-md transition-colors hover:brightness-125"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    color: "var(--text-secondary)",
                    border: "none",
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
