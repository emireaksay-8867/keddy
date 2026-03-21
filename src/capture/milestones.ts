import type { ParsedExchange } from "../types.js";
import type { MilestoneType } from "../types.js";

export interface ExtractedMilestone {
  milestone_type: MilestoneType;
  exchange_index: number;
  description: string;
  metadata: Record<string, unknown> | null;
}

const COMMIT_RE = /git commit\s+(?:.*\s)?-m\s+["']([^"']+)["']/;
const PUSH_RE = /git push\s*(.*)/;
const PR_RE = /gh pr create/;
const BRANCH_RE = /git checkout -b\s+(\S+)/;
const TEST_COMMANDS = [/\bnpm test\b/, /\bnpx vitest\b/, /\bvitest\b/, /\bjest\b/, /\bpytest\b/, /\bcargo test\b/, /\bgo test\b/, /\bmake test\b/];

function getBashCommand(tc: { name: string; input: unknown }): string | null {
  if (tc.name !== "Bash") return null;
  if (typeof tc.input === "string") return tc.input;
  if (typeof tc.input === "object" && tc.input !== null && "command" in tc.input) {
    return String((tc.input as { command: unknown }).command);
  }
  return null;
}

export function extractMilestones(exchanges: ParsedExchange[]): ExtractedMilestone[] {
  const milestones: ExtractedMilestone[] = [];

  for (const exchange of exchanges) {
    for (const tc of exchange.tool_calls) {
      const cmd = getBashCommand(tc);
      if (!cmd) continue;

      // Git commit
      const commitMatch = cmd.match(COMMIT_RE);
      if (commitMatch) {
        milestones.push({
          milestone_type: "commit",
          exchange_index: exchange.index,
          description: `Commit: ${commitMatch[1]}`,
          metadata: { message: commitMatch[1] },
        });
        continue;
      }

      // Git push
      const pushMatch = cmd.match(PUSH_RE);
      if (pushMatch) {
        milestones.push({
          milestone_type: "push",
          exchange_index: exchange.index,
          description: `Push${pushMatch[1] ? `: ${pushMatch[1].trim()}` : ""}`,
          metadata: { args: pushMatch[1]?.trim() ?? null },
        });
        continue;
      }

      // PR creation
      if (PR_RE.test(cmd)) {
        milestones.push({
          milestone_type: "pr",
          exchange_index: exchange.index,
          description: "Created pull request",
          metadata: null,
        });
        continue;
      }

      // Branch creation
      const branchMatch = cmd.match(BRANCH_RE);
      if (branchMatch) {
        milestones.push({
          milestone_type: "branch",
          exchange_index: exchange.index,
          description: `Branch: ${branchMatch[1]}`,
          metadata: { branch: branchMatch[1] },
        });
        continue;
      }

      // Test commands
      if (TEST_COMMANDS.some((re) => re.test(cmd))) {
        const isError = tc.is_error === true;
        milestones.push({
          milestone_type: isError ? "test_fail" : "test_pass",
          exchange_index: exchange.index,
          description: isError ? `Tests failed: ${cmd}` : `Tests passed: ${cmd}`,
          metadata: { command: cmd },
        });
      }
    }
  }

  return milestones;
}
