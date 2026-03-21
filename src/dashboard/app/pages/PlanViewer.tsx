import { useState, useEffect } from "react";
import { useParams, Link } from "react-router";
import { getSessionPlans } from "../lib/api.js";
import { PlanCard } from "../components/PlanCard.js";
import type { Plan } from "../lib/types.js";

export function PlanViewer() {
  const { id } = useParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    loadPlans();
  }, [id]);

  async function loadPlans() {
    setLoading(true);
    try {
      const data = (await getSessionPlans(id!)) as Plan[];
      setPlans(data);
    } catch (err) {
      console.error("Failed to load plans:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>;

  return (
    <div>
      <div className="mb-4">
        <Link to={`/sessions/${id}`} className="text-xs text-[var(--color-accent)] hover:underline">
          ← Back to session
        </Link>
      </div>

      <h1 className="text-xl font-semibold mb-4">Plan Versions</h1>

      {plans.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No plans in this session.</p>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}
