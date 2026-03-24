import { useState } from "react";
import type { Plan, Task } from "../../lib/types.js";

interface PlanSectionProps {
  plans: Plan[];
  tasks: Task[];
  sessionExchangeCount: number;
  onViewPlan: (plan: Plan) => void;
}

function fmtTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

function extractTitle(planText: string): string {
  if (!planText) return "(drafting...)";
  for (const line of planText.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) {
      return t.replace(/^#+\s*/, "").replace(/^Plan:\s*/i, "");
    }
  }
  return planText.split("\n").find(l => l.trim().length > 3)?.trim().substring(0, 80) || "Untitled plan";
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + "..." : s;
}

/** Status dot color — the only color on the container */
function statusDotColor(status: string): string {
  if (status === "approved" || status === "implemented") return "#10b981";
  if (status === "drafted" || status === "revised") return "#f59e0b";
  if (status === "rejected") return "#ef4444";
  return "var(--text-muted)";
}

/** Derive UX label for previous versions */
function deriveLabel(
  plan: Plan,
  nextVersion: Plan | null,
  isLast: boolean,
  exchangesAfter: boolean,
): { label: string; color: string; arrow?: string; showFeedback: boolean } {
  const status = plan.status;
  if (status === "drafted") {
    return { label: isLast && !exchangesAfter ? "Drafting" : "Draft — session ended", color: "#f59e0b", showFeedback: false };
  }
  if ((status === "approved" || status === "implemented") && isLast) {
    return { label: status === "implemented" ? "Implemented — current" : "Approved — current", color: "#10b981", showFeedback: false };
  }
  if ((status === "approved" || status === "implemented" || status === "superseded") && nextVersion) {
    return { label: "Approved", color: "var(--text-muted)", arrow: `V${nextVersion.version}`, showFeedback: false };
  }
  if (status === "revised" && nextVersion) {
    return { label: "Revised", color: "#f59e0b", arrow: `V${nextVersion.version}`, showFeedback: true };
  }
  if (status === "revised" && !nextVersion) {
    return { label: exchangesAfter ? "Revised — no new plan" : "Revised — session ended", color: "#f59e0b", showFeedback: true };
  }
  if (status === "rejected" && nextVersion) {
    return { label: "Rejected", color: "#ef4444", arrow: `V${nextVersion.version}`, showFeedback: false };
  }
  if (status === "rejected" && !nextVersion) {
    return { label: exchangesAfter ? "Rejected — continued without plan" : "Rejected — session ended", color: "#ef4444", showFeedback: false };
  }
  return { label: status, color: "var(--text-muted)", showFeedback: false };
}

/** Current plan status label text */
function currentStatusLabel(status: string, exchangesAfter: boolean): string {
  if (status === "drafted") return exchangesAfter ? "Draft — session ended" : "Drafting";
  if (status === "implemented") return "Implemented";
  if (status === "approved") return "Approved";
  if (status === "rejected") return exchangesAfter ? "Rejected — continued without plan" : "Rejected";
  if (status === "revised") return exchangesAfter ? "Revised — no new plan" : "Revised";
  return status;
}

