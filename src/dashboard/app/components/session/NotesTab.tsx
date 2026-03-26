import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSessionNotes, generateSessionNotesSSE, deleteSessionNote } from "../../lib/api.js";
import type { SessionNote } from "../../lib/types.js";

// ── Mermaid Diagram Renderer ─────────────────────────────────

let mermaidId = 0;

export function MermaidDiagram({ chart, compact }: { chart: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++mermaidId}`;

    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          primaryColor: "#6366f1",
          primaryTextColor: "#fafafa",
          primaryBorderColor: "#3f3f46",
          lineColor: "#52525b",
          secondaryColor: "#18181b",
          tertiaryColor: "#27272a",
          background: "#111113",
          mainBkg: "#18181b",
          nodeBorder: "#3f3f46",
          clusterBkg: "#18181b",
          titleColor: "#fafafa",
          edgeLabelBackground: "#18181b",
          nodeTextColor: "#fafafa",
        },
        flowchart: { htmlLabels: true, curve: "basis", padding: compact ? 8 : 12 },
        fontFamily: "'Geist', system-ui, sans-serif",
        fontSize: compact ? 11 : 13,
      });
      mermaid.render(id, chart)
        .then(({ svg: rendered }) => { if (!cancelled) setSvg(rendered); })
        .catch((err) => { if (!cancelled) setError(err?.message || "Render failed"); });
    }).catch(() => { if (!cancelled) setError("Mermaid library not available"); });

    return () => { cancelled = true; };
  }, [chart, compact]);

  if (error) {
    return (
      <div className="rounded-lg p-3 my-2" style={{ background: "var(--bg-root)", border: "1px solid var(--border)" }}>
        <pre className="text-[11px] whitespace-pre-wrap" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" }}>{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center gap-2 py-3" style={{ color: "var(--text-muted)" }}>
        <div className="animate-spin w-3 h-3 rounded-full" style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} />
        <span className="text-[11px]">Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`my-3 flex justify-center overflow-x-auto rounded-lg p-3 ${compact ? "mermaid-compact" : ""}`}
      style={{ background: "var(--bg-root)", border: "1px solid var(--border)", ...(compact ? { maxHeight: 240 } : {}) }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── Markdown with Mermaid ────────────────────────────────────

export function MarkdownWithMermaid({ content, compact }: { content: string; compact?: boolean }) {
  const parts: Array<{ type: "text" | "mermaid"; content: string }> = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    parts.push({ type: "mermaid", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) parts.push({ type: "text", content: content.slice(lastIndex) });

  return (
    <div className="md-content">
      {parts.map((part, i) =>
        part.type === "mermaid" ? (
          <MermaidDiagram key={i} chart={part.content} compact={compact} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{part.content}</ReactMarkdown>
        ),
      )}
    </div>
  );
}

// ── Section Parser ───────────────────────────────────────────

interface NoteSection {
  id: string;
  title: string;
  content: string;
  hasMermaid: boolean;
}

function parseNoteSections(content: string): NoteSection[] {
  const sections: NoteSection[] = [];
  const lines = content.split("\n");
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (current) {
        const body = current.lines.join("\n").trim();
        if (body) {
          sections.push({
            id: current.title.toLowerCase().replace(/\s+/g, "-"),
            title: current.title,
            content: body,
            hasMermaid: body.includes("```mermaid"),
          });
        }
      }
      current = { title: headingMatch[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Content before first heading
      if (line.trim()) {
        if (!current) current = { title: "Overview", lines: [] };
        current.lines.push(line);
      }
    }
  }
  if (current) {
    const body = current.lines.join("\n").trim();
    if (body) {
      sections.push({
        id: current.title.toLowerCase().replace(/\s+/g, "-"),
        title: current.title,
        content: body,
        hasMermaid: body.includes("```mermaid"),
      });
    }
  }
  return sections;
}

// ── Live Activity Feed ───────────────────────────────────────

