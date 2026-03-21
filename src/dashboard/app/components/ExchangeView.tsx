import { useState } from "react";
import type { Exchange } from "../lib/types.js";

interface ExchangeViewProps {
  exchange: Exchange;
}

export function ExchangeView({ exchange }: ExchangeViewProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] cursor-pointer hover:border-[var(--color-accent)] transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5">
          #{exchange.exchange_index}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{exchange.user_prompt || "(empty prompt)"}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-muted)]">
            {exchange.tool_call_count > 0 && <span>{exchange.tool_call_count} tools</span>}
            {!!exchange.is_interrupt && (
              <span className="text-[#EC4899]">interrupted</span>
            )}
            {!!exchange.is_compact_summary && (
              <span className="text-[#F59E0B]">compacted</span>
            )}
          </div>
        </div>
        <span className="text-xs text-[var(--color-text-muted)]">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div>
            <h5 className="text-xs font-medium text-[var(--color-accent)] mb-1">User</h5>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-[var(--color-bg)] p-2 rounded max-h-40 overflow-y-auto">
              {exchange.user_prompt}
            </pre>
          </div>
          {exchange.assistant_response && (
            <div>
              <h5 className="text-xs font-medium text-[#10B981] mb-1">Assistant</h5>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-[var(--color-bg)] p-2 rounded max-h-40 overflow-y-auto">
                {exchange.assistant_response}
              </pre>
            </div>
          )}
          {exchange.tool_calls && exchange.tool_calls.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Tool Calls
              </h5>
              <div className="space-y-1">
                {exchange.tool_calls.map((tc) => (
                  <div
                    key={tc.id}
                    className="text-xs font-mono bg-[var(--color-bg)] p-2 rounded flex items-start gap-2"
                  >
                    <span className={tc.is_error ? "text-[#EF4444]" : "text-[var(--color-accent)]"}>
                      {tc.tool_name}
                    </span>
                    <span className="text-[var(--color-text-muted)] truncate">
                      {tc.tool_input.substring(0, 100)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
