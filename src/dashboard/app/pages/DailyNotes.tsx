import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { getDailyData, generateDailyNoteSSE, deleteDailyNote } from "../lib/api.js";
import type { DailyData } from "../lib/types.js";
import { MarkdownWithMermaid, ActivityFeed, parseNoteSections, SectionCard } from "../components/session/NotesTab.js";
import { CalendarDays, Trash2 } from "lucide-react";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function fullDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === formatDate(today)) return "Today, " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (dateStr === formatDate(yesterday)) return "Yesterday, " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60000) return "<1m";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function CalendarDropdown({ selected, onChange, onClose }: { selected: string; onChange: (d: string) => void; onClose: () => void }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selected + "T12:00:00");
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewMonth.year, viewMonth.month, 1).getDay();
  const monthLabel = new Date(viewMonth.year, viewMonth.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const prevMonth = () => setViewMonth((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setViewMonth((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });
  const cells: Array<{ day: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push({ day: null, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: `${viewMonth.year}-${String(viewMonth.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  }
  return (
    <div className="absolute top-full left-0 mt-1 rounded-lg p-3 z-50 shadow-lg" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-bright)", minWidth: 260 }}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="px-2 py-1 rounded text-[12px] hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-secondary)" }}>&larr;</button>
        <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{monthLabel}</span>
        <button onClick={nextMonth} className="px-2 py-1 rounded text-[12px] hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-secondary)" }}>&rarr;</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="text-[10px] py-1" style={{ color: "var(--text-muted)" }}>{d}</div>
        ))}
        {cells.map((c, i) => (
          <button key={i} disabled={!c.dateStr} onClick={() => { if (c.dateStr) { onChange(c.dateStr); onClose(); } }}
            className="text-[12px] py-1.5 rounded transition-colors"
            style={{ color: c.dateStr === selected ? "white" : c.day ? "var(--text-secondary)" : "transparent", background: c.dateStr === selected ? "var(--accent)" : undefined, cursor: c.day ? "pointer" : "default" }}
            onMouseEnter={(e) => { if (c.day && c.dateStr !== selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (c.dateStr !== selected) e.currentTarget.style.background = "transparent"; }}
          >{c.day || ""}</button>
        ))}
      </div>
    </div>
  );
}

export function DailyNotes() {
  const { date: paramDate } = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const today = formatDate(new Date());
  const selectedDate = paramDate || today;

  // Each piece of state is keyed: data is fetched per date, generation is tracked per date
  const [dataByDate, setDataByDate] = useState<Record<string, DailyData>>({});
  const [loading, setLoading] = useState(true);
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; message: string; detail?: string; timestamp: number }>>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [excludedSessions, setExcludedSessions] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const cleanupRef = useRef<(() => void) | null>(null);

  // Fetch data for selected date
  useEffect(() => {
    setLoading(true);
    setExcludedSessions(new Set());
    getDailyData(selectedDate)
      .then((d) => setDataByDate((prev) => ({ ...prev, [selectedDate]: d })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedDate]);

  // Current date's data
  const data = dataByDate[selectedDate] || null;
  const isGenerating = generatingDate === selectedDate;

  const handleDateChange = (d: string) => navigate(d === today ? "/daily" : `/daily/${d}`);

  const handleGenerate = () => {
    setGeneratingDate(selectedDate);
    setEvents([]);
    const targetDate = selectedDate;
    const includedIds = data?.sessions.filter((s) => !excludedSessions.has(s.session_id)).map((s) => s.session_id);
    cleanupRef.current = generateDailyNoteSSE(targetDate, {
      onEvent: (e) => {
        if (generatingDate !== null && targetDate !== generatingDate) return; // stale
        setEvents((prev) => [...prev, e]);
        if (e.type === "result") {
          setExpandedSections(new Set());
          getDailyData(targetDate)
            .then((d) => { setDataByDate((prev) => ({ ...prev, [targetDate]: d })); setGeneratingDate(null); })
            .catch(() => setGeneratingDate(null));
        }
      },
      onDone: (note) => {
        setDataByDate((prev) => {
          const existing = prev[targetDate];
          return existing ? { ...prev, [targetDate]: { ...existing, note } } : prev;
        });
        setGeneratingDate(null);
      },
      onError: (err) => {
        setEvents((prev) => [...prev, { type: "error", message: err, timestamp: Date.now() }]);
        setGeneratingDate(null);
      },
    }, includedIds ? { sessionIds: includedIds } : undefined);
  };

  const handleDelete = async () => {
    await deleteDailyNote(selectedDate);
    setDataByDate((prev) => {
      const existing = prev[selectedDate];
      return existing ? { ...prev, [selectedDate]: { ...existing, note: null } } : prev;
    });
  };

  useEffect(() => { return () => { cleanupRef.current?.(); }; }, []);

  useEffect(() => {
    if (!calendarOpen) return;
    const handler = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-calendar]")) setCalendarOpen(false); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [calendarOpen]);

  const sessionCount = data?.sessions.length || 0;

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5 pb-3 flex items-center gap-3" style={{ background: "var(--bg-root)" }}>
        <h1 style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 450, letterSpacing: "0.03em" }}>Daily Notes</h1>
        <div className="relative" data-calendar>
          <button onClick={() => setCalendarOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            <CalendarDays size={13} style={{ color: "var(--text-muted)" }} />
            {fullDateLabel(selectedDate)}
          </button>
          {calendarOpen && <CalendarDropdown selected={selectedDate} onChange={handleDateChange} onClose={() => setCalendarOpen(false)} />}
        </div>
        <div className="flex-1" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {loading ? (
          <div className="p-8 text-center" style={{ color: "var(--text-tertiary)" }}><span className="text-xs">loading...</span></div>
        ) : !data || sessionCount === 0 ? (
          <div className="p-12 text-center" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm mb-1">No sessions recorded</p>
            <p className="text-xs">{selectedDate === today ? "Start a Claude Code session to see it here" : `No activity on ${fullDateLabel(selectedDate)}`}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Sessions ({sessionCount})
                </h2>
                {!isGenerating && (
                  <button onClick={handleGenerate} className="text-[11px] px-2.5 py-1 rounded hover:opacity-90"
                    style={{ background: "var(--accent)", color: "white" }}>
                    {data.note ? "Regenerate" : "AI Analyze"}
                  </button>
                )}
                {data.note && !isGenerating && (
                  <button onClick={handleDelete} className="text-[11px] px-2 py-1 rounded transition-colors"
                    style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                {data.sessions.map((s, i) => {
                  const title = s.title || s.session_id.substring(0, 16);
                  const project = s.project_path.split("/").pop();
                  const duration = formatDuration(s.started_at, s.ended_at);
                  const excluded = excludedSessions.has(s.session_id);
                  return (
                    <div
                      key={s.session_id}
                      className={`flex items-center px-4 py-2.5 transition-colors${i < sessionCount - 1 ? " border-b" : ""}`}
                      style={{ borderColor: i < sessionCount - 1 ? "var(--border)" : undefined, opacity: excluded ? 0.4 : 1 }}
                    >
                      <button
                        onClick={() => setExcludedSessions((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.session_id)) next.delete(s.session_id); else next.add(s.session_id);
                          return next;
                        })}
                        className="shrink-0 mr-2 w-4 h-4 rounded border flex items-center justify-center transition-colors"
                        style={{
                          borderColor: excluded ? "var(--border)" : "var(--accent)",
                          background: excluded ? "transparent" : "var(--accent)",
                        }}
                        title={excluded ? "Include in analysis" : "Exclude from analysis"}
                      >
                        {!excluded && <span className="text-white text-[10px] leading-none">✓</span>}
                      </button>
                      <Link to={`/sessions/${s.session_id}`} className="flex-1 min-w-0 hover:bg-[var(--bg-hover)] rounded px-1 -mx-1 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
                          <span className="text-[13px] truncate flex-1"
                            style={{ color: "var(--text-primary)", fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', monospace" }}>{title}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded" style={{ border: "1px solid var(--border-bright)", color: "var(--text-secondary)" }}>{project}</span>
                          <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                            {s.exchange_count} exch{duration ? ` · ${duration}` : ""}
                          </span>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Generating state */}
            {isGenerating && (
              <section>
                <h2 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Daily Analysis</h2>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                    <div className="animate-spin w-3.5 h-3.5 rounded-full shrink-0" style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} />
                    <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Generating daily analysis...</span>
                  </div>
                  <div className="p-4" style={{ background: "var(--bg-elevated)" }}>
                    <ActivityFeed events={events} />
                    {events.length === 0 && (
                      <div className="text-[11px] py-2" style={{ color: "var(--text-muted)" }}>Waiting for agent to start...</div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Daily Analysis — AI sections in SectionCard containers */}
            {!isGenerating && data.note && (() => {
              const sections = parseNoteSections(data.note!.content).filter((s) => s.id !== "overview");
              const sectionIds = new Set(sections.map((s) => s.id));
              // On first load (empty set), expand all sections
              const effectiveExpanded = expandedSections.size === 0 ? sectionIds : expandedSections;
              const toggle = (id: string) => setExpandedSections((prev) => {
                // Initialize from effectiveExpanded if this is the first toggle
                const base = prev.size === 0 ? new Set(sectionIds) : new Set(prev);
                if (base.has(id)) base.delete(id); else base.add(id);
                return base;
              });
              return (
                <section>
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Daily Analysis</h2>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {data.note!.agent_turns} turns · ${data.note!.cost_usd?.toFixed(3)}
                      {data.note!.model && ` · ${data.note!.model.replace("claude-", "").replace(/-\d{8}$/, "")}`}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {sections.map((section) => (
                      <SectionCard
                        key={section.id}
                        section={section}
                        expanded={effectiveExpanded.has(section.id)}
                        onToggle={() => toggle(section.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
