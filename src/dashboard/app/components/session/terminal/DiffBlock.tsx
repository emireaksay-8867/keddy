import { useMemo, useState } from "react";
import { diffLines, diffWords } from "diff";

const CONTEXT_SIZE = 3;

interface DiffLine {
  type: "context" | "added" | "removed";
  content: string;
  oldNo: number | null;
  newNo: number | null;
}

interface Hunk {
  lines: DiffLine[];
  collapsedCount: number; // "N unchanged lines" before this hunk
}

function computeHunks(oldStr: string, newStr: string): Hunk[] {
  const changes = diffLines(oldStr, newStr);
  const allLines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n");
    for (const line of lines) {
      if (change.added) {
        allLines.push({ type: "added", content: line, oldNo: null, newNo: newNo++ });
      } else if (change.removed) {
        allLines.push({ type: "removed", content: line, oldNo: oldNo++, newNo: null });
      } else {
        allLines.push({ type: "context", content: line, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }

  // Find which lines are within CONTEXT_SIZE of a change
  const isChange = allLines.map(l => l.type !== "context");
  const visible = new Array(allLines.length).fill(false);
  for (let i = 0; i < allLines.length; i++) {
    if (isChange[i]) {
      for (let j = Math.max(0, i - CONTEXT_SIZE); j <= Math.min(allLines.length - 1, i + CONTEXT_SIZE); j++) {
        visible[j] = true;
      }
    }
  }

  // Group into hunks
  const hunks: Hunk[] = [];
  let currentHunk: DiffLine[] = [];
  let collapsedCount = 0;

  for (let i = 0; i < allLines.length; i++) {
    if (visible[i]) {
      if (currentHunk.length === 0 && collapsedCount > 0) {
        hunks.push({ lines: [], collapsedCount });
        collapsedCount = 0;
      }
      currentHunk.push(allLines[i]);
    } else {
      if (currentHunk.length > 0) {
        hunks.push({ lines: currentHunk, collapsedCount: 0 });
        currentHunk = [];
      }
      collapsedCount++;
    }
  }
  if (currentHunk.length > 0) {
    hunks.push({ lines: currentHunk, collapsedCount: 0 });
  }
  if (collapsedCount > 0) {
    hunks.push({ lines: [], collapsedCount });
  }

  return hunks;
}

/** Word-level diff for a removed/added line pair */
function WordDiffLine({ oldLine, newLine, type }: { oldLine: string; newLine: string; type: "added" | "removed" }) {
  const words = diffWords(oldLine, newLine);
  const isAdded = type === "added";

  return (
    <>
      {words
        .filter(w => isAdded ? !w.removed : !w.added)
        .map((w, i) => {
          const isHighlighted = isAdded ? w.added : w.removed;
          return (
            <span
              key={i}
              style={isHighlighted ? {
                background: isAdded ? "var(--cc-diff-added-word)" : "var(--cc-diff-removed-word)",
                borderRadius: "2px",
              } : undefined}
            >
              {w.value}
            </span>
          );
        })}
    </>
  );
}

export function DiffBlock({
  oldStr,
  newStr,
}: {
  oldStr: string;
  newStr: string;
}) {
  const [expandedCollapses, setExpandedCollapses] = useState<Set<number>>(new Set());

  const hunks = useMemo(() => computeHunks(oldStr, newStr), [oldStr, newStr]);

  // Build word-diff pairs: match consecutive removed→added sequences
  const wordDiffPairs = useMemo(() => {
    const pairs = new Map<number, { removedContent: string; addedContent: string }>();
    for (const hunk of hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        const next = hunk.lines[i + 1];
        if (line.type === "removed" && next?.type === "added") {
          // Use a unique key based on the line's position
          const key = line.oldNo ?? i;
          pairs.set(key, { removedContent: line.content, addedContent: next.content });
        }
      }
    }
    return pairs;
  }, [hunks]);

  // Performance guard for huge diffs
  if (oldStr.length + newStr.length > 50000) {
    return (
      <div className="whitespace-pre overflow-x-auto text-[11px] ml-6 my-0.5 rounded overflow-hidden" style={{ border: "1px dashed var(--cc-subtle)" }}>
        {oldStr.split("\n").map((line, i) => (
          <div key={`o${i}`} className="px-2" style={{ background: "var(--cc-diff-removed-bg)", color: "var(--text-secondary)" }}>- {line}</div>
        ))}
        {newStr.split("\n").map((line, i) => (
          <div key={`n${i}`} className="px-2" style={{ background: "var(--cc-diff-added-bg)", color: "var(--text-secondary)" }}>+ {line}</div>
        ))}
      </div>
    );
  }

  const maxLineNo = Math.max(
    ...hunks.flatMap(h => h.lines.map(l => l.oldNo ?? l.newNo ?? 0)),
    1
  );
  const lineNoWidth = `${String(maxLineNo).length + 1}ch`;

  const toggleCollapse = (idx: number) => {
    setExpandedCollapses(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  return (
    <div
      className="overflow-x-auto text-[11px] ml-6 my-0.5 rounded overflow-hidden font-mono"
      style={{ border: "1px dashed var(--cc-subtle)" }}
    >
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx}>
          {/* Collapsed unchanged lines */}
          {hunk.collapsedCount > 0 && !expandedCollapses.has(hunkIdx) && (
            <div
              className="text-center py-0.5 text-[10px] cursor-pointer hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--cc-dim)", background: "var(--bg-elevated)" }}
              onClick={() => toggleCollapse(hunkIdx)}
            >
              {hunk.collapsedCount} unchanged line{hunk.collapsedCount !== 1 ? "s" : ""}
            </div>
          )}

          {/* Diff lines */}
          {hunk.lines.map((line, lineIdx) => {
            const bg =
              line.type === "added" ? "var(--cc-diff-added-bg)" :
              line.type === "removed" ? "var(--cc-diff-removed-bg)" :
              "transparent";
            const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

            // Check for word-level diff
            const pairKey = line.type === "removed" ? line.oldNo : null;
            const pair = pairKey != null ? wordDiffPairs.get(pairKey) : null;
            const showWordDiff = pair && (line.type === "removed" || line.type === "added");

            // For added lines that are part of a pair, find the matching removed line
            const addedPairKey = line.type === "added" && lineIdx > 0 && hunk.lines[lineIdx - 1]?.type === "removed"
              ? hunk.lines[lineIdx - 1].oldNo
              : null;
            const addedPair = addedPairKey != null ? wordDiffPairs.get(addedPairKey) : null;

            return (
              <div key={lineIdx} className="flex" style={{ background: bg }}>
                {/* Line number */}
                <span
                  className="select-none text-right shrink-0 px-1"
                  style={{ color: "var(--text-muted)", width: lineNoWidth }}
                >
                  {line.oldNo ?? line.newNo ?? ""}
                </span>
                {/* +/- prefix */}
                <span className="shrink-0 w-4 text-center select-none" style={{ color: "var(--cc-dim)" }}>
                  {prefix}
                </span>
                {/* Content with optional word-level highlights */}
                <span className="pr-2" style={{ color: "var(--text-secondary)" }}>
                  {line.type === "removed" && pair ? (
                    <WordDiffLine oldLine={pair.removedContent} newLine={pair.addedContent} type="removed" />
                  ) : line.type === "added" && addedPair ? (
                    <WordDiffLine oldLine={addedPair.removedContent} newLine={addedPair.addedContent} type="added" />
                  ) : (
                    line.content
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
