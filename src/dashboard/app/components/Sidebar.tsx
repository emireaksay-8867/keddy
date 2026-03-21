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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Sidebar() {
  const { projects, stats, selectedProject, setSelectedProject } = useAppContext();
  const location = useLocation();

  // Group: org repos vs personal repos
  const orgRepos = projects.filter((p) => p.org && p.org !== "");
  const personalRepos = projects.filter((p) => !p.org || p.org === "");

  // Group org repos by org
  const byOrg = new Map<string, typeof projects>();
  for (const p of orgRepos) {
    if (!byOrg.has(p.org)) byOrg.set(p.org, []);
    byOrg.get(p.org)!.push(p);
  }

  const isSelected = (p: typeof projects[0]) => {
    if (!selectedProject) return false;
    // Match exact path or by repo name for worktree-merged entries
    return selectedProject === p.project_path || selectedProject === p.short_path;
  };

  const handleSelect = (p: typeof projects[0]) => {
    // If clicking the already-selected project, deselect
    if (isSelected(p)) {
      setSelectedProject(null);
    } else {
      setSelectedProject(p.project_path);
    }
  };

  return (
    <aside
      className="flex flex-col border-r h-full shrink-0 select-none"
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
        className="flex items-center gap-2.5 px-4 py-3.5 border-b hover:bg-[var(--bg-hover)] transition-colors"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: "#34d399" }}
        />
        <span className="font-semibold text-sm tracking-tight" style={{ color: "var(--text-primary)" }}>
          keddy
        </span>
        {stats && (
          <span
            className="ml-auto text-xs tabular-nums"
            style={{ color: "var(--text-tertiary)" }}
          >
            {stats.total_sessions} sessions
          </span>
        )}
      </Link>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {/* All sessions */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={() => setSelectedProject(null)}
            className="w-full text-left px-2.5 py-2 text-xs rounded transition-colors flex items-center gap-2"
            style={{
              color: selectedProject === null ? "var(--text-primary)" : "var(--text-secondary)",
              background: selectedProject === null ? "var(--accent-dim)" : "transparent",
              borderLeft: selectedProject === null ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            <span>All Sessions</span>
            <span className="ml-auto tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              {stats?.total_sessions || 0}
            </span>
          </button>
        </div>

        {/* Organizations */}
        {Array.from(byOrg.entries()).map(([org, orgProjects]) => (
          <div key={org} className="px-3 mt-3">
            <div
              className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: "var(--text-tertiary)", fontSize: 10 }}
            >
              <span style={{ opacity: 0.5 }}>&#9656;</span>
              {org}
            </div>
            {orgProjects.map((p) => {
              const active = isSelected(p);
              return (
                <button
                  key={p.project_path}
                  onClick={() => handleSelect(p)}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors flex items-center gap-2"
                  style={{
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    background: active ? "var(--accent-dim)" : undefined,
                    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="truncate flex-1">{p.repo}</span>
                  <span className="tabular-nums shrink-0" style={{ color: "var(--text-tertiary)" }}>
                    {p.session_count}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {/* Personal / Other repos */}
        {personalRepos.length > 0 && (
          <div className="px-3 mt-3">
            <div
              className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: "var(--text-tertiary)", fontSize: 10 }}
            >
              <span style={{ opacity: 0.5 }}>&#9656;</span>
              Repositories
            </div>
            {personalRepos.map((p) => {
              const active = isSelected(p);
              return (
                <button
                  key={p.project_path}
                  onClick={() => handleSelect(p)}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors flex items-center gap-2"
                  style={{
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    background: active ? "var(--accent-dim)" : undefined,
                    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="truncate flex-1">{p.repo}</span>
                  <span className="tabular-nums shrink-0" style={{ color: "var(--text-tertiary)" }}>
                    {p.session_count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-2.5 flex gap-3" style={{ borderColor: "var(--border)" }}>
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
          <span className="text-xs ml-auto tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            {stats.db_size_mb}MB
          </span>
        )}
      </div>
    </aside>
  );
}
