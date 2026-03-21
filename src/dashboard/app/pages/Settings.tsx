import { useState, useEffect } from "react";
import { Link } from "react-router";
import { getConfig, updateConfig, getStats } from "../lib/api.js";
import type { Stats } from "../lib/types.js";

interface ConfigData {
  analysis: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    features: Record<string, { enabled: boolean; model: string }>;
  };
}

export function Settings() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      getConfig() as Promise<ConfigData>,
      getStats() as Promise<Stats>,
    ])
      .then(([c, s]) => { setConfig(c); setStats(s); })
      .catch(console.error);
  }, []);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return (
      <div className="p-8 text-xs" style={{ color: "var(--text-tertiary)" }}>
        loading...
      </div>
    );
  }

  const inputStyle = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
  };

  return (
    <div className="h-full flex flex-col">
      <div
        className="px-5 py-3 border-b flex items-center gap-3"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        <Link
          to="/"
          className="text-xs transition-colors hover:text-[var(--text-primary)]"
          style={{ color: "var(--text-tertiary)" }}
        >
          ← back
        </Link>
        <h1 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          settings
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-5 max-w-xl">
        {/* Stats */}
        {stats && (
          <div className="mb-6 rounded border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <div className="text-xs mb-3 font-medium" style={{ color: "var(--text-tertiary)" }}>
              database
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <span style={{ color: "var(--text-tertiary)" }}>size</span>
                <p style={{ color: "var(--text-primary)" }}>{stats.db_size_mb} MB</p>
              </div>
              <div>
                <span style={{ color: "var(--text-tertiary)" }}>sessions</span>
                <p style={{ color: "var(--text-primary)" }}>{stats.total_sessions}</p>
              </div>
              <div>
                <span style={{ color: "var(--text-tertiary)" }}>exchanges</span>
                <p style={{ color: "var(--text-primary)" }}>{stats.total_exchanges}</p>
              </div>
            </div>
          </div>
        )}

        {/* AI Analysis */}
        <div className="rounded border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-xs mb-3 font-medium" style={{ color: "var(--text-tertiary)" }}>
            ai analysis
          </div>

          <label className="flex items-center gap-2 mb-4 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={config.analysis.enabled}
              onChange={(e) =>
                setConfig({ ...config, analysis: { ...config.analysis, enabled: e.target.checked } })
              }
            />
            <span style={{ color: "var(--text-primary)" }}>enable ai analysis</span>
          </label>

          {config.analysis.enabled && (
            <div className="space-y-3 pl-5">
              <div>
                <label className="text-xs block mb-1" style={{ color: "var(--text-tertiary)" }}>provider</label>
                <select
                  value={config.analysis.provider}
                  onChange={(e) =>
                    setConfig({ ...config, analysis: { ...config.analysis, provider: e.target.value } })
                  }
                  className="w-full px-3 py-1.5 rounded text-xs outline-none"
                  style={inputStyle}
                >
                  <option value="anthropic">anthropic</option>
                  <option value="openai-compatible">openai-compatible</option>
                </select>
              </div>

              <div>
                <label className="text-xs block mb-1" style={{ color: "var(--text-tertiary)" }}>api key</label>
                <input
                  type="password"
                  value={config.analysis.apiKey}
                  onChange={(e) =>
                    setConfig({ ...config, analysis: { ...config.analysis, apiKey: e.target.value } })
                  }
                  className="w-full px-3 py-1.5 rounded text-xs outline-none"
                  style={inputStyle}
                  placeholder="sk-ant-..."
                />
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>features</div>
                {Object.entries(config.analysis.features).map(([key, feature]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={feature.enabled}
                      onChange={(e) => {
                        const features = { ...config.analysis.features };
                        features[key] = { ...feature, enabled: e.target.checked };
                        setConfig({ ...config, analysis: { ...config.analysis, features } });
                      }}
                    />
                    <span style={{ color: "var(--text-secondary)" }}>
                      {key.replace(/([A-Z])/g, " $1").toLowerCase().trim()}
                    </span>
                    <span className="ml-auto" style={{ color: "var(--text-tertiary)" }}>
                      {feature.model.split("-").pop()}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-4 py-1.5 rounded transition-colors"
              style={{
                background: "var(--accent)",
                color: "white",
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "saving..." : "save"}
            </button>
            {saved && (
              <span className="text-xs" style={{ color: "#34d399" }}>saved</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
