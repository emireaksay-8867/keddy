import { useState } from "react";
import type { Plan, Task, Milestone, GitDetail } from "../../lib/types.js";

interface PlanSectionProps {
  plans: Plan[];
  tasks: Task[];
  milestones: Milestone[];
  gitDetails: GitDetail[];
  sessionExchangeCount: number;
  forkExchangeIndex?: number | null;
  onViewPlan: (plan: Plan, compareWithText?: string) => void;
  onViewInTerminal: (exchangeIndex: number) => void;
}

function fmtTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

function extractTitle(planText: string, status?: string): string {
  if (!planText) {
    if (status === "drafted") return "In plan mode";
    return "Explored in plan mode";
  }
  for (const line of planText.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) {
      return t.replace(/^#+\s*/, "").replace(/^Plan:\s*/i, "");
    }
  }
  return planText.split("\n").find(l => l.trim().length > 3)?.trim().substring(0, 80) || "Untitled plan";
}

function getStatusLabel(status: string): string | null {
  if (status === "implemented") return "Implemented";
  if (status === "approved") return "Approved";
  if (status === "superseded") return "Approved";
  if (status === "drafted") return "In progress";
  if (status === "rejected") return "Rejected";
  return null;
}

/** Get tasks that belong to a specific plan (by exchange range) */
function getTasksForPlan(plan: Plan, allPlans: Plan[], tasks: Task[]): Task[] {
  const planEnd = plan.exchange_index_end;
  const nextPlan = allPlans.find(p => p.version > plan.version);
  const nextPlanStart = nextPlan?.exchange_index_start ?? Infinity;
  return tasks.filter(t => t.exchange_created >= planEnd && t.exchange_created < nextPlanStart);
}

/** Get rich git details for a plan (by exchange range) */
function getGitDetailsForPlan(plan: Plan, allPlans: Plan[], gitDetails: GitDetail[]): GitDetail[] {
  const planEnd = plan.exchange_index_end;
  const nextPlan = allPlans.find(p => p.version > plan.version);
  const nextPlanStart = nextPlan?.exchange_index_start ?? Infinity;
  return gitDetails.filter(gd =>
    gd.exchange_index >= planEnd && gd.exchange_index < nextPlanStart &&
    (gd.type === "commit" || gd.type === "push" || gd.type === "pr")
  );
}

// ── Grouping ─────────────────────────────────────────────

interface IterationEntry {
  plan: Plan;
  planChanged: boolean;
  nextPlanText: string;
}

interface PlanGroup {
  final: Plan;
  entries: IterationEntry[];
}

const EXCHANGE_GAP_THRESHOLD = 8;

/** Build meaningful iteration entries from raw plan iterations.
 *  Only includes entries where the user spoke (has feedback),
 *  explicitly rejected, or a revision happened across exchanges.
 *  Hides Claude's internal self-revision within a single exchange. */
function buildEntries(iterations: Plan[], final: Plan): IterationEntry[] {
  const entries: IterationEntry[] = [];
  const allPlans = [...iterations, final];

  for (let i = 0; i < iterations.length; i++) {
    const plan = iterations[i];
    const nextPlan = allPlans[i + 1];

    const hasFeedback = plan.user_feedback != null && plan.user_feedback.length > 0;
    const wasRejected = plan.status === "rejected";
    const sameExchangeAsNext = nextPlan != null && plan.exchange_index_end === nextPlan.exchange_index_end;

    // Skip Claude internal drafting: no feedback, not rejected, same exchange as next
    if (!hasFeedback && !wasRejected && sameExchangeAsNext) {
      continue;
    }

    const planChanged = nextPlan != null ? plan.plan_text !== nextPlan.plan_text : false;
    entries.push({ plan, planChanged, nextPlanText: nextPlan?.plan_text || "" });
  }

  return entries;
}

