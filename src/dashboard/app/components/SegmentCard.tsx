import type { Segment } from "../lib/types.js";
import { SEGMENT_COLORS, SEGMENT_LABELS } from "../lib/constants.js";

interface SegmentCardProps {
  segment: Segment;
}

export function SegmentCard({ segment }: SegmentCardProps) {
  const color = SEGMENT_COLORS[segment.segment_type] || "#6B7280";
  const label = SEGMENT_LABELS[segment.segment_type] || segment.segment_type;
  const files: string[] = JSON.parse(segment.files_touched || "[]");
  const tools: Record<string, number> = JSON.parse(segment.tool_counts || "{}");

  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center">
        <div
          className="w-3 h-3 rounded-full border-2"
          style={{ borderColor: color, backgroundColor: color }}
        />
        <div className="w-0.5 flex-1 bg-[var(--color-border)]" />
      </div>

      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {label}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            Exchanges {segment.exchange_index_start}–{segment.exchange_index_end}
          </span>
        </div>

        {segment.summary && (
          <p className="text-sm text-[var(--color-text-muted)] mb-1">{segment.summary}</p>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {files.slice(0, 5).map((f) => (
              <span
                key={f}
                className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]"
              >
                {f.split("/").pop()}
              </span>
            ))}
            {files.length > 5 && (
              <span className="text-xs text-[var(--color-text-muted)]">
                +{files.length - 5} more
              </span>
            )}
          </div>
        )}

        {Object.keys(tools).length > 0 && (
          <div className="flex gap-2 text-xs text-[var(--color-text-muted)]">
            {Object.entries(tools).map(([name, count]) => (
              <span key={name}>
                {name}: {count}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
