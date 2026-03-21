import { Link, useLocation } from "react-router";
import { useAppContext } from "../App.js";

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Sidebar() {
  const { projects, stats, selectedProject, setSelectedProject } = useAppContext();
  const location = useLocation();

  // Group projects by org
  const grouped = new Map<string, typeof projects>();
  for (const p of projects) {
    const key = p.org || "_standalone";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  return (
    <aside
      className="flex flex-col border-r h-full shrink-0"
      style={{
        width: 260,
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
    >
      {/* Header */}
      <Link
        to="/"
        onClick={() => setSelectedProject(null)}
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: "var(--accent)" }}
        />
        <span className="font-semibold text-sm tracking-wide" style={{ color: "var(--text-primary)" }}>
          keddy
        </span>
        {stats && (
          <span
            className="ml-auto text-xs tabular-nums"
            style={{ color: "var(--text-tertiary)" }}
          >
            {stats.total_sessions}
          </span>
        )}
      </Link>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* All sessions */}
        <button
          onClick={() => setSelectedProject(null)}
          className="w-full text-left px-4 py-1.5 text-xs flex items-center gap-2 transition-colors"
          style={{
            color: selectedProject === null ? "var(--text-primary)" : "var(--text-secondary)",
            background: selectedProject === null ? "var(--accent-dim)" : "transparent",
          }}
        >
          <span style={{ color: "var(--text-tertiary)" }}>//</span>
          all sessions
        </button>

        {Array.from(grouped.entries()).map(([org, orgProjects]) => (
          <div key={org} className="mt-3">
            {org !== "_standalone" && (
              <div
                className="px-4 py-1 text-xs uppercase tracking-wider"
                style={{ color: "var(--text-tertiary)", fontSize: 10 }}
              >
                {org}
              </div>
            )}
            {orgProjects.map((p) => {
              const isActive = selectedProject === p.project_path;
              return (
                <button
                  key={p.project_path}
                  onClick={() => setSelectedProject(p.project_path)}
                  className="w-full text-left px-4 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-[var(--bg-hover)]"
                  style={{
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    background: isActive ? "var(--accent-dim)" : undefined,
                  }}
                >
                  <span className="truncate flex-1">{p.repo}</span>
                  <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {p.session_count}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-2 flex gap-3" style={{ borderColor: "var(--border)" }}>
        <Link
          to="/settings"
          className="text-xs transition-colors hover:text-[var(--text-primary)]"
          style={{
            color: location.pathname === "/settings" ? "var(--text-primary)" : "var(--text-tertiary)",
          }}
        >
          settings
        </Link>
        {stats && (
          <span className="text-xs ml-auto" style={{ color: "var(--text-tertiary)" }}>
            {stats.db_size_mb}MB
          </span>
        )}
      </div>
    </aside>
  );
}
