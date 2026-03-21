import { useState, useEffect } from "react";
import { SearchBar } from "../components/SearchBar.js";
import { SessionCard } from "../components/SessionCard.js";
import { getSessions, getStats } from "../lib/api.js";
import type { SessionListItem, Stats } from "../lib/types.js";

export function Sessions() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData(searchQuery?: string) {
    setLoading(true);
    try {
      const [sessionsData, statsData] = await Promise.all([
        getSessions(searchQuery ? { q: searchQuery } : undefined) as Promise<SessionListItem[]>,
        getStats() as Promise<Stats>,
      ]);
      setSessions(sessionsData);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(q: string) {
    setQuery(q);
    loadData(q || undefined);
  }

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Sessions", value: stats.total_sessions },
            { label: "Exchanges", value: stats.total_exchanges },
            { label: "Plans", value: stats.total_plans },
            { label: "Projects", value: stats.projects },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              <p className="text-2xl font-semibold">{stat.value}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4">
        <SearchBar onSearch={handleSearch} />
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[var(--color-text-muted)]">
            {query ? "No sessions match your search." : "No sessions captured yet."}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Run <code className="bg-[var(--color-surface)] px-1 rounded">keddy init</code> and start a Claude Code session.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
