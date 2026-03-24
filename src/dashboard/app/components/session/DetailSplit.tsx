import { useState, useEffect, type ReactNode } from "react";

interface DetailSplitProps {
  title: string;
  subtitle: string;
  content: ReactNode;
  rawData: unknown;
  onClose: () => void;
}

export function DetailSplit({ title, subtitle, content, rawData, onClose }: DetailSplitProps) {
  const [mode, setMode] = useState<"rendered" | "raw">("rendered");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ borderLeft: "1px solid var(--border)", background: "var(--bg-main)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{title}</div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{subtitle}</div>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <div className="flex text-[11px]" style={{ border: "1px solid var(--border)", borderRadius: 4 }}>
            <button
              className="px-2 py-0.5"
              style={{
                background: mode === "rendered" ? "var(--bg-elevated)" : "transparent",
                color: mode === "rendered" ? "var(--text-primary)" : "var(--text-muted)",
                borderRadius: "3px 0 0 3px",
              }}
              onClick={() => setMode("rendered")}
            >rendered</button>
            <button
              className="px-2 py-0.5"
              style={{
                background: mode === "raw" ? "var(--bg-elevated)" : "transparent",
                color: mode === "raw" ? "var(--text-primary)" : "var(--text-muted)",
                borderRadius: "0 3px 3px 0",
                borderLeft: "1px solid var(--border)",
              }}
              onClick={() => setMode("raw")}
            >raw</button>
          </div>
          <button
            className="text-[13px] px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-muted)" }}
            onClick={onClose}
            title="Close (Esc)"
          >&#x2715;</button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {mode === "rendered" ? (
          content
        ) : (
          <pre
            className="text-[12px] whitespace-pre-wrap break-words"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}
          >{JSON.stringify(rawData, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
