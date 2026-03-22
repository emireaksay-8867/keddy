import type { ParsedExchange } from "../types.js";

export interface ExtractedPlan {
  version: number;
  plan_text: string;
  status: "drafted" | "approved" | "rejected" | "superseded";
  user_feedback: string | null;
  exchange_index_start: number;
  exchange_index_end: number;
}

const IMPLEMENTATION_TOOLS = new Set(["Edit", "Write", "Bash", "NotebookEdit"]);

export function extractPlans(exchanges: ParsedExchange[]): ExtractedPlan[] {
  const plans: ExtractedPlan[] = [];
  let version = 0;
  let planStart: number | null = null;

  for (const exchange of exchanges) {
    for (const tc of exchange.tool_calls) {
      // Detect plan mode enter
      if (tc.name === "EnterPlanMode") {
        planStart = exchange.index;
        continue;
      }

      // Detect plan mode exit — this contains the plan text
      if (tc.name === "ExitPlanMode") {
        version++;
        const planText =
          typeof tc.input === "object" && tc.input !== null && "plan" in tc.input
            ? String((tc.input as { plan: unknown }).plan)
            : "";

        let status: ExtractedPlan["status"] = "drafted";
        let userFeedback: string | null = null;

        // Check tool result for explicit approval/rejection
        if (tc.result) {
          if (tc.result.includes("User has approved your plan")) {
            status = "approved";
          } else if (tc.result.includes("doesn't want to proceed")) {
            status = "rejected";
            const feedbackMatch = tc.result.match(/the user said:\n([\s\S]*)/);
            if (feedbackMatch) {
              userFeedback = feedbackMatch[1].trim();
            }
          }
        }

        plans.push({
          version,
          plan_text: planText,
          status,
          user_feedback: userFeedback,
          exchange_index_start: planStart ?? exchange.index,
          exchange_index_end: exchange.index,
        });

        planStart = null;
      }
    }
  }

  // Detect implicit approval: if a "drafted" plan is the last plan version
  // AND subsequent exchanges contain implementation tool calls (Edit, Write, Bash),
  // the plan was implicitly approved by the user continuing with execution.
  for (let i = 0; i < plans.length; i++) {
    if (plans[i].status !== "drafted") continue;

    const planEndIdx = plans[i].exchange_index_end;
    const nextPlanStartIdx = (i + 1 < plans.length) ? plans[i + 1].exchange_index_start : Infinity;

    // Check exchanges between this plan's end and the next plan's start
    const followingExchanges = exchanges.filter(
      (e) => e.index > planEndIdx && e.index < nextPlanStartIdx,
    );

    // If there are implementation tool calls after the plan, it was implicitly approved
    const hasImplementation = followingExchanges.some((e) =>
      e.tool_calls.some((tc) => IMPLEMENTATION_TOOLS.has(tc.name)),
    );

    if (hasImplementation) {
      plans[i].status = "approved";
    }
  }

  // Mark superseded plans (all approved plans before the last approved one)
  const approvedPlans = plans.filter((p) => p.status === "approved");
  if (approvedPlans.length > 1) {
    for (let i = 0; i < approvedPlans.length - 1; i++) {
      approvedPlans[i].status = "superseded";
    }
  }

  return plans;
}
