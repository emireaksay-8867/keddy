import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { getDailyList, getConfig } from "../lib/api.js";
import type { DailyListItem } from "../lib/types.js";
import { CalendarView } from "../components/CalendarView.js";
import { List, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

function formatRelative(dateStr: string): string {
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function DayRow({ item, isLast, defaultModel }: { item: DailyListItem; isLast: boolean; defaultModel: string }) {
  const [model, setModel] = useState<"haiku" | "sonnet" | "opus">(defaultModel as any || "sonnet");
  const borderStyle = isLast ? "1px solid transparent" : "1px solid rgba(255,255,255,0.06)";

  // Today, no activity captured yet (synthetic row — see DailyList useEffect below)
  if (item.session_count === 0 && !item.note) {
    return (
      <Link to={`/daily/${item.date}`}
        className="flex items-center px-5 py-2 transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderBottom: borderStyle }}>
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <p className="text-[13px] font-medium shrink-0" style={{ color: "var(--text-primary)" }}>No exchanges yet</p>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Start a Claude Code session to see activity here
          </span>
        </div>
      </Link>
    );
  }

  if (item.note) {
    return (
      <Link to={`/daily/${item.date}`}
        className="block px-5 py-2 transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderBottom: borderStyle }}>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {item.note.summary}
            </p>
            <div className="mt-1 inline-flex items-center gap-x-2 gap-y-1 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}>
                {item.session_count} session{item.session_count !== 1 ? "s" : ""}
              </span>
              {item.note.model && (
                <span className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}>
                  {item.note.model.replace("claude-", "").replace(/-\d{8}$/, "")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center shrink-0">
            <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
              {formatRelative(item.note.generated_at)}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link to={`/daily/${item.date}`}
      className="flex items-center px-5 py-2 transition-colors hover:bg-[var(--bg-hover)]"
      style={{ borderBottom: borderStyle }}>
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <div className="shrink-0 flex items-center justify-center"
          style={{ width: 24, height: 24, borderRadius: 6, background: "var(--accent-dim)", border: "1px solid rgba(63, 63, 70, 0.4)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="12" y1="14" x2="12" y2="18" />
            <line x1="10" y1="16" x2="14" y2="16" />
          </svg>
        </div>
        <p className="text-[13px] font-medium shrink-0" style={{ color: "var(--text-primary)" }}>No daily note</p>
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}>
            {item.session_count} session{item.session_count !== 1 ? "s" : ""}
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full shrink-0 leading-none"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}>
            {item.total_exchanges} exchanges
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.preventDefault()}>
        <select value={model} onChange={(e) => setModel(e.target.value as "haiku" | "sonnet" | "opus")}
          className="text-[11px] px-1.5 py-1 rounded"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
        <Link to={`/daily/${item.date}?auto=1&model=${model}`}
          className="text-[11px] px-2.5 py-1 rounded hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}>
          Generate
        </Link>
      </div>
    </Link>
  );
}

export function DailyList() {
  const [items, setItems] = useState<DailyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultModel, setDefaultModel] = useState("sonnet");

  useEffect(() => {
    getConfig().then((c: any) => {
      const m = c?.notes?.dailyModel || c?.notes?.model;
      if (m) setDefaultModel(m);
    }).catch(() => {});
  }, []);
  const [localSearch, setLocalSearch] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "7d" | "30d" | "all">("all");
  const [visibleCount, setVisibleCount] = useState(50);
  const [viewMode, setViewMode] = useState<"list" | "calendar">(() => {
    try { return localStorage.getItem("keddy-daily-view") === "calendar" ? "calendar" : "list"; } catch { return "list"; }
  });
  useEffect(() => {
    try { localStorage.setItem("keddy-daily-view", viewMode); } catch {}
  }, [viewMode]);

  // Calendar month state — lifted here so header can show month nav
  const [calMonth, setCalMonth] = useState(() => {
    try {
      const saved = localStorage.getItem("keddy-calendar-month");
      if (saved) { const p = JSON.parse(saved); return { year: p.year, month: p.month }; }
    } catch {}
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  useEffect(() => {
    try { localStorage.setItem("keddy-calendar-month", JSON.stringify(calMonth)); } catch {}
  }, [calMonth]);
  const calMonthLabel = new Date(calMonth.year, calMonth.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const prevMonth = () => setCalMonth((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setCalMonth((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  useEffect(() => {
    getDailyList(365)
      .then((data) => {
        const todayStr = new Date().toISOString().split("T")[0];
        if (!data.some((d) => d.date === todayStr)) {
          data = [{ date: todayStr, session_count: 0, total_exchanges: 0, note: null }, ...data];
        }
        setItems(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Search-only filter (for calendar view — no date range needed)
  const searchFiltered = useMemo(() => {
    if (!localSearch) return items;
    const words = localSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((d) => {
      const text = `${d.note?.summary || ""} ${d.date}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [items, localSearch]);

  // Full filter with search + date range (for list view)
  const filtered = useMemo(() => {
    let result = searchFiltered;

    if (dateRange !== "all") {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === "today") {
        cutoff.setHours(0, 0, 0, 0);
      } else if (dateRange === "7d") {
        cutoff.setDate(now.getDate() - 7);
      } else if (dateRange === "30d") {
        cutoff.setDate(now.getDate() - 30);
      }
      result = result.filter((d) => new Date(d.date + "T23:59:59") >= cutoff);
    }

    return result;
  }, [searchFiltered, dateRange]);

  const visible = filtered.slice(0, visibleCount);

  // Group by date label (Today, Yesterday, Wednesday Apr 2, etc.)
  const grouped = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayStr = today.toISOString().split("T")[0];
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const groups: Array<[string, DailyListItem[]]> = [];
    for (const item of visible) {
      let label: string;
      if (item.date === todayStr) {
        label = "Today";
      } else if (item.date === yesterdayStr) {
        label = "Yesterday";
      } else {
        const d = new Date(item.date + "T12:00:00");
        label = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      }
      const existing = groups.find(([k]) => k === label);
      if (existing) {
        existing[1].push(item);
      } else {
        groups.push([label, [item]]);
      }
    }
    return groups;
  }, [visible]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 pt-8 pb-3 flex items-center gap-4" style={{ background: "var(--bg-root)" }}>
        <h1 style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 450, letterSpacing: "0.03em" }}>Daily Notes</h1>
        {items.length > 0 && (
          <span className="text-[11px] tabular-nums px-2.5 py-0.5 rounded-full"
            style={{ border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-secondary)" }}>
            {filtered.length} day{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex items-center gap-0.5 rounded-md p-0.5" style={{ background: "rgba(255,255,255,0.04)" }}>
          <button onClick={() => setViewMode("list")}
            className="p-1.5 rounded transition-colors"
            style={{ background: viewMode === "list" ? "rgba(255,255,255,0.1)" : "transparent", color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)" }}>
            <List size={14} />
          </button>
          <button onClick={() => setViewMode("calendar")}
            className="p-1.5 rounded transition-colors"
            style={{ background: viewMode === "calendar" ? "rgba(255,255,255,0.1)" : "transparent", color: viewMode === "calendar" ? "var(--text-primary)" : "var(--text-muted)" }}>
            <CalendarDays size={14} />
          </button>
        </div>
        {viewMode === "calendar" && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
              {calMonthLabel}
            </span>
            <div className="flex items-center">
              <button onClick={prevMonth}
                className="p-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--text-secondary)" }}>
                <ChevronLeft size={14} />
              </button>
              <button onClick={nextMonth}
                className="p-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--text-secondary)" }}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-shadow focus-within:shadow-[0_0_0_2px_rgba(56,139,253,0.75)]"
          style={{ background: "rgba(255,255,255,0.09)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" value={localSearch} onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search notes..." className="text-xs w-32 outline-none bg-transparent" style={{ color: "var(--text-primary)" }} />
        </div>
      </div>

      {/* Date filters — only shown in list mode */}
      {viewMode === "list" && (
        <div className="px-5 pb-2 flex gap-1" style={{ background: "var(--bg-root)" }}>
          {(["all", "today", "7d", "30d"] as const).map((range) => (
            <button key={range} onClick={() => { setDateRange(range); setVisibleCount(50); }}
              className="text-[11px] px-2.5 py-1 rounded-md transition-colors"
              style={{
                background: dateRange === range ? "rgba(255,255,255,0.1)" : "transparent",
                color: dateRange === range ? "var(--text-primary)" : "var(--text-muted)",
                border: "none",
              }}>
              {range === "all" ? "All" : range === "today" ? "Today" : range === "7d" ? "7 days" : "30 days"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="p-8 text-center" style={{ color: "var(--text-tertiary)" }}>
            <span className="text-xs">loading...</span>
          </div>
        ) : viewMode === "calendar" ? (
          <CalendarView items={searchFiltered} viewMonth={calMonth} defaultModel={defaultModel} />
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm mb-1">No days found</p>
            <p className="text-xs">Start a Claude Code session to see activity here</p>
          </div>
        ) : (
          <>
            {grouped.map(([label, dayItems], groupIdx) => (
              <div key={label} className="px-4" style={{ marginTop: groupIdx > 0 ? 12 : 0 }}>
                <div className="px-2 py-1.5 sticky top-0 z-10" style={{ background: "var(--bg-root)" }}>
                  <span className="text-[11px]" style={{ color: "var(--text-tertiary)", fontWeight: 500, letterSpacing: "0.02em" }}>
                    {label}
                  </span>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  {dayItems.map((item, idx) => (
                    <DayRow key={item.date} item={item} isLast={idx === dayItems.length - 1} defaultModel={defaultModel} />
                  ))}
                </div>
              </div>
            ))}

            {visibleCount < filtered.length && (
              <div className="py-4 text-center">
                <button onClick={() => setVisibleCount((c) => c + 50)}
                  className="text-xs px-4 py-2 rounded-md transition-colors hover:brightness-125"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "none" }}>
                  load more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
