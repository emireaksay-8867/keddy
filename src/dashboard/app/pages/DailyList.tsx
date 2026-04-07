import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { getDailyList } from "../lib/api.js";
import type { DailyListItem } from "../lib/types.js";

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

function DayRow({ item, isLast }: { item: DailyListItem; isLast: boolean }) {
  const borderStyle = isLast ? "1px solid transparent" : "1px solid rgba(255,255,255,0.06)";

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
    <div className="flex items-center px-5 py-2" style={{ borderBottom: borderStyle }}>
      <div className="flex-1 min-w-0">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>No daily note</p>
        <div className="mt-1 inline-flex items-center gap-x-2 gap-y-1 flex-wrap">
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
      <Link to={`/daily/${item.date}?auto=1`}
        className="text-[11px] px-2.5 py-1 rounded hover:opacity-90 shrink-0"
        style={{ background: "var(--accent)", color: "white" }}>
        Generate
      </Link>
    </div>
  );
}

export function DailyList() {
  const [items, setItems] = useState<DailyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [localSearch, setLocalSearch] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "7d" | "30d" | "all">("all");
  const [visibleCount, setVisibleCount] = useState(50);

  useEffect(() => {
    getDailyList(365)
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = items;

    if (localSearch) {
      const words = localSearch.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((d) => {
        const text = `${d.note?.summary || ""} ${d.date}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
    }

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
  }, [items, localSearch, dateRange]);

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
      <div className="px-5 pt-5 pb-3 flex items-center gap-4" style={{ background: "var(--bg-root)" }}>
        <h1 style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 450, letterSpacing: "0.03em" }}>Daily Notes</h1>
        {items.length > 0 && (
          <span className="text-[11px] tabular-nums px-2.5 py-0.5 rounded-full"
            style={{ border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-secondary)" }}>
            {filtered.length} day{filtered.length !== 1 ? "s" : ""}
          </span>
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

      {/* Date filters */}
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

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="p-8 text-center" style={{ color: "var(--text-tertiary)" }}>
            <span className="text-xs">loading...</span>
          </div>
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
                  <span className="text-[11px] uppercase" style={{ color: "var(--text-tertiary)", fontWeight: 500, letterSpacing: "0.06em" }}>
                    {label}
                  </span>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  {dayItems.map((item, idx) => (
                    <DayRow key={item.date} item={item} isLast={idx === dayItems.length - 1} />
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