function groupPlans(plans: Plan[]): PlanGroup[] {
  if (plans.length === 0) return [];

  const groups: PlanGroup[] = [];
  let currentBatch: Plan[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const isLast = i === plans.length - 1;

    // Exchange gap: different topic — close current group
    if (currentBatch.length > 0) {
      const prevPlan = currentBatch[currentBatch.length - 1];
      const gap = plan.exchange_index_start - prevPlan.exchange_index_end;
      if (gap > EXCHANGE_GAP_THRESHOLD) {
        const last = currentBatch[currentBatch.length - 1];
        const rest = currentBatch.slice(0, -1);
        groups.push({ final: last, entries: buildEntries(rest, last) });
        currentBatch = [];
      }
    }

    if (plan.status === "rejected" || plan.status === "revised") {
      currentBatch.push(plan);
    } else if (plan.status === "drafted" && !isLast) {
      currentBatch.push(plan);
    } else if (plan.status === "approved" || plan.status === "implemented" || plan.status === "superseded") {
      groups.push({ final: plan, entries: buildEntries(currentBatch, plan) });
      currentBatch = [];
    } else if (plan.status === "drafted" && isLast) {
      groups.push({ final: plan, entries: buildEntries(currentBatch, plan) });
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    const last = currentBatch[currentBatch.length - 1];
    const rest = currentBatch.slice(0, -1);
    groups.push({ final: last, entries: buildEntries(rest, last) });
  }

  return groups;
}

// ── Expandable Feedback ────────────────────────────────────

const FEEDBACK_PREVIEW_LEN = 140;

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > FEEDBACK_PREVIEW_LEN;
  const display = expanded || !isLong ? text : text.substring(0, FEEDBACK_PREVIEW_LEN);

  return (
    <div
      className={`text-[11.5px] leading-[1.6] ${isLong ? "cursor-pointer" : ""}`}
      style={{ color: "var(--text-secondary)" }}
      onClick={isLong ? () => setExpanded(!expanded) : undefined}
    >
      {display}
      {isLong && !expanded && <span style={{ color: "var(--text-muted)" }}> ...</span>}
    </div>
  );
}

// ── Git Detail Item ────────────────────────────────────────

