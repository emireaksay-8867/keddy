import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router";
import { getSession, getSessionExchanges, analyzeSession, getConfig, updateConfig, getFileDiffs } from "../lib/api.js";
import { cleanText } from "../lib/cleanText.js";
import { useAppContext } from "../App.js";
import { DetailSplit } from "../components/session/DetailSplit.js";
import { GitBranch } from "lucide-react";
import { PlanSection } from "../components/session/PlanSection.js";
import { FilesSection } from "../components/session/FilesSection.js";
import { FileDiffs } from "../components/session/FileDiffs.js";
import { PlanView, parseSections } from "../components/session/PlanView.js";
import { TimelineView, SessionFlowDiagram } from "../components/session/TimelineView.js";
import { TerminalView } from "../components/session/TerminalView.js";
import { NotesTab } from "../components/session/NotesTab.js";
import type { SessionDetail as SessionDetailType, Exchange, Plan, FileDiffEntry } from "../lib/types.js";

// ── Helpers ────────────────────────────────────────────────────
function trunc(s: string, n: number) { return s.length > n ? s.substring(0, n) + "..." : s; }

function resolveRepoName(
  projectPath: string,
  projects: Array<{ project_path: string; repo: string }>,
): string {
  const direct = projects.find((p) => p.project_path === projectPath);
  if (direct) return direct.repo;
  const parts = projectPath.split("/");
  const wtIdx = parts.indexOf("worktrees");
  if (wtIdx >= 0 && wtIdx + 1 < parts.length) return parts[wtIdx + 1];
  return parts[parts.length - 1] || projectPath;
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return "";
  const m = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
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

// ── Main Component ─────────────────────────────────────────────
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects } = useAppContext();

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

  const handleViewPlan = (plan: Plan, compareWithText?: string) => {
    const time = plan.ended_at || plan.started_at || plan.created_at;
    const fmtDate = time ? new Date(time).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }) : "";
    // Extract clean title from plan text
    let planTitle = "Plan";
    if (plan.plan_text) {
      for (const line of plan.plan_text.split("\n")) {
        const t = line.trim();
        if (t.startsWith("#")) {
          planTitle = t.replace(/^#+\s*/, "").replace(/^Plan:\s*/i, "");
          break;
        }
      }
    }

    // Compute section-level diff if comparison text is provided
    let changedSections: Set<number> | undefined;
    if (compareWithText && plan.plan_text) {
      const currentSections = parseSections(plan.plan_text);
      const nextSections = parseSections(compareWithText);
      changedSections = new Set<number>();
      for (let i = 0; i < currentSections.length; i++) {
        const cur = currentSections[i];
        // Find matching section in next version by heading
        const match = nextSections.find(s => s.heading === cur.heading && s.level === cur.level);
        if (!match || match.content !== cur.content) {
          changedSections.add(i);
        }
      }
    }

    openDetail(
      planTitle,
      fmtDate,
      <div key={`plan-${plan.version}-${plan.id}`}>
        <PlanView planText={plan.plan_text} version={plan.version} status={plan.status} changedSections={changedSections} />
        {plan.user_feedback && (
          <div className="mt-5 px-3 py-2 rounded text-[12px] leading-relaxed"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", borderLeft: "2px solid rgba(255,255,255,0.08)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>Your feedback on this version</div>
            {plan.user_feedback}
          </div>
        )}
      </div>,
      plan,
    );
  };

  const handleViewInTerminal = useCallback((exchangeIndex: number) => {
    setTab("terminal");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`terminal-${exchangeIndex}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }, []);

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
  const repoName = resolveRepoName(session.project_path, projects);
  const duration = fmtDuration(session.started_at, session.ended_at);

  // Model display — show all if multiple were used
  const modelDisplay = session.model_breakdown && session.model_breakdown.length > 0
    ? session.model_breakdown.map(m => m.model.replace("claude-", "")).join(", ")
    : null;

  // Build metadata items with middle dots
  const metaItems: Array<{ text: string; mono?: boolean; icon?: true }> = [];
  metaItems.push({ text: repoName });
  if (session.git_branch) metaItems.push({ text: session.git_branch, mono: true, icon: true });
  metaItems.push({ text: `${exchanges.length} exchanges` });
  if (duration) metaItems.push({ text: duration });
  if (modelDisplay) metaItems.push({ text: modelDisplay, mono: true });

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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <button onClick={() => navigate("/")} className="text-[13px] w-5 h-5 flex items-center justify-center rounded shrink-0 hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.08)] transition-all" style={{ color: "var(--text-muted)" }}>&larr;</button>
              <h1 className="text-[17px] font-semibold leading-snug">{trunc(title, 100)}</h1>
            </div>
            <div className="flex items-center flex-wrap text-[12px] pl-[26px]" style={{ color: "var(--text-muted)" }}>
              {metaItems.map((item, i) => (
                <span key={i} className="inline-flex items-center">
                  {i > 0 && <span className="mx-1.5">·</span>}
                  {item.icon && <GitBranch size={11} className="mr-1 shrink-0" style={{ color: "var(--text-muted)" }} />}
                  <span className={item.mono ? "font-mono" : ""}>{item.text}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="shrink-0">
            {analyzing ? (
              <span className="text-[11px]" style={{ color: "var(--accent)" }}>{analyzeStep}</span>
            ) : (
              <button onClick={runAnalysis} className="text-[11px] px-2.5 py-1 rounded-md hover:brightness-125 transition-colors font-medium" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "none" }}>
                Keddy Analyze
              </button>
            )}
          </div>
        </div>
        {session.parent_title && (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(167, 139, 250, 0.1)", color: "#a78bfa" }}>
              forked: {trunc(session.parent_title, 40)}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b px-6" style={{ borderColor: "var(--border)" }}>
        {([
          { key: "timeline" as const, label: "Timeline" },
          { key: "terminal" as const, label: "Terminal Log" },
          { key: "files" as const, label: `Files (${session.file_operations?.length || 0})` },
          { key: "notes" as const, label: "Notes" },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-4 py-2.5 text-[13px] relative font-medium" style={{ color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t.label}
            {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "rgba(56,139,253,0.75)" }} />}
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
                  <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>Plans</div>
                  <PlanSection
                    plans={session.plans}
                    tasks={session.tasks}
                    milestones={session.milestones}
                    gitDetails={session.git_details || []}
                    sessionExchangeCount={session.exchange_count}
                    forkExchangeIndex={session.fork_exchange_index}
                    onViewPlan={handleViewPlan}
                    onViewInTerminal={handleViewInTerminal}
                  />
                </div>
              )}
              {/* Session Flow — between plans and activity */}
              <div className={`px-6 ${session.plans.length > 0 ? "" : "pt-4"}`}>
                <SessionFlowDiagram sessionId={session.session_id} />
              </div>

              {/* Activity heading */}
              <div className="mx-6 mb-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider pb-1" style={{ color: "var(--text-muted)" }}>Activity</div>
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
              forkExchangeIndex={session.fork_exchange_index}
              parentTitle={session.parent_title}
              forkChildren={session.fork_children}
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
