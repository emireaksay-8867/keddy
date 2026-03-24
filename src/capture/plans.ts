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
              // Strip system notes
              if (userFeedback.includes("Note: The user's next message")) {
                userFeedback = userFeedback.split("Note: The user's next message")[0].trim();
              }
              // Strip terminal transcript pastes (start with Claude Code banner or ❯ prompt)
              if (userFeedback.startsWith("\u259B") || userFeedback.startsWith("▛")) {
                // Full terminal paste — extract just the last ❯ prompt line
                const lines = userFeedback.split(/\r?\n/);
                const lastPrompt = lines.filter(l => l.startsWith("❯") || l.startsWith(">")).pop();
                userFeedback = lastPrompt ? lastPrompt.replace(/^[❯>]\s*/, "").trim() : "";
              }
              // Cap at 1000 chars — preserve full user feedback without terminal noise
              if (userFeedback.length > 1000) {
                userFeedback = userFeedback.substring(0, 1000);
              }
              // If empty after cleanup, null it out
              if (!userFeedback) userFeedback = null;
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

  // Fix: If plan mode was entered but never exited (still drafting, or session ended),
  // create a "drafted" plan record so the UI shows an active draft exists
  if (planStart !== null && exchanges.length > 0) {
    version++;
    plans.push({
      version,
      plan_text: "",
      status: "drafted",
      user_feedback: null,
      exchange_index_start: planStart,
      exchange_index_end: exchanges[exchanges.length - 1].index,
      tasks_created: 0,
      tasks_completed: 0,
    });
    planStart = null;
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

      const implTools = new Set(["Edit", "Write", "Bash", "NotebookEdit"]);
      const hasImplementation = followingExchanges.some((e) =>
        e.tool_calls.some((tc) => implTools.has(tc.name)),
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

  // Detect "implemented": ONLY from task evidence (factual, no heuristics)
  // We don't guess from edit counts — edits after a plan could be unrelated.
  // Tasks are the only factual link: Claude creates them from the plan and marks them done.
  for (const plan of plans) {
    if (plan.status === "approved" && plan.tasks_created > 0) {
      if (plan.tasks_completed >= plan.tasks_created) {
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

  // If the last plan is "drafted" (entered but not exited), supersede any previous
  // approved/implemented plans — re-entering plan mode means the old plan is being replaced
  const lastPlan = plans[plans.length - 1];
  if (lastPlan && lastPlan.status === "drafted" && plans.length > 1) {
    for (let i = 0; i < plans.length - 1; i++) {
      if (plans[i].status === "approved" || plans[i].status === "implemented") {
        plans[i].status = "superseded";
      }
    }
  }

  return plans;
}
