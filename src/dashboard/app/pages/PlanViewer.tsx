import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { getSessionPlans } from "../lib/api.js";
import { SEGMENT_COLORS } from "../lib/constants.js";
import type { Plan } from "../lib/types.js";

const STATUS_COLORS: Record<string, string> = {
  approved: "#34d399",
  rejected: "#f87171",
  drafted: "#fbbf24",
  superseded: "#9ca3af",
};

export function PlanViewer() {
  const { id } = useParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getSessionPlans(id)
      .then((data) => setPlans(data as Plan[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-xs" style={{ color: "var(--text-tertiary)" }}>loading...</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-3 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <Link to={`/sessions/${id}`} className="text-xs" style={{ color: "var(--text-tertiary)" }}>← back to session</Link>
        <h1 className="text-sm font-medium mt-1" style={{ color: "var(--text-primary)" }}>plans</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {plans.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>no plans</div>
        ) : plans.map((plan) => (
          <div key={plan.id} className="border rounded p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>v{plan.version}</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${STATUS_COLORS[plan.status]}18`, color: STATUS_COLORS[plan.status] }}>
                {plan.status}
              </span>
            </div>
            <pre className="text-xs whitespace-pre-wrap rounded p-3 max-h-48 overflow-y-auto" style={{ background: "var(--bg-root)", color: "var(--text-secondary)" }}>
              {plan.plan_text}
            </pre>
            {plan.user_feedback && (
              <div className="mt-2 p-2 rounded text-xs" style={{ background: `${SEGMENT_COLORS.debugging}10`, color: SEGMENT_COLORS.debugging }}>
                feedback: {plan.user_feedback}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
