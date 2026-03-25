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
import { TerminalView } from "../components/session/TerminalView.js";
import { NotesTab } from "../components/session/NotesTab.js";
import type { SessionDetail as SessionDetailType, Exchange, Plan, FileDiffEntry } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
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

// ── Main Component ─────────────────────────────────────────────
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "terminal" | "files" | "notes">("timeline");
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
          { key: "terminal" as const, label: "Terminal Log" },
          { key: "files" as const, label: `Files (${session.file_operations?.length || 0})` },
          { key: "notes" as const, label: "Notes" },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2.5 text-[13px] relative font-medium" style={{ color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t.label}
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--text-primary)" }} />}
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
              {/* Activity heading — always shown; separator line only when plans exist above */}
              <div className={`mx-6 mb-2 ${session.plans.length > 0 ? "" : "pt-3"}`} style={session.plans.length > 0 ? { borderTop: "1px solid var(--border)" } : undefined}>
                <div className={`text-[11px] font-semibold uppercase tracking-wider ${session.plans.length > 0 ? "pt-3" : ""} pb-1`} style={{ color: "var(--text-muted)" }}>Activity</div>
              </div>
              {/* Activity timeline — git events appear as milestones inline here */}
              <TimelineView
                session={session}
                exchanges={exchanges}
                onViewPlan={handleViewPlan}
                onViewGroup={(title, subtitle, content, rawData) => openDetail(title, subtitle, content, rawData)}
              />
            </div>
          ) : tab === "terminal" ? (
            <TerminalView
              exchanges={exchanges}
              milestones={session.milestones}
              compactionEvents={session.compaction_events}
            />
          ) : tab === "files" ? (
            <div className="px-6 py-5">
              <FilesSection
                fileOps={session.file_operations || []}
                onViewFile={handleViewFile}
              />
            </div>
          ) : (
            <NotesTab sessionId={id!} />
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
