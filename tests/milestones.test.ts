import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseTranscript } from "../src/capture/parser.js";
import { extractMilestones } from "../src/capture/milestones.js";

const FIXTURES = join(__dirname, "fixtures");

describe("extractMilestones", () => {
  it("should detect git commit milestones", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const milestones = extractMilestones(transcript.exchanges);
    const commits = milestones.filter((m) => m.milestone_type === "commit");
    expect(commits.length).toBe(1);
    expect(commits[0].description).toContain("feat: add description");
  });

  it("should extract commit message", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const milestones = extractMilestones(transcript.exchanges);
    const commit = milestones.find((m) => m.milestone_type === "commit")!;
    expect(commit.metadata).toBeDefined();
    expect(commit.metadata!.message).toContain("feat: add description");
  });

  it("should detect git push milestones", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const milestones = extractMilestones(transcript.exchanges);
    const pushes = milestones.filter((m) => m.milestone_type === "push");
    expect(pushes.length).toBe(1);
  });

  it("should detect test command milestones", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const milestones = extractMilestones(transcript.exchanges);
    const tests = milestones.filter(
      (m) => m.milestone_type === "test_pass" || m.milestone_type === "test_fail",
    );
    expect(tests.length).toBe(1);
    expect(tests[0].milestone_type).toBe("test_pass");
  });

  it("should assign exchange indices to milestones", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const milestones = extractMilestones(transcript.exchanges);
    for (const m of milestones) {
      expect(m.exchange_index).toBeDefined();
      expect(m.exchange_index).toBeGreaterThanOrEqual(0);
    }
  });

  it("should return empty array for sessions without milestones", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const milestones = extractMilestones(transcript.exchanges);
    expect(milestones).toEqual([]);
  });

  it("should detect branch creation via regex", () => {
    const milestones = extractMilestones([
      {
        index: 0,
        user_prompt: "Create a branch",
        assistant_response: "Creating branch.",
        tool_calls: [
          {
            name: "Bash",
            input: { command: "git checkout -b feature/new-api" },
            id: "t1",
          },
        ],
        timestamp: "2024-01-01",
        is_interrupt: false,
        is_compact_summary: false,
      },
    ]);
    const branch = milestones.find((m) => m.milestone_type === "branch");
    expect(branch).toBeDefined();
    expect(branch!.description).toContain("feature/new-api");
  });

  it("should detect PR creation via regex", () => {
    const milestones = extractMilestones([
      {
        index: 0,
        user_prompt: "Create PR",
        assistant_response: "Creating PR.",
        tool_calls: [
          {
            name: "Bash",
            input: {
              command:
                'gh pr create --title "Add auth" --body "Adds authentication"',
            },
            id: "t1",
          },
        ],
        timestamp: "2024-01-01",
        is_interrupt: false,
        is_compact_summary: false,
      },
    ]);
    const pr = milestones.find((m) => m.milestone_type === "pr");
    expect(pr).toBeDefined();
    expect(pr!.description).toContain("pull request");
  });
});
