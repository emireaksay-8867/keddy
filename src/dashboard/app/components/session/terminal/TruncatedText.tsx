import { useState } from "react";

export function TruncatedText({
  text,
  maxLines,
  prefix,
  prefixStyle,
  textStyle,
}: {
  text: string;
  maxLines: number;
  prefix?: string;
  prefixStyle?: React.CSSProperties;
  textStyle?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsTruncation = lines.length > maxLines;
  const visibleLines = needsTruncation && !expanded ? lines.slice(0, maxLines) : lines;
  const remainingCount = lines.length - maxLines;
  const indent = prefix ? "\u00A0".repeat(prefix.length + 1) : "";

  return (
    <div className="whitespace-pre-wrap break-words">
      {visibleLines.map((line, i) => (
        <div key={i} style={textStyle}>
          {i === 0 && prefix ? (
            <><span style={prefixStyle}>{prefix}</span>{" "}{line}</>
          ) : (
            <>{indent}{line}</>
          )}
        </div>
      ))}
      {needsTruncation && !expanded && (
        <div
          className="cursor-pointer hover:underline"
          style={{ color: "var(--text-muted)" }}
          onClick={() => setExpanded(true)}
        >
          {indent}...show more ({remainingCount} more lines)
        </div>
      )}
      {expanded && needsTruncation && (
        <div
          className="cursor-pointer hover:underline"
          style={{ color: "var(--text-muted)" }}
          onClick={() => setExpanded(false)}
        >
          {indent}show less
        </div>
      )}
    </div>
  );
}
