import { useState, useEffect, useMemo, type ReactNode } from "react";
import type { SessionDetail, Exchange, ActivityGroupDetail, Plan } from "../../lib/types.js";
import { cleanText } from "../../lib/cleanText.js";
import { getSessionNotes, getSessionMermaid } from "../../lib/api.js";
import { MermaidDiagram } from "./NotesTab.js";

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
  const [showInherited, setShowInherited] = useState(false);
  const groups = session.activity_groups || [];
  const milestones = session.milestones || [];
  const forkIdx = session.fork_exchange_index;
  const inheritedGroupCount = forkIdx != null ? groups.filter(g => g.exchange_end < forkIdx).length : 0;
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

      {/* Collapsed inherited groups toggle (same pattern as Terminal view) */}
      {forkIdx != null && inheritedGroupCount > 0 && (
        <div className="mb-3 px-2">
          <button
            onClick={() => setShowInherited(!showInherited)}
            className="text-[11px] font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{ color: "#a78bfa", background: "rgba(167, 139, 250, 0.08)", border: "1px solid rgba(167, 139, 250, 0.15)" }}
          >
            {showInherited ? "Hide" : "Show"} {inheritedGroupCount} inherited activity group{inheritedGroupCount > 1 ? "s" : ""}
            {session.parent_title ? ` from "${trunc(session.parent_title, 30)}"` : ""}
          </button>
        </div>
      )}

      {/* Timeline */}
      <div className="flex flex-col gap-2">
        {filteredItems.map((item, i) => {
          if (item.type === "group") {
            const group = groups[item.idx];
            const isInherited = forkIdx != null && group.exchange_end < forkIdx;
            const isFirstNew = forkIdx != null && group.exchange_start >= forkIdx
              && (item.idx === 0 || groups[item.idx - 1].exchange_end < forkIdx);
            const trailingMs = milestones.filter(m =>
              m.exchange_index >= group.exchange_start && m.exchange_index <= group.exchange_end
            );

            // Hide inherited groups when collapsed
            if (isInherited && !showInherited) return null;

            return (
              <div key={`g-${i}`}>
                {/* Fork divider — shown before the first post-fork group */}
                {isFirstNew && (
                  <div className="fork-divider flex items-center gap-3 my-3 px-2">
                    <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                    <span className="text-[11px] font-medium shrink-0" style={{ color: "#a78bfa" }}>
                      {session.parent_title
                        ? `Forked from "${trunc(session.parent_title, 40)}"`
                        : "Fork point — new content below"}
                    </span>
                    <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                  </div>
                )}
                <div style={{ opacity: isInherited ? 0.4 : 1 }}>
                  <ActivityGroupCard
                    group={group}
                    exchanges={exchanges}
                    defaultOpen={isInherited ? false : defaultOpen(item.idx)}
                    filter={filter}
                    onSelect={handleSelectGroup}
                  />
                </div>
                {/* Show inline milestones only when not in git filter (git filter shows them separately) */}
                {filter !== "git" && trailingMs.map((ms, j) => (
                  <MilestoneItem key={`ms-${i}-${j}`} type={ms.milestone_type} description={ms.description} />
                ))}
                {/* Fork-out markers: child sessions forked from within this group's range */}
                {session.fork_children?.filter((fc) =>
                  fc.fork_exchange_index != null &&
                  fc.fork_exchange_index >= group.exchange_start &&
                  fc.fork_exchange_index <= group.exchange_end
                ).map((fc) => (
                  <div key={fc.session_id} className="flex items-center gap-3 my-2 px-2">
                    <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                    <a href={`/sessions/${fc.session_id}`} className="text-[11px] font-medium shrink-0 hover:underline" style={{ color: "#a78bfa" }}>
                      {"\u2192"} Forked into "{fc.title && fc.title.length > 35 ? fc.title.substring(0, 35) + "\u2026" : fc.title || fc.session_id.substring(0, 12)}"
                    </a>
                    <div className="flex-1 h-px" style={{ background: "#a78bfa" }} />
                  </div>
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

// ── Session Flow Diagram ──────────────────────────────────────

interface FlowSource {
  id: string;
  label: string;
  mermaid: string;
  isAi: boolean;
}

export function SessionFlowDiagram({ sessionId }: { sessionId: string }) {
  const [sources, setSources] = useState<FlowSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedMermaid, setExpandedMermaid] = useState<string | null>(null);

  // Close expanded view on Escape
  useEffect(() => {
    if (!expanded) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [expanded]);

  // Fetch expanded mermaid when expanding (activity data only — AI diagrams use their own mermaid)
  useEffect(() => {
    if (!expanded) { setExpandedMermaid(null); return; }
    const source = sources.find((s) => s.id === activeSourceId);
    if (!source?.mermaid) return;
    if (source.isAi) {
      setExpandedMermaid(source.mermaid);
      return;
    }
    getSessionMermaid(sessionId, "expanded")
      .then((data) => setExpandedMermaid(data?.mermaid || source.mermaid))
      .catch(() => setExpandedMermaid(source.mermaid));
  }, [expanded, activeSourceId, sessionId, sources]);

  useEffect(() => {
    let activitySource: FlowSource | null = null;
    const aiSources: FlowSource[] = [];

    const progPromise = getSessionMermaid(sessionId)
      .then((data) => {
        activitySource = {
          id: "activity",
          label: "Activity data",
          mermaid: data?.mermaid || "",
          isAi: false,
        };
      })
      .catch(() => {
        activitySource = { id: "activity", label: "Activity data", mermaid: "", isAi: false };
      });

    const notesPromise = getSessionNotes(sessionId)
      .then((notes: any[]) => {
        if (!notes) return;
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (!n.mermaid) continue;
          const date = new Date(n.generated_at);
          const timeStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const modelStr = n.model ? ` · ${n.model.replace(/^claude-/, "").split("-20")[0]}` : "";
          aiSources.push({
            id: `note-${n.id}`,
            label: `AI · ${timeStr}${modelStr}${i === 0 ? " (latest)" : ""}`,
            mermaid: n.mermaid,
            isAi: true,
          });
        }
      })
      .catch(() => {});

    Promise.all([progPromise, notesPromise]).then(() => {
      const all: FlowSource[] = [];
      if (activitySource) all.push(activitySource);
      all.push(...aiSources);

      if (all.length === 0) return;
      setSources(all);

      if (activitySource?.mermaid) {
        setActiveSourceId("activity");
      } else if (aiSources.length > 0) {
        setActiveSourceId(aiSources[0].id);
      } else {
        setActiveSourceId(all[0].id);
      }
    });
  }, [sessionId]);

  const activeSource = sources.find((s) => s.id === activeSourceId) || null;
  const hasMultipleSources = sources.filter((s) => s.mermaid).length > 1 || (sources.some((s) => s.isAi) && sources.some((s) => !s.isAi));

  if (!activeSource) return null;
  if (!activeSource.mermaid && sources.every((s) => !s.mermaid)) return null;

  const header = (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Session Flow
      </span>
      {hasMultipleSources ? (
        <select
          value={activeSourceId || ""}
          onChange={(e) => setActiveSourceId(e.target.value)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-transparent outline-none"
          style={{
            color: activeSource.isAi ? "#a78bfa" : "var(--text-muted)",
            border: `1px solid ${activeSource.isAi ? "#a78bfa33" : "var(--border)"}`,
          }}
        >
          {sources.map((s) => (
            <option
              key={s.id}
              value={s.id}
              disabled={!s.mermaid}
              style={{ background: "#18181b", color: s.mermaid ? "#fafafa" : "#52525b" }}
            >
              {s.label}{!s.mermaid ? " (no data)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color: activeSource.isAi ? "#a78bfa" : "var(--text-muted)",
            border: `1px solid ${activeSource.isAi ? "#a78bfa33" : "var(--border)"}`,
          }}
        >
          {activeSource.isAi ? "AI-enhanced" : "from activity data"}
        </span>
      )}
      {activeSource.mermaid && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
          style={{ color: "var(--text-muted)" }}
          title={expanded ? "Collapse diagram" : "Expand diagram"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? (
              <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
            ) : (
              <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
            )}
          </svg>
        </button>
      )}
    </div>
  );

  // Expanded: fixed overlay, full viewport, blurred background, expanded labels
  if (expanded && activeSource.mermaid) {
    return (
      <div className="mb-2 pb-2">
        <div style={{ height: 60 }} />
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }} onClick={() => setExpanded(false)} />
          <div
            className="relative rounded-xl overflow-y-auto"
            style={{ width: "96vw", maxWidth: "1800px", maxHeight: "90vh", padding: "1.5rem 2rem", background: "var(--bg-root)", border: "1px solid rgba(63, 63, 70, 0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExpanded(false)}
              className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            {expandedMermaid ? (
              <MermaidDiagram chart={expandedMermaid} />
            ) : (
              <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
                <div className="animate-spin w-3 h-3 rounded-full mr-2" style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} />
                <span className="text-[11px]">Loading expanded view...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 pb-2">
      {header}
      {activeSource.mermaid ? (
        <MermaidDiagram chart={activeSource.mermaid} />
      ) : (
        <div
          className="rounded-lg p-4 text-center text-[12px]"
          style={{ background: "var(--bg-root)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          Not enough activity data for a flow diagram
        </div>
      )}
    </div>
  );
}
