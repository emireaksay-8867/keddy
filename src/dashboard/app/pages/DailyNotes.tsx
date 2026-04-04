import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router";
import { getDailyData, generateDailyNoteSSE, deleteDailyNote } from "../lib/api.js";
import type { DailyData } from "../lib/types.js";
import { MarkdownWithMermaid, ActivityFeed } from "../components/session/NotesTab.js";
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
  const [searchParams] = useSearchParams();
  const today = formatDate(new Date());
  const selectedDate = paramDate || today;
  const autoGenerate = searchParams.get("auto") === "1";

  const [dataByDate, setDataByDate] = useState<Record<string, DailyData>>({});
  const [loading, setLoading] = useState(true);
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; message: string; detail?: string; timestamp: number }>>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [model, setModel] = useState<"haiku" | "sonnet" | "opus">("sonnet");
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedNoteIdx, setSelectedNoteIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Fetch data for selected date
  useEffect(() => {
    setLoading(true);
    setSelectedNoteIdx(0);
    getDailyData(selectedDate)
      .then((d) => setDataByDate((prev) => ({ ...prev, [selectedDate]: d })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedDate]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingText, isStreaming]);

  const data = dataByDate[selectedDate] || null;
  const isGenerating = generatingDate === selectedDate;

  // Auto-trigger generation when arriving from list view "Generate" button
  const autoTriggered = useRef(false);
  useEffect(() => {
    if (autoGenerate && data && (!data.notes || data.notes.length === 0) && !isGenerating && !autoTriggered.current) {
      autoTriggered.current = true;
      navigate(`/daily/${selectedDate}`, { replace: true });
      // Delay slightly to let state settle after navigate
      setTimeout(() => handleGenerate(), 100);
    }
  }, [autoGenerate, data, isGenerating]);

  const handleDateChange = (d: string) => navigate(`/daily/${d}`);

  const handleGenerate = () => {
    setGeneratingDate(selectedDate);
    setEvents([]);
    setStreamingText("");
    setIsStreaming(false);
    const targetDate = selectedDate;
    cleanupRef.current = generateDailyNoteSSE(targetDate, {
      onEvent: (e) => {
        if (generatingDate !== null && targetDate !== generatingDate) return;
        setEvents((prev) => [...prev, e]);
        if (e.type === "result") {
          getDailyData(targetDate)
            .then((d) => { setDataByDate((prev) => ({ ...prev, [targetDate]: d })); setGeneratingDate(null); })
            .catch(() => setGeneratingDate(null));
        }
      },
      onTextDelta: (text) => {
        setIsStreaming(true);
        setStreamingText((prev) => prev + text);
      },
      onDone: () => {
        getDailyData(targetDate)
          .then((d) => setDataByDate((prev) => ({ ...prev, [targetDate]: d })))
          .catch(() => {});
        setSelectedNoteIdx(0);
        setGeneratingDate(null);
        setIsStreaming(false);
        setStreamingText("");
      },
      onError: (err) => {
        setEvents((prev) => [...prev, { type: "error", message: err, timestamp: Date.now() }]);
        setGeneratingDate(null);
        setIsStreaming(false);
      },
    }, { model });
  };

  const handleDelete = async (noteId: string) => {
    await deleteDailyNote(selectedDate, noteId);
    const refreshed = await getDailyData(selectedDate);
    setDataByDate((prev) => ({ ...prev, [selectedDate]: refreshed }));
    setSelectedNoteIdx(0);
  };

  useEffect(() => { return () => { cleanupRef.current?.(); }; }, []);

  useEffect(() => {
    if (!calendarOpen) return;
    const handler = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-calendar]")) setCalendarOpen(false); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [calendarOpen]);

  const sessionCount = data?.sessions.length || 0;

  // Session list header — "Today's Sessions" or date-specific
  const sessionsLabel = selectedDate === today
    ? "Today's Sessions"
    : `Sessions on ${new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex flex-col gap-2" style={{ background: "var(--bg-root)" }}>
        <Link to="/daily" className="text-[11px] hover:underline" style={{ color: "var(--text-muted)" }}>
          &larr; Daily Notes
        </Link>
        <div className="flex items-center gap-3">
        <h1 style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 450, letterSpacing: "0.03em" }}>{fullDateLabel(selectedDate)}</h1>
        <div className="relative" data-calendar>
          <button onClick={() => setCalendarOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <CalendarDays size={11} />
          </button>
          {calendarOpen && <CalendarDropdown selected={selectedDate} onChange={handleDateChange} onClose={() => setCalendarOpen(false)} />}
        </div>
        <div className="flex-1" />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {loading ? (
          <div className="p-8 text-center" style={{ color: "var(--text-tertiary)" }}><span className="text-xs">loading...</span></div>
        ) : !data || sessionCount === 0 ? (
          <div className="p-12 text-center" style={{ color: "var(--text-tertiary)" }}>
            <p className="text-sm mb-1">No sessions recorded</p>
            <p className="text-xs">{selectedDate === today ? "Start a Claude Code session to see it here" : `No activity on ${fullDateLabel(selectedDate)}`}</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* ZONE 1: Session List */}
            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                {sessionsLabel} <span className="font-normal">({sessionCount})</span>
              </h2>
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                {data.sessions.map((s, i) => {
                  const title = s.title || s.session_id.substring(0, 16);
                  const project = s.project_path.split("/").pop();
                  const duration = formatDuration(s.started_at, s.ended_at);
                  const dayRange = data.exchangeRanges?.[s.session_id];
                  const exchLabel = dayRange && dayRange.day_exchange_count < s.exchange_count
                    ? `${dayRange.day_exchange_count} of ${s.exchange_count} exch`
                    : `${s.exchange_count} exch`;
                  return (
                    <Link key={s.session_id} to={`/sessions/${s.session_id}`}
                      className={`flex items-center px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]${i < sessionCount - 1 ? " border-b" : ""}`}
                      style={{ borderColor: i < sessionCount - 1 ? "var(--border)" : undefined }}>
                      <span className="text-[11px] font-mono shrink-0 w-5" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
                      <span className="text-[13px] truncate flex-1"
                        style={{ color: "var(--text-primary)", fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', monospace" }}>
                        {title}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded ml-2"
                        style={{ border: "1px solid var(--border-bright)", color: "var(--text-secondary)" }}>
                        {project}
                      </span>
                      <span className="text-[11px] tabular-nums ml-3" style={{ color: "var(--text-muted)" }}>
                        {exchLabel}{duration ? ` · ${duration}` : ""}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* ZONE 2: Analyze Block — no note yet, not generating */}
            {!isGenerating && !data.note && (
              <section>
                <div className="flex flex-col items-center gap-4 py-10">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ background: "var(--accent-dim)", border: "1px solid rgba(63, 63, 70, 0.4)" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                      <line x1="12" y1="14" x2="12" y2="18" />
                      <line x1="10" y1="16" x2="14" y2="16" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>No daily notes yet</div>
                    <p className="text-[12px] max-w-md" style={{ color: "var(--text-muted)" }}>
                      Generate a summary of what happened across your sessions today.
                    </p>
                  </div>
                  <button onClick={handleGenerate}
                    className="px-5 py-2.5 rounded-lg text-[13px] font-medium hover:opacity-90"
                    style={{ background: "var(--accent)", color: "white" }}>
                    Generate Daily Notes
                  </button>
                  <select value={model} onChange={(e) => setModel(e.target.value as "haiku" | "sonnet" | "opus")}
                    className="text-[12px] px-2 py-1.5 rounded-lg"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    <option value="opus">Opus</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="haiku">Haiku</option>
                  </select>
                </div>
              </section>
            )}

            {/* ZONE 2: Generating — activity feed then streaming text */}
            {isGenerating && (
              <section>
                {isStreaming ? (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="animate-spin w-3 h-3 rounded-full shrink-0"
                        style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} />
                      <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Writing...</span>
                    </div>
                    <div ref={scrollRef} className="overflow-y-auto md-content px-1 pt-2">
                      <MarkdownWithMermaid content={streamingText} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-3 px-4 py-2.5"
                      style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                      <div className="animate-spin w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} />
                      <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Analyzing sessions...</span>
                    </div>
                    <div className="p-4" style={{ background: "var(--bg-elevated)" }}>
                      <ActivityFeed events={events} />
                      {events.length === 0 && (
                        <div className="text-[11px] py-2" style={{ color: "var(--text-muted)" }}>Waiting for agent to start...</div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ZONE 2: Final note with toolbar — matches session notes pattern */}
            {!isGenerating && data.notes && data.notes.length > 0 && (() => {
              const notes = data.notes;
              const note = notes[selectedNoteIdx] || notes[0];
              return (
                <section>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Version selector */}
                      {notes.length > 1 ? (
                        <select value={selectedNoteIdx} onChange={(e) => setSelectedNoteIdx(Number(e.target.value))}
                          className="text-[11px] px-2 py-1 rounded"
                          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                          {notes.map((n, i) => (
                            <option key={n.id} value={i}>
                              {new Date(n.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              {i === 0 ? " (latest)" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[11px] px-2 py-1 rounded"
                          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                          {new Date(note.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      )}
                      {/* Meta */}
                      <div className="flex items-center gap-1.5 text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                        {note.agent_turns != null && <span>{note.agent_turns} turns</span>}
                        {note.cost_usd != null && <span>&middot; ${note.cost_usd.toFixed(3)}</span>}
                        {note.model && <span>&middot; {note.model.replace("claude-", "").replace(/-\d{8}$/, "")}</span>}
                        {data.newExchangesSinceNote != null && data.newExchangesSinceNote > 0 && (
                          <span className="ml-1 px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(234,179,8,0.15)", color: "#eab308" }}>
                            {data.newExchangesSinceNote} new exchange{data.newExchangesSinceNote !== 1 ? "s" : ""} since this note
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select value={model} onChange={(e) => setModel(e.target.value as "haiku" | "sonnet" | "opus")}
                        className="text-[11px] px-1.5 py-1 rounded"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                        <option value="opus">Opus</option>
                        <option value="sonnet">Sonnet</option>
                        <option value="haiku">Haiku</option>
                      </select>
                      <button onClick={handleGenerate}
                        className="text-[11px] px-2.5 py-1 rounded hover:opacity-90"
                        style={{ background: "var(--accent)", color: "white" }}>
                        + New Note
                      </button>
                      <button onClick={() => handleDelete(note.id)}
                        className="text-[11px] px-2 py-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
                        style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                        &#x2715;
                      </button>
                    </div>
                  </div>
                  <div className="md-content px-1">
                    <MarkdownWithMermaid content={note.content} />
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
