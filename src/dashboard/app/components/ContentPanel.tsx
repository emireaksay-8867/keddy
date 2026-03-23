import { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SEGMENT_COLORS } from "../lib/constants.js";
import { cleanText } from "../lib/cleanText.js";
import { toolSummary } from "../lib/toolSummary.js";
import { ClaudeIcon } from "./ClaudeIcon.js";
import type { Exchange } from "../lib/types.js";

function fmtShortTime(d: string) { return new Date(d).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }); }

interface ContentPanelProps {
  title: string;
  content: string;
  onClose: () => void;
  subtitle?: string;
  chatExchanges?: Exchange[];
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
}

export function ContentPanel({ title, content, onClose, subtitle, chatExchanges, onPrev, onNext, prevLabel, nextLabel }: ContentPanelProps) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext]);

  const hasMarkdown = /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s|```/m.test(content);
  const showTranscript = chatExchanges && chatExchanges.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 flex flex-col slide-in" style={{ width: "min(960px, 88vw)", background: "var(--bg-root)", borderLeft: "1px solid var(--border)", boxShadow: "-12px 0 40px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div className="px-6 py-3.5 border-b shrink-0" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold">{title}</h3>
              {subtitle && <p className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{subtitle}</p>}
            </div>
          {!showTranscript && hasMarkdown && (
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setMode("rendered")} className="px-3 py-1 text-[12px] transition-colors" style={{ background: mode === "rendered" ? "var(--accent)" : "transparent", color: mode === "rendered" ? "white" : "var(--text-tertiary)" }}>Rendered</button>
              <button onClick={() => setMode("raw")} className="px-3 py-1 text-[12px] transition-colors" style={{ background: mode === "raw" ? "var(--accent)" : "transparent", color: mode === "raw" ? "white" : "var(--text-tertiary)" }}>Raw</button>
            </div>
          )}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-lg" style={{ color: "var(--text-tertiary)" }}>×</button>
          </div>

          {/* Navigation between segments */}
          {(onPrev || onNext) && (
            <div className="flex items-center gap-2 px-6 pt-2">
              <button
                onClick={onPrev}
                disabled={!onPrev}
                className="text-[12px] flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: onPrev ? "var(--text-secondary)" : "var(--text-muted)", opacity: onPrev ? 1 : 0.3 }}
              >
                ← {prevLabel || "Previous"}
              </button>
              <div className="flex-1" />
              <button
                onClick={onNext}
                disabled={!onNext}
                className="text-[12px] flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: onNext ? "var(--text-secondary)" : "var(--text-muted)", opacity: onNext ? 1 : 0.3 }}
              >
                {nextLabel || "Next"} →
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showTranscript ? (
            <PanelTranscript exchanges={chatExchanges} />
          ) : mode === "rendered" && hasMarkdown ? (
            <div className="md-content px-8 py-6"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>
          ) : (
            <pre className="text-[13px] whitespace-pre-wrap leading-relaxed px-8 py-6" style={{ color: "var(--text-secondary)", fontFamily: "inherit" }}>{content}</pre>
          )}
        </div>
      </div>
    </>
  );
}

// Full transcript view inside the panel — same quality as the main transcript page
function PanelTranscript({ exchanges }: { exchanges: Exchange[] }) {
  return (
    <div className="py-4">
      {exchanges.map((ex) => (
        <PanelExchange key={ex.id} ex={ex} />
      ))}
    </div>
  );
}

function PanelExchange({ ex }: { ex: Exchange }) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [userExpanded, setUserExpanded] = useState(false);
  const [claudeExpanded, setClaudeExpanded] = useState(false);
  const tools = ex.tool_calls || [];
  const { cleaned: userText, wasInterrupted: userInt } = cleanText(ex.user_prompt);
  const { cleaned: claudeText } = cleanText(ex.assistant_response || "");
  const isInterrupted = !!ex.is_interrupt || userInt;
  const hasMarkdown = /^#{1,6}\s|^\*\*|^-\s|```/m.test(claudeText);

  const USER_LIMIT = 1500;
  const CLAUDE_LIMIT = 2500;

  return (
    <div className="mb-1">
      {/* Compaction */}
      {!!ex.is_compact_summary && (
        <div className="flex items-center gap-3 px-8 py-3">
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
          <span className="text-[11px] font-medium" style={{ color: SEGMENT_COLORS.exploring }}>Context Compacted</span>
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
        </div>
      )}

      {/* User */}
      {userText && !ex.is_compact_summary && (
        <div className="flex justify-end px-6 py-3">
          <div className="max-w-[80%]">
            <div className="rounded-2xl rounded-br-sm px-5 py-3.5" style={{ background: "var(--user-bubble-bg)" }}>
              <div className="text-[14px] leading-[1.75]" style={{ color: "var(--text-primary)" }}>
                {!userExpanded && userText.length > USER_LIMIT ? (
                  <>
                    <pre className="whitespace-pre-wrap font-[inherit]">{userText.substring(0, USER_LIMIT)}</pre>
                    <button onClick={() => setUserExpanded(true)} className="text-[13px] font-medium hover:underline mt-2 block" style={{ color: "var(--accent-hover)" }}>
                      Show full ({Math.ceil(userText.length / 1000)}k chars)
                    </button>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap font-[inherit]">{userText}</pre>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1.5 px-1">
              {ex.timestamp && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>{fmtShortTime(ex.timestamp)}</span>}
              {isInterrupted && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${SEGMENT_COLORS.pivot}15`, color: SEGMENT_COLORS.pivot }}>interrupted</span>}
            </div>
          </div>
        </div>
      )}

      {/* Tools — visible inline */}
      {tools.length > 0 && (
        <div className="px-6 py-1 ml-6">
          <div className="space-y-0.5">
            {tools.slice(0, toolsExpanded ? tools.length : 3).map((tc) => (
              <div key={tc.id} className="text-[12px] flex items-center gap-2 py-1 px-3 rounded-md" style={{ color: "var(--text-tertiary)" }}>
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }} />
                <span className="font-mono font-medium" style={{ color: tc.is_error ? SEGMENT_COLORS.debugging : "var(--accent)" }}>{tc.tool_name}</span>
                <span className="font-mono truncate flex-1 opacity-50">{toolSummary(tc.tool_name, tc.tool_input)}</span>
                {!!tc.is_error && <span className="text-[10px] px-1 rounded" style={{ background: `${SEGMENT_COLORS.debugging}20`, color: SEGMENT_COLORS.debugging }}>error</span>}
              </div>
            ))}
          </div>
          {tools.length > 3 && (
            <button onClick={() => setToolsExpanded(!toolsExpanded)} className="text-[11px] mt-1 ml-3 hover:underline" style={{ color: "var(--text-muted)" }}>
              {toolsExpanded ? "show less" : `+${tools.length - 3} more tools`}
            </button>
          )}
        </div>
      )}

      {/* Claude */}
      {claudeText && (
        <div className="flex justify-start px-6 py-3">
          <div className="flex gap-3 max-w-[90%]">
            <div className="shrink-0 mt-1"><ClaudeIcon size={18} /></div>
            <div className="flex-1 min-w-0">
              {!claudeExpanded && claudeText.length > CLAUDE_LIMIT ? (
                <div className="text-[14px] leading-[1.75]" style={{ color: "var(--text-secondary)" }}>
                  {hasMarkdown ? (
                    <div className="md-content"><Markdown remarkPlugins={[remarkGfm]}>{claudeText.substring(0, CLAUDE_LIMIT)}</Markdown></div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-[inherit]">{claudeText.substring(0, CLAUDE_LIMIT)}</pre>
                  )}
                  <button onClick={() => setClaudeExpanded(true)} className="text-[13px] font-medium hover:underline mt-2 block" style={{ color: "var(--accent)" }}>
                    Show full response ({Math.ceil(claudeText.length / 1000)}k chars)
                  </button>
                </div>
              ) : hasMarkdown ? (
                <div className="md-content text-[14px]"><Markdown remarkPlugins={[remarkGfm]}>{claudeText}</Markdown></div>
              ) : (
                <pre className="text-[14px] leading-[1.75] whitespace-pre-wrap font-[inherit]" style={{ color: "var(--text-secondary)" }}>{claudeText}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
