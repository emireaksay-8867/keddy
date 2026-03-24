import { useState, useMemo } from "react";
import type { SessionDetail, Exchange, ActivityGroupDetail, Plan } from "../../lib/types.js";
import { cleanText } from "../../lib/cleanText.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }

const BOUNDARY_COLORS: Record<string, string> = {
  plan_change: "#a78bfa",
  compaction: "#f59e0b",
  tool_shift: "#60a5fa",
  file_shift: "#10b981",
  time_gap: "#6b7280",
  session_start: "#818cf8",
};

const MS_CONFIG: Record<string, { symbol: string; color: string }> = {
  commit: { symbol: "\u25CF", color: "#818cf8" },
  push: { symbol: "\u2191", color: "#60a5fa" },
  pull: { symbol: "\u2193", color: "#a78bfa" },
  pr: { symbol: "\u2442", color: "#34d399" },
  branch: { symbol: "\u2443", color: "#fbbf24" },
  test_pass: { symbol: "\u2713", color: "#10b981" },
  test_fail: { symbol: "\u2717", color: "#ef4444" },
};

type FilterType = "all" | "prompts" | "tools" | "git" | "plans" | "errors";

// ── Exchange One-liner ─────────────────────────────────────────
function ExchangeOneLiner({ ex }: { ex: Exchange }) {
  const { cleaned: prompt } = cleanText(ex.user_prompt || "");
  const tools = ex.tool_calls || [];
  const hasErrors = tools.some(tc => !!tc.is_error);
  const time = ex.timestamp ? new Date(ex.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="py-1">
      {/* User prompt */}
      <div className="flex items-start gap-2 text-[12px]">
        <span className="shrink-0 text-[11px] w-[50px] text-right" style={{ color: "var(--text-muted)" }}>{time}</span>
        <span className="min-w-0 truncate" style={{ color: hasErrors ? "#ef4444" : "var(--text-secondary)" }}>
          "{trunc(prompt, 80)}"
        </span>
      </div>
      {/* Tool call one-liners */}
      {tools.length > 0 && (
        <div className="ml-[58px] flex flex-col gap-0.5 mt-0.5">
          {tools.slice(0, 5).map((tc, i) => {
            const isErr = !!tc.is_error;
            let label = tc.tool_name;
            if (tc.file_path) label += `  ${tc.file_path.split("/").pop()}`;
            else if (tc.bash_command) label += `  ${trunc(tc.bash_command, 50)}`;
            else if (tc.bash_desc) label += `  ${tc.bash_desc}`;
            else if (tc.subagent_desc) label += `  ${tc.subagent_desc}`;

            return (
              <div key={i} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="shrink-0">{isErr ? "\u2717" : "\u251C\u2500\u2500"}</span>
                <span className={`truncate ${isErr ? "" : ""}`} style={{ color: isErr ? "#ef4444" : "var(--text-tertiary)" }}>{label}</span>
                {tc.turn_duration_ms && <span className="shrink-0 ml-auto">{fmtMs(tc.turn_duration_ms)}</span>}
              </div>
            );
          })}
          {tools.length > 5 && (
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>+{tools.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Activity Group Card ────────────────────────────────────────
function ActivityGroupCard({
  group,
  exchanges,
  totalExchanges,
  defaultOpen,
}: {
  group: ActivityGroupDetail;
  exchanges: Exchange[];
  totalExchanges: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const borderColor = BOUNDARY_COLORS[group.boundary] || "#6b7280";
  const tokens = (group.total_input_tokens || 0) + (group.total_output_tokens || 0);
  const durationStr = group.duration_ms ? fmtMs(group.duration_ms) : "";

  // Group exchanges that belong to this activity group
  const groupExchanges = exchanges.filter(
    e => e.exchange_index >= group.exchange_start && e.exchange_index <= group.exchange_end
  );

  const showInitial = 3;
  const [showAll, setShowAll] = useState(false);
  const visibleExchanges = showAll ? groupExchanges : groupExchanges.slice(0, showInitial);

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${borderColor}` }}>
      {/* Header */}
      <div
        className="px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] flex items-start justify-between gap-2"
        style={{ background: "var(--bg-surface)" }}
        onClick={() => setOpen(!open)}
      >
        <div className="min-w-0 flex-1">
          {/* Title: ai_label or first_prompt */}
          {group.ai_label ? (
            <>
              <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{group.ai_label}</div>
              {group.first_prompt && (
                <div className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                  "{trunc(cleanText(group.first_prompt).cleaned, 60)}"
                </div>
              )}
            </>
          ) : (
            <div className="text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
              "{trunc(cleanText(group.first_prompt || "").cleaned, 80)}"
              <span className="ml-2 px-1.5 py-0.5 rounded text-[9px]" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                {group.boundary.replace("_", " ")}
              </span>
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>#{group.exchange_start}-{group.exchange_end}</span>
          {durationStr && <span>{durationStr}</span>}
          {tokens > 0 && <span>{fmtTokens(tokens)} tok</span>}
          {(group.error_count || 0) > 0 && <span style={{ color: "#ef4444" }}>{group.error_count} err</span>}
          <span className="text-[10px]">{open ? "\u25BC" : "\u25B6"}</span>
        </div>
      </div>

      {/* Body */}
      {open && (
        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--border)" }}>
          {/* Key actions */}
          {group.key_actions && group.key_actions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {group.key_actions.slice(0, 5).map((a, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
                  {trunc(a, 40)}
                </span>
              ))}
            </div>
          )}

          {/* AI summary */}
          {group.ai_summary && (
            <div className="text-[12px] mb-2 italic" style={{ color: "var(--text-tertiary)" }}>{group.ai_summary}</div>
          )}

          {/* Exchanges */}
          {visibleExchanges.map(ex => (
            <ExchangeOneLiner key={ex.exchange_index} ex={ex} />
          ))}
          {!showAll && groupExchanges.length > showInitial && (
            <button
              className="text-[11px] mt-1 hover:underline"
              style={{ color: "var(--text-muted)" }}
              onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
            >
              {"\u25B8"} {groupExchanges.length - showInitial} more exchanges
            </button>
          )}

          {/* Files written */}
          {group.files_written && group.files_written.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {group.files_written.slice(0, 8).map((f, i) => (
                <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                  {f.split("/").pop()}
                </span>
              ))}
              {group.files_written.length > 8 && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>+{group.files_written.length - 8}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Milestone Divider ──────────────────────────────────────────
function MilestoneDivider({ type, description }: { type: string; description: string }) {
  const cfg = MS_CONFIG[type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="h-px flex-1" style={{ background: cfg.color + "40" }} />
      <span className="text-[11px] font-medium" style={{ color: cfg.color }}>
        {cfg.symbol} {description}
      </span>
      <div className="h-px flex-1" style={{ background: cfg.color + "40" }} />
    </div>
  );
}

// ── Plan Card ──────────────────────────────────────────────────
function PlanCard({ plan, onViewPlan }: { plan: Plan; onViewPlan: (p: Plan) => void }) {
  // Extract first heading or first few lines as preview
  const lines = plan.plan_text.split("\n").filter(l => l.trim());
  const heading = lines.find(l => l.startsWith("#"))?.replace(/^#+\s*/, "") || "";
  const milestoneLines = lines.filter(l => /^\s*[-*]\s*\[[ x✓]\]/.test(l)).slice(0, 3);

  return (
    <div
      className="rounded-lg px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)]"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--accent)30", borderLeft: "3px solid var(--accent)" }}
      onClick={() => onViewPlan(plan)}
    >
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="font-medium" style={{ color: "var(--accent)" }}>Plan V{plan.version} &middot; {plan.status}</span>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>View Plan</span>
      </div>
      {heading && <div className="text-[12px] mb-1" style={{ color: "var(--text-secondary)" }}>{trunc(heading, 80)}</div>}
      {milestoneLines.length > 0 && (
        <div className="text-[11px] space-y-0.5" style={{ color: "var(--text-muted)" }}>
          {milestoneLines.map((l, i) => <div key={i} className="truncate">{l.trim()}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Main Timeline View ─────────────────────────────────────────
interface TimelineViewProps {
  session: SessionDetail;
  exchanges: Exchange[];
  onViewPlan: (plan: Plan) => void;
}

export function TimelineView({ session, exchanges, onViewPlan }: TimelineViewProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const groups = session.activity_groups || [];
  const milestones = session.milestones || [];
  const plans = session.plans || [];
  const totalExchanges = session.exchange_count;

  // Determine default collapse state: >10 groups → collapse most
  const defaultOpen = (idx: number) => {
    if (totalExchanges <= 20) return true;
    if (groups.length <= 5) return true;
    // Open last 3 groups and any with errors
    if (idx >= groups.length - 3) return true;
    const g = groups[idx];
    if ((g.error_count || 0) > 0) return true;
    return false;
  };

  // Build timeline items: interleave groups, milestones, and plans chronologically
  const timelineItems = useMemo(() => {
    const items: Array<{ type: "group" | "milestone" | "plan"; idx: number; sortKey: number }> = [];

    for (let i = 0; i < groups.length; i++) {
      items.push({ type: "group", idx: i, sortKey: groups[i].exchange_start });
    }
    for (let i = 0; i < milestones.length; i++) {
      // Only show milestones that aren't inside a group's exchange range
      const ms = milestones[i];
      const insideGroup = groups.some(g => ms.exchange_index >= g.exchange_start && ms.exchange_index <= g.exchange_end);
      if (!insideGroup) {
        items.push({ type: "milestone", idx: i, sortKey: ms.exchange_index + 0.5 });
      }
    }
    for (let i = 0; i < plans.length; i++) {
      items.push({ type: "plan", idx: i, sortKey: plans[i].exchange_index_start + 0.3 });
    }

    items.sort((a, b) => a.sortKey - b.sortKey);
    return items;
  }, [groups, milestones, plans]);

  // Filter logic
  const filteredItems = useMemo(() => {
    if (filter === "all") return timelineItems;
    return timelineItems.filter(item => {
      if (filter === "git") return item.type === "milestone";
      if (filter === "plans") return item.type === "plan";
      if (filter === "errors") {
        if (item.type === "group") return (groups[item.idx].error_count || 0) > 0;
        return false;
      }
      if (filter === "prompts" || filter === "tools") return item.type === "group";
      return true;
    });
  }, [filter, timelineItems, groups]);

  const errorCount = groups.reduce((sum, g) => sum + (g.error_count || 0), 0);

  // Milestones that are inside groups — render them inline
  const milestonesByIdx = useMemo(() => {
    const map = new Map<number, typeof milestones>();
    for (const m of milestones) {
      if (!map.has(m.exchange_index)) map.set(m.exchange_index, []);
      map.get(m.exchange_index)!.push(m);
    }
    return map;
  }, [milestones]);

  // If no activity groups, show a helpful message
  if (groups.length === 0) {
    return (
      <div className="px-6 py-8 text-[13px]" style={{ color: "var(--text-muted)" }}>
        No activity groups available for this session. Try the Transcript tab for the full conversation.
      </div>
    );
  }

  return (
    <div className="px-6 py-4">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {([
          { key: "all", label: "All" },
          { key: "prompts", label: "Prompts" },
          { key: "tools", label: "Tools" },
          { key: "git", label: "Git" },
          { key: "plans", label: "Plans" },
          { key: "errors", label: `Errors${errorCount > 0 ? ` (${errorCount})` : ""}` },
        ] as Array<{ key: FilterType; label: string }>).map(f => (
          <button
            key={f.key}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{
              background: filter === f.key ? "var(--bg-elevated)" : "transparent",
              color: filter === f.key ? "var(--text-primary)" : "var(--text-muted)",
              border: `1px solid ${filter === f.key ? "var(--border-bright)" : "transparent"}`,
              ...(f.key === "errors" && errorCount > 0 ? { color: filter === f.key ? "#ef4444" : "#ef444480" } : {}),
            }}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline items */}
      <div className="flex flex-col gap-2.5">
        {filteredItems.map((item, i) => {
          if (item.type === "group") {
            const group = groups[item.idx];
            // Find milestones within this group for inline display
            const inlineMs: Array<{ type: string; description: string; exchange_index: number }> = [];
            for (const [idx, ms] of milestonesByIdx) {
              if (idx >= group.exchange_start && idx <= group.exchange_end) {
                inlineMs.push(...ms);
              }
            }
            return (
              <div key={`g-${i}`}>
                <ActivityGroupCard
                  group={group}
                  exchanges={exchanges}
                  totalExchanges={totalExchanges}
                  defaultOpen={defaultOpen(item.idx)}
                />
                {/* Inline milestones after the group */}
                {inlineMs.map((ms, j) => (
                  <MilestoneDivider key={`ims-${i}-${j}`} type={ms.type || ms.milestone_type} description={ms.description} />
                ))}
              </div>
            );
          }
          if (item.type === "milestone") {
            const ms = milestones[item.idx];
            return <MilestoneDivider key={`m-${i}`} type={ms.milestone_type} description={ms.description} />;
          }
          if (item.type === "plan") {
            const plan = plans[item.idx];
            return <PlanCard key={`p-${i}`} plan={plan} onViewPlan={onViewPlan} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
