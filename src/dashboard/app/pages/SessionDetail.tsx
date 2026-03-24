import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router";
import { getSession, getSessionExchanges, analyzeSession, getConfig, updateConfig, getFileDiffs } from "../lib/api.js";
import { cleanText } from "../lib/cleanText.js";
import { DetailSplit } from "../components/session/DetailSplit.js";
import { OutcomesBar } from "../components/session/OutcomesBar.js";
import { PlanSection } from "../components/session/PlanSection.js";
import { FilesSection } from "../components/session/FilesSection.js";
import { FileDiffs } from "../components/session/FileDiffs.js";
import { PlanView } from "../components/session/PlanView.js";
import { TimelineView } from "../components/session/TimelineView.js";
import { ClaudeIcon } from "../components/ClaudeIcon.js";
import type { SessionDetail as SessionDetailType, Exchange, ToolCall, Plan, FileDiffEntry, CompactionEvent } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function fmtDuration(a: string, b: string | null) {
  if (!b) return "";
  const m = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m < 1) return "<1m"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function fmtMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Detail Panel State ─────────────────────────────────────────
interface DetailState {
  open: boolean;
  title: string;
  subtitle: string;
  content: ReactNode;
  rawData: unknown;
}

const EMPTY_DETAIL: DetailState = { open: false, title: "", subtitle: "", content: null, rawData: null };

// ── Exchange Metadata Bar ──────────────────────────────────────
function ExchangeMeta({ ex }: { ex: Exchange }) {
  if (!ex.model && !ex.input_tokens) return null;
  const model = ex.model?.replace("claude-", "").replace(/-\d{8}$/, "") ?? "";
  const items: string[] = [];
  if (model) items.push(model);
  if (ex.input_tokens) items.push(`${fmtTokens(ex.input_tokens)} in / ${fmtTokens(ex.output_tokens || 0)} out`);
  if (ex.cache_read_tokens && ex.input_tokens && ex.input_tokens > 0) {
    items.push(`${Math.round((ex.cache_read_tokens / ex.input_tokens) * 100)}% cached`);
  }
  if (ex.turn_duration_ms) items.push(fmtMs(ex.turn_duration_ms));
  return (
    <div className="flex items-center gap-2 text-[10px] py-1 px-2 flex-wrap" style={{ color: "var(--text-muted)" }}>
      {items.map((item, i) => (
        <span key={i} className={i === 0 ? "font-mono" : ""}>{i > 0 && <span className="mr-2" style={{ color: "var(--border)" }}>&middot;</span>}{item}</span>
      ))}
      {!!ex.has_thinking && <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>thinking</span>}
      {!!ex.is_sidechain && <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>sidechain</span>}
    </div>
  );
}

