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
  plan_change: "#a78bfa", compaction: "#f59e0b", tool_shift: "#60a5fa",
  file_shift: "#10b981", time_gap: "#6b7280", session_start: "#818cf8",
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

// ── Activity Group Card — clean, compact ───────────────────────
function ActivityGroupCard({
  group, exchanges, defaultOpen, filter,
}: {
  group: ActivityGroupDetail;
  exchanges: Exchange[];
  defaultOpen: boolean;
  filter: FilterType;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const borderColor = BOUNDARY_COLORS[group.boundary] || "#6b7280";
  const tokens = (group.total_input_tokens || 0) + (group.total_output_tokens || 0);

  const groupExchanges = exchanges.filter(
    e => e.exchange_index >= group.exchange_start && e.exchange_index <= group.exchange_end
  );

  // Filter-aware content: what to show inside the card
  const showPrompts = filter === "all" || filter === "prompts" || filter === "errors";
  const showTools = filter === "all" || filter === "tools" || filter === "errors";

  const [showAll, setShowAll] = useState(false);
  const maxVisible = 3;
  const visibleExchanges = showAll ? groupExchanges : groupExchanges.slice(0, maxVisible);

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${borderColor}` }}>
      {/* Compact header — just title + key stats */}
      <div
        className="px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] flex items-center justify-between gap-3"
        onClick={() => setOpen(!open)}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{open ? "\u25BC" : "\u25B6"}</span>
          {group.ai_label ? (
            <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{group.ai_label}</span>
          ) : (
            <span className="text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
              {trunc(cleanText(group.first_prompt || "").cleaned, 60)}
            </span>
          )}
          {!group.ai_label && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px]" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
              {group.boundary.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>#{group.exchange_start}{group.exchange_end !== group.exchange_start ? `-${group.exchange_end}` : ""}</span>
          {group.duration_ms ? <span>{fmtMs(group.duration_ms)}</span> : null}
          {tokens > 0 && <span>{fmtTokens(tokens)} tok</span>}
          {(group.error_count || 0) > 0 && <span style={{ color: "#ef4444" }}>{group.error_count} err</span>}
        </div>
      </div>

      {/* Expanded body — exchanges only, clean */}
      {open && (
        <div className="px-3 py-2 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
          {group.ai_summary && (
            <div className="text-[11px] italic pb-1" style={{ color: "var(--text-tertiary)" }}>{group.ai_summary}</div>
          )}
          {visibleExchanges.map(ex => {
            const { cleaned: prompt } = cleanText(ex.user_prompt || "");
            const tools = ex.tool_calls || [];
            const hasErrors = tools.some(tc => !!tc.is_error);
            const time = ex.timestamp ? new Date(ex.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

            return (
              <div key={ex.exchange_index} className="py-0.5">
                {showPrompts && prompt && (
                  <div className="flex items-start gap-2 text-[12px]">
                    <span className="shrink-0 text-[10px] w-[48px] text-right font-mono" style={{ color: "var(--text-muted)" }}>{time}</span>
                    <span className="min-w-0 truncate" style={{ color: hasErrors ? "#ef4444" : "var(--text-secondary)" }}>
                      {trunc(prompt, 90)}
                    </span>
                  </div>
                )}
                {showTools && tools.length > 0 && (
                  <div className={`flex flex-col gap-0.5 ${showPrompts ? "ml-[56px]" : ""} mt-0.5`}>
                    {tools.slice(0, 4).map((tc, i) => {
                      const isErr = !!tc.is_error;
                      let label = tc.file_path ? tc.file_path.split("/").pop()! : tc.bash_command ? trunc(tc.bash_command, 50) : tc.bash_desc || tc.subagent_desc || "";
                      return (
                        <div key={i} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          <span className="shrink-0 w-[40px] text-right font-medium" style={{ color: isErr ? "#ef4444" : "var(--text-tertiary)" }}>{tc.tool_name}</span>
                          <span className="truncate font-mono" style={{ color: isErr ? "#ef4444" : "var(--text-muted)" }}>{label}</span>
                        </div>
                      );
                    })}
                    {tools.length > 4 && <div className="text-[10px] ml-[48px]" style={{ color: "var(--text-muted)" }}>+{tools.length - 4} more</div>}
                  </div>
                )}
              </div>
            );
          })}
          {!showAll && groupExchanges.length > maxVisible && (
            <button
              className="text-[11px] hover:underline py-0.5"
              style={{ color: "var(--text-muted)" }}
              onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
            >
              {"\u25B8"} {groupExchanges.length - maxVisible} more exchanges
            </button>
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
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1" style={{ background: cfg.color + "40" }} />
      <span className="text-[11px] font-medium" style={{ color: cfg.color }}>{cfg.symbol} {description}</span>
      <div className="h-px flex-1" style={{ background: cfg.color + "40" }} />
    </div>
  );
}

// ── Plan Card ──────────────────────────────────────────────────
function PlanCard({ plan, onViewPlan }: { plan: Plan; onViewPlan: (p: Plan) => void }) {
  const lines = plan.plan_text.split("\n").filter(l => l.trim());
  const heading = lines.find(l => l.startsWith("#"))?.replace(/^#+\s*/, "") || "";

  return (
    <div
      className="rounded-lg px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)]"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--accent)30", borderLeft: "3px solid var(--accent)" }}
      onClick={() => onViewPlan(plan)}
    >
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-medium" style={{ color: "var(--accent)" }}>Plan V{plan.version} &middot; {plan.status}</span>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>View &rarr;</span>
      </div>
      {heading && <div className="text-[12px] mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>{trunc(heading, 80)}</div>}
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

  const defaultOpen = (idx: number) => {
    if (totalExchanges <= 20) return true;
    if (groups.length <= 5) return true;
    if (idx >= groups.length - 3) return true;
    if ((groups[idx].error_count || 0) > 0) return true;
    return false;
  };

  // Build all milestones into a lookup (including those inside groups)
  const allMilestones = useMemo(() => {
    const byIdx = new Map<number, typeof milestones>();
    for (const m of milestones) {
      if (!byIdx.has(m.exchange_index)) byIdx.set(m.exchange_index, []);
      byIdx.get(m.exchange_index)!.push(m);
    }
    return byIdx;
  }, [milestones]);

  // Interleave groups, standalone milestones, and plans
  const timelineItems = useMemo(() => {
    const items: Array<{ type: "group" | "milestone" | "plan"; idx: number; sortKey: number }> = [];
    for (let i = 0; i < groups.length; i++) items.push({ type: "group", idx: i, sortKey: groups[i].exchange_start });
    for (let i = 0; i < milestones.length; i++) {
      const ms = milestones[i];
      const insideGroup = groups.some(g => ms.exchange_index >= g.exchange_start && ms.exchange_index <= g.exchange_end);
      if (!insideGroup) items.push({ type: "milestone", idx: i, sortKey: ms.exchange_index + 0.5 });
    }
    for (let i = 0; i < plans.length; i++) items.push({ type: "plan", idx: i, sortKey: plans[i].exchange_index_start + 0.3 });
    items.sort((a, b) => a.sortKey - b.sortKey);
    return items;
  }, [groups, milestones, plans]);

  // Filter: for "git" show milestones + groups that have milestones; for "plans" show only plans; etc.
  const filteredItems = useMemo(() => {
    if (filter === "all" || filter === "prompts" || filter === "tools") return timelineItems;
    if (filter === "git") {
      // Show all milestones + groups that contain milestones
      return timelineItems.filter(item => {
        if (item.type === "milestone") return true;
        if (item.type === "group") {
          const g = groups[item.idx];
          for (const [idx] of allMilestones) {
            if (idx >= g.exchange_start && idx <= g.exchange_end) return true;
          }
        }
        return false;
      });
    }
    if (filter === "plans") return timelineItems.filter(item => item.type === "plan");
    if (filter === "errors") {
      return timelineItems.filter(item => {
        if (item.type === "group") return (groups[item.idx].error_count || 0) > 0;
        return false;
      });
    }
    return timelineItems;
  }, [filter, timelineItems, groups, allMilestones]);

  const errorCount = groups.reduce((sum, g) => sum + (g.error_count || 0), 0);
  const gitCount = milestones.length;
  const planCount = plans.length;

  if (groups.length === 0) {
    return (
      <div className="px-6 py-8 text-[13px]" style={{ color: "var(--text-muted)" }}>
        No activity groups available. Try the Transcript tab for the full conversation.
      </div>
    );
  }

  return (
    <div className="px-6 py-4">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {([
          { key: "all" as FilterType, label: "All" },
          { key: "prompts" as FilterType, label: "Prompts" },
          { key: "tools" as FilterType, label: "Tools" },
          { key: "git" as FilterType, label: `Git${gitCount ? ` (${gitCount})` : ""}` },
          { key: "plans" as FilterType, label: `Plans${planCount ? ` (${planCount})` : ""}` },
          { key: "errors" as FilterType, label: `Errors${errorCount ? ` (${errorCount})` : ""}` },
        ]).map(f => (
          <button
            key={f.key}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
            style={{
              background: filter === f.key ? "var(--bg-elevated)" : "transparent",
              color: f.key === "errors" && errorCount > 0
                ? (filter === f.key ? "#ef4444" : "#ef444480")
                : (filter === f.key ? "var(--text-primary)" : "var(--text-muted)"),
              border: `1px solid ${filter === f.key ? "var(--border-bright)" : "transparent"}`,
            }}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="flex flex-col gap-2">
        {filteredItems.map((item, i) => {
          if (item.type === "group") {
            const group = groups[item.idx];
            // Find milestones after this group (between this and next group)
            const nextGroup = groups[item.idx + 1];
            const trailingMs = milestones.filter(m => {
              if (m.exchange_index < group.exchange_start || m.exchange_index > group.exchange_end) return false;
              return true;
            });
            return (
              <div key={`g-${i}`}>
                <ActivityGroupCard
                  group={group}
                  exchanges={exchanges}
                  defaultOpen={defaultOpen(item.idx)}
                  filter={filter}
                />
                {trailingMs.map((ms, j) => (
                  <MilestoneDivider key={`ms-${i}-${j}`} type={ms.milestone_type} description={ms.description} />
                ))}
              </div>
            );
          }
          if (item.type === "milestone") {
            const ms = milestones[item.idx];
            return <MilestoneDivider key={`m-${i}`} type={ms.milestone_type} description={ms.description} />;
          }
          if (item.type === "plan") {
            return <PlanCard key={`p-${i}`} plan={plans[item.idx]} onViewPlan={onViewPlan} />;
          }
          return null;
        })}
        {filteredItems.length === 0 && (
          <div className="text-[12px] py-4 text-center" style={{ color: "var(--text-muted)" }}>
            No {filter} found in this session.
          </div>
        )}
      </div>
    </div>
  );
}
