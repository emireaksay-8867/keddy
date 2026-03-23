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
