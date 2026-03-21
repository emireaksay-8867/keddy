import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { getSession, getSessionExchanges } from "../lib/api.js";
import { Timeline } from "../components/Timeline.js";
import { ExchangeView } from "../components/ExchangeView.js";
import type { SessionDetail as SessionDetailType, Exchange } from "../lib/types.js";

export function SessionDetail() {
  const { id } = useParams();
  const [session, setSession] = useState<SessionDetailType | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "exchanges">("timeline");

  useEffect(() => {
    if (!id) return;
    loadSession();
  }, [id]);

  async function loadSession() {
    setLoading(true);
    try {
      const [sessionData, exchangeData] = await Promise.all([
        getSession(id!) as Promise<SessionDetailType>,
        getSessionExchanges(id!, true) as Promise<Exchange[]>,
      ]);
      setSession(sessionData);
      setExchanges(exchangeData);
    } catch (err) {
      console.error("Failed to load session:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>;
  if (!session) return <p className="text-sm text-[var(--color-text-muted)]">Session not found.</p>;

  const title = session.title || session.session_id.substring(0, 16);
  const project = session.project_path.split("/").slice(-2).join("/");

  return (
    <div>
      <div className="mb-4">
        <Link to="/" className="text-xs text-[var(--color-accent)] hover:underline">
          ← Back to sessions
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1">{title}</h1>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>{project}</span>
          {session.git_branch && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)]">
              {session.git_branch}
            </span>
          )}
          <span>{session.exchange_count} exchanges</span>
          {session.plans.length > 0 && (
            <Link
              to={`/sessions/${id}/plans`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {session.plans.length} plans
            </Link>
          )}
          <span>{new Date(session.started_at).toLocaleString()}</span>
          {session.ended_at && <span>→ {new Date(session.ended_at).toLocaleString()}</span>}
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab("timeline")}
          className={`px-3 py-1.5 rounded-md text-sm ${
            tab === "timeline"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          Timeline
        </button>
        <button
          onClick={() => setTab("exchanges")}
          className={`px-3 py-1.5 rounded-md text-sm ${
            tab === "exchanges"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          Exchanges ({exchanges.length})
        </button>
      </div>

      {tab === "timeline" ? (
        <Timeline
          segments={session.segments}
          milestones={session.milestones}
          compactionEvents={session.compaction_events}
        />
      ) : (
        <div className="space-y-2">
          {exchanges.map((exchange) => (
            <ExchangeView key={exchange.id} exchange={exchange} />
          ))}
        </div>
      )}
    </div>
  );
}
