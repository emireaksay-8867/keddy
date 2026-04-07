import type { Plan, Task, Milestone, GitDetail, Exchange } from "../../lib/types.js";
import { PlanSection } from "./PlanSection.js";

interface PlansTabProps {
  plans: Plan[];
  tasks: Task[];
  milestones: Milestone[];
  gitDetails: GitDetail[];
  sessionExchangeCount: number;
  forkExchangeIndex?: number | null;
  onViewPlan: (plan: Plan, compareWithText?: string) => void;
  exchanges?: Exchange[];
  onViewInActivity?: (exchangeIndex: number) => void;
}

export function PlansTab({
  plans,
  tasks,
  milestones,
  gitDetails,
  sessionExchangeCount,
  forkExchangeIndex,
  onViewPlan,
  exchanges,
  onViewInActivity,
}: PlansTabProps) {
  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="text-[40px] opacity-30">{"\u{1F4CB}"}</div>
        <div className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>
          No plans in this session
        </div>
        <div className="text-[12px] max-w-[280px] text-center" style={{ color: "var(--text-muted)" }}>
          Plans appear when Claude enters plan mode to design an implementation approach.
        </div>
      </div>
    );
  }

  return (
    <div className="py-2">
      <PlanSection
        plans={plans}
        tasks={tasks}
        milestones={milestones}
        gitDetails={gitDetails}
        sessionExchangeCount={sessionExchangeCount}
        forkExchangeIndex={forkExchangeIndex}
        onViewPlan={onViewPlan}
        onViewInTerminal={onViewInActivity}
        exchanges={exchanges}
      />
    </div>
  );
}
