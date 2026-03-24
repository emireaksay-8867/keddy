interface StatsTabProps {
  stats: {
    tokens: {
      total_input: number;
      total_output: number;
      total_cache_read: number;
      total_cache_write: number;
      total: number;
      cache_hit_rate: number;
      per_exchange: Array<{
        index: number;
        timestamp: string;
        input: number;
        output: number;
        cache_read: number;
        model: string | null;
      }>;
    };
    tools: {
      counts: Record<string, number>;
      errors: Record<string, number>;
      total: number;
      error_total: number;
    };
    files: Array<{
      file_path: string;
      short_name: string;
      reads: number;
      edits: number;
      writes: number;
    }>;
    models: Array<{
      model: string;
      exchange_count: number;
      total_tokens: number;
      percentage: number;
    }>;
    timing: {
      total_duration_ms: number;
      avg_turn_ms: number;
      longest_turn: { index: number; duration_ms: number } | null;
      exchange_timestamps: Array<{ index: number; timestamp: string }>;
    };
  } | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4
      className="text-xs font-semibold uppercase tracking-wider mb-3"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </h4>
  );
}

function StatNumber({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-lg font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

export function StatsTab({ stats }: StatsTabProps) {
  if (!stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          Stats unavailable
        </span>
      </div>
    );
  }

  const { tokens, tools, files, models, timing } = stats;

  // Tool usage: sorted by count descending
  const toolEntries = Object.entries(tools.counts).sort(([, a], [, b]) => b - a);
  const maxToolCount = toolEntries.length > 0 ? toolEntries[0][1] : 1;

  // Files: sorted by total ops descending
  const sortedFiles = [...files].sort(
    (a, b) => b.reads + b.edits + b.writes - (a.reads + a.edits + a.writes),
  );
  const maxFileOps = sortedFiles.length > 0
    ? sortedFiles[0].reads + sortedFiles[0].edits + sortedFiles[0].writes
    : 1;

  // Per-exchange token chart: find max for scaling
  const maxPerExchange = tokens.per_exchange.reduce(
    (max, ex) => Math.max(max, ex.input + ex.output),
    1,
  );

  return (
    <div className="flex flex-col gap-8 p-6">
      {/* Token Usage */}
      <section>
        <SectionHeader>Token Usage</SectionHeader>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <StatNumber label="Input" value={formatTokens(tokens.total_input)} />
          <StatNumber label="Output" value={formatTokens(tokens.total_output)} />
          <StatNumber label="Total" value={formatTokens(tokens.total)} />
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <StatNumber label="Cache Read" value={formatTokens(tokens.total_cache_read)} />
          <StatNumber label="Cache Write" value={formatTokens(tokens.total_cache_write)} />
          <StatNumber
            label="Cache Hit Rate"
            value={`${Math.round(tokens.cache_hit_rate * 100)}%`}
          />
        </div>

        {/* Per-exchange bar chart */}
        {tokens.per_exchange.length > 0 && (
          <div
            className="mt-4 rounded-lg p-4"
            style={{ background: "var(--bg-elevated)" }}
          >
            <span className="text-xs mb-3 block" style={{ color: "var(--text-muted)" }}>
              Tokens per exchange
            </span>
            <div
              className="flex items-end gap-px"
              style={{ height: "80px" }}
            >
              {tokens.per_exchange.map((ex) => {
                const inputHeight = (ex.input / maxPerExchange) * 100;
                const outputHeight = (ex.output / maxPerExchange) * 100;
                return (
                  <div
                    key={ex.index}
                    className="flex-1 flex flex-col justify-end"
                    style={{ minWidth: "2px", height: "100%" }}
                    title={`#${ex.index}: ${formatTokens(ex.input)} in, ${formatTokens(ex.output)} out`}
                  >
                    <div
                      className="rounded-t-sm"
                      style={{
                        height: `${outputHeight}%`,
                        backgroundColor: "#a78bfa",
                        minHeight: ex.output > 0 ? "1px" : "0",
                      }}
                    />
                    <div
                      style={{
                        height: `${inputHeight}%`,
                        backgroundColor: "#60a5fa",
                        minHeight: ex.input > 0 ? "1px" : "0",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: "#60a5fa" }} />
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Input</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: "#a78bfa" }} />
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Output</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tool Usage */}
      <section>
        <SectionHeader>Tool Usage</SectionHeader>
        {toolEntries.length === 0 ? (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>No tools used</span>
        ) : (
          <div className="flex flex-col gap-2">
            {toolEntries.map(([name, count]) => {
              const errorCount = tools.errors[name] || 0;
              const barWidth = (count / maxToolCount) * 100;
              return (
                <div key={name} className="flex items-center gap-3">
                  <span
                    className="text-xs font-mono w-28 shrink-0 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {name}
                  </span>
                  <div className="flex-1 h-2 rounded-full" style={{ background: "var(--bg-hover)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: "var(--accent)",
                        minWidth: "4px",
                      }}
                    />
                  </div>
                  <span
                    className="text-xs tabular-nums w-10 text-right shrink-0"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {count}
                  </span>
                  {errorCount > 0 && (
                    <span
                      className="text-xs tabular-nums shrink-0"
                      style={{ color: "#ef4444" }}
                    >
                      {errorCount} err
                    </span>
                  )}
                </div>
              );
            })}
            {tools.error_total > 0 && (
              <div className="text-xs mt-1" style={{ color: "#ef4444" }}>
                {tools.error_total} total error{tools.error_total !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Files */}
      <section>
        <SectionHeader>Files</SectionHeader>
        {sortedFiles.length === 0 ? (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>No file operations</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sortedFiles.map((f) => {
              const totalOps = f.reads + f.edits + f.writes;
              const barWidth = (totalOps / maxFileOps) * 100;
              return (
                <div key={f.file_path} className="flex items-center gap-3">
                  <span
                    className="text-xs font-mono w-40 shrink-0 truncate"
                    style={{ color: "var(--text-secondary)" }}
                    title={f.file_path}
                  >
                    {f.short_name}
                  </span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-hover)" }}>
                    <div className="flex h-full">
                      {f.edits > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${(f.edits / totalOps) * barWidth}%`,
                            backgroundColor: "#a78bfa",
                          }}
                        />
                      )}
                      {f.reads > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${(f.reads / totalOps) * barWidth}%`,
                            backgroundColor: "#60a5fa",
                          }}
                        />
                      )}
                      {f.writes > 0 && (
                        <div
                          className="h-full"
                          style={{
                            width: `${(f.writes / totalOps) * barWidth}%`,
                            backgroundColor: "#34d399",
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <span
                    className="text-xs tabular-nums shrink-0"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {f.edits > 0 && <span>{f.edits}e </span>}
                    {f.reads > 0 && <span>{f.reads}r </span>}
                    {f.writes > 0 && <span>{f.writes}w</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Models */}
      <section>
        <SectionHeader>Models</SectionHeader>
        {models.length === 1 ? (
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            <span className="font-mono">{models[0].model}</span>
            <span style={{ color: "var(--text-muted)" }}>
              {" \u00B7 "}100% ({models[0].exchange_count} exchange{models[0].exchange_count !== 1 ? "s" : ""})
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {models.map((m) => (
              <div key={m.model} className="flex items-center gap-3">
                <span
                  className="text-xs font-mono w-40 shrink-0 truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {m.model}
                </span>
                <div className="flex-1 h-2 rounded-full" style={{ background: "var(--bg-hover)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${m.percentage}%`,
                      backgroundColor: "var(--accent)",
                      minWidth: "4px",
                    }}
                  />
                </div>
                <span
                  className="text-xs tabular-nums shrink-0"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {Math.round(m.percentage)}% ({m.exchange_count})
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Timing */}
      <section>
        <SectionHeader>Timing</SectionHeader>
        <div className="grid grid-cols-3 gap-4">
          <StatNumber label="Total Duration" value={formatDuration(timing.total_duration_ms)} />
          <StatNumber label="Avg Turn" value={formatDuration(timing.avg_turn_ms)} />
          {timing.longest_turn && (
            <StatNumber
              label={`Longest Turn (#${timing.longest_turn.index})`}
              value={formatDuration(timing.longest_turn.duration_ms)}
            />
          )}
        </div>
      </section>
    </div>
  );
}
