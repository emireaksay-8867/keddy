import type { GitDetail } from "../../lib/types.js";

interface GitSectionProps {
  gitDetails: GitDetail[];
  testStatus: { passing: boolean; description: string; exchange_index: number } | null;
  onViewDetail: (detail: GitDetail) => void;
}

const TYPE_CONFIG: Record<string, { symbol: string; color: string }> = {
  commit: { symbol: "\u25CF", color: "#818cf8" },
  push: { symbol: "\u2191", color: "#60a5fa" },
  pull: { symbol: "\u2193", color: "#a78bfa" },
  pr: { symbol: "\u2442", color: "#34d399" },
  branch: { symbol: "\u2443", color: "#fbbf24" },
};

export function GitSection({ gitDetails, testStatus, onViewDetail }: GitSectionProps) {
  if (gitDetails.length === 0 && !testStatus) return null;

  return (
    <div className="mb-6">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Git</div>

      <div className="flex flex-col gap-3">
        {gitDetails.map((d, i) => {
          const config = TYPE_CONFIG[d.type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
          return (
            <div key={i} className="text-[12px]">
              <div className="flex items-start gap-2">
                <span style={{ color: config.color }}>{config.symbol}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span style={{ color: "var(--text-primary)" }}>{d.description}</span>
                    {d.hash && (
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>#{d.hash}</span>
                    )}
                  </div>
                  {d.stats && (
                    <div className="mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {d.stats.files_changed} file{d.stats.files_changed !== 1 ? "s" : ""} changed
                      {d.stats.insertions > 0 && <span style={{ color: "#10b981" }}> +{d.stats.insertions}</span>}
                      {d.stats.deletions > 0 && <span style={{ color: "#ef4444" }}> -{d.stats.deletions}</span>}
                    </div>
                  )}
                  {d.files && d.files.length > 0 && (
                    <div className="mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {d.files.map(f => f.split("/").pop()).join(" \u00B7 ")}
                    </div>
                  )}
                  {d.push_range && (
                    <div className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {d.push_range}
                      {d.push_branch && <span> {d.push_branch}</span>}
                    </div>
                  )}
                </div>
                <button
                  className="text-[11px] px-1.5 py-0.5 shrink-0 hover:underline"
                  style={{ color: "var(--text-muted)" }}
                  onClick={() => onViewDetail(d)}
                >view</button>
              </div>
            </div>
          );
        })}

        {/* Test status — final state */}
        {testStatus && (
          <div className="flex items-center gap-2 text-[12px]">
            <span style={{ color: testStatus.passing ? "#10b981" : "#ef4444" }}>
              {testStatus.passing ? "\u2713" : "\u2717"}
            </span>
            <span style={{ color: testStatus.passing ? "var(--text-tertiary)" : "#ef4444" }}>
              {testStatus.description}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