interface AgentEvent {
  type: string;
  message: string;
  detail?: string;
  timestamp: number;
}

const EVENT_ICONS: Record<string, string> = {
  status: "\u25CB",
  mcp_connect: "\u26A1",
  tool_call: "\u25B6",
  thinking: "\u2026",
  result: "\u2714",
  error: "\u2718",
};

const EVENT_COLORS: Record<string, string> = {
  status: "var(--text-muted)",
  mcp_connect: "#60a5fa",
  tool_call: "var(--accent)",
  thinking: "var(--text-tertiary)",
  result: "#10b981",
  error: "#ef4444",
};

export function ActivityFeed({ events }: { events: AgentEvent[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events.length]);

  return (
    <div ref={feedRef} className="overflow-y-auto max-h-72 space-y-0.5 font-mono text-[11px]">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-2 py-0.5">
          <span style={{ color: EVENT_COLORS[ev.type] || "var(--text-muted)", minWidth: 14, textAlign: "center" }}>
            {EVENT_ICONS[ev.type] || "\u00B7"}
          </span>
          <span style={{ color: "var(--text-secondary)" }}>{ev.message}</span>
          {ev.detail && <span className="truncate" style={{ color: "var(--text-muted)" }}>{ev.detail}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Section Card ─────────────────────────────────────────────

function SectionCard({ section, expanded, onToggle }: { section: NoteSection; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
        onClick={onToggle}
      >
        <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{section.title}</span>
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <MarkdownWithMermaid content={section.content} />
        </div>
      )}
    </div>
  );
}

// ── Notes Tab ────────────────────────────────────────────────

interface NotesTabProps {
  sessionId: string;
}

export function NotesTab({ sessionId }: NotesTabProps) {
  const [notes, setNotes] = useState<SessionNote[] | undefined>(undefined);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"sections" | "full" | "raw">("sections");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const cancelRef = useRef<(() => void) | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const data = await getSessionNotes(sessionId);
      setNotes(data || []);
      setSelectedIdx(0);
    } catch {
      setNotes([]);
    }
  }, [sessionId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);
  useEffect(() => () => { cancelRef.current?.(); }, []);

  // When note changes, expand all sections by default
  const note = notes?.[selectedIdx] || null;
  const sections = note ? parseNoteSections(note.content) : [];

  useEffect(() => {
    if (sections.length > 0) {
      setExpandedSections(new Set(sections.map((s) => s.id)));
    }
  }, [note?.id]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    setGenerating(true);
    setError(null);
    setEvents([]);

    cancelRef.current = generateSessionNotesSSE(sessionId, {
      onEvent: (ev) => setEvents((prev) => [...prev, ev]),
      onDone: (newNote) => {
        setNotes((prev) => [newNote, ...(prev || [])]);
        setSelectedIdx(0);
        setGenerating(false);
        setViewMode("sections");
      },
      onError: (err) => {
        setError(err);
        setGenerating(false);
      },
    });
  };

  const handleDelete = async (noteId: string) => {
    try {
      await deleteSessionNote(sessionId, noteId);
      setNotes((prev) => (prev || []).filter((n) => n.id !== noteId));
      setSelectedIdx(0);
    } catch { /* ignore */ }
  };

  if (notes === undefined) {
    return <div className="p-6 text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  }

  // Generating — live activity feed
  if (generating) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="animate-spin w-4 h-4 rounded-full shrink-0" style={{ border: "2px solid var(--border)", borderTopColor: "var(--accent)" }} />
          <div className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
            Generating session notes...
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="rounded-lg p-4" style={{ background: "var(--bg-root)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--text-muted)" }}>
              Agent Activity
            </div>
            <ActivityFeed events={events} />
            {events.length === 0 && (
              <div className="text-[11px] py-2" style={{ color: "var(--text-muted)" }}>Waiting for agent to start...</div>
            )}
          </div>
          <div className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
            The agent uses Keddy MCP tools to inspect this session. Each tool call appears above in real time.
          </div>
        </div>
        {error && (
          <div className="px-6 py-2 text-[12px]" style={{ color: "#ef4444", borderTop: "1px solid var(--border)" }}>{error}</div>
        )}
      </div>
    );
  }

  // Empty state
  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-dim)", border: "1px solid var(--border)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6" />
            <path d="M9 15h6" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-[14px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>No session notes yet</div>
          <p className="text-[12px] max-w-md" style={{ color: "var(--text-muted)" }}>
            An AI agent will inspect this session via Keddy MCP tools and produce a detailed analysis with a visual flow diagram. You'll see every step live.
          </p>
        </div>
        <button onClick={handleGenerate} className="px-5 py-2.5 rounded-lg text-[13px] font-medium hover:opacity-90" style={{ background: "var(--accent)", color: "white" }}>
          Generate Session Notes
        </button>
        {error && <div className="text-[12px] max-w-sm text-center px-4 py-2 rounded-lg" style={{ color: "#ef4444", background: "#ef444410" }}>{error}</div>}
      </div>
    );
  }

  // Notes exist
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-2.5 gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 min-w-0">
          {/* View mode */}
          <div className="flex text-[11px] shrink-0" style={{ border: "1px solid var(--border)", borderRadius: 4 }}>
            {(["sections", "full", "raw"] as const).map((mode, i) => (
              <button
                key={mode}
                className="px-2.5 py-1"
                style={{
                  background: viewMode === mode ? "var(--bg-elevated)" : "transparent",
                  color: viewMode === mode ? "var(--text-primary)" : "var(--text-muted)",
                  borderRadius: i === 0 ? "3px 0 0 3px" : i === 2 ? "0 3px 3px 0" : "0",
                  borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                }}
                onClick={() => setViewMode(mode)}
              >
                {mode === "sections" ? "Sections" : mode === "full" ? "Full" : "Raw"}
              </button>
            ))}
          </div>

          {/* Note version selector */}
          {notes.length > 1 && (
            <select
              value={selectedIdx}
              onChange={(e) => setSelectedIdx(Number(e.target.value))}
              className="text-[11px] px-2 py-1 rounded"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            >
              {notes.map((n, i) => (
                <option key={n.id} value={i}>
                  {new Date(n.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {i === 0 ? " (latest)" : ""}
                </option>
              ))}
            </select>
          )}

          {/* Meta */}
          {note && (
            <div className="flex items-center gap-1.5 text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
              {note.agent_turns != null && <span>{note.agent_turns} turns</span>}
              {note.cost_usd != null && <span>&middot; ${note.cost_usd.toFixed(3)}</span>}
              {note.model && <span>&middot; {note.model.replace("claude-", "").replace(/-\d{8}$/, "")}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleGenerate} className="text-[11px] px-2.5 py-1 rounded hover:opacity-90" style={{ background: "var(--accent)", color: "white" }}>
            + New Note
          </button>
          {note && (
            <button onClick={() => handleDelete(note.id)} className="text-[11px] px-2 py-1 rounded hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }} title="Delete this note">
              &#x2715;
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!note ? (
          <div className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>No note selected</div>
        ) : viewMode === "sections" ? (
          <div className="space-y-2">
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                expanded={expandedSections.has(section.id)}
                onToggle={() => toggleSection(section.id)}
              />
            ))}
          </div>
        ) : viewMode === "full" ? (
          <MarkdownWithMermaid content={note.content} />
        ) : (
          <pre className="text-[12px] whitespace-pre-wrap break-words leading-relaxed" style={{ color: "var(--text-secondary)", fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" }}>
            {note.content}
          </pre>
        )}
      </div>

      {error && (
        <div className="px-6 py-2 text-[12px]" style={{ color: "#ef4444", borderTop: "1px solid var(--border)" }}>{error}</div>
      )}
    </div>
  );
}
