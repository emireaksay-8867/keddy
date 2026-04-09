import { useState, useEffect } from "react";
import { Link } from "react-router";
import { getConfig, updateConfig, getStats, getSystemInfo, clearAllData } from "../lib/api.js";
import type { Stats } from "../lib/types.js";
import { XCircle, Eye, EyeOff } from "lucide-react";

interface ConfigData {
  analysis: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    baseUrl?: string;
    features: Record<string, { enabled: boolean; model: string }>;
  };
  notes: {
    model: string;
    autoSessionNotes: boolean;
    autoDailyNotes: boolean;
  };
}

interface SystemInfo {
  version: string;
  hooksInstalled: boolean;
  hookDetails: Record<string, boolean>;
  dbPath: string;
  github: string;
  npm: string;
}

const MODEL_OPTIONS = [
  { id: "haiku", label: "Haiku 4.5", desc: "Fastest, cheapest", color: "#10b981" },
  { id: "sonnet", label: "Sonnet 4.6", desc: "Balanced (recommended)", color: "#6366f1" },
  { id: "opus", label: "Opus 4.6", desc: "Most intelligent", color: "#f59e0b" },
];

// Section heading: normal case, semibold, sits above the container
function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-secondary)" }}>{children}</h2>;
}

// Grouped container for rows
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#151518" }}>
      {children}
    </div>
  );
}

// Row inside a Group: label+description left, control right
function Row({ label, desc, children, border = true }: { label: string; desc?: string; children?: React.ReactNode; border?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-5 py-5 ${border ? "border-b" : ""}`} style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-normal" style={{ color: "var(--text-primary)" }}>{label}</div>
        {desc && <div className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>{desc}</div>}
      </div>
      {children && <div className="shrink-0 ml-4">{children}</div>}
    </div>
  );
}

// Stacked row (for full-width inputs like API key)
function StackedRow({ label, desc, children, border = true }: { label: string; desc?: string; children: React.ReactNode; border?: boolean }) {
  return (
    <div className={`px-5 py-5 ${border ? "border-b" : ""}`} style={{ borderColor: "var(--border)" }}>
      <label className="text-[14px] font-normal block mb-2" style={{ color: "var(--text-primary)" }}>{label}</label>
      {children}
      {desc && <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>{desc}</p>}
    </div>
  );
}

// Reusable select dropdown
function Select({ value, onChange, options, color }: { value: string; onChange: (v: string) => void; options: { id: string; label: string }[]; color?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-[12px] px-3 py-1.5 rounded-md outline-none cursor-pointer"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: color || "var(--text-secondary)" }}
    >
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

// Reusable toggle (disabled state)
function Toggle({ enabled, disabled }: { enabled: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors ${disabled ? "opacity-40" : ""}`}
      style={{ background: enabled ? "var(--accent)" : "var(--bg-active)" }}
    >
      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: enabled ? 21 : 2 }} />
    </button>
  );
}

