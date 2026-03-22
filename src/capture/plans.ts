import type { ParsedExchange } from "../types.js";

export interface ExtractedPlan {
  version: number;
  plan_text: string;
  status: "drafted" | "approved" | "rejected" | "superseded" | "revised";
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
      if (tc.name === "EnterPlanMode") {
        planStart = exchange.index;
        continue;
      }

      if (tc.name === "ExitPlanMode") {
        version++;
        const planText =
          typeof tc.input === "object" && tc.input !== null && "plan" in tc.input
            ? String((tc.input as { plan: unknown }).plan)
            : "";

        let status: ExtractedPlan["status"] = "drafted";
        let userFeedback: string | null = null;

        if (tc.result) {
          if (tc.result.includes("User has approved your plan")) {
            status = "approved";
          } else if (tc.result.includes("doesn't want to proceed")) {
            status = "rejected";
            const feedbackMatch = tc.result.match(/the user said:\n([\s\S]*)/);
            if (feedbackMatch) {
              userFeedback = feedbackMatch[1].trim();
              // Clean up the feedback
              if (userFeedback.includes("Note: The user's next message")) {
                userFeedback = userFeedback.split("Note: The user's next message")[0].trim();
              }
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

  // Now determine the TRUE status of each plan:
  //
  // 1. If a "rejected" plan has user feedback AND a next version exists,
  //    it was "revised" — the user asked for changes, not a full rejection
  //
  // 2. The LAST plan version that is followed by implementation tool calls
  //    is "approved" (implicitly) — the user proceeded with execution
  //
  // 3. Earlier approved plans are "superseded" by later ones

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const hasNextVersion = i + 1 < plans.length;

    // "Rejected" with feedback + next version = "revised" (feedback incorporated)
    if (plan.status === "rejected" && plan.user_feedback && hasNextVersion) {
      plan.status = "revised";
    }

    // Check for implicit approval: if this plan (drafted or rejected without feedback)
    // is the LAST plan AND subsequent exchanges have implementation tools
    if (plan.status === "drafted" || (plan.status === "rejected" && !hasNextVersion)) {
      const planEndIdx = plan.exchange_index_end;
      const nextPlanStartIdx = hasNextVersion ? plans[i + 1].exchange_index_start : Infinity;

      const followingExchanges = exchanges.filter(
        (e) => e.index > planEndIdx && e.index < nextPlanStartIdx,
      );

      const hasImplementation = followingExchanges.some((e) =>
        e.tool_calls.some((tc) => IMPLEMENTATION_TOOLS.has(tc.name)),
      );

      if (hasImplementation) {
        plan.status = "approved";
      }
    }
  }

  // Mark superseded: all approved plans except the last one
  const approvedPlans = plans.filter((p) => p.status === "approved");
  if (approvedPlans.length > 1) {
    for (let i = 0; i < approvedPlans.length - 1; i++) {
      approvedPlans[i].status = "superseded";
    }
  }

  return plans;
}
