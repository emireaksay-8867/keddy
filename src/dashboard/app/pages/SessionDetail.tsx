import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSession, getSessionExchanges, analyzeSession, getConfig, updateConfig, getFileDiffs } from "../lib/api.js";
import { cleanText } from "../lib/cleanText.js";
import { DetailSplit } from "../components/session/DetailSplit.js";
import { OutcomesBar } from "../components/session/OutcomesBar.js";
import { PlanSection } from "../components/session/PlanSection.js";
import { GitSection } from "../components/session/GitSection.js";
import { FilesSection } from "../components/session/FilesSection.js";
import { FileDiffs } from "../components/session/FileDiffs.js";
import { PlanView } from "../components/session/PlanView.js";
import { ClaudeIcon } from "../components/ClaudeIcon.js";
import type { SessionDetail as SessionDetailType, Exchange, Plan, GitDetail, FileDiffEntry, CompactionEvent } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function fmtTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function fmtDuration(a: string, b: string | null) {
  if (!b) return "";
  const m = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m < 1) return "<1m"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }

// ── Detail Panel State ─────────────────────────────────────────
interface DetailState {
  open: boolean;
  title: string;
  subtitle: string;
  content: ReactNode;
  rawData: unknown;
}

const EMPTY_DETAIL: DetailState = { open: false, title: "", subtitle: "", content: null, rawData: null };

// ── Exchange Bubble (used in transcript) ───────────────────────
function ExchangeBubble({ ex }: { ex: Exchange }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const tools = ex.tool_calls || [];
  const { cleaned: userText } = cleanText(ex.user_prompt);
  const { cleaned: claudeText } = cleanText(ex.assistant_response || "");

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
      {claudeText && (
        <div className="flex justify-start mb-3">
          <div className="max-w-[85%] flex gap-2">
            <div className="shrink-0 mt-1"><ClaudeIcon size={18} /></div>
            <div>
              <div className="px-4 py-2.5 rounded-2xl rounded-tl-md text-[13px]" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                <div className="whitespace-pre-wrap break-words">{trunc(claudeText, 2000)}</div>
              </div>
              {tools.length > 0 && (
                <div className="mt-1.5 ml-1">
                  {(toolsOpen ? tools : tools.slice(0, 3)).map((tc, i) => (
                    <div key={i} className="text-[11px] flex items-center gap-1.5 py-0.5" style={{ color: "var(--text-muted)" }}>
                      <span style={{ color: tc.is_error ? "#ef4444" : "var(--text-tertiary)" }}>{tc.tool_name}</span>
                      {tc.is_error ? <span style={{ color: "#ef4444" }}>error</span> : null}
                    </div>
                  ))}
                  {!toolsOpen && tools.length > 3 && (
                    <button className="text-[11px] hover:underline" style={{ color: "var(--text-muted)" }} onClick={() => setToolsOpen(true)}>
                      +{tools.length - 3} more tools
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
  const [tab, setTab] = useState<"session" | "transcript">("session");
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

  const handleViewGitDetail = (d: GitDetail) => {
    openDetail(
      `${d.type === "commit" ? "\u25CF" : d.type === "push" ? "\u2191" : d.type} \u00B7 ${trunc(d.description, 60)}`,
      `Exchange #${d.exchange_index}${d.timestamp ? ` \u00B7 ${new Date(d.timestamp).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`,
      <div className="text-[13px] space-y-3">
        <div style={{ color: "var(--text-primary)" }}>{d.description}</div>
        {d.hash && <div className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>Hash: {d.hash}</div>}
        {d.stats && <div style={{ color: "var(--text-tertiary)" }}>{d.stats.files_changed} files changed, +{d.stats.insertions} -{d.stats.deletions}</div>}
        {d.files && d.files.length > 0 && (
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>Files:</div>
            {d.files.map((f, i) => <div key={i} className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>{f}</div>)}
          </div>
        )}
        {d.push_range && <div className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{d.push_range} {d.push_branch}</div>}
      </div>,
      d,
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
        {(["session", "transcript"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className="px-4 py-2.5 text-[13px] relative font-medium" style={{ color: tab === t ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t === "session" ? "Session" : "Transcript"}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      {/* Content area — splits 50/50 when detail is open */}
      <div className={`flex-1 overflow-hidden ${detail.open ? "grid grid-cols-2" : ""}`} style={{ minHeight: 0 }}>
        {/* Left: main content */}
        <div className="overflow-y-auto h-full" ref={contentRef}>
          {tab === "session" ? (
            <div className="px-6 py-5">
              <PlanSection
                plans={session.plans}
                tasks={session.tasks}
                sessionExchangeCount={session.exchange_count}
                onViewPlan={handleViewPlan}
              />
              <GitSection
                gitDetails={session.git_details || []}
                testStatus={session.test_status || null}
                onViewDetail={handleViewGitDetail}
              />
              <FilesSection
                fileOps={session.file_operations || []}
                onViewFile={handleViewFile}
              />
            </div>
          ) : (
            <TranscriptView
              exchanges={exchanges}
              milestones={session.milestones}
              compactionEvents={session.compaction_events}
            />
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
