import { useState, useEffect } from "react";
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

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [configData, statsData] = await Promise.all([
        getConfig() as Promise<ConfigData>,
        getStats() as Promise<Stats>,
      ]);
      setConfig(configData);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      await updateConfig(config);
    } catch (err) {
      console.error("Failed to save config:", err);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">Settings</h1>

      {stats && (
        <div className="mb-8 p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
          <h2 className="text-sm font-medium mb-3">Data</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[var(--color-text-muted)]">Database</p>
              <p>{stats.db_size_mb} MB</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)]">Sessions</p>
              <p>{stats.total_sessions}</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)]">Projects</p>
              <p>{stats.projects}</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
        <h2 className="text-sm font-medium mb-4">AI Analysis</h2>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={config.analysis.enabled}
            onChange={(e) =>
              setConfig({
                ...config,
                analysis: { ...config.analysis, enabled: e.target.checked },
              })
            }
            className="rounded"
          />
          <span className="text-sm">Enable AI analysis</span>
        </label>

        {config.analysis.enabled && (
          <div className="space-y-4 pl-6">
            <div>
              <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                Provider
              </label>
              <select
                value={config.analysis.provider}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    analysis: { ...config.analysis, provider: e.target.value },
                  })
                }
                className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai-compatible">OpenAI Compatible</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-[var(--color-text-muted)] block mb-1">
                API Key
              </label>
              <input
                type="password"
                value={config.analysis.apiKey}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    analysis: { ...config.analysis, apiKey: e.target.value },
                  })
                }
                className="w-full px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
                placeholder="sk-ant-..."
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">Features</p>
              {Object.entries(config.analysis.features).map(([key, feature]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={feature.enabled}
                    onChange={(e) => {
                      const features = { ...config.analysis.features };
                      features[key] = { ...feature, enabled: e.target.checked };
                      setConfig({
                        ...config,
                        analysis: { ...config.analysis, features },
                      });
                    }}
                    className="rounded"
                  />
                  <span className="text-sm">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                    {feature.model}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 px-4 py-2 rounded-md bg-[var(--color-accent)] text-white text-sm hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
