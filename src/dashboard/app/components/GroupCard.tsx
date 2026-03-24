interface GroupCardProps {
  group: {
    exchange_start: number;
    exchange_end: number;
    exchange_count: number;
    started_at: string | null;
    ended_at: string | null;
    tool_counts: Record<string, number>;
    error_count: number;
    files_read: string[];
    files_written: string[];
    total_input_tokens: number;
    total_output_tokens: number;
    duration_ms: number;
    models: string[];
    markers: Array<{ exchange_index: number; type: string; label: string }>;
    boundary: string;
    ai_summary: string | null;
    ai_label: string | null;
  };
  onClick?: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function densityDot(toolCounts: Record<string, number>, boundary: string): string {
  if (boundary === "plan_enter" || boundary === "plan_exit") return "\u25C8"; // ◈
  const totalTools = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  return totalTools > 0 ? "\u25C9" : "\u25CB"; // ◉ or ○
}

// Aggregate file edits from files_written (may have duplicates = multiple edits)
function aggregateFiles(files: string[]): Array<{ name: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const short = f.split("/").pop() || f;
    counts[short] = (counts[short] || 0) + 1;
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));
}

const MARKER_CONFIG: Record<string, { symbol: string; color: string }> = {
  plan_enter: { symbol: "\u2191 plan", color: "#34d399" },
  plan_exit: { symbol: "\u2193 plan", color: "#34d399" },
  commit: { symbol: "\u25CF", color: "#818cf8" },
  test_pass: { symbol: "\u2713", color: "#10b981" },
  test_fail: { symbol: "\u2717", color: "#ef4444" },
  skill: { symbol: "/", color: "#60a5fa" },
  subagent: { symbol: "\uD83D\uDD00", color: "#a78bfa" },
  web_research: { symbol: "\uD83D\uDD0D", color: "#f97316" },
};

export function GroupCard({ group, onClick }: GroupCardProps) {
  const totalTokens = group.total_input_tokens + group.total_output_tokens;
  const toolEntries = Object.entries(group.tool_counts).filter(([, count]) => count > 0);
  const fileAgg = aggregateFiles(group.files_written);
  const maxFiles = 5;

  return (
    <div
      className="px-4 py-3 rounded-lg cursor-pointer transition-colors"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-bright)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--text-tertiary)", fontSize: "12px" }}>
          {densityDot(group.tool_counts, group.boundary)}
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {group.exchange_count} exchange{group.exchange_count !== 1 ? "s" : ""}
          {" \u00B7 "}
          {formatDuration(group.duration_ms)}
          {" \u00B7 "}
          {formatTokens(totalTokens)} tokens
        </span>
        <div className="flex-1" />
        {group.started_at && (
          <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
            {formatTime(group.started_at)}
          </span>
        )}
      </div>

      {/* AI Summary */}
      {group.ai_summary && (
        <div
          className="mt-2 px-3 py-2 rounded-md text-xs"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ color: "var(--accent-hover)" }}>{"\u2726"} </span>
          {group.ai_summary}
        </div>
      )}

      {/* Tool breakdown */}
      {toolEntries.length > 0 && (
        <div className="mt-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
          {toolEntries.map(([name, count], i) => (
            <span key={name}>
              {i > 0 && ", "}
              {name} \u00D7{count}
            </span>
          ))}
          {group.error_count > 0 && (
            <span style={{ color: "#ef4444" }}>
              {" "}({group.error_count} error{group.error_count !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      )}

      {/* Files written */}
      {fileAgg.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {fileAgg.slice(0, maxFiles).map((f) => (
            <span
              key={f.name}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: "var(--bg-hover)",
                color: "var(--text-tertiary)",
              }}
            >
              {f.name}{f.count > 1 ? ` (${f.count} edits)` : ""}
            </span>
          ))}
          {fileAgg.length > maxFiles && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              +{fileAgg.length - maxFiles} more
            </span>
          )}
        </div>
      )}

      {/* Markers */}
      {group.markers.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-2">
          {group.markers.map((marker, i) => {
            const config = MARKER_CONFIG[marker.type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
            return (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <span style={{ color: config.color }}>{config.symbol}</span>
                <span style={{ color: config.color }}>{marker.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
