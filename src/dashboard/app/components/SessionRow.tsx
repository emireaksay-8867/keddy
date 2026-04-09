import { Link } from "react-router";
import type { SessionListItem } from "../lib/types.js";
import {
  FileText,
  ArrowUp,
  ArrowDown,
  GitPullRequest,
  GitCommitHorizontal,
  GitBranch,
  Split,
} from "lucide-react";

export function resolveRepoName(projectPath: string): string {
  const parts = projectPath.split("/");
  const wtIdx = parts.indexOf("worktrees");
  if (wtIdx >= 0 && wtIdx + 1 < parts.length) return parts[wtIdx + 1];
  return parts[parts.length - 1] || projectPath;
}

export function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Factual session chips — shows what actually happened based on observable data */
export function SessionChips({ session }: { session: SessionListItem }) {
  const pills: Array<{ icon: typeof ArrowUp; label: string; iconColor: string }> = [];
  const outcomes = session.outcomes;

  // Branch — always first chip
  if (session.git_branch) {
    pills.push({ icon: GitBranch, label: session.git_branch, iconColor: "#71717a" });
  }

  // Plan — simple indicator
  if (session.latest_plan) {
    pills.push({ icon: FileText, label: "plan", iconColor: "#6dab7a" });
  }

  // Committed (only if no push/pull) — uses custom dot, not an icon
  const hasCommitOnly = outcomes?.has_commits && (!outcomes.git_ops || outcomes.git_ops.length === 0);

  // Push/pull in chronological order
  if (outcomes?.git_ops) {
    for (const op of outcomes.git_ops) {
      if (op === "push") {
        pills.push({ icon: ArrowUp, label: "pushed", iconColor: "#60a5fa" });
      } else {
        pills.push({ icon: ArrowDown, label: "pulled", iconColor: "#a78bfa" });
      }
    }
  }

  // PR
  if (outcomes?.has_pr) {
    pills.push({ icon: GitPullRequest, label: "PR", iconColor: "#34d399" });
  }

  // Forked
  if (session.parent_title) {
    const short = session.parent_title!.length > 25 ? session.parent_title!.substring(0, 25) + "…" : session.parent_title;
    pills.push({ icon: Split, label: `forked: ${short}`, iconColor: "#a78bfa" });
  }

  if (!hasCommitOnly && pills.length === 0) return null;

  // Branch pill is always first in pills array — render it separately with mono font
  const branchPill = session.git_branch ? pills.shift() : null;

  return (
    <span className="inline-flex items-center gap-x-2 gap-y-1 min-w-0 flex-wrap">
      {/* Branch pill — monospace, first position */}
      {branchPill && (
        <span
          className="inline-flex items-center justify-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none font-mono"
          style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}
        >
          <GitBranch size={11} className="shrink-0" style={{ color: branchPill.iconColor }} />
          <span style={{ lineHeight: 1 }}>{branchPill.label}</span>
        </span>
      )}
      {/* Committed pill */}
      {hasCommitOnly && (
        <span
          className="inline-flex items-center justify-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none"
          style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}
        >
          <GitCommitHorizontal size={11} className="shrink-0" style={{ color: "#818cf8" }} />
          <span style={{ lineHeight: 1 }}>committed</span>
        </span>
      )}
      {/* Action pills — rounded containers */}
      {pills.map((pill, i) => {
        const Icon = pill.icon;
        return (
          <span
            key={i}
            className="inline-flex items-center justify-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}
          >
            <Icon size={11} className="shrink-0" style={{ color: pill.iconColor }} />
            <span style={{ lineHeight: 1 }}>{pill.label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function SessionRow({
  session,
  showProject,
  repoName,
  isLast,
}: {
  session: SessionListItem;
  showProject: boolean;
  repoName: string;
  isLast: boolean;
}) {
  const title = session.title || session.session_id.substring(0, 20);
  const lastActivity = session.ended_at || session.started_at;

  return (
    <Link
      to={`/sessions/${session.session_id}`}
      className={`block px-5 py-2 transition-colors hover:bg-[var(--bg-hover)]`}
      style={{ borderBottom: isLast ? "1px solid transparent" : "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex gap-2">
        {/* Left: Title + Factual chips */}
        <div className="flex-1 min-w-0">
          <p
            className="text-[13px] font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </p>
          <div className="mt-1" style={{ minHeight: 20 }}>
            <SessionChips session={session} />
          </div>
        </div>

        {/* Right: Repo + Time */}
        <div className="flex items-center gap-1.5 shrink-0">
          {showProject && (
            <>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {repoName}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>·</span>
            </>
          )}
          <span
            className="text-[11px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {formatRelative(lastActivity)}
          </span>
        </div>
      </div>
    </Link>
  );
}
