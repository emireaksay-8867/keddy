export const SEGMENT_COLORS: Record<string, string> = {
  planning: "#a78bfa",
  implementing: "#60a5fa",
  testing: "#34d399",
  debugging: "#f87171",
  exploring: "#fbbf24",
  querying: "#fb923c",
  reviewing: "#c084fc",
  discussion: "#9ca3af",
  pivot: "#f472b6",
  deploying: "#22d3ee",
};

export const SEGMENT_LABELS: Record<string, string> = {
  planning: "Planning",
  implementing: "Implementation",
  testing: "Testing",
  debugging: "Debugging",
  exploring: "Exploration",
  querying: "Querying",
  reviewing: "Review",
  discussion: "Discussion",
  pivot: "Direction Change",
  deploying: "Deployment",
};

/** Short labels for the segment flow display */
export const SEGMENT_SHORT_LABELS: Record<string, string> = {
  planning: "plan",
  implementing: "build",
  testing: "test",
  debugging: "debug",
  exploring: "explore",
  querying: "query",
  reviewing: "review",
  discussion: "chat",
  pivot: "pivot",
  deploying: "deploy",
};

export const MILESTONE_ICONS: Record<string, string> = {
  commit: "\u25CB",
  push: "\u2191",
  pr: "\u2442",
  branch: "\u2443",
  test_pass: "\u2713",
  test_fail: "\u2717",
};

export const TOOL_LABELS: Record<string, string> = {
  Read: "read",
  Edit: "edit",
  Write: "write",
  Bash: "bash",
  Grep: "grep",
  Glob: "glob",
  Agent: "agent",
};
