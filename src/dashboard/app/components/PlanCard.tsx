import type { Plan } from "../lib/types.js";

interface PlanCardProps {
  plan: Plan;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  approved: { bg: "#10B98120", text: "#10B981" },
  rejected: { bg: "#EF444420", text: "#EF4444" },
  drafted: { bg: "#F59E0B20", text: "#F59E0B" },
  superseded: { bg: "#6B728020", text: "#6B7280" },
};

export function PlanCard({ plan }: PlanCardProps) {
  const status = STATUS_COLORS[plan.status] || STATUS_COLORS.drafted;

  return (
    <div className="p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="font-medium text-sm">Plan v{plan.version}</h4>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: status.bg, color: status.text }}
        >
          {plan.status}
        </span>
        <span className="text-xs text-[var(--color-text-muted)] ml-auto">
          Exchanges {plan.exchange_index_start}–{plan.exchange_index_end}
        </span>
      </div>

      <pre className="text-xs text-[var(--color-text-muted)] whitespace-pre-wrap font-mono bg-[var(--color-bg)] p-3 rounded-md max-h-48 overflow-y-auto">
        {plan.plan_text}
      </pre>

      {plan.user_feedback && (
        <div className="mt-3 p-3 rounded-md bg-[#EF444410] border border-[#EF444430]">
          <p className="text-xs font-medium text-[#EF4444] mb-1">User Feedback</p>
          <p className="text-xs text-[var(--color-text-muted)]">{plan.user_feedback}</p>
        </div>
      )}
    </div>
  );
}
