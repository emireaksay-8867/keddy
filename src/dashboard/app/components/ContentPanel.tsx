import { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ContentPanelProps {
  title: string;
  content: string;
  onClose: () => void;
  subtitle?: string;
}

export function ContentPanel({ title, content, onClose, subtitle }: ContentPanelProps) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Detect if content looks like markdown
  const hasMarkdown = /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s|```/m.test(content);

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
          {hasMarkdown && (
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
          {mode === "rendered" && hasMarkdown ? (
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
