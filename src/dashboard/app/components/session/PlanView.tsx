import { useState, useEffect, useRef } from "react";

interface PlanViewProps {
  planText: string;
  version: number;
  status: string;
  changedSections?: Set<number>;
}

/** Parse plan text into structured sections */
export function parseSections(text: string): Array<{ heading: string; level: number; content: string }> {
  const lines = text.split("\n");
  const sections: Array<{ heading: string; level: number; content: string }> = [];
  let currentHeading = "";
  let currentLevel = 0;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({ heading: currentHeading, level: currentLevel, content: currentLines.join("\n").trim() });
      }
      currentHeading = headingMatch[2];
      currentLevel = headingMatch[1].length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentHeading || currentLines.length > 0) {
    sections.push({ heading: currentHeading, level: currentLevel, content: currentLines.join("\n").trim() });
  }

  return sections;
}

/** Render a content block — handles code blocks as expandable, inline code as styled, rest as text */
function ContentBlock({ text }: { text: string }) {
  if (!text) return null;

  // Split content into segments: regular text vs code blocks
  const segments: Array<{ type: "text" | "code"; content: string; lang?: string }> = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", content: match[2].trim(), lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return (
    <div className="space-y-2">
      {segments.map((seg, i) => {
        if (seg.type === "code") {
          return <CodeBlock key={i} code={seg.content} lang={seg.lang} />;
        }
        return <TextBlock key={i} text={seg.content} />;
      })}
    </div>
  );
}

/** Code block — shown as written, with language label */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="rounded" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
      {lang && (
        <div className="px-3 py-1 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{lang}</div>
      )}
      <pre
        className="px-3 pb-2 pt-1 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap"
        style={{ color: "var(--text-secondary)", letterSpacing: "-0.02em" }}
      >{code}</pre>
    </div>
  );
}

/** Text content — renders inline code, file paths, bold, lists */
function TextBlock({ text }: { text: string }) {
  if (!text.trim()) return null;

  const lines = text.split("\n");

  return (
    <div className="text-[12px] space-y-1" style={{ color: "var(--text-secondary)" }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;

        // Horizontal rule
        if (/^-{3,}$/.test(trimmed)) return <div key={i} className="h-px my-2" style={{ background: "var(--border)" }} />;

        // List items
        const listMatch = trimmed.match(/^[-*]\s+(.*)/);
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);

        const content = listMatch ? listMatch[1] : numMatch ? numMatch[2] : trimmed;
        const prefix = listMatch ? "\u2022 " : numMatch ? `${numMatch[1]}. ` : "";

        return (
          <div key={i} className={listMatch || numMatch ? "ml-2" : ""}>
            {prefix && <span style={{ color: "var(--text-muted)" }}>{prefix}</span>}
            <InlineText text={content} />
          </div>
        );
      })}
    </div>
  );
}

/** Inline text rendering — bold, inline code, file paths */
function InlineText({ text }: { text: string }) {
  // Split by: **bold**, `inline code`, file paths
  const parts: Array<{ type: "text" | "bold" | "code"; content: string }> = [];
  const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)/g;
  let lastIdx = 0;
  let m;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ type: "text", content: text.slice(lastIdx, m.index) });
    }
    if (m[1]) {
      parts.push({ type: "bold", content: m[1].replace(/\*\*/g, "") });
    } else if (m[2]) {
      parts.push({ type: "code", content: m[2].replace(/`/g, "") });
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ type: "text", content: text.slice(lastIdx) });
  }

  return (
    <span>
      {parts.map((p, i) => {
        if (p.type === "bold") {
          return <span key={i} className="font-semibold" style={{ color: "var(--text-primary)" }}>{p.content}</span>;
        }
        if (p.type === "code") {
          return (
            <span key={i} className="font-mono text-[11px] px-1 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)", letterSpacing: "-0.02em" }}>
              {p.content}
            </span>
          );
        }
        return <span key={i}>{p.content}</span>;
      })}
    </span>
  );
}

export function PlanView({ planText, version, status, changedSections }: PlanViewProps) {
  if (!planText) return <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>(empty plan)</div>;

  const sections = parseSections(planText);
  const firstChangedRef = useRef<HTMLDivElement>(null);
  const hasChanges = changedSections && changedSections.size > 0;

  // Scroll to first changed section instantly after render
  useEffect(() => {
    if (hasChanges && firstChangedRef.current) {
      requestAnimationFrame(() => {
        firstChangedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [hasChanges, planText]);

  return (
    <div className="space-y-4">
      {sections.map((sec, i) => {
        const isChanged = changedSections?.has(i) ?? false;
        const isFirstChanged = isChanged && ![...Array(i)].some((_, j) => changedSections?.has(j));

        return (
          <div
            key={i}
            ref={isFirstChanged ? firstChangedRef : undefined}
          >
            {sec.heading && (
              <div
                className={`font-mono font-medium mb-1.5 ${sec.level === 1 ? "text-[14px]" : sec.level === 2 ? "text-[12px]" : "text-[11px]"}`}
                style={{
                  color: sec.level === 1 ? "var(--text-primary)" : "var(--text-secondary)",
                  letterSpacing: "-0.02em",
                }}
              >
                {sec.heading}
              </div>
            )}
            <ContentBlock text={sec.content} />
          </div>
        );
      })}
    </div>
  );
}
