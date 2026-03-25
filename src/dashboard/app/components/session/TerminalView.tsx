import { useState } from "react";
import { cleanText } from "../../lib/cleanText.js";
import type { Exchange, ToolCall, CompactionEvent } from "../../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function firstLine(s: string, max: number): string {
  const line = s.split("\n")[0] || "";
  return line.length > max ? line.substring(0, max) + "\u2026" : line;
}

// ── Expandable ─────────────────────────────────────────────────
function Expandable({
  preview,
  children,
  defaultOpen = false,
}: {
  preview: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className="cursor-pointer select-none -mx-1 px-1 rounded hover:bg-[var(--bg-hover)]"
        onClick={() => setOpen(!open)}
      >
        {preview}
      </div>
      {open && children}
    </div>
  );
}

// ── Tool Call Row ──────────────────────────────────────────────
function ToolRow({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const isError = !!tc.is_error;
  const name = tc.tool_name;

  let input: Record<string, unknown> = {};
  try { input = JSON.parse(tc.tool_input || "{}"); } catch { /* ignore */ }

  let summary = "";
  let inlineDiff: React.ReactNode = null;
  let expandedContent: React.ReactNode = null;

  if (name === "Read") {
    const fp = tc.file_path || (input.file_path as string) || "";
    const offset = input.offset ? `:${input.offset}` : "";
    const limit = input.limit ? `+${input.limit}` : "";
    summary = `${fp}${offset}${limit}`;
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[400px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 10000)}
          {tc.tool_result.length > 10000 && "\n\u2026 (truncated)"}
        </div>
      );
    }
  } else if (name === "Edit") {
    const fp = tc.file_path || (input.file_path as string) || "";
    const oldStr = (input.old_string as string) || "";
    const newStr = (input.new_string as string) || "";
    const replaceAll = input.replace_all ? " (replace all)" : "";
    summary = `${fp}${replaceAll}`;
    if (oldStr || newStr) {
      inlineDiff = (
        <div className="text-[11px] whitespace-pre overflow-x-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)" }}>
          {oldStr.split("\n").map((line, i) => (
            <div key={`o${i}`} style={{ color: "#b55a5a" }}>- {line}</div>
          ))}
          {newStr.split("\n").map((line, i) => (
            <div key={`n${i}`} style={{ color: "#5a9e6f" }}>+ {line}</div>
          ))}
        </div>
      );
    }
  } else if (name === "Write") {
    const fp = tc.file_path || (input.file_path as string) || "";
    const content = (input.content as string) || "";
    summary = fp;
    if (content) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[400px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {content.substring(0, 5000)}
          {content.length > 5000 && "\n\u2026 (truncated)"}
        </div>
      );
    }
  } else if (name === "Bash") {
    const cmd = tc.bash_command || (input.command as string) || "";
    const desc = tc.bash_desc || (input.description as string) || "";
    summary = cmd || desc;
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[400px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 10000)}
          {tc.tool_result.length > 10000 && "\n\u2026 (truncated)"}
        </div>
      );
    }
  } else if (name === "Grep") {
    const pattern = (input.pattern as string) || "";
    const path = (input.path as string) || "";
    summary = `/${pattern}/${path ? ` in ${path}` : ""}`;
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 8000)}
          {tc.tool_result.length > 8000 && "\n\u2026 (truncated)"}
        </div>
      );
    }
  } else if (name === "Glob") {
    summary = (input.pattern as string) || "";
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 8000)}
          {tc.tool_result.length > 8000 && "\n\u2026 (truncated)"}
        </div>
      );
    }
  } else if (name === "Agent") {
    const desc = tc.subagent_desc || (input.description as string) || "";
    const type = tc.subagent_type || (input.subagent_type as string) || "";
    summary = type ? `[${type}] ${desc}` : desc;
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[400px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 10000)}
          {tc.tool_result.length > 10000 && "\n\u2026 (truncated)"}
        </div>
      );
    }
  } else if (name === "WebSearch") {
    summary = tc.web_query || (input.query as string) || "";
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 5000)}
        </div>
      );
    }
  } else if (name === "WebFetch") {
    summary = tc.web_url || (input.url as string) || "";
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 5000)}
        </div>
      );
    }
  } else if (name === "Skill") {
    summary = tc.skill_name || (input.skill as string) || "";
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 5000)}
        </div>
      );
    }
  } else {
    summary = tc.bash_desc || Object.keys(input).slice(0, 3).join(", ") || name;
    if (tc.tool_result) {
      expandedContent = (
        <div className="text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto py-1.5 px-3 rounded mt-1" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 5000)}
        </div>
      );
    }
  }

  const hasExpand = !!expandedContent;

  return (
    <div className="mb-0.5">
      {/* Grey-highlighted tool row */}
      <div
        className={`flex items-baseline gap-2 py-1 px-3 rounded ${hasExpand ? "cursor-pointer" : ""}`}
        style={{ background: "var(--bg-elevated)" }}
        onClick={hasExpand ? () => setOpen(!open) : undefined}
      >
        {hasExpand && (
          <span className="shrink-0 text-[9px] w-2" style={{ color: "var(--text-muted)" }}>
            {open ? "\u25BC" : "\u25B6"}
          </span>
        )}
        <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>{name}</span>
        <span className="min-w-0 truncate text-[11px]" style={{ color: isError ? "#b55a5a" : "var(--text-secondary)" }}>
          {summary.length > 200 ? summary.substring(0, 200) + "\u2026" : summary}
        </span>
        {isError && <span className="shrink-0 text-[10px]" style={{ color: "#b55a5a" }}>error</span>}
      </div>

      {/* Inline diff — always visible for Edit */}
      {inlineDiff}

      {/* Error preview when collapsed */}
      {isError && tc.tool_result && !open && !inlineDiff && (
        <div className="text-[11px] truncate px-3 py-0.5" style={{ color: "var(--text-muted)" }}>
          {tc.tool_result.split("\n")[0]?.substring(0, 200) || ""}
        </div>
      )}

      {/* Expanded output */}
      {open && expandedContent}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────
interface TerminalViewProps {
  exchanges: Exchange[];
  milestones: Array<{ milestone_type: string; exchange_index: number; description: string }>;
  compactionEvents: CompactionEvent[];
}

export function TerminalView({ exchanges, milestones }: TerminalViewProps) {
  const milestonesByIdx = new Map<number, Array<{ type: string; desc: string }>>();
  for (const m of milestones) {
    if (!milestonesByIdx.has(m.exchange_index)) milestonesByIdx.set(m.exchange_index, []);
    milestonesByIdx.get(m.exchange_index)!.push({ type: m.milestone_type, desc: m.description });
  }

  return (
    <div className="font-mono text-[12px] leading-relaxed">
      {exchanges.map((ex) => {
        const { cleaned: userText } = cleanText(ex.user_prompt);
        const { cleaned: claudeText } = cleanText(ex.assistant_response || "");
        const tools = ex.tool_calls || [];
        const time = ex.timestamp ? fmtTime(ex.timestamp) : "";
        const model = ex.model?.replace("claude-", "").replace(/-\d{8}$/, "") ?? "";

        const metaParts: string[] = [];
        if (model) metaParts.push(model);
        if (ex.input_tokens) metaParts.push(`${fmtTokens(ex.input_tokens)} in / ${fmtTokens(ex.output_tokens || 0)} out`);
        if (ex.cache_read_tokens && ex.input_tokens && ex.input_tokens > 0) {
          metaParts.push(`${Math.round((ex.cache_read_tokens / ex.input_tokens) * 100)}% cached`);
        }
        if (ex.turn_duration_ms) metaParts.push(fmtMs(ex.turn_duration_ms));
        if (ex.has_thinking) metaParts.push("thinking");
        if (ex.is_sidechain) metaParts.push("sidechain");
        if (ex.stop_reason && ex.stop_reason !== "end_turn") metaParts.push(`stop: ${ex.stop_reason}`);

        const userPreview = userText ? firstLine(userText, 100) : "";
        const claudePreview = claudeText ? firstLine(claudeText, 100) : "";
        const isLongUser = userText.length > 120 || userText.includes("\n");
        const isLongClaude = claudeText.length > 150 || claudeText.includes("\n");

        return (
          <div key={ex.exchange_index} id={`terminal-${ex.exchange_index}`} className="scroll-mt-16">
            {/* Milestones */}
            {milestonesByIdx.get(ex.exchange_index)?.map((ms, i) => (
              <div key={i} className="px-5 py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{ms.desc}</span>
              </div>
            ))}

            {/* Compaction */}
            {!!ex.is_compact_summary && (
              <div className="px-5 py-2 text-center text-[11px]" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                {"\u2500\u2500\u2500"} context compacted {"\u2500\u2500\u2500"}
              </div>
            )}

            {/* Exchange */}
            <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              {/* Header */}
              <div className="flex items-center gap-2 mb-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                <span className="font-bold">#{ex.exchange_index}</span>
                {time && <span>{time}</span>}
                {ex.cwd && <span className="truncate max-w-[300px]">{ex.cwd.split("/").slice(-3).join("/")}</span>}
                {metaParts.length > 0 && <span className="ml-auto shrink-0">{metaParts.join(" \u00B7 ")}</span>}
              </div>

              {/* User prompt — grey, it's just what was typed */}
              {userText && !ex.is_compact_summary && (
                <div className="mb-2">
                  {isLongUser ? (
                    <Expandable
                      preview={
                        <div className="flex items-baseline gap-2 py-0.5">
                          <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u25B6"}</span>
                          <span className="truncate" style={{ color: "var(--text-tertiary)" }}>{userPreview}</span>
                        </div>
                      }
                    >
                      <div className="whitespace-pre-wrap break-words text-[12px] py-1 ml-4" style={{ color: "var(--text-tertiary)" }}>
                        {userText}
                      </div>
                    </Expandable>
                  ) : (
                    <div style={{ color: "var(--text-tertiary)" }}>{userText}</div>
                  )}
                  {!!ex.is_interrupt && (
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>[interrupted]</div>
                  )}
                </div>
              )}

              {/* Tool calls */}
              {tools.length > 0 && (
                <div className="my-2">
                  {tools.map((tc, i) => <ToolRow key={i} tc={tc} />)}
                </div>
              )}

              {/* Claude response — this is the content you're reading */}
              {claudeText && (
                <div className="mt-2">
                  {isLongClaude ? (
                    <Expandable
                      preview={
                        <div className="flex items-baseline gap-2 py-0.5">
                          <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u25B6"}</span>
                          <span className="truncate" style={{ color: "var(--text-secondary)" }}>{claudePreview}</span>
                        </div>
                      }
                    >
                      <div className="whitespace-pre-wrap break-words text-[12px] py-1 ml-4" style={{ color: "var(--text-secondary)" }}>
                        {claudeText}
                      </div>
                    </Expandable>
                  ) : (
                    <div style={{ color: "var(--text-secondary)" }}>{claudeText}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
