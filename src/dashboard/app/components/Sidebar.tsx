import { Link, useLocation, useNavigate } from "react-router";
import { useAppContext } from "../App.js";

export function Sidebar() {
  const { projects, stats, selectedProject, setSelectedProject } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  const orgRepos = projects.filter((p) => p.org && p.org !== "");
  const personalRepos = projects.filter((p) => !p.org || p.org === "");
  const byOrg = new Map<string, typeof projects>();
  for (const p of orgRepos) {
    if (!byOrg.has(p.org)) byOrg.set(p.org, []);
    byOrg.get(p.org)!.push(p);
  }

  const isSelected = (p: typeof projects[0]) =>
    selectedProject === p.project_path || selectedProject === p.short_path;

  const select = (p: typeof projects[0] | null) => {
    setSelectedProject(p ? (isSelected(p) ? null : p.project_path) : null);
    if (location.pathname !== "/") navigate("/");
  };

  const Item = ({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) => (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-[6px] text-[13px] rounded-md transition-all flex items-center gap-2"
      style={{
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "var(--accent-dim)" : undefined,
        fontWeight: active ? 500 : 400,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? "var(--accent-dim)" : "transparent"; }}
    >
      <span className="truncate flex-1">{label}</span>
      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{count}</span>
    </button>
  );

  return (
    <aside className="flex flex-col border-r h-full shrink-0 select-none" style={{ width: 250, background: "var(--bg-surface)", borderColor: "var(--border)" }}>
      {/* Logo */}
      <button onClick={() => select(null)} className="flex items-center gap-2.5 px-4 py-3 border-b hover:bg-[var(--bg-hover)] transition-colors text-left w-full" style={{ borderColor: "var(--border)" }}>
        <div className="w-2 h-2 rounded-full" style={{ background: "var(--claude-accent)" }} />
        <span className="font-semibold text-[15px]">keddy</span>
        {stats && <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>{stats.total_sessions}</span>}
      </button>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        <Item active={selectedProject === null} onClick={() => select(null)} label="All Sessions" count={stats?.total_sessions || 0} />

        {Array.from(byOrg.entries()).map(([org, ps]) => (
          <div key={org} className="mt-4">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {org}
            </div>
            {ps.map((p) => <Item key={p.project_path} active={isSelected(p)} onClick={() => select(p)} label={p.repo} count={p.session_count} />)}
          </div>
        ))}

        {personalRepos.length > 0 && (
          <div className="mt-4">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Personal
            </div>
            {personalRepos.map((p) => <Item key={p.project_path} active={isSelected(p)} onClick={() => select(p)} label={p.repo} count={p.session_count} />)}
          </div>
        )}
      </div>

      <div className="border-t px-4 py-2.5 flex items-center" style={{ borderColor: "var(--border)" }}>
        <Link to="/settings" className="text-xs hover:text-[var(--text-primary)] transition-colors" style={{ color: location.pathname === "/settings" ? "var(--text-primary)" : "var(--text-muted)" }}>
          Settings
        </Link>
        {stats && <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>{stats.db_size_mb} MB</span>}
      </div>
    </aside>
  );
}
