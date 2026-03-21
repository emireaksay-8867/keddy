import { Link, useLocation, useNavigate } from "react-router";
import { useAppContext } from "../App.js";

export function Sidebar() {
  const { projects, stats, selectedProject, setSelectedProject } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

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
    return selectedProject === p.project_path || selectedProject === p.short_path;
  };

  const handleSelect = (p: typeof projects[0]) => {
    if (isSelected(p)) {
      setSelectedProject(null);
    } else {
      setSelectedProject(p.project_path);
    }
    // Always navigate to home when selecting a project
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const handleAllSessions = () => {
    setSelectedProject(null);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const SidebarButton = ({
    active,
    onClick,
    children,
    count,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    count: number;
  }) => (
    <button
      onClick={onClick}
      className="w-full text-left px-2.5 py-1.5 text-xs rounded transition-all flex items-center gap-2 group"
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
      <span className="truncate flex-1">{children}</span>
      <span className="tabular-nums shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
        {count}
      </span>
    </button>
  );

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
      <button
        onClick={handleAllSessions}
        className="flex items-center gap-2.5 px-4 py-3.5 border-b hover:bg-[var(--bg-hover)] transition-colors text-left w-full"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#34d399" }} />
        <span className="font-semibold text-sm tracking-tight" style={{ color: "var(--text-primary)" }}>
          keddy
        </span>
        {stats && (
          <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
            {stats.total_sessions}
          </span>
        )}
      </button>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 pb-1">
          <SidebarButton active={selectedProject === null} onClick={handleAllSessions} count={stats?.total_sessions || 0}>
            All Sessions
          </SidebarButton>
        </div>

        {/* Organizations */}
        {Array.from(byOrg.entries()).map(([org, orgProjects]) => (
          <div key={org} className="px-3 mt-4">
            <div
              className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: "var(--text-tertiary)", fontSize: 10 }}
            >
              <span style={{ opacity: 0.4 }}>&#9656;</span>
              {org}
            </div>
            {orgProjects.map((p) => (
              <SidebarButton key={p.project_path} active={isSelected(p)} onClick={() => handleSelect(p)} count={p.session_count}>
                {p.repo}
              </SidebarButton>
            ))}
          </div>
        ))}

        {/* Personal repos */}
        {personalRepos.length > 0 && (
          <div className="px-3 mt-4">
            <div
              className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider flex items-center gap-1.5"
              style={{ color: "var(--text-tertiary)", fontSize: 10 }}
            >
              <span style={{ opacity: 0.4 }}>&#9656;</span>
              Repositories
            </div>
            {personalRepos.map((p) => (
              <SidebarButton key={p.project_path} active={isSelected(p)} onClick={() => handleSelect(p)} count={p.session_count}>
                {p.repo}
              </SidebarButton>
            ))}
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
