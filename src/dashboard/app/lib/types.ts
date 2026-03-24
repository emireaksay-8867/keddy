export interface SessionListItem {
  id: string;
  session_id: string;
  project_path: string;
  git_branch: string | null;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  exchange_count: number;
  compaction_count: number;
  segments: Array<{ type: string; start: number; end: number; has_summary?: boolean }>;
  milestone_count: number;
  outcomes?: {
    has_commits: boolean;
    git_ops: Array<"push" | "pull">;
    has_pr: boolean;
  };
  latest_plan?: {
    version: number;
    status: string;
    total_versions: number;
    plan_title: string | null;
  } | null;
  plans?: Array<{ version: number; status: string }>;
  has_ai?: boolean;
  forked_from?: string | null;
  parent_title?: string | null;
  // Facts-first
  activity_groups?: ActivityGroupSummary[];
  milestones?: MilestoneMarker[];
  token_summary?: { total_input: number; total_output: number; total_cache_read: number; total: number } | null;
  model?: string | null;
  file_count?: number;
  total_tool_calls?: number;
}

export interface ActivityGroupSummary {
  exchange_start: number;
  exchange_end: number;
  exchange_count: number;
  dominant_tool_category: string;
  has_errors: boolean;
  boundary: string;
}

export interface MilestoneMarker {
  type: string;
  exchange_index: number;
  description: string;
}

export interface Decision {
  id: string;
  exchange_index: number;
  decision_text: string;
  context: string | null;
  alternatives: string | null; // JSON array string
}

export interface ActivityGroupDetail {
  exchange_start: number;
  exchange_end: number;
  exchange_count: number;
  started_at: string | null;
  ended_at: string | null;
  tool_counts: Record<string, number>;
  error_count: number;
  files_read: string[];
  files_written: string[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  duration_ms: number;
  models: string[];
  markers: Array<{ exchange_index: number; type: string; label: string; metadata?: Record<string, unknown> }>;
  boundary: string;
  ai_summary: string | null;
  ai_label: string | null;
  key_actions: string[];
  first_prompt: string | null;
}

export interface SessionDetail {
  id: string;
  session_id: string;
  project_path: string;
  git_branch: string | null;
  title: string | null;
  slug: string | null;
  claude_version: string | null;
  started_at: string;
  ended_at: string | null;
  exchange_count: number;
  segments: Segment[];
  milestones: Milestone[];
  plans: Plan[];
  compaction_events: CompactionEvent[];
  tasks: Task[];
  decisions: Decision[];
  // Facts-first
  outcomes?: { has_commits: boolean; git_ops: ("push" | "pull")[]; has_pr: boolean };
  git_details?: GitDetail[];
  test_status?: { passing: boolean; description: string; exchange_index: number } | null;
  activity_groups?: ActivityGroupDetail[];
  token_summary?: { total_input: number; total_output: number; total_cache_read: number; total_cache_write: number; total: number; cache_hit_rate: number } | null;
  model_breakdown?: Array<{ model: string; exchange_count: number; total_tokens: number }>;
  file_operations?: Array<{ file_path: string; short_name: string; reads: number; edits: number; writes: number }>;
}

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: string;
  exchange_created: number;
  exchange_completed: number | null;
}

export interface Exchange {
  id: string;
  session_id: string;
  exchange_index: number;
  user_prompt: string;
  assistant_response: string;
  tool_call_count: number;
  timestamp: string;
  is_interrupt: number;
  is_compact_summary: number;
  tool_calls?: ToolCall[];
  // Facts-first fields
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  stop_reason: string | null;
  has_thinking: number | null;
  permission_mode: string | null;
  is_sidechain: number | null;
  entrypoint: string | null;
  cwd: string | null;
  git_branch: string | null;
  turn_duration_ms: number | null;
}

export interface ToolCall {
  id: string;
  tool_name: string;
  tool_input: string;
  tool_result: string | null;
  is_error: number;
  // Enriched fields
  file_path: string | null;
  bash_command: string | null;
  bash_desc: string | null;
  web_query: string | null;
  web_url: string | null;
  skill_name: string | null;
  subagent_type: string | null;
  subagent_desc: string | null;
}

export interface Segment {
  id: string;
  segment_type: string;
  exchange_index_start: number;
  exchange_index_end: number;
  files_touched: string;
  tool_counts: string;
  summary: string | null;
}

export interface Milestone {
  id: string;
  milestone_type: string;
  exchange_index: number;
  description: string;
  metadata: string | null;
}

export interface Plan {
  id: string;
  version: number;
  plan_text: string;
  status: string;
  user_feedback: string | null;
  exchange_index_start: number;
  exchange_index_end: number;
  created_at: string;
  started_at?: string;
  ended_at?: string;
}

export interface CompactionEvent {
  id: string;
  exchange_index: number;
  summary: string | null;
  analysis_summary: string | null;
  exchanges_before: number;
  exchanges_after: number;
  pre_tokens: number | null;
  timestamp: string;
}

export interface Stats {
  total_sessions: number;
  total_exchanges: number;
  total_plans: number;
  total_milestones: number;
  projects: number;
  db_size_mb: number;
}

export interface GitDetail {
  type: "commit" | "push" | "pull" | "pr" | "branch";
  exchange_index: number;
  timestamp: string;
  description: string;
  files?: string[];
  stats?: { files_changed: number; insertions: number; deletions: number };
  hash?: string;
  push_range?: string;
  push_branch?: string;
}

export interface FileDiffEntry {
  id: string;
  exchange_index: number;
  timestamp: string;
  tool_name: string;
  is_error: boolean;
  old_string?: string;
  new_string?: string;
  content_length?: number;
}

export interface RawToolCall {
  id: string;
  tool_name: string;
  tool_input: unknown;
  tool_result: string | null;
  is_error: boolean;
  bash_desc?: string;
  bash_command?: string;
  exchange_index: number;
  timestamp: string;
}
