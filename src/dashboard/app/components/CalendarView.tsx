import { useState, useMemo } from "react";
import { Link } from "react-router";
import type { DailyListItem } from "../lib/types.js";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Day Cell ────────────────────────────────────────────────

function CalendarDayCell({ dateStr, label, item, isToday, isFuture, isOutside, defaultModel }: {
  dateStr: string;
  label: string;
  item: DailyListItem | undefined;
  isToday: boolean;
  isFuture: boolean;
  isOutside: boolean;
  defaultModel: string;
}) {
  const [model, setModel] = useState<"haiku" | "sonnet" | "opus">(defaultModel as any || "sonnet");
  const dayColor = isToday ? "var(--text-primary)" : isOutside ? "var(--text-muted)" : "var(--text-secondary)";
  const hasNote = !!item?.note;
  const hasSessions = item && item.session_count > 0;

  const cellStyle = { background: "var(--bg-root)", borderLeft: isToday ? "2px solid var(--accent)" : undefined };

  // Has note
  if (hasNote) {
    return (
      <Link to={`/daily/${dateStr}`}
        className="flex flex-col p-2 min-h-[120px] gap-1.5 transition-colors hover:brightness-110"
        style={cellStyle}>
        <span className="text-[12px] tabular-nums" style={{ color: dayColor, fontWeight: isToday ? 600 : 400 }}>{label}</span>
        <div className="rounded-md px-2 py-1" style={{ background: "rgba(99,102,241,0.15)", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
          <p className="text-[10px] font-medium leading-tight line-clamp-2" style={{ color: "var(--text-primary)" }}>
            {item.note!.summary}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-1 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full leading-none"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}>
            {item.session_count}s
          </span>
          {item.note!.model && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full leading-none"
              style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-tertiary)", fontWeight: 500 }}>
              {item.note!.model.replace("claude-", "").replace(/-\d{8}$/, "")}
            </span>
          )}
        </div>
      </Link>
    );
  }

  // No note, has sessions
  if (hasSessions) {
    return (
      <Link to={`/daily/${dateStr}`}
        className="flex flex-col items-center min-h-[120px] p-2 gap-1 transition-colors hover:brightness-110"
        style={cellStyle}>
        <span className="text-[12px] tabular-nums self-start" style={{ color: dayColor, fontWeight: isToday ? 600 : 400 }}>{label}</span>
        <div className="shrink-0 flex items-center justify-center"
          style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent-dim)", border: "1px solid rgba(63, 63, 70, 0.4)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="12" y1="14" x2="12" y2="18" />
            <line x1="10" y1="16" x2="14" y2="16" />
          </svg>
        </div>
        <span className="text-[9px] font-medium" style={{ color: "var(--text-secondary)" }}>No daily note</span>
        <span className="text-[9px] px-2 py-0.5 rounded hover:opacity-90 font-medium cursor-pointer"
          style={{ background: "var(--accent)", color: "white" }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/daily/${dateStr}?auto=1&model=${model}`; }}>
          Generate
        </span>
        <select value={model}
          onClick={(e) => e.preventDefault()}
          onChange={(e) => { e.preventDefault(); setModel(e.target.value as "haiku" | "sonnet" | "opus"); }}
          className="text-[9px] px-1 py-0.5 rounded"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
          <option value="haiku">Haiku</option>
        </select>
      </Link>
    );
  }

  // Today, no activity captured yet
  if (isToday) {
    return (
      <Link to={`/daily/${dateStr}`}
        className="flex flex-col p-2 min-h-[120px] gap-1.5 transition-colors hover:brightness-110"
        style={cellStyle}>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--text-primary)", fontWeight: 600 }}>{label}</span>
        <span className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
          No exchanges yet
        </span>
      </Link>
    );
  }

  // Empty / future / outside
  return (
    <div className="flex flex-col p-2 min-h-[120px]" style={cellStyle}>
      <span className="text-[12px] tabular-nums" style={{ color: isOutside ? "var(--text-muted)" : isFuture ? "var(--text-muted)" : "var(--text-tertiary)", fontWeight: 400 }}>
        {label}
      </span>
    </div>
  );
}

// ── Calendar Grid ───────────────────────────────────────────

export function CalendarView({ items, viewMonth, defaultModel = "sonnet" }: { items: DailyListItem[]; viewMonth: { year: number; month: number }; defaultModel?: string }) {
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewMonth.year, viewMonth.month, 1).getDay();
  const todayStr = new Date().toISOString().split("T")[0];

  const itemsByDate = useMemo(() => {
    const map = new Map<string, DailyListItem>();
    for (const item of items) map.set(item.date, item);
    return map;
  }, [items]);

  // Natural cell count — prev fill + current month + next fill to complete last row
  const cells: Array<{ dateStr: string; label: string; isOutside: boolean }> = [];

  // Leading days from previous month
  const prevMonthDays = new Date(viewMonth.year, viewMonth.month, 0).getDate();
  const pm = viewMonth.month === 0 ? 11 : viewMonth.month - 1;
  const py = viewMonth.month === 0 ? viewMonth.year - 1 : viewMonth.year;
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    cells.push({ dateStr: fmt(py, pm, d), label: i === firstDayOfWeek - 1 ? `${SHORT_MONTHS[pm]} ${d}` : String(d), isOutside: true });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const showMonth = d === 1 && firstDayOfWeek > 0;
    cells.push({ dateStr: fmt(viewMonth.year, viewMonth.month, d), label: showMonth ? `${SHORT_MONTHS[viewMonth.month]} ${d}` : String(d), isOutside: false });
  }

  // Trailing days to complete last row
  const remainder = cells.length % 7;
  if (remainder > 0) {
    const nm = viewMonth.month === 11 ? 0 : viewMonth.month + 1;
    const ny = viewMonth.month === 11 ? viewMonth.year + 1 : viewMonth.year;
    for (let i = 1; i <= 7 - remainder; i++) {
      cells.push({ dateStr: fmt(ny, nm, i), label: i === 1 ? `${SHORT_MONTHS[nm]} 1` : String(i), isOutside: true });
    }
  }

  return (
    <div className="px-4 pb-4">
      {/* Header */}
      <div className="rounded-t-lg overflow-hidden grid grid-cols-7 shrink-0"
        style={{ background: "#1e1e22", border: "1px solid var(--border)", borderBottom: "none" }}>
        {DAYS_OF_WEEK.map((d) => (
          <div key={d} className="text-[10px] text-center py-2.5 uppercase"
            style={{ color: "var(--text-tertiary)", fontWeight: 500, letterSpacing: "0.05em" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid — natural row count */}
      <div className="rounded-b-lg overflow-hidden"
        style={{ border: "1px solid var(--border-bright)", borderTop: "none" }}>
        <div className="grid grid-cols-7 gap-px" style={{ background: "var(--border-bright)" }}>
          {cells.map((c, i) => (
            <CalendarDayCell
              key={i}
              dateStr={c.dateStr}
              label={c.label}
              item={itemsByDate.get(c.dateStr)}
              isToday={c.dateStr === todayStr}
              isFuture={c.dateStr > todayStr}
              isOutside={c.isOutside}
              defaultModel={defaultModel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
