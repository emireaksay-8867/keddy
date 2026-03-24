import type { SessionDetail as SessionDetailType } from "../../lib/types.js";

interface OutcomesBarProps {
  session: SessionDetailType;
}

function fmtDuration(a: string, b: string | null): string {
  if (!b) return "";
  const m = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function OutcomesBar({ session }: OutcomesBarProps) {
  const items: Array<{ symbol: string; text: string; color: string }> = [];

  // Commits
  const commits = session.milestones.filter(m => m.milestone_type === "commit");
  if (commits.length > 0) {
    items.push({
      symbol: "\u25CF",
      text: commits.length === 1 ? "1 commit" : `${commits.length} commits`,
      color: "#818cf8",
    });
  }

  // Push/pull
  if (session.outcomes?.git_ops) {
    for (const op of session.outcomes.git_ops) {
      items.push({
        symbol: op === "push" ? "\u2191" : "\u2193",
        text: op === "push" ? "pushed" : "pulled",
        color: op === "push" ? "#60a5fa" : "#a78bfa",
      });
    }
  }

  // PR
  if (session.outcomes?.has_pr) {
    items.push({ symbol: "\u2442", text: "PR", color: "#34d399" });
  }

  // Test status (final state)
  if (session.test_status) {
    items.push({
      symbol: session.test_status.passing ? "\u2713" : "\u2717",
      text: session.test_status.passing ? "tests passing" : "tests failing",
      color: session.test_status.passing ? "#10b981" : "#ef4444",
    });
  }

  // Files edited
  const filesEdited = session.file_operations?.filter(f => f.edits > 0 || f.writes > 0).length || 0;
  if (filesEdited > 0) {
    items.push({
      symbol: "",
      text: `${filesEdited} file${filesEdited !== 1 ? "s" : ""} edited`,
      color: "var(--text-tertiary)",
    });
  }

  // Duration
  const duration = fmtDuration(session.started_at, session.ended_at);
  if (duration) {
    items.push({ symbol: "", text: duration, color: "var(--text-muted)" });
  }

  // Tokens
  if (session.token_summary?.total) {
    items.push({ symbol: "", text: `${fmtTokens(session.token_summary.total)} tokens`, color: "var(--text-muted)" });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px]">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1" style={{ color: item.color }}>
          {item.symbol && <span>{item.symbol}</span>}
          <span>{item.text}</span>
        </span>
      ))}
    </div>
  );
}
