import { useState, useMemo, type ReactNode } from "react";
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

type FilterType = "all" | "prompts" | "tools" | "git" | "errors";

// ── Activity Group Card ────────────────────────────────────────
function ActivityGroupCard({
  group, exchanges, defaultOpen, filter, onSelect,
}: {
  group: ActivityGroupDetail;
  exchanges: Exchange[];
  defaultOpen: boolean;
  filter: FilterType;
  onSelect: (group: ActivityGroupDetail, exchanges: Exchange[]) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const borderColor = BOUNDARY_COLORS[group.boundary] || "#6b7280";
  const tokens = (group.total_input_tokens || 0) + (group.total_output_tokens || 0);

  const groupExchanges = exchanges.filter(
    e => e.exchange_index >= group.exchange_start && e.exchange_index <= group.exchange_end
  );

  const showPrompts = filter === "all" || filter === "prompts" || filter === "errors";
  const showTools = filter === "all" || filter === "tools" || filter === "errors";
  // For git filter, don't show the card body — just the header as context
  const showBody = filter !== "git";

  const [showAll, setShowAll] = useState(false);
  const maxVisible = 3;
  const visibleExchanges = showAll ? groupExchanges : groupExchanges.slice(0, maxVisible);

  const errCount = group.error_count || 0;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${borderColor}` }}>
      {/* Header — click opens detail panel */}
      <div
        className="px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] flex items-center justify-between gap-3"
        onClick={() => onSelect(group, groupExchanges)}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {/* Expand/collapse chevron */}
          {showBody && (
            <button
              className="text-[10px] shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--bg-elevated)]"
              style={{ color: "var(--text-muted)" }}
              onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            >{open ? "\u25BC" : "\u25B6"}</button>
          )}
          {group.ai_label ? (
            <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{group.ai_label}</span>
          ) : (
            <span className="text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
              {trunc(cleanText(group.first_prompt || "").cleaned, 60)}
            </span>
          )}
          {!group.ai_label && group.boundary !== "session_start" && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px]" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
              {group.boundary.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>#{group.exchange_start}{group.exchange_end !== group.exchange_start ? `-${group.exchange_end}` : ""}</span>
          {group.duration_ms ? <span>{fmtMs(group.duration_ms)}</span> : null}
          {tokens > 0 && <span>{fmtTokens(tokens)} tok</span>}
          {errCount > 0 && <span className="text-[10px]">{errCount} err</span>}
        </div>
      </div>

      {/* Body */}
      {open && showBody && (
        <div className="px-3 py-2 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
          {group.ai_summary && (
            <div className="text-[11px] italic pb-1" style={{ color: "var(--text-tertiary)" }}>{group.ai_summary}</div>
          )}
          {visibleExchanges.map(ex => {
            const { cleaned: prompt } = cleanText(ex.user_prompt || "");
            const tools = ex.tool_calls || [];
            const hasErrors = false; // Don't color prompts based on tool errors
            const time = ex.timestamp ? new Date(ex.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

            return (
              <div key={ex.exchange_index} className="py-0.5">
                {showPrompts && prompt && (
                  <div className="flex items-start gap-2 text-[12px]">
                    <span className="shrink-0 text-[10px] w-[48px] text-right font-mono" style={{ color: "var(--text-muted)" }}>{time}</span>
                    <span className="min-w-0 truncate" style={{ color: hasErrors ? "#ef444480" : "var(--text-secondary)" }}>
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
                          <span className="shrink-0 w-[40px] text-right font-medium" style={{ color: "var(--text-tertiary)" }}>{tc.tool_name}</span>
                          <span className="truncate font-mono">{label}</span>
                          {isErr && <span className="shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>err</span>}
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

// ── Milestone Item — compact timeline event ────────────────────
function MilestoneItem({ type, description }: { type: string; description: string }) {
  const cfg = MS_CONFIG[type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
  return (
    <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-md" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <span className="text-[13px]" style={{ color: cfg.color }}>{cfg.symbol}</span>
      <span className="text-[12px] min-w-0 truncate" style={{ color: cfg.color }}>{description}</span>
    </div>
  );
}

// ── Main Timeline View ─────────────────────────────────────────
interface TimelineViewProps {
  session: SessionDetail;
  exchanges: Exchange[];
  onViewPlan: (plan: Plan) => void;
  onViewGroup: (title: string, subtitle: string, content: ReactNode, rawData: unknown) => void;
}

export function TimelineView({ session, exchanges, onViewPlan, onViewGroup }: TimelineViewProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const groups = session.activity_groups || [];
  const milestones = session.milestones || [];
  const totalExchanges = session.exchange_count;

  const defaultOpen = (idx: number) => {
    if (totalExchanges <= 20) return true;
    if (groups.length <= 5) return true;
    if (idx >= groups.length - 3) return true;
    return false;
  };

  const allMilestones = useMemo(() => {
    const byIdx = new Map<number, typeof milestones>();
    for (const m of milestones) {
      if (!byIdx.has(m.exchange_index)) byIdx.set(m.exchange_index, []);
      byIdx.get(m.exchange_index)!.push(m);
    }
    return byIdx;
  }, [milestones]);

  const timelineItems = useMemo(() => {
    const items: Array<{ type: "group" | "milestone"; idx: number; sortKey: number }> = [];
    for (let i = 0; i < groups.length; i++) items.push({ type: "group", idx: i, sortKey: groups[i].exchange_start });
    for (let i = 0; i < milestones.length; i++) {
      const ms = milestones[i];
      const insideGroup = groups.some(g => ms.exchange_index >= g.exchange_start && ms.exchange_index <= g.exchange_end);
      if (!insideGroup) items.push({ type: "milestone", idx: i, sortKey: ms.exchange_index + 0.5 });
    }
    items.sort((a, b) => a.sortKey - b.sortKey);
    return items;
  }, [groups, milestones]);

  // Git filter: show only milestones (not empty groups)
  const filteredItems = useMemo(() => {
    if (filter === "all" || filter === "prompts" || filter === "tools") return timelineItems;
    if (filter === "git") {
      // Show standalone milestones + milestones from within groups (flatten them out)
      const gitItems: Array<{ type: "milestone"; idx: number; sortKey: number }> = [];
      for (let i = 0; i < milestones.length; i++) {
        gitItems.push({ type: "milestone", idx: i, sortKey: milestones[i].exchange_index });
      }
      gitItems.sort((a, b) => a.sortKey - b.sortKey);
      return gitItems;
    }
    if (filter === "errors") {
      return timelineItems.filter(item => {
        if (item.type !== "group") return false;
        return (groups[item.idx].error_count || 0) > 0;
      });
    }
    return timelineItems;
  }, [filter, timelineItems, groups, milestones]);

  const errorCount = groups.reduce((sum, g) => sum + (g.error_count || 0), 0);
  const gitCount = milestones.length;

  // Handler for clicking "view" on an activity group
  const handleSelectGroup = (group: ActivityGroupDetail, groupExchanges: Exchange[]) => {
    const title = group.ai_label || trunc(cleanText(group.first_prompt || "").cleaned, 60);
    const subtitle = `#${group.exchange_start}-${group.exchange_end} \u00B7 ${group.exchange_count} exchanges`;
    const content = (
      <div className="text-[13px] space-y-4">
        {group.ai_summary && <div className="italic" style={{ color: "var(--text-tertiary)" }}>{group.ai_summary}</div>}

        {/* Full exchange logs */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Conversation</div>
          {groupExchanges.map(ex => {
            const { cleaned: prompt } = cleanText(ex.user_prompt || "");
            const { cleaned: response } = cleanText(ex.assistant_response || "");
            const tools = ex.tool_calls || [];
            const time = ex.timestamp ? new Date(ex.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

            return (
              <div key={ex.exchange_index} className="mb-3 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
                {/* User prompt */}
                {prompt && (
                  <div className="mb-1.5">
                    <div className="text-[10px] mb-0.5" style={{ color: "var(--text-muted)" }}>{time} &middot; User</div>
                    <div className="text-[12px] whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{trunc(prompt, 500)}</div>
                  </div>
                )}
                {/* Claude response */}
                {response && (
                  <div className="mb-1.5">
                    <div className="text-[10px] mb-0.5" style={{ color: "var(--text-muted)" }}>Claude</div>
                    <div className="text-[12px] whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{trunc(response, 500)}</div>
                  </div>
                )}
                {/* Tool calls */}
                {tools.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {tools.map((tc, i) => {
                      const isErr = !!tc.is_error;
                      let label = tc.file_path ? tc.file_path.split("/").pop()! : tc.bash_command || tc.bash_desc || tc.subagent_desc || "";
                      return (
                        <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                          <span className="font-medium shrink-0" style={{ color: "var(--text-tertiary)" }}>{tc.tool_name}</span>
                          <span className="font-mono truncate">{trunc(label, 80)}</span>
                          {isErr && <span className="shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>err</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Files written */}
        {group.files_written && group.files_written.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Files Written</div>
            {group.files_written.map((f, i) => (
              <div key={i} className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>{f.split("/").pop()}</div>
            ))}
          </div>
        )}
      </div>
    );
    onViewGroup(title, subtitle, content, group);
  };

  if (groups.length === 0) {
    return (
      <div className="px-6 py-8 text-[13px]" style={{ color: "var(--text-muted)" }}>
        No activity groups available. Try the Transcript tab for the full conversation.
      </div>
    );
  }

  return (
    <div className="px-6 pb-4 pt-1">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {([
          { key: "all" as FilterType, label: "All" },
          { key: "prompts" as FilterType, label: "Prompts" },
          { key: "tools" as FilterType, label: "Tools" },
          { key: "git" as FilterType, label: `Git${gitCount ? ` (${gitCount})` : ""}` },
          { key: "errors" as FilterType, label: `Errors${errorCount ? ` (${errorCount})` : ""}` },
        ]).map(f => (
          <button
            key={f.key}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
            style={{
              background: filter === f.key ? "var(--bg-elevated)" : "transparent",
              color: filter === f.key ? "var(--text-primary)" : "var(--text-muted)",
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
            const trailingMs = milestones.filter(m =>
              m.exchange_index >= group.exchange_start && m.exchange_index <= group.exchange_end
            );
            return (
              <div key={`g-${i}`}>
                <ActivityGroupCard
                  group={group}
                  exchanges={exchanges}
                  defaultOpen={defaultOpen(item.idx)}
                  filter={filter}
                  onSelect={handleSelectGroup}
                />
                {/* Show inline milestones only when not in git filter (git filter shows them separately) */}
                {filter !== "git" && trailingMs.map((ms, j) => (
                  <MilestoneItem key={`ms-${i}-${j}`} type={ms.milestone_type} description={ms.description} />
                ))}
              </div>
            );
          }
          if (item.type === "milestone") {
            const ms = milestones[item.idx];
            return <MilestoneItem key={`m-${i}`} type={ms.milestone_type} description={ms.description} />;
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