export function Settings() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState("");

  useEffect(() => {
    Promise.all([
      getConfig() as Promise<ConfigData>,
      getStats() as Promise<Stats>,
      getSystemInfo(),
    ])
      .then(([c, s, sys]) => { setConfig(c); setStats(s); setSystem(sys); setSavedApiKey(c.analysis?.apiKey || ""); })
      .catch(console.error);
  }, []);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig(config);
      setSaved(true);
      setSavedApiKey(config.analysis.apiKey);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  async function handleClearData() {
    setClearing(true);
    try {
      await clearAllData();
      const s = await getStats() as Stats;
      setStats(s);
      setShowClearConfirm(false);
      setClearConfirmText("");
    } catch (err) { console.error(err); }
    finally { setClearing(false); }
  }

  if (!config) return <div className="p-8 text-[14px]" style={{ color: "var(--text-muted)" }}>Loading...</div>;

  const sessionModel = MODEL_OPTIONS.find(m => m.id === (config.notes?.sessionModel || config.notes?.model || "sonnet"));
  const dailyModel = MODEL_OPTIONS.find(m => m.id === (config.notes?.dailyModel || config.notes?.model || "sonnet"));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <Link to="/" className="text-[12px] mb-2 flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors" style={{ color: "var(--text-muted)" }}>&larr; Sessions</Link>
        <h1 className="text-[17px] font-semibold">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-8 flex flex-col" style={{ minHeight: "100%" }}>

          {/* ── DATA ── */}
          <section>
            <SectionHead>Storage</SectionHead>
            <Group>
              {stats && (
                <Row label="Usage">
                  <span className="text-[13px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {stats.total_sessions} sessions · {stats.total_exchanges.toLocaleString()} exchanges · {stats.projects} projects
                  </span>
                </Row>
              )}
              {system && (
                <Row label="Database" border={false}>
                  <code className="text-[12px] font-mono" style={{ color: "var(--text-secondary)" }}>{system.dbPath} · {stats?.db_size_mb || "—"} MB</code>
                </Row>
              )}
            </Group>
          </section>

          {/* ── NOTES ── */}
          <section className="flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-[13px] font-bold" style={{ color: "var(--text-secondary)" }}>Notes</h2>
              <span className="text-[11px]" style={{ color: savedApiKey ? "#10b981" : "var(--text-muted)" }}>
                · {savedApiKey ? "Configured" : "Not configured"}
              </span>
            </div>
            <Group>
              <StackedRow label="API Key" desc={<>Stored locally at ~/.keddy/config.json · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-secondary)] transition-colors" style={{ color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: "2px" }}>Get your key</a></>}>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={config.analysis.apiKey}
                    onChange={(e) => setConfig({ ...config, analysis: { ...config.analysis, apiKey: e.target.value } })}
                    className="w-full px-4 py-2.5 pr-10 rounded-lg text-[13px] font-mono outline-none transition-colors focus:border-[var(--accent)]"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    placeholder="sk-ant-api03-..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    {showKey ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </div>
              </StackedRow>

              <Row label="Session notes model" desc="Model used when generating session notes">
                <Select
                  value={config.notes?.sessionModel || config.notes?.model || "sonnet"}
                  onChange={(v) => setConfig({ ...config, notes: { ...config.notes, sessionModel: v } })}
                  options={MODEL_OPTIONS}
                  color={sessionModel?.color}
                />
              </Row>

              <Row label="Daily notes model" desc="Model used when generating daily summaries">
                <Select
                  value={config.notes?.dailyModel || config.notes?.model || "sonnet"}
                  onChange={(v) => setConfig({ ...config, notes: { ...config.notes, dailyModel: v } })}
                  options={MODEL_OPTIONS}
                  color={dailyModel?.color}
                />
              </Row>

              <Row label="Auto-generate session notes" desc="Automatically generate notes when a session ends">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>Soon</span>
                  <Toggle enabled={false} disabled />
                </div>
              </Row>

              <Row label="Auto-generate daily notes" desc="Automatically generate a daily synthesis" border={false}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>Soon</span>
                  <Toggle enabled={false} disabled />
                </div>
              </Row>
            </Group>

            <div className="flex items-center mt-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-[13px] font-medium transition-colors"
                  style={{ color: saved ? "#10b981" : "var(--accent)" }}
                  onMouseEnter={(e) => { if (!saved) e.currentTarget.style.color = "var(--accent-hover)"; }}
                  onMouseLeave={(e) => { if (!saved) e.currentTarget.style.color = "var(--accent)"; }}
                >
                  {saved ? "Saved" : "Save Changes"}
                </button>
              </div>

              {/* Right side — footer + delete */}
              <div className="flex items-center gap-2 ml-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
                {!showClearConfirm ? (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="text-[11px] transition-colors"
                    style={{ color: "#ef4444", opacity: 0.7 }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                  >
                    Delete all data
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={clearConfirmText}
                      onChange={(e) => setClearConfirmText(e.target.value)}
                      className="px-2 py-1 rounded-md text-[11px] outline-none w-32"
                      style={{ background: "var(--bg-elevated)", border: "1px solid #ef444440", color: "var(--text-primary)" }}
                      placeholder='Type "delete"'
                      autoFocus
                    />
                    <button
                      onClick={handleClearData}
                      disabled={clearConfirmText !== "delete" || clearing}
                      className="text-[11px] font-medium transition-colors"
                      style={{ color: clearConfirmText === "delete" ? "#ef4444" : "#ef444460" }}
                    >
                      {clearing ? "Deleting..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => { setShowClearConfirm(false); setClearConfirmText(""); }}
                      className="text-[11px] transition-colors"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {system && !system.hooksInstalled && (
                  <>
                    <span>·</span>
                    <XCircle size={10} style={{ color: "#ef4444" }} />
                    <span style={{ color: "#ef4444" }}>Hooks not installed</span>
                  </>
                )}
                <span>·</span>
                {system && <span className="font-mono">keddy v{system.version}</span>}
                {system && <>
                  <span>·</span>
                  <a href={system.github} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-secondary)] transition-colors">GitHub</a>
                  <span>·</span>
                  <a href={system.npm} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-secondary)] transition-colors">npm</a>
                </>}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
