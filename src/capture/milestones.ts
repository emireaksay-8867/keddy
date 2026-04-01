import { execSync } from "child_process";
import type { ParsedExchange } from "../types.js";
import type { MilestoneType } from "../types.js";

export interface ExtractedMilestone {
  milestone_type: MilestoneType;
  exchange_index: number;
  description: string;
  metadata: Record<string, unknown> | null;
}

// Match: git commit -m "message" or git commit -m 'message'
const COMMIT_SIMPLE_RE = /(?:^|&&\s*|;\s*)git commit\s+(?:.*\s)?-m\s+["']([^"']+)["']/m;
// Match: git commit -m "$(cat <<'EOF'\nmessage\nEOF\n)" — extract first meaningful line after EOF marker
const COMMIT_HEREDOC_RE = /(?:^|&&\s*|;\s*)git commit\s+.*-m\s+['"]\$\(cat\s+<<[\s']*(\w+)/m;
const PUSH_RE = /(?:^|&&\s*|;\s*)git push\s*(.*)/m;
const PULL_RE = /(?:^|&&\s*|;\s*)git pull\s*(.*)/m;
const PR_RE = /(?:^|&&\s*|;\s*)gh pr create/m;
const PR_TITLE_RE = /--title\s+["']([^"']+)["']/;
const BRANCH_RE = /(?:^|&&\s*|;\s*)git checkout -b\s+(\S+)/m;
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