// ── Tool Call Card ─────────────────────────────────────────────
function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isError = !!tc.is_error;
  const name = tc.tool_name;

  // Parse tool_input for display
  let input: Record<string, unknown> = {};
  try { input = JSON.parse(tc.tool_input || "{}"); } catch { /* ignore */ }

  // Build one-liner summary based on tool type
  let summary = "";
  let detail: React.ReactNode = null;

  if (name === "Read") {
    const fp = tc.file_path || (input.file_path as string) || "";
    const fname = fp.split("/").pop() || fp;
    const lines = tc.tool_result ? tc.tool_result.split("\n").length : 0;
    summary = `${fname}${lines > 0 ? ` \u00B7 ${lines} lines` : ""}`;
  } else if (name === "Edit") {
    const fp = tc.file_path || (input.file_path as string) || "";
    const fname = fp.split("/").pop() || fp;
    const old_str = (input.old_string as string) || "";
    const new_str = (input.new_string as string) || "";
    summary = fname;
    if (old_str || new_str) {
      detail = (
        <div className="font-mono text-[11px] mt-1.5 rounded px-2.5 py-1.5 overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
          {old_str.split("\n").slice(0, 3).map((line, i) => (
            <div key={`o${i}`} className="truncate" style={{ color: "#ef4444" }}>- {line}</div>
          ))}
          {new_str.split("\n").slice(0, 3).map((line, i) => (
            <div key={`n${i}`} className="truncate" style={{ color: "#10b981" }}>+ {line}</div>
          ))}
          {(old_str.split("\n").length > 3 || new_str.split("\n").length > 3) && (
            <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>...</div>
          )}
        </div>
      );
    }
  } else if (name === "Write") {
    const fp = tc.file_path || (input.file_path as string) || "";
    const fname = fp.split("/").pop() || fp;
    const contentLen = (input.content as string)?.length || 0;
    summary = `${fname} \u00B7 created${contentLen ? ` (${fmtTokens(contentLen)} chars)` : ""}`;
  } else if (name === "Bash") {
    const cmd = tc.bash_command || (input.command as string) || "";
    summary = cmd.length > 80 ? cmd.substring(0, 80) + "..." : cmd;
    if (tc.tool_result && expanded) {
      detail = (
        <div className="font-mono text-[11px] mt-1.5 rounded px-2.5 py-1.5 max-h-[200px] overflow-y-auto whitespace-pre-wrap" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          {tc.tool_result.substring(0, 2000)}
          {tc.tool_result.length > 2000 && "\n..."}
        </div>
      );
    }
  } else if (name === "Grep" || name === "Glob") {
    const pattern = (input.pattern as string) || "";
    const path = (input.path as string) || "";
    summary = `${pattern}${path ? ` in ${path.split("/").pop()}` : ""}`;
  } else if (name === "Agent") {
    summary = tc.subagent_desc || (input.description as string) || (tc.subagent_type || "agent");
  } else if (name === "WebSearch" || name === "WebFetch") {
    summary = tc.web_query || tc.web_url || (input.query as string) || (input.url as string) || "";
  } else if (name === "Skill") {
    summary = tc.skill_name || (input.skill as string) || "";
  } else {
    summary = tc.bash_desc || Object.keys(input).slice(0, 2).join(", ") || "";
  }

  const hasExpandable = name === "Bash" && tc.tool_result;

  return (
    <div
      className={`rounded px-2.5 py-1.5 text-[12px] ${hasExpandable ? "cursor-pointer" : ""}`}
      style={{
        background: "var(--bg-surface)",
        border: `1px solid ${isError ? "#ef444440" : "var(--border)"}`,
        borderLeft: isError ? "3px solid #ef4444" : undefined,
      }}
      onClick={hasExpandable ? () => setExpanded(!expanded) : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 font-medium text-[11px]" style={{ color: isError ? "#ef4444" : "var(--accent)" }}>{name}</span>
        <span className="truncate font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>{summary}</span>
        {isError && <span className="shrink-0 text-[10px] font-medium" style={{ color: "#ef4444" }}>ERROR</span>}
        {hasExpandable && !expanded && (
          <span className="shrink-0 text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{"\u25B8"} output</span>
        )}
      </div>
      {/* Error message shown immediately */}
      {isError && tc.tool_result && (
        <div className="font-mono text-[11px] mt-1 truncate" style={{ color: "#ef4444" }}>
          {trunc(tc.tool_result.split("\n")[0] || "", 200)}
        </div>
      )}
      {/* Inline detail (Edit diff, Bash output) */}
      {detail}
    </div>
  );
}

