import { useState } from "react";
import type { FileDiffEntry } from "../../lib/types.js";

interface FileDiffsProps {
  diffs: FileDiffEntry[];
  fileName: string;
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + "..." : s;
}

export function FileDiffs({ diffs, fileName }: FileDiffsProps) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 5;
  const visible = showAll ? diffs : diffs.slice(0, INITIAL_COUNT);

  return (
    <div>
      <div className="text-[13px] font-medium mb-3" style={{ color: "var(--text-primary)" }}>
        {fileName.split("/").pop()} — {diffs.length} operation{diffs.length !== 1 ? "s" : ""}
      </div>

      <div className="flex flex-col gap-3">
        {visible.map((d, i) => (
          <div key={i} className="text-[12px]">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono" style={{ color: "var(--text-muted)" }}>#{d.exchange_index}</span>
              <span style={{ color: "var(--text-tertiary)" }}>{d.tool_name}</span>
              {d.is_error && <span style={{ color: "#ef4444" }}>error</span>}
            </div>

            {d.tool_name === "Edit" && d.old_string != null && d.new_string != null && (
              <div className="font-mono text-[11px] rounded px-3 py-2" style={{ background: "var(--bg-elevated)" }}>
                <div style={{ color: "#ef4444" }}>- {trunc(d.old_string, 200)}</div>
                <div style={{ color: "#10b981" }}>+ {trunc(d.new_string, 200)}</div>
              </div>
            )}

            {d.tool_name === "Write" && (
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                created ({d.content_length != null ? `${d.content_length} chars` : "file"})
              </div>
            )}

            {d.tool_name === "Read" && (
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>read file</div>
            )}

            {(d.tool_name === "Grep" || d.tool_name === "Glob") && (
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>searched</div>
            )}
          </div>
        ))}
      </div>

      {!showAll && diffs.length > INITIAL_COUNT && (
        <button
          className="text-[11px] mt-2 hover:underline"
          style={{ color: "var(--text-muted)" }}
          onClick={() => setShowAll(true)}
        >...{diffs.length - INITIAL_COUNT} more</button>
      )}
    </div>
  );
}
