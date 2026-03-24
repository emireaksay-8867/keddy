interface ActivityStripProps {
  groups: Array<{
    exchange_start: number;
    exchange_end: number;
    exchange_count: number;
    dominant_tool_category: string;
    has_errors: boolean;
    boundary: string;
  }>;
  milestones: Array<{
    type: string;
    exchange_index: number;
    description: string;
  }>;
  totalExchanges: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  none: "#6b7280",
  read: "#60a5fa",
  edit: "#a78bfa",
  bash: "#fbbf24",
  plan: "#34d399",
  mixed: "#94a3b8",
};

const MILESTONE_SYMBOLS: Record<string, string> = {
  commit: "●",
  test_pass: "✓",
  test_fail: "✗",
  pr: "⑂",
  push: "↑",
  branch: "⑃",
};

const MILESTONE_COLORS: Record<string, string> = {
  commit: "#818cf8",
  test_pass: "#10b981",
  test_fail: "#ef4444",
  pr: "#34d399",
  push: "#60a5fa",
  branch: "#fbbf24",
};

export function ActivityStrip({ groups, milestones, totalExchanges }: ActivityStripProps) {
  if (groups.length === 0 || totalExchanges === 0) return null;

  // Map milestones to their position as a fraction of totalExchanges
  const milestonePositions = milestones.map((ms) => ({
    ...ms,
    position: (ms.exchange_index / totalExchanges) * 100,
  }));

  return (
    <div className="flex flex-col gap-1">
      {/* Activity bar */}
      <div className="flex items-center" style={{ gap: "1px", height: "6px" }}>
        {groups.map((group, i) => {
          const width = (group.exchange_count / totalExchanges) * 100;
          const color = CATEGORY_COLORS[group.dominant_tool_category] || CATEGORY_COLORS.none;

          return (
            <div
              key={i}
              className="relative rounded-sm"
              style={{
                flex: `${width} 0 0%`,
                minWidth: "4px",
                height: "6px",
                backgroundColor: color,
              }}
              title={`${group.dominant_tool_category} · ${group.exchange_count} exchanges`}
            >
              {group.has_errors && (
                <div
                  className="absolute rounded-full"
                  style={{
                    width: "4px",
                    height: "4px",
                    backgroundColor: "#ef4444",
                    top: "-2px",
                    right: "-1px",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Milestone markers */}
      {milestonePositions.length > 0 && (
        <div className="relative" style={{ height: "12px" }}>
          {milestonePositions.map((ms, i) => {
            const symbol = MILESTONE_SYMBOLS[ms.type] || "·";
            const color = MILESTONE_COLORS[ms.type] || "#6b7280";

            return (
              <span
                key={i}
                className="absolute"
                style={{
                  left: `${ms.position}%`,
                  transform: "translateX(-50%)",
                  fontSize: "9px",
                  lineHeight: "12px",
                  color,
                }}
                title={`${ms.type}: ${ms.description}`}
              >
                {symbol}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