// ── Exchange Bubble (used in transcript) ───────────────────────
function ExchangeBubble({ ex }: { ex: Exchange }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const { cleaned: userText } = cleanText(ex.user_prompt);
  const { cleaned: claudeText } = cleanText(ex.assistant_response || "");
  const hasErrors = tools.some(tc => !!tc.is_error);

  return (
    <div id={`exchange-${ex.exchange_index}`} className="scroll-mt-16">
      {!!ex.is_compact_summary && (
        <div className="flex items-center gap-3 py-3 my-2">
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
          <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Context Compacted</span>
          <div className="h-px flex-1" style={{ background: "var(--border-bright)" }} />
        </div>
      )}
      {userText && !ex.is_compact_summary && (
        <div className="flex justify-end mb-3">
          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-md text-[13px]" style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}>
            <div className="whitespace-pre-wrap break-words">{trunc(userText, 1200)}</div>
            {!!ex.is_interrupt && <div className="text-[11px] mt-1 italic" style={{ color: "#f59e0b" }}>[interrupted]</div>}
          </div>
        </div>
      )}
      {/* Exchange metadata bar */}
      <ExchangeMeta ex={ex} />
      {claudeText && (
        <div className="flex justify-start mb-3">
          <div className="max-w-[85%] flex gap-2">
            <div className="shrink-0 mt-1"><ClaudeIcon size={18} /></div>
            <div className="min-w-0 flex-1">
              <div className="px-4 py-2.5 rounded-2xl rounded-tl-md text-[13px]" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: `1px solid ${hasErrors ? "#ef444430" : "var(--border)"}` }}>
                <div className="whitespace-pre-wrap break-words">{trunc(claudeText, 2000)}</div>
              </div>
              {/* Rich tool call cards */}
              {tools.length > 0 && (
                <div className="mt-2 ml-1 flex flex-col gap-1">
                  {(toolsOpen ? tools : tools.slice(0, 5)).map((tc, i) => (
                    <ToolCallCard key={i} tc={tc} />
                  ))}
                  {!toolsOpen && tools.length > 5 && (
                    <button className="text-[11px] hover:underline py-0.5" style={{ color: "var(--text-muted)" }} onClick={() => setToolsOpen(true)}>
                      +{tools.length - 5} more tools
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transcript View ────────────────────────────────────────────
function TranscriptView({ exchanges, milestones, compactionEvents }: {
  exchanges: Exchange[];
  milestones: Array<{ milestone_type: string; exchange_index: number; description: string }>;
  compactionEvents: CompactionEvent[];
}) {
  // Build milestone lookup
  const milestonesByIdx = new Map<number, Array<{ type: string; desc: string }>>();
  for (const m of milestones) {
    if (!milestonesByIdx.has(m.exchange_index)) milestonesByIdx.set(m.exchange_index, []);
    milestonesByIdx.get(m.exchange_index)!.push({ type: m.milestone_type, desc: m.description });
  }

  const msConfig: Record<string, { symbol: string; color: string }> = {
    commit: { symbol: "\u25CF", color: "#818cf8" },
    push: { symbol: "\u2191", color: "#60a5fa" },
    pull: { symbol: "\u2193", color: "#a78bfa" },
    pr: { symbol: "\u2442", color: "#34d399" },
    branch: { symbol: "\u2443", color: "#fbbf24" },
    test_pass: { symbol: "\u2713", color: "#10b981" },
    test_fail: { symbol: "\u2717", color: "#ef4444" },
  };

  return (
    <div className="px-6 py-4 space-y-1">
      {exchanges.map((ex) => (
        <div key={ex.exchange_index}>
          {/* Milestone markers before this exchange */}
          {milestonesByIdx.get(ex.exchange_index)?.map((ms, i) => {
            const cfg = msConfig[ms.type] || { symbol: "\u00B7", color: "var(--text-tertiary)" };
            return (
              <div key={i} className="flex items-center gap-3 py-2 my-1">
                <div className="h-px flex-1" style={{ background: cfg.color + "40" }} />
                <span className="text-[11px] font-medium" style={{ color: cfg.color }}>
                  {cfg.symbol} {ms.desc}
                </span>
                <div className="h-px flex-1" style={{ background: cfg.color + "40" }} />
              </div>
            );
          })}
          <ExchangeBubble ex={ex} />
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "transcript" | "files">("timeline");
  const [detail, setDetail] = useState<DetailState>(EMPTY_DETAIL);

  // AI analysis state (preserved from original)
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState("");
  const [showAiSetup, setShowAiSetup] = useState(false);
  const [aiKey, setAiKey] = useState("");

  // Live session polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [newExchangeCount, setNewExchangeCount] = useState(0);
  const [lastSeenCount, setLastSeenCount] = useState(0);

  const fetchData = useCallback(async (initial: boolean) => {
    if (!id) return;
    try {
      const s = await getSession(id) as SessionDetailType;
      const exs = await getSessionExchanges(id, true) as Exchange[];
      setSession(s);
      setExchanges(exs);
      if (initial) {
        setLoading(false);
        setLastSeenCount(exs.length);
      } else if (exs.length > lastSeenCount) {
        setNewExchangeCount(exs.length - lastSeenCount);
      }
    } catch { if (initial) setLoading(false); }
  }, [id, lastSeenCount]);

  useEffect(() => { fetchData(true); }, [fetchData]);
  useEffect(() => {
    pollRef.current = setInterval(() => fetchData(false), 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  // Detail panel helpers
  const openDetail = (title: string, subtitle: string, content: ReactNode, rawData: unknown) =>
    setDetail({ open: true, title, subtitle, content, rawData });

  const closeDetail = () => setDetail(EMPTY_DETAIL);

  const handleViewPlan = (plan: Plan) => {
    const time = plan.ended_at || plan.started_at || plan.created_at;
    const fmtDate = time ? new Date(time).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    openDetail(
      `Plan V${plan.version} \u00B7 ${plan.status}`,
      `${fmtDate} \u00B7 Exchange #${plan.exchange_index_start}${plan.exchange_index_end !== plan.exchange_index_start ? `-${plan.exchange_index_end}` : ""}`,
      <PlanView planText={plan.plan_text} version={plan.version} status={plan.status} />,
      plan,
    );
  };

  const handleViewFile = async (filePath: string) => {
    if (!session) return;
    try {
      const diffs = await getFileDiffs(session.session_id, filePath) as FileDiffEntry[];
      const fileName = filePath.split("/").pop() || filePath;
      openDetail(
        fileName,
        `${diffs.length} operation${diffs.length !== 1 ? "s" : ""}`,
        <FileDiffs diffs={diffs} fileName={filePath} />,
        diffs,
      );
    } catch { /* failed to load */ }
  };

  if (loading) return <div className="p-8 text-[14px]" style={{ color: "var(--text-muted)" }}>Loading...</div>;
  if (!session) return <div className="p-8 text-[14px]" style={{ color: "var(--text-muted)" }}>Session not found</div>;

  const title = cleanText(session.title || session.session_id.substring(0, 24)).cleaned;
  const project = session.project_path.split("/").slice(-2).join("/");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <button onClick={() => navigate("/")} className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>&larr; Sessions</button>
        <h1 className="text-[17px] font-semibold leading-snug mb-1.5">{trunc(title, 100)}</h1>
        <div className="flex items-center gap-2.5 text-[12px] flex-wrap mb-2" style={{ color: "var(--text-tertiary)" }}>
          <span>{project}</span>
          {session.git_branch && <span className="px-1.5 py-0.5 rounded font-mono text-[11px]" style={{ background: "var(--bg-elevated)" }}>{session.git_branch}</span>}
          <span>{exchanges.length} exchanges</span>
          {session.model_breakdown && session.model_breakdown.length > 0 && (
            <span className="font-mono text-[11px]">{session.model_breakdown[0].model.replace("claude-", "")}</span>
          )}
          {(() => {
            const runAnalysis = async () => {
              if (!id) return;
              try {
                const cfg = await getConfig() as any;
                if (!cfg.analysis?.enabled || !cfg.analysis?.apiKey) { setShowAiSetup(true); return; }
                setAnalyzing(true);
                setAnalyzeStep("Analyzing...");
                await analyzeSession(id);
                setAnalyzeStep("");
                setAnalyzing(false);
                fetchData(true);
              } catch { setAnalyzeStep(""); setAnalyzing(false); }
            };
            if (analyzing) return <span className="text-[11px] ml-2" style={{ color: "var(--accent)" }}>{analyzeStep}</span>;
            return (
              <button onClick={runAnalysis} className="text-[11px] px-2 py-0.5 rounded hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                AI Analyze
              </button>
            );
          })()}
        </div>
        <OutcomesBar session={session} />
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b px-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        {([
          { key: "timeline" as const, label: "Timeline" },
          { key: "transcript" as const, label: `Transcript (${exchanges.length})` },
          { key: "files" as const, label: `Files (${session.file_operations?.length || 0})` },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2.5 text-[13px] relative font-medium" style={{ color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t.label}
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      {/* Content area — splits 50/50 when detail is open */}
      <div className={`flex-1 overflow-hidden ${detail.open ? "grid grid-cols-2" : ""}`} style={{ minHeight: 0 }}>
        {/* Left: main content */}
        <div className="overflow-y-auto h-full" ref={contentRef}>
          {tab === "timeline" ? (
            <div>
              {/* Plans at top — strategy overview */}
              {session.plans.length > 0 && (
                <div className="px-6 pt-5 pb-3">
                  <PlanSection
                    plans={session.plans}
                    tasks={session.tasks}
                    sessionExchangeCount={session.exchange_count}
                    onViewPlan={handleViewPlan}
                  />
                </div>
              )}
              {/* Separator */}
              {session.plans.length > 0 && (
                <div className="mx-6 mb-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider pt-3 pb-1" style={{ color: "var(--text-muted)" }}>Activity</div>
                </div>
              )}
              {/* Activity timeline — git events appear as milestones inline here */}
              <TimelineView
                session={session}
                exchanges={exchanges}
                onViewPlan={handleViewPlan}
                onViewGroup={(title, subtitle, content, rawData) => openDetail(title, subtitle, content, rawData)}
              />
            </div>
          ) : tab === "transcript" ? (
            <TranscriptView
              exchanges={exchanges}
              milestones={session.milestones}
              compactionEvents={session.compaction_events}
            />
          ) : (
            <div className="px-6 py-5">
              <FilesSection
                fileOps={session.file_operations || []}
                onViewFile={handleViewFile}
              />
            </div>
          )}
        </div>

        {/* Right: detail split */}
        {detail.open && (
          <DetailSplit
            title={detail.title}
            subtitle={detail.subtitle}
            content={detail.content}
            rawData={detail.rawData}
            onClose={closeDetail}
          />
        )}
      </div>

      {/* New exchanges notification */}
      {newExchangeCount > 0 && (
        <div className="sticky bottom-4 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              setLastSeenCount(exchanges.length);
              setNewExchangeCount(0);
            }}
            className="pointer-events-auto text-[13px] font-medium px-5 py-2.5 rounded-full shadow-lg"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {newExchangeCount} new exchange{newExchangeCount !== 1 ? "s" : ""}
          </button>
        </div>
      )}

      {/* AI Setup Modal (preserved) */}
      {showAiSetup && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="p-6 rounded-xl max-w-md w-full" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
            <h3 className="text-[15px] font-semibold mb-3">AI Analysis Setup</h3>
            <p className="text-[12px] mb-3" style={{ color: "var(--text-tertiary)" }}>Enter your Anthropic API key to enable AI-powered titles and summaries.</p>
            <input
              type="password"
              value={aiKey}
              onChange={e => setAiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2 rounded text-[13px] mb-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAiSetup(false)} className="px-3 py-1.5 text-[12px] rounded" style={{ color: "var(--text-muted)" }}>Cancel</button>
              <button
                onClick={async () => {
                  await updateConfig({ analysis: { enabled: true, apiKey: aiKey } });
                  setShowAiSetup(false);
                }}
                className="px-3 py-1.5 text-[12px] rounded font-medium"
                style={{ background: "var(--accent)", color: "white" }}
              >Save & Enable</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