export function PlanSection({ plans, tasks, sessionExchangeCount, onViewPlan }: PlanSectionProps) {
  if (plans.length === 0) return null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState<Record<number, boolean>>({});
  const [feedbackExpanded, setFeedbackExpanded] = useState<Record<number, boolean>>({});

  // Current = last approved/implemented/drafted, fallback to last plan
  const current = [...plans].reverse().find(p =>
    p.status === "approved" || p.status === "implemented" || p.status === "drafted"
  ) || plans[plans.length - 1];

  const currentTitle = extractTitle(current.plan_text);
  const dotColor = statusDotColor(current.status);
  const previousVersions = plans.filter(p => p.version !== current.version);
  const hasHistory = previousVersions.length > 0;
  const exchangesAfter = current.exchange_index_end < sessionExchangeCount - 1;
  const currentLabel = currentStatusLabel(current.status, exchangesAfter);

  const currentRange = current.exchange_index_start === current.exchange_index_end
    ? `#${current.exchange_index_start}`
    : `#${current.exchange_index_start}-${current.exchange_index_end}`;

  // Tasks
  const planTasks = tasks.filter(t => t.status !== undefined);
  const completedTasks = planTasks.filter(t => t.status === "completed");

  return (
    <div className="mb-4">
      <div className="rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "var(--bg-surface)" }}>

        {/* Main: dot + Plan label + title | metadata right */}
        <div className="px-4 py-3">
          <div className="flex gap-3">
            {/* Left: dot + label + title */}
            <div className="flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full inline-flex items-center gap-1.5" style={{ color: dotColor, background: `${dotColor}10`, border: `1px solid ${dotColor}30` }}>
                    <span style={{ color: "var(--text-muted)" }}>Plan</span>
                    <span style={{ width: 1, height: 10, background: `${dotColor}30` }} />
                    {currentLabel}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{fmtTime(current.ended_at || current.started_at || current.created_at)}</span>
                </div>
                <p className="text-[13px] font-medium font-mono" style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                  {currentTitle}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  {hasHistory && (
                    <button
                      className="text-[12px] hover:underline transition-colors"
                      style={{ color: "var(--text-tertiary)" }}
                      onClick={() => setHistoryOpen(!historyOpen)}
                    >
                      <span style={{ fontSize: 10, display: "inline-block", transform: historyOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", marginRight: 4 }}>{"\u25B6"}</span>
                      {previousVersions.length} previous version{previousVersions.length !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right: view button */}
            {current.plan_text && (
              <div className="flex items-center shrink-0">
                <button
                  className="text-[12px] px-3 py-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                  style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                  onClick={() => onViewPlan(current)}
                >View plan</button>
              </div>
            )}
          </div>
        </div>

        {/* Tasks */}
        {planTasks.length > 0 && (
          <div className="px-4 pb-3 ml-[18px]">
            <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              Tasks {completedTasks.length}/{planTasks.length} completed
            </div>
            <div className="flex flex-col gap-0.5">
              {planTasks.map((t, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[11px] font-mono" style={{ letterSpacing: "-0.02em" }}>
                  <span style={{ color: t.status === "completed" ? "#10b981" : "var(--text-muted)" }}>
                    {t.status === "completed" ? "\u2713" : "\u25CB"}
                  </span>
                  <span style={{ color: t.status === "completed" ? "var(--text-tertiary)" : "var(--text-secondary)" }}>
                    {t.subject}
                  </span>
                  {t.exchange_created != null && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      #{t.exchange_created}{t.exchange_completed != null ? ` \u2192 #${t.exchange_completed}` : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Previous versions — expanded when toggled from status line */}
        {hasHistory && historyOpen && (
          <div className="px-4 pb-3 ml-[18px]">
            {previousVersions.map(p => {
              const nextVersion = plans.find(pp => pp.version === p.version + 1) || null;
              const isLast = p.version === plans[plans.length - 1].version;
              const exAfter = p.exchange_index_end < sessionExchangeCount - 1;
              const { label, color, arrow, showFeedback } = deriveLabel(p, nextVersion, isLast, exAfter);
              const title = extractTitle(p.plan_text);
              const time = fmtTime(p.ended_at || p.started_at || p.created_at);

              return (
                <div key={p.version} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full" style={{ width: 6, height: 6, border: "1.5px solid var(--text-muted)", background: "transparent" }} />
                    <span className="font-mono font-medium text-[11px] shrink-0" style={{ color: "var(--text-muted)", letterSpacing: "-0.02em" }}>V{p.version}</span>
                    <span className="font-mono text-[12px] font-medium min-w-0 truncate" style={{ color: "var(--text-tertiary)", letterSpacing: "-0.02em" }}>{title}</span>
                    <div className="flex-1" />
                    <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>{time}</span>
                    {p.plan_text && (
                      <button className="shrink-0 text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-tertiary)", border: "1px solid var(--border)" }} onClick={() => onViewPlan(p)}>view</button>
                    )}
                  </div>
                  {/* Status + feedback toggle on same line */}
                  <div className="mt-1 ml-[8px] flex items-center gap-2">
                    {(p.status === "rejected") && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[2px] rounded-full" style={{ color: "#ef4444", background: "#ef444415", border: "1px solid #ef444430" }}>Rejected</span>
                    )}
                    {(p.status === "revised") && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[2px] rounded-full" style={{ color: "#f59e0b", background: "#f59e0b15", border: "1px solid #f59e0b30" }}>Revised</span>
                    )}
                    {(p.status === "superseded" || (p.status === "approved" && !isLast)) && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[2px] rounded-full" style={{ color: "#60a5fa", background: "#60a5fa15", border: "1px solid #60a5fa30" }}>Replaced</span>
                    )}
                    {showFeedback && p.user_feedback && (
                      <button
                        className="text-[10px] hover:underline transition-colors"
                        style={{ color: "var(--text-muted)" }}
                        onClick={() => setFeedbackOpen(prev => ({ ...prev, [p.version]: !prev[p.version] }))}
                      >
                        <span style={{ fontSize: 8, display: "inline-block", transform: feedbackOpen[p.version] ? "rotate(90deg)" : "none", transition: "transform 0.15s", marginRight: 3 }}>{"\u25B6"}</span>
                        Feedback
                      </button>
                    )}
                  </div>
                  {showFeedback && p.user_feedback && feedbackOpen[p.version] && (
                    <div className="mt-2 ml-[8px]">
                      <div className="px-3 py-2 rounded-lg text-[12px] leading-relaxed" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", maxHeight: feedbackExpanded[p.version] ? "none" : 80, overflow: "hidden" }}>
                        {p.user_feedback}
                      </div>
                      {p.user_feedback.length > 200 && !feedbackExpanded[p.version] && (
                        <button
                          className="text-[10px] mt-1 hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          onClick={() => setFeedbackExpanded(prev => ({ ...prev, [p.version]: true }))}
                        >Show full</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
