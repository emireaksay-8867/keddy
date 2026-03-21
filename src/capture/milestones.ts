import type { ParsedExchange } from "../types.js";
import type { MilestoneType } from "../types.js";

export interface ExtractedMilestone {
  milestone_type: MilestoneType;
  exchange_index: number;
  description: string;
  metadata: Record<string, unknown> | null;
}

// Match: git commit -m "message" or git commit -m 'message'
const COMMIT_SIMPLE_RE = /git commit\s+(?:.*\s)?-m\s+["']([^"']+)["']/;
// Match: git commit -m "$(cat <<'EOF'\nmessage\nEOF\n)" — extract first meaningful line after EOF marker
const COMMIT_HEREDOC_RE = /git commit\s+.*-m\s+['"]\$\(cat\s+<<[\s']*(\w+)/;
const PUSH_RE = /git push\s*(.*)/;
const PR_RE = /gh pr create/;
const PR_TITLE_RE = /--title\s+["']([^"']+)["']/;
const BRANCH_RE = /git checkout -b\s+(\S+)/;
const BRANCH_SWITCH_RE = /git switch -c\s+(\S+)/;
const TEST_COMMANDS = [/\bnpm test\b/, /\bnpx vitest\b/, /\bvitest run\b/, /\bjest\b/, /\bpytest\b/, /\bcargo test\b/, /\bgo test\b/, /\bmake test\b/];

function getBashCommand(tc: { name: string; input: unknown }): string | null {
  if (tc.name !== "Bash") return null;
  if (typeof tc.input === "string") return tc.input;
  if (typeof tc.input === "object" && tc.input !== null && "command" in tc.input) {
    return String((tc.input as { command: unknown }).command);
  }
  return null;
}

function extractHeredocMessage(cmd: string): string | null {
  // Look for the first non-empty line after the heredoc marker that looks like a commit message
  const lines = cmd.split("\n");
  let foundMarker = false;
  for (const line of lines) {
    if (/<<[\s']*EOF/.test(line) || /<<[\s']*HEREDOC/.test(line)) {
      foundMarker = true;
      continue;
    }
    if (foundMarker) {
      const trimmed = line.trim();
      if (trimmed && trimmed !== "EOF" && trimmed !== "HEREDOC" && !trimmed.startsWith(")") && !trimmed.startsWith("Co-Authored")) {
        return trimmed;
      }
    }
  }
  return null;
}

function cleanPushDescription(args: string): string {
  // Remove noise like "2>&1", "| tail", etc.
  return args
    .replace(/\s*2>&1.*$/, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*&&.*$/, "")
    .trim();
}

export function extractMilestones(exchanges: ParsedExchange[]): ExtractedMilestone[] {
  const milestones: ExtractedMilestone[] = [];

  for (const exchange of exchanges) {
    for (const tc of exchange.tool_calls) {
      const cmd = getBashCommand(tc);
      if (!cmd) continue;

      // Git commit — try heredoc format first (more specific), then simple
      if (COMMIT_HEREDOC_RE.test(cmd)) {
        const msg = extractHeredocMessage(cmd);
        if (msg) {
          milestones.push({
            milestone_type: "commit",
            exchange_index: exchange.index,
            description: msg,
            metadata: { message: msg },
          });
        } else {
          milestones.push({
            milestone_type: "commit",
            exchange_index: exchange.index,
            description: "Committed changes",
            metadata: null,
          });
        }
        continue;
      }

      // Git commit — simple format: git commit -m "message"
      const commitSimple = cmd.match(COMMIT_SIMPLE_RE);
      if (commitSimple) {
        milestones.push({
          milestone_type: "commit",
          exchange_index: exchange.index,
          description: commitSimple[1],
          metadata: { message: commitSimple[1] },
        });
        continue;
      }

      // Git push
      const pushMatch = cmd.match(PUSH_RE);
      if (pushMatch) {
        const cleanArgs = cleanPushDescription(pushMatch[1] || "");
        const parts = cleanArgs.split(/\s+/).filter(Boolean);
        const remote = parts[0] || "origin";
        const branch = parts[1] || "";
        milestones.push({
          milestone_type: "push",
          exchange_index: exchange.index,
          description: branch ? `Pushed to ${remote}/${branch}` : `Pushed to ${remote}`,
          metadata: { remote, branch: branch || null },
        });
        continue;
      }

      // PR creation
      if (PR_RE.test(cmd)) {
        const titleMatch = cmd.match(PR_TITLE_RE);
        milestones.push({
          milestone_type: "pr",
          exchange_index: exchange.index,
          description: titleMatch ? `PR: ${titleMatch[1]}` : "Created pull request",
          metadata: titleMatch ? { title: titleMatch[1] } : null,
        });
        continue;
      }

      // Branch creation
      const branchMatch = cmd.match(BRANCH_RE) || cmd.match(BRANCH_SWITCH_RE);
      if (branchMatch) {
        milestones.push({
          milestone_type: "branch",
          exchange_index: exchange.index,
          description: `Created branch ${branchMatch[1]}`,
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
          description: isError ? "Tests failed" : "Tests passed",
          metadata: { command: cmd.split(/\s*[|&2>]/).shift()?.trim() || cmd },
        });
      }
    }
  }

  return milestones;
}