function GitItem({ gd, expanded, onToggle }: { gd: GitDetail; expanded: boolean; onToggle: () => void }) {
  const isCommit = gd.type === "commit";
  const isPush = gd.type === "push";
  const isPr = gd.type === "pr";

  const symbol = isCommit ? "\u25CF" : isPush ? "\u2191" : isPr ? "\u2442" : "\u00B7";
  const symbolColor = isCommit ? "#818cf8" : isPush ? "#60a5fa" : isPr ? "#34d399" : "var(--text-tertiary)";

  const shortHash = isCommit && gd.hash ? gd.hash.substring(0, 7) : null;
  const hasExpandable = isCommit && (gd.files?.length || gd.stats);

  return (
    <div>
      <div
        className={`text-[11px] flex items-center gap-1.5 ${hasExpandable ? "cursor-pointer hover:bg-[var(--bg-hover)] -mx-1 px-1 rounded" : ""}`}
        style={{ color: "var(--text-tertiary)" }}
        onClick={hasExpandable ? onToggle : undefined}
      >
        <span style={{ color: symbolColor }}>{symbol}</span>
        {shortHash && (
          <span className="font-mono" style={{ color: "var(--text-muted)" }}>{shortHash}</span>
        )}
        <span className="flex-1 min-w-0 truncate">{gd.description}</span>
        {gd.url && (
          <a
            href={gd.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 hover:text-[var(--text-secondary)] transition-colors"
            style={{ color: "var(--text-muted)" }}
            onClick={(e) => e.stopPropagation()}
            title="Open on GitHub"
          >{"\u2197"}</a>
        )}
      </div>
      {expanded && isCommit && (
        <div className="ml-5 mt-0.5 mb-1">
          {gd.stats && (
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {gd.stats.files_changed} file{gd.stats.files_changed !== 1 ? "s" : ""} changed
              {gd.stats.insertions > 0 && <span style={{ color: "#10b981" }}> +{gd.stats.insertions}</span>}
              {gd.stats.deletions > 0 && <span style={{ color: "#ef4444" }}> &minus;{gd.stats.deletions}</span>}
            </div>
          )}
          {gd.files && gd.files.length > 0 && (
            <div className="flex flex-col mt-0.5">
              {gd.files.map((f, i) => (
                <div key={i} className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)", letterSpacing: "-0.02em" }}>
                  <span style={{ color: "var(--text-muted)" }}>{i < gd.files!.length - 1 ? "\u251C\u2500 " : "\u2514\u2500 "}</span>
                  {f.split("/").pop()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Plan Group Card ────────────────────────────────────────

function PlanGroupCard({
  group, allPlans, tasks, gitDetails, onViewPlan, onViewInTerminal,
}: {
  group: PlanGroup;
  allPlans: Plan[];
  tasks: Task[];
  gitDetails: GitDetail[];
  onViewPlan: (plan: Plan, compareWithText?: string) => void;
  onViewInTerminal: (exchangeIndex: number) => void;
}) {
  const [tasksOpen, setTasksOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedCommits, setExpandedCommits] = useState<Set<number>>(new Set());

  const { final, entries } = group;
  const title = extractTitle(final.plan_text, final.status);
  const statusLabel = getStatusLabel(final.status);
  const planTasks = getTasksForPlan(final, allPlans, tasks);
  const completedTasks = planTasks.filter(t => t.status === "completed");
  const planGitDetails = getGitDetailsForPlan(final, allPlans, gitDetails);
  const time = fmtTime(final.ended_at || final.started_at || final.created_at);

  const toggleCommit = (idx: number) => {
    setExpandedCommits(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const hasEntries = entries.length > 0;

  return (
    <div className="rounded-lg mb-3" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "var(--bg-surface)" }}>
      {/* ── Main plan ── */}
      <div className="px-4 py-3">
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Plan</span>
              {statusLabel && (
                <>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u00B7"}</span>
                  <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>{statusLabel}</span>
                </>
              )}
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u00B7"}</span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{time}</span>
            </div>
            <p className="text-[13px] font-medium font-mono" style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              {title}
            </p>
          </div>
          <div className="flex items-start shrink-0 pt-0.5 gap-2">
            {final.plan_text && (
              <button
                className="text-[12px] px-3 py-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                onClick={() => onViewPlan(final)}
              >View plan</button>
            )}
            <button
              className="text-[11px] py-1.5 hover:underline"
              style={{ color: "var(--text-muted)" }}
              onClick={() => onViewInTerminal(final.plan_text ? final.exchange_index_end : final.exchange_index_start)}
            >View in terminal</button>
          </div>
        </div>
      </div>

      {/* Tasks */}
      {planTasks.length > 0 && (
        <div className="px-4 pb-3">
          <button
            className="text-[11px] font-medium mb-1 hover:underline"
            style={{ color: "var(--text-muted)" }}
            onClick={() => setTasksOpen(!tasksOpen)}
          >
            <span style={{ fontSize: 9, display: "inline-block", transform: tasksOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", marginRight: 4 }}>{"\u25B6"}</span>
            Tasks {completedTasks.length}/{planTasks.length} completed
          </button>
          {tasksOpen && (
            <div className="flex flex-col gap-0.5 ml-3">
              {planTasks.map((t, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[11px] font-mono" style={{ letterSpacing: "-0.02em" }}>
                  <span style={{ color: t.status === "completed" ? "#10b981" : "var(--text-muted)" }}>
                    {t.status === "completed" ? "\u2713" : "\u25CB"}
                  </span>
                  <span style={{ color: t.status === "completed" ? "var(--text-tertiary)" : "var(--text-secondary)" }}>
                    {t.subject}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Git details */}
      {planGitDetails.length > 0 && (
        <div className="px-4 pb-3 flex flex-col gap-0.5">
          {planGitDetails.map((gd, i) => (
            <GitItem
              key={i}
              gd={gd}
              expanded={expandedCommits.has(i)}
              onToggle={() => toggleCommit(i)}
            />
          ))}
        </div>
      )}

      {/* ── Iteration thread ── */}
      {hasEntries && (
        <div className="px-4 pb-3">
          <button
            className="text-[11px] font-medium mb-1 hover:underline"
            style={{ color: "var(--text-muted)" }}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <span style={{ fontSize: 9, display: "inline-block", transform: historyOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", marginRight: 4 }}>{"\u25B6"}</span>
            {entries.length} {entries.length === 1 ? "revision" : "revisions"}
          </button>
          {historyOpen && (
            <div className="mt-2 flex flex-col gap-2">
              {entries.map((entry, idx) => {
                const { plan, planChanged } = entry;
                const hasFeedback = plan.user_feedback != null && plan.user_feedback.length > 0;

                return (
                  <div key={idx} className="rounded-md px-3 py-2"
                    style={{ background: "var(--bg-elevated)", border: "1px solid rgba(255,255,255,0.04)" }}>

                    {hasFeedback ? (
                      // User spoke — show feedback + result
                      <>
                        <div className="mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>You: </span>
                        </div>
                        <ExpandableText text={plan.user_feedback!} />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {"\u2192"} {planChanged ? "Plan updated" : "Plan unchanged"}
                          </span>
                          <div className="flex items-center gap-2">
                            {planChanged && plan.plan_text && (
                              <button
                                className="text-[11px] px-2 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                                style={{ color: "var(--text-tertiary)", border: "1px solid var(--border)" }}
                                onClick={() => onViewPlan(plan, entry.nextPlanText)}
                              >View</button>
                            )}
                            <button
                              className="text-[10px] hover:underline"
                              style={{ color: "var(--text-muted)" }}
                              onClick={() => onViewInTerminal(plan.exchange_index_end)}
                            >{"\u2197"}</button>
                          </div>
                        </div>
                      </>
                    ) : plan.status === "rejected" ? (
                      // Rejected without feedback text
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Plan rejected</span>
                        <button
                          className="text-[10px] hover:underline"
                          style={{ color: "var(--text-muted)" }}
                          onClick={() => onViewInTerminal(plan.exchange_index_end)}
                        >{"\u2197"}</button>
                      </div>
                    ) : (
                      // No feedback, different exchange — something caused a revision
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Plan revised</span>
                        <div className="flex items-center gap-2">
                          {planChanged && plan.plan_text && (
                            <button
                              className="text-[11px] px-2 py-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
                              style={{ color: "var(--text-tertiary)", border: "1px solid var(--border)" }}
                              onClick={() => onViewPlan(plan, entry.nextPlanText)}
                            >View</button>
                          )}
                          <button
                            className="text-[10px] hover:underline"
                            style={{ color: "var(--text-muted)" }}
                            onClick={() => onViewInTerminal(plan.exchange_index_end)}
                          >{"\u2197"}</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export function PlanSection({ plans, tasks, milestones, gitDetails, sessionExchangeCount, forkExchangeIndex, onViewPlan, onViewInTerminal }: PlanSectionProps) {
  if (plans.length === 0) return null;

  // Filter out inherited plans (from parent session) and empty drafted plans (abandoned plan mode)
  const relevantPlans = (forkExchangeIndex != null
    ? plans.filter(p => p.exchange_index_end >= forkExchangeIndex)
    : plans
  ).filter(p => !(p.status === "drafted" && !p.plan_text));

  const relevantTasks = forkExchangeIndex != null
    ? tasks.filter(t => t.exchange_created >= forkExchangeIndex)
    : tasks;

  if (relevantPlans.length === 0) return null;

  const groups = groupPlans(relevantPlans);

  return (
    <div className="mb-4">
      {groups.map((group, i) => (
        <PlanGroupCard
          key={i}
          group={group}
          allPlans={relevantPlans}
          tasks={relevantTasks}
          gitDetails={gitDetails}
          onViewPlan={onViewPlan}
          onViewInTerminal={onViewInTerminal}
        />
      ))}
    </div>
  );
}
