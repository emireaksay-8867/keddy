import type { ParsedExchange } from "../types.js";

export interface ExtractedPlan {
  version: number;
  plan_text: string;
  status: "drafted" | "approved" | "rejected" | "superseded";
  user_feedback: string | null;
  exchange_index_start: number;
  exchange_index_end: number;
}

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

        // Check tool result for approval/rejection
        if (tc.result) {
          if (tc.result.includes("User has approved your plan")) {
            status = "approved";
          } else if (tc.result.includes("doesn't want to proceed")) {
            status = "rejected";
            // Extract user feedback after "the user said:\n"
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

  // Mark superseded plans (all approved plans before the last one)
  const approvedPlans = plans.filter((p) => p.status === "approved");
  if (approvedPlans.length > 1) {
    for (let i = 0; i < approvedPlans.length - 1; i++) {
      approvedPlans[i].status = "superseded";
    }
  }

  return plans;
}
