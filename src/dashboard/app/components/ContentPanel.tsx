import { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SEGMENT_COLORS } from "../lib/constants.js";
import type { Exchange } from "../lib/types.js";

/** Strip noise from displayed text */
function cleanText(text: string): { cleaned: string; wasInterrupted: boolean } {
  let wasInterrupted = false;
  let cleaned = text;
  if (/\[Request interrupted by user\]/.test(cleaned) || /\[Request interrupted by user for tool use\]/.test(cleaned)) {
    wasInterrupted = true;
    cleaned = cleaned.replace(/\[Request interrupted by user(?:\s+for tool use)?\]/g, "").trim();
  }
  cleaned = cleaned.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
  cleaned = cleaned.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "");
  cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  return { cleaned: cleaned.trim(), wasInterrupted };
}

function fmtShortTime(d: string) { return new Date(d).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }); }

interface ContentPanelProps {
  title: string;
  content: string;
  onClose: () => void;
  subtitle?: string;
  chatExchanges?: Exchange[];
}

export function ContentPanel({ title, content, onClose, subtitle, chatExchanges }: ContentPanelProps) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Detect if content looks like markdown
  const hasMarkdown = /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s|```/m.test(content);

  const showChatBubbles = chatExchanges && chatExchanges.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col slide-in"
        style={{
          width: "min(720px, 80vw)",
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">{title}</h3>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{subtitle}</p>}
          </div>
          {!showChatBubbles && hasMarkdown && (
            <div className="flex rounded overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => setMode("rendered")}
                className="px-2.5 py-1 text-xs transition-colors"
                style={{
                  background: mode === "rendered" ? "var(--accent)" : "transparent",
                  color: mode === "rendered" ? "white" : "var(--text-tertiary)",
                }}
              >
                Rendered
              </button>
              <button
                onClick={() => setMode("raw")}
                className="px-2.5 py-1 text-xs transition-colors"
                style={{
                  background: mode === "raw" ? "var(--accent)" : "transparent",
                  color: mode === "raw" ? "white" : "var(--text-tertiary)",
                }}
              >
                Raw
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors text-lg"
            style={{ color: "var(--text-tertiary)" }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {showChatBubbles ? (
            <PanelChatBubbles exchanges={chatExchanges} />
          ) : mode === "rendered" && hasMarkdown ? (
            <div className="md-content">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap leading-relaxed font-mono" style={{ color: "var(--text-secondary)" }}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}

function PanelChatBubbles({ exchanges }: { exchanges: Exchange[] }) {
  return (
    <div className="chat-transcript space-y-1">
      {exchanges.map((ex) => {
        const { cleaned: userText, wasInterrupted: userInt } = cleanText(ex.user_prompt);
        const { cleaned: claudeText, wasInterrupted: claudeInt } = cleanText(ex.assistant_response || "");
        const isInterrupted = !!ex.is_interrupt || userInt || claudeInt;
        const tools = ex.tool_calls || [];

        return (
          <div key={ex.id} className="mb-3">
            {/* Compaction divider */}
            {!!ex.is_compact_summary && (
              <div className="flex items-center gap-3 py-2 my-1">
                <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
                <span className="text-[11px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context Compacted</span>
                <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
              </div>
            )}

            {/* User bubble */}
            {userText && !ex.is_compact_summary && (
              <div className="flex justify-end mb-2">
                <div className="max-w-[80%]">
                  <div className="rounded-2xl rounded-br-md px-4 py-3" style={{ background: "var(--user-bubble-bg)" }}>
                    <pre className="text-[13px] leading-[1.7] whitespace-pre-wrap font-[inherit]" style={{ color: "var(--text-primary)" }}>{userText}</pre>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-1 px-1">
                    <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>#{ex.exchange_index}</span>
                    {ex.timestamp && <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ex.timestamp)}</span>}
                    {isInterrupted && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>}
                  </div>
                </div>
              </div>
            )}

            {/* Tool calls */}
            {tools.length > 0 && (
              <div className="flex justify-start mb-2 ml-8">
                <span className="text-[11px] font-mono px-2 py-1 rounded-lg" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)" }}>
                  {tools.length} tool{tools.length !== 1 ? "s" : ""}: {[...new Set(tools.map((t) => t.tool_name))].slice(0, 3).join(", ")}
                </span>
              </div>
            )}

            {/* Claude response */}
            {claudeText && (
              <div className="flex justify-start mb-2">
                <div className="flex gap-2.5 max-w-[85%]">
                  <span className="shrink-0 mt-1 text-[16px] leading-none select-none" style={{ color: "var(--claude-accent)" }}>✦</span>
                  <pre className="text-[13px] leading-[1.7] whitespace-pre-wrap font-[inherit] flex-1 min-w-0" style={{ color: "var(--text-secondary)" }}>{claudeText}</pre>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
