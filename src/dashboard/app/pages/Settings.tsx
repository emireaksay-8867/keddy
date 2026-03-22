import { useState, useEffect } from "react";
import { Link } from "react-router";
import { getConfig, updateConfig, getStats, getAnalyzeStatus, analyzeBulk } from "../lib/api.js";
import type { Stats } from "../lib/types.js";

interface ConfigData {
  analysis: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    features: Record<string, { enabled: boolean; model: string }>;
  };
}

const FEATURE_INFO: Record<string, { name: string; description: string; tier: "fast" | "smart" }> = {
  sessionTitles: { name: "Session Titles", description: "Generate descriptive titles for each session based on the conversation content", tier: "fast" },
  segmentSummaries: { name: "Segment Summaries", description: "Summarize what happened in each timeline segment", tier: "fast" },
  decisionExtraction: { name: "Decision Extraction", description: "Identify key technical decisions and their rationale", tier: "fast" },
  planDiffAnalysis: { name: "Plan Diff Analysis", description: "Analyze changes between plan versions and why they evolved", tier: "smart" },
  sessionNotes: { name: "Session Notes", description: "Generate retrospective notes for completed sessions", tier: "smart" },
};

export function Settings() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<{ total: number; needsTitle: number; analyzed: number; hasSummaries: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getConfig() as Promise<ConfigData>, getStats() as Promise<Stats>, getAnalyzeStatus()])
      .then(([c, s, a]) => { setConfig(c); setStats(s); setAnalyzeStatus(a); })
      .catch(console.error);
  }, []);

  async function handleBulkAnalyze() {
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      const result = await analyzeBulk(20) as any;
      setAnalyzeResult(`Processed ${result.processed} sessions`);
      // Refresh status
      const status = await getAnalyzeStatus();
      setAnalyzeStatus(status);
    } catch (e: any) {
      setAnalyzeResult(`Error: ${e.message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  if (!config) return <div className="p-8 text-[14px]" style={{ color: "var(--text-muted)" }}>Loading...</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <Link to="/" className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>← Sessions</Link>
        <h1 className="text-[17px] font-semibold">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl space-y-8">

          {/* Database Stats */}
          {stats && (
            <section>
              <h2 className="text-[14px] font-semibold mb-4">Database</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Sessions", value: stats.total_sessions },
                  { label: "Exchanges", value: stats.total_exchanges.toLocaleString() },
                  { label: "Projects", value: stats.projects },
                  { label: "Size", value: `${stats.db_size_mb} MB` },
                ].map(s => (
                  <div key={s.label} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                    <div className="text-[20px] font-semibold mb-0.5">{s.value}</div>
                    <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI Analysis */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-[14px] font-semibold">AI Analysis</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: config.analysis.enabled ? "#10b98115" : "var(--bg-elevated)", color: config.analysis.enabled ? "#10b981" : "var(--text-muted)" }}>
                {config.analysis.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
              {/* Enable toggle */}
              <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: "var(--border)" }}>
                <div>
                  <div className="text-[14px] font-medium">Enable AI-powered analysis</div>
                  <div className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>Uses Claude to generate titles, summaries, and extract decisions from your sessions</div>
                </div>
                <button
                  onClick={() => setConfig({ ...config, analysis: { ...config.analysis, enabled: !config.analysis.enabled } })}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ background: config.analysis.enabled ? "var(--accent)" : "var(--bg-active)" }}
                >
                  <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: config.analysis.enabled ? 21 : 2 }} />
                </button>
              </div>

              {config.analysis.enabled && (
                <>
                  {/* API Key */}
                  <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                    <label className="text-[13px] font-medium block mb-2">Anthropic API Key</label>
                    <input
                      type="password"
                      value={config.analysis.apiKey}
                      onChange={(e) => setConfig({ ...config, analysis: { ...config.analysis, apiKey: e.target.value } })}
                      className="w-full px-4 py-2.5 rounded-lg text-[13px] outline-none transition-colors focus:border-[var(--accent)]"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                      placeholder="sk-ant-api03-..."
                    />
                    <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                      Your key is stored locally at ~/.keddy/config.json
                    </p>
                  </div>

                  {/* Features */}
                  <div className="px-5 py-4">
                    <div className="text-[13px] font-medium mb-3">Features</div>
                    <div className="space-y-1">
                      {Object.entries(config.analysis.features).map(([key, feature]) => {
                        const info = FEATURE_INFO[key];
                        if (!info) return null;
                        return (
                          <div key={key} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                            <button
                              onClick={() => {
                                const features = { ...config.analysis.features };
                                features[key] = { ...feature, enabled: !feature.enabled };
                                setConfig({ ...config, analysis: { ...config.analysis, features } });
                              }}
                              className="relative w-8 h-4 rounded-full transition-colors shrink-0"
                              style={{ background: feature.enabled ? "var(--accent)" : "var(--bg-active)" }}
                            >
                              <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform" style={{ left: feature.enabled ? 17 : 2 }} />
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-medium">{info.name}</div>
                              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{info.description}</div>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                              {info.tier === "fast" ? "Haiku" : "Sonnet"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[13px] font-medium px-6 py-2.5 rounded-lg transition-all"
              style={{ background: "var(--accent)", color: "white", opacity: saving ? 0.5 : 1 }}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && <span className="text-[13px] font-medium" style={{ color: "#10b981" }}>Saved successfully</span>}
          </div>

          {/* Bulk Analysis */}
          {config.analysis.enabled && config.analysis.apiKey && analyzeStatus && (
            <section>
              <h2 className="text-[14px] font-semibold mb-4">Process Sessions</h2>
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
                <div className="px-5 py-4">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <div className="text-[18px] font-semibold">{analyzeStatus.analyzed}</div>
                      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>Analyzed</div>
                    </div>
                    <div>
                      <div className="text-[18px] font-semibold" style={{ color: analyzeStatus.needsTitle > 0 ? "var(--accent)" : "var(--text-muted)" }}>{analyzeStatus.needsTitle}</div>
                      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>Need Analysis</div>
                    </div>
                    <div>
                      <div className="text-[18px] font-semibold">{analyzeStatus.hasSummaries}</div>
                      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>With Summaries</div>
                    </div>
                  </div>

                  {analyzeStatus.needsTitle > 0 && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleBulkAnalyze}
                        disabled={analyzing}
                        className="text-[13px] font-medium px-5 py-2.5 rounded-lg transition-all"
                        style={{ background: analyzing ? "var(--bg-active)" : "var(--accent)", color: "white", opacity: analyzing ? 0.7 : 1 }}
                      >
                        {analyzing ? "Processing..." : `Analyze ${Math.min(analyzeStatus.needsTitle, 20)} sessions`}
                      </button>
                      {analyzeResult && <span className="text-[13px]" style={{ color: "#10b981" }}>{analyzeResult}</span>}
                    </div>
                  )}

                  {analyzeStatus.needsTitle === 0 && (
                    <p className="text-[13px]" style={{ color: "#10b981" }}>All sessions have been analyzed</p>
                  )}

                  <p className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
                    Generates AI titles and segment summaries using your Anthropic API key. Processes up to 20 sessions per batch.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
