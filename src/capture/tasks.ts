import type { ParsedExchange } from "../types.js";

export interface ExtractedTask {
  id: string; // taskId from TaskCreate/TaskUpdate
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "stopped";
  exchange_index_created: number;
  exchange_index_completed: number | null;
}

export function extractTasks(exchanges: ParsedExchange[]): ExtractedTask[] {
  const tasks = new Map<string, ExtractedTask>();
  let autoId = 0;

  for (const exchange of exchanges) {
    for (const tc of exchange.tool_calls) {
      if (tc.name === "TaskCreate") {
        autoId++;
        const input = typeof tc.input === "object" && tc.input !== null
          ? tc.input as Record<string, unknown>
          : {};
        const taskId = String(autoId);
        tasks.set(taskId, {
          id: taskId,
          subject: String(input.subject || ""),
          description: String(input.description || ""),
          status: "pending",
          exchange_index_created: exchange.index,
          exchange_index_completed: null,
        });
      }

      if (tc.name === "TaskUpdate") {
        const input = typeof tc.input === "object" && tc.input !== null
          ? tc.input as Record<string, unknown>
          : {};
        const taskId = String(input.taskId || "");
        const status = String(input.status || "");
        const task = tasks.get(taskId);
        if (task) {
          if (status === "completed") {
            task.status = "completed";
            task.exchange_index_completed = exchange.index;
          } else if (status === "in_progress") {
            task.status = "in_progress";
          }
        }
      }

      if (tc.name === "TaskStop") {
        const input = typeof tc.input === "object" && tc.input !== null
          ? tc.input as Record<string, unknown>
          : {};
        const taskId = String(input.taskId || input.task_id || "");
        const task = tasks.get(taskId);
        if (task) {
          task.status = "stopped";
        }
      }
    }
  }

  return Array.from(tasks.values());
}
