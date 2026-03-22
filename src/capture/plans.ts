import type { ParsedExchange } from "../types.js";

export interface ExtractedPlan {
  version: number;
  plan_text: string;
  status: "drafted" | "approved" | "implemented" | "rejected" | "superseded" | "revised";
  user_feedback: string | null;
  exchange_index_start: number;
  exchange_index_end: number;
  tasks_created: number;
  tasks_completed: number;
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
          tasks_created: 0,
          tasks_completed: 0,
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

  // Track tasks created/completed after each plan
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const planEndIdx = plan.exchange_index_end;
    const nextPlanStartIdx = (i + 1 < plans.length) ? plans[i + 1].exchange_index_start : Infinity;

    const followingExchanges = exchanges.filter(
      (e) => e.index > planEndIdx && e.index < nextPlanStartIdx,
    );

    let tasksCreated = 0;
    let tasksCompleted = 0;

    for (const ex of followingExchanges) {
      for (const tc of ex.tool_calls) {
        if (tc.name === "TaskCreate") tasksCreated++;
        if (tc.name === "TaskUpdate") {
          const input = typeof tc.input === "object" && tc.input !== null ? tc.input as Record<string, unknown> : {};
          if (input.status === "completed") tasksCompleted++;
        }
      }
    }

    plan.tasks_created = tasksCreated;
    plan.tasks_completed = tasksCompleted;
  }

  // Detect "implemented": approved plans with substantial implementation evidence
  for (const plan of plans) {
    if (plan.status === "approved") {
      const planEndIdx = plan.exchange_index_end;
      const followingExchanges = exchanges.filter((e) => e.index > planEndIdx);

      // Count implementation tool calls
      let editCount = 0;
      for (const ex of followingExchanges) {
        for (const tc of ex.tool_calls) {
          if (IMPLEMENTATION_TOOLS.has(tc.name)) editCount++;
        }
      }

      // Plan is "implemented" if:
      // - Has tasks and most are completed, OR
      // - Has significant implementation activity (3+ edits)
      const taskCompletion = plan.tasks_created > 0 ? plan.tasks_completed / plan.tasks_created : 0;
      if ((plan.tasks_created > 0 && taskCompletion >= 0.5) || editCount >= 3) {
        plan.status = "implemented";
      }
    }
  }

  // Mark superseded: all implemented/approved plans except the last one
  const activePlans = plans.filter((p) => p.status === "approved" || p.status === "implemented");
  if (activePlans.length > 1) {
    for (let i = 0; i < activePlans.length - 1; i++) {
      activePlans[i].status = "superseded";
    }
  }

  return plans;
}
