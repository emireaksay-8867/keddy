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
  plans?: Array<{ version: number; status: string }>;
  has_ai?: boolean;
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
}

export interface ToolCall {
  id: string;
  tool_name: string;
  tool_input: string;
  tool_result: string | null;
  is_error: number;
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
}

export interface CompactionEvent {
  id: string;
  exchange_index: number;
  summary: string | null;
  exchanges_before: number;
  exchanges_after: number;
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