/** Parse test runner output to extract pass/fail counts and first failure info */
export function extractTestSummary(result: string | undefined): {
  passed: number;
  failed: number;
  total: number;
  firstFailFile: string | null;
  firstFailTest: string | null;
} | null {
  if (!result) return null;
  // Truncate to avoid pathological regex on huge output
  const text = result.substring(0, 4000);

  let passed = 0;
  let failed = 0;
  let firstFailFile: string | null = null;
  let firstFailTest: string | null = null;

  // Vitest/Jest: "Tests  X failed | Y passed" or "Test Suites:  X failed, Y passed"
  const vitestTests = text.match(/Tests?\s+(\d+)\s+failed\s*[|,]\s*(\d+)\s+passed/i);
  const vitestSuites = text.match(/Test (?:Suites|Files):?\s+(\d+)\s+failed\s*[|,]\s*(\d+)\s+passed/i);
  // Vitest alt: "Y passed | X failed" (reversed order)
  const vitestReversed = text.match(/Tests?\s+(\d+)\s+passed\s*[|,]\s*(\d+)\s+failed/i);

  if (vitestTests) {
    failed = parseInt(vitestTests[1]);
    passed = parseInt(vitestTests[2]);
  } else if (vitestSuites) {
    failed = parseInt(vitestSuites[1]);
    passed = parseInt(vitestSuites[2]);
  } else if (vitestReversed) {
    passed = parseInt(vitestReversed[1]);
    failed = parseInt(vitestReversed[2]);
  }

  // pytest: "X failed, Y passed" or "X passed, Y failed" or "X passed"
  if (passed === 0 && failed === 0) {
    const pytestFP = text.match(/(\d+)\s+failed.*?(\d+)\s+passed/);
    const pytestPF = text.match(/(\d+)\s+passed.*?(\d+)\s+failed/);
    const pytestPass = text.match(/(\d+)\s+passed/);
    if (pytestFP) { failed = parseInt(pytestFP[1]); passed = parseInt(pytestFP[2]); }
    else if (pytestPF) { passed = parseInt(pytestPF[1]); failed = parseInt(pytestPF[2]); }
    else if (pytestPass) { passed = parseInt(pytestPass[1]); }
  }

  // cargo test: "test result: FAILED. X passed; Y failed"
  if (passed === 0 && failed === 0) {
    const cargo = text.match(/test result:.*?(\d+)\s+passed.*?(\d+)\s+failed/);
    if (cargo) { passed = parseInt(cargo[1]); failed = parseInt(cargo[2]); }
  }

  // go test: count "--- FAIL:" and "--- PASS:" occurrences
  if (passed === 0 && failed === 0) {
    const goFails = text.match(/--- FAIL:/g);
    const goPasses = text.match(/--- PASS:/g);
    if (goFails || goPasses) {
      failed = goFails?.length ?? 0;
      passed = goPasses?.length ?? 0;
    }
  }

  // If we didn't find any counts, return null
  if (passed === 0 && failed === 0) return null;

  // Extract first failing test file: "FAIL src/auth.test.ts" or "FAIL  tests/auth.test.ts"
  const failFileMatch = text.match(/FAIL\s+(\S+\.(?:test|spec)\.\w+)/);
  if (failFileMatch) firstFailFile = failFileMatch[1];

  // pytest: "FAILED test_file.py::test_name"
  if (!firstFailFile) {
    const pytestFile = text.match(/FAILED\s+(\S+?)(?:::|\s)/);
    if (pytestFile) firstFailFile = pytestFile[1];
  }

  // Extract first failing test name: "✕ test name" or "> test name" after FAIL line
  const failNameMatch = text.match(/[✕×✗>]\s+(.+?)(?:\s+\(\d|$)/m);
  if (failNameMatch) firstFailTest = failNameMatch[1].trim();

  // go test: "--- FAIL: TestName"
  if (!firstFailTest) {
    const goFail = text.match(/--- FAIL:\s+(\S+)/);
    if (goFail) firstFailTest = goFail[1];
  }

  // cargo test: "test module::name ... FAILED"
  if (!firstFailTest) {
    const cargoFail = text.match(/test\s+(\S+)\s+\.\.\.\s+FAILED/);
    if (cargoFail) firstFailTest = cargoFail[1];
  }

  return {
    passed,
    failed,
    total: passed + failed,
    firstFailFile,
    firstFailTest,
  };
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
      // No `continue` — chained commands (git commit && git push) need both detected
      let foundCommit = false;
      if (COMMIT_HEREDOC_RE.test(cmd)) {
        const msg = extractHeredocMessage(cmd);
        milestones.push({
          milestone_type: "commit",
          exchange_index: exchange.index,
          description: msg || "Committed changes",
          metadata: msg ? { message: msg } : null,
        });
        foundCommit = true;
      }

      if (!foundCommit) {
        const commitSimple = cmd.match(COMMIT_SIMPLE_RE);
        if (commitSimple) {
          milestones.push({
            milestone_type: "commit",
            exchange_index: exchange.index,
            description: commitSimple[1],
            metadata: { message: commitSimple[1] },
          });
          foundCommit = true;
        }
      }

      // Git push — always check even if commit was found (chained commands)
      // Skip failed pushes — if the command errored, nothing was pushed
      const pushMatch = !tc.is_error && cmd.match(PUSH_RE);
      if (pushMatch) {
        const cleanArgs = cleanPushDescription(pushMatch[1] || "");
        // Reject false positives: garbage chars indicate "git push" appeared
        // inside a SQL query, string literal, or other non-git context
        const isGarbage = /[;'"(){}|<>\\$~%^!?]/.test(cleanArgs)
          || /\.(db|sqlite|sql)\b/.test(cleanArgs);
        if (!isGarbage) {
          const parts = cleanArgs.split(/\s+/).filter(Boolean);
          const remote = parts[0] || "origin";
          const branch = parts[1] || "";
          milestones.push({
            milestone_type: "push",
            exchange_index: exchange.index,
            description: branch ? `Pushed to ${remote}/${branch}` : `Pushed to ${remote}`,
            metadata: { remote, branch: branch || null },
          });
        }
        if (foundCommit) continue; // both found, move on
        continue;
      }

      if (foundCommit) continue;

      // Git pull — skip failed pulls
      const pullMatch = !tc.is_error && cmd.match(PULL_RE);
      if (pullMatch) {
        const cleanArgs = cleanPushDescription(pullMatch[1] || "");
        const isGarbage = /[;'"(){}|<>\\$~%^!?]/.test(cleanArgs)
          || /\.(db|sqlite|sql)\b/.test(cleanArgs);
        if (!isGarbage) {
          const parts = cleanArgs.split(/\s+/).filter(Boolean);
          const remote = parts[0] || "origin";
          const branch = parts[1] || "";
          milestones.push({
            milestone_type: "pull",
            exchange_index: exchange.index,
            description: branch ? `Pulled from ${remote}/${branch}` : `Pulled from ${remote}`,
            metadata: { remote, branch: branch || null },
          });
        }
        continue;
      }

      // PR creation — skip failed attempts (command errored, no PR was created)
      if (!tc.is_error && PR_RE.test(cmd)) {
        const titleMatch = cmd.match(PR_TITLE_RE);
        // Extract PR number from tool result (e.g., "https://github.com/owner/repo/pull/42")
        const prNumMatch = tc.result?.match(/\/pull\/(\d+)/);
        const prNum = prNumMatch ? parseInt(prNumMatch[1]) : null;
        const title = titleMatch ? titleMatch[1] : "Created pull request";
        milestones.push({
          milestone_type: "pr",
          exchange_index: exchange.index,
          description: prNum ? `PR #${prNum}: ${title}` : `PR: ${title}`,
          metadata: { title, ...(prNum ? { number: prNum } : {}) },
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
        const summary = extractTestSummary(tc.result);
        let description: string;
        if (summary && summary.total > 0) {
          if (isError && summary.firstFailFile) {
            const shortFile = summary.firstFailFile.split("/").pop() || summary.firstFailFile;
            const testPart = summary.firstFailTest ? ` — ${summary.firstFailTest}` : "";
            description = `Tests failed: ${shortFile}${testPart} (${summary.failed}/${summary.total})`;
          } else if (isError) {
            description = `Tests failed (${summary.failed}/${summary.total})`;
          } else {
            description = `Tests passed (${summary.passed}/${summary.total})`;
          }
        } else {
          description = isError ? "Tests failed" : "Tests passed";
        }
        milestones.push({
          milestone_type: isError ? "test_fail" : "test_pass",
          exchange_index: exchange.index,
          description,
          metadata: {
            command: cmd.split(/\s*[|&2>]/).shift()?.trim() || cmd,
            ...(summary ? { passed: summary.passed, failed: summary.failed, total: summary.total } : {}),
          },
        });
      }
    }
  }

  return milestones;
}

/**
 * Extract milestones from git history during the session timeframe.
 * Captures commits made by any tool (terminal, GitKraken, VS Code, GitHub Desktop)
 * — not just Claude's Bash calls.
 */
export function extractGitMilestones(
  projectPath: string,
  startedAt: string,
  endedAt: string | null,
  existingCommitMessages: Set<string>,
): ExtractedMilestone[] {
  const milestones: ExtractedMilestone[] = [];

  try {
    const since = new Date(startedAt).toISOString();
    const until = endedAt ? new Date(endedAt).toISOString() : new Date().toISOString();

    // Get commits in timeframe: hash, subject, author date
    const gitLog = execSync(
      `git log --all --after="${since}" --before="${until}" --format="%H%x00%s%x00%aI" --no-merges`,
      { cwd: projectPath, timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!gitLog) return milestones;

    for (const line of gitLog.split("\n")) {
      if (!line.trim()) continue;
      const [hash, subject, _date] = line.split("\0");
      if (!hash || !subject) continue;

      // Skip if already captured from Claude's tool calls
      if (existingCommitMessages.has(subject)) continue;

      milestones.push({
        milestone_type: "commit",
        exchange_index: -1,
        description: subject,
        metadata: { message: subject, hash: hash.substring(0, 8), source: "git" },
      });
    }

    // Detect pushes from reflog during session timeframe
    const existingPushes = existingCommitMessages; // reuse param to check duplication flag
    try {
      const reflog = execSync(
        `git reflog --date=iso --format="%gd%x00%gs%x00%gD" --all`,
        { cwd: projectPath, timeout: 5000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
      if (reflog) {
        for (const line of reflog.split("\n")) {
          if (!line.includes("push") && !line.includes("update by push")) continue;
          // reflog entries with push indicate a push happened
          const hasPushMilestone = milestones.some(m => m.milestone_type === "push");
          if (!hasPushMilestone) {
            milestones.push({
              milestone_type: "push",
              exchange_index: -1,
              description: "Pushed (detected from git)",
              metadata: { source: "git" },
            });
            break; // one push milestone is enough
          }
        }
      }
    } catch { /* reflog not available */ }

    // Detect PRs via gh CLI (if available)
    try {
      const prs = execSync(
        `gh pr list --state all --author @me --json number,title,createdAt --limit 5`,
        { cwd: projectPath, timeout: 10000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
      if (prs) {
        const prList = JSON.parse(prs) as Array<{ number: number; title: string; createdAt: string }>;
        const sinceDate = new Date(since);
        const untilDate = new Date(until);
        for (const pr of prList) {
          const prDate = new Date(pr.createdAt);
          if (prDate >= sinceDate && prDate <= untilDate) {
            milestones.push({
              milestone_type: "pr",
              exchange_index: -1,
              description: `PR #${pr.number}: ${pr.title}`,
              metadata: { number: pr.number, title: pr.title, source: "github" },
            });
          }
        }
      }
    } catch { /* gh not available or not authenticated */ }
  } catch {
    // Not a git repo, or git not available — silently skip
  }

  return milestones;
}
