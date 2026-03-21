import { Link } from "react-router";
import type { SessionListItem } from "../lib/types.js";
import { SEGMENT_COLORS } from "../lib/constants.js";

interface SessionCardProps {
  session: SessionListItem;
}

function SegmentBar({ segments, total }: { segments: SessionListItem["segments"]; total: number }) {
  if (segments.length === 0 || total === 0) return null;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--color-border)]">
      {segments.map((seg, i) => {
        const width = ((seg.end - seg.start + 1) / total) * 100;
        return (
          <div
            key={i}
            style={{
              width: `${Math.max(width, 2)}%`,
              backgroundColor: SEGMENT_COLORS[seg.type] || "#6B7280",
            }}
            title={seg.type}
          />
        );
      })}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
  if (diffHours < 48) return "yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SessionCard({ session }: SessionCardProps) {
  const title = session.title || session.session_id.substring(0, 16);
  const project = session.project_path.split("/").slice(-2).join("/");

  return (
    <Link
      to={`/sessions/${session.session_id}`}
      className="block p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-medium text-sm truncate flex-1">{title}</h3>
        <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
          {formatDate(session.started_at)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)] mb-3">
        <span>{project}</span>
        {session.git_branch && (
          <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)]">
            {session.git_branch}
          </span>
        )}
        <span>{session.exchange_count} exchanges</span>
        {session.milestone_count > 0 && <span>{session.milestone_count} milestones</span>}
      </div>

      <SegmentBar segments={session.segments} total={session.exchange_count} />
    </Link>
  );
}
