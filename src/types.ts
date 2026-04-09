// ============================================================
// Keddy — Shared Type Definitions
// ============================================================

// --- Core Entities ---

export interface Session {
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
  compaction_count: number;
  jsonl_path: string | null;
  forked_from: string | null;
  fork_exchange_index: number | null;
  metadata: string | null; // JSON string
  entrypoint: string | null;
}

export interface Exchange {
  id: string;
  session_id: string;
  exchange_index: number;
  user_prompt: string;
  assistant_response: string;
  tool_call_count: number;
  timestamp: string;
  duration_ms: number | null;
  is_interrupt: boolean;
  is_compact_summary: boolean;
  metadata: string | null; // JSON string
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
  exchange_id: string;
  session_id: string;
  tool_name: string;
  tool_input: string; // JSON string
  tool_result: string | null;
  tool_use_id: string;
  is_error: boolean;
  duration_ms: number | null;
  // Facts-first enrichment
  skill_name: string | null;
  subagent_type: string | null;
  subagent_desc: string | null;
  file_path: string | null;
  bash_command: string | null;
  bash_desc: string | null;
  web_query: string | null;
  web_url: string | null;
}

export type PlanStatus = "drafted" | "approved" | "implemented" | "rejected" | "superseded" | "revised";

export interface Plan {
  id: string;
  session_id: string;
  version: number;
  plan_text: string;
  status: PlanStatus;
  user_feedback: string | null;
  exchange_index_start: number;
  exchange_index_end: number;
  created_at: string;
}

export type SegmentType =
  | "planning"
  | "implementing"
  | "testing"
  | "debugging"
  | "exploring"
  | "querying"
  | "reviewing"
  | "discussion"
  | "pivot"
  | "deploying";

export interface Segment {
  id: string;
  session_id: string;
  segment_type: SegmentType;
  exchange_index_start: number;
  exchange_index_end: number;
  files_touched: string; // JSON array string
  tool_counts: string; // JSON object string
  summary: string | null;
  // Facts-first activity group fields
  boundary_type: string | null;
  files_read: string | null; // JSON array string
  files_written: string | null; // JSON array string
  error_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  duration_ms: number;
  models: string | null; // JSON array string
  markers: string | null; // JSON array string
  exchange_count: number;
  started_at: string | null;
  ended_at: string | null;
  ai_label: string | null;
  ai_summary: string | null;
}

export type MilestoneType =
  | "commit"
  | "push"
  | "pull"
  | "pr"
  | "branch"
  | "test_pass"
  | "test_fail";

export interface Milestone {
  id: string;
  session_id: string;
  milestone_type: MilestoneType;
  exchange_index: number;
  description: string;
  metadata: string | null; // JSON string
}

export interface Decision {
  id: string;
  session_id: string;
  exchange_index: number;
  decision_text: string;
  context: string | null;
  alternatives: string | null; // JSON array string
}

export interface CompactionEvent {
  id: string;
  session_id: string;
  exchange_index: number;
  summary: string | null;
  exchanges_before: number;
  exchanges_after: number;
  timestamp: string;
}

export interface SessionLink {
  id: string;
  source_session_id: string;
  target_session_id: string;
  link_type: string;
  shared_files: string; // JSON array string
}

// --- Parser Types ---

export interface ContentBlockRef {
  type: "text" | "tool_use" | "thinking";
  text?: string;         // for type === "text"
  tool_use_id?: string;  // for type === "tool_use"
}

export interface ParsedToolCall {
  name: string;
  input: unknown;
  id: string;
  result?: string;
  is_error?: boolean;
}

export interface ParsedExchange {
  index: number;
  user_prompt: string;
  assistant_response: string;
  assistant_response_pre: string;
  content_blocks?: ContentBlockRef[];
  tool_calls: ParsedToolCall[];
  timestamp: string;
  is_interrupt: boolean;
  is_compact_summary: boolean;
  metadata?: Record<string, unknown>;
  // Facts-first fields
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  stop_reason?: string | null;
  has_thinking?: boolean;
  permission_mode?: string | null;
  is_sidechain?: boolean;
  entrypoint?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  turn_duration_ms?: number | null;
}

export interface ParsedTranscript {
  session_id: string;
  project_path: string;
  git_branch: string | null;
  claude_version: string | null;
  slug: string | null;
  forked_from: string | null;
  custom_title: string | null;
  started_at: string | null;
  ended_at: string | null;
  exchanges: ParsedExchange[];
  compactions: Array<{
    exchange_index: number;
    summary: string | null;
    pre_tokens: number | null;
  }>;
  /** Exchange index where forked session diverges from parent (new content starts) */
  fork_exchange_index: number | null;
  entrypoint?: string | null;
}

// --- Facts-First Types ---

export type BoundaryType =
  | "session_start"
  | "plan_mode"
  | "compaction"
  | "interrupt"
  | "branch_change"
  | "file_focus_shift"
  | "long_pause"
  | "session_end"
  // Legacy — kept for DB compatibility with existing data
  | "milestone"
  | "skill"
  | "model_switch";

export type MarkerType =
  | "plan_enter"
  | "plan_exit"
  | "compaction"
  | "interrupt"
  | "commit"
  | "push"
  | "pr"
  | "branch"
  | "test_pass"
  | "test_fail"
  | "skill"
  | "subagent"
  | "web_research"
  | "branch_change"
  | "model_switch";

export interface GroupMarker {
  exchange_index: number;
  type: MarkerType;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityGroup {
  exchange_index_start: number;
  exchange_index_end: number;
  started_at: string;
  ended_at: string;
  exchange_count: number;
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
  markers: GroupMarker[];
  boundary: BoundaryType;
  ai_summary: string | null;
  ai_label: string | null;
}

// --- Config Types ---

export interface AnalysisFeature {
  enabled: boolean;
  model: string;
}

export interface AnalysisConfig {
  enabled: boolean;
  provider: "anthropic" | "openai-compatible";
  apiKey: string;
  baseUrl?: string;
  features: {
    sessionTitles: AnalysisFeature;
    segmentSummaries: AnalysisFeature;
    decisionExtraction: AnalysisFeature;
    [key: string]: AnalysisFeature; // Tolerate legacy keys from existing config files
  };
}

export interface NotesConfig {
  model?: string; // legacy single model, kept for backward compat
  sessionModel: string;
  dailyModel: string;
  autoSessionNotes: boolean;
  autoDailyNotes: boolean;
}

export interface KeddyConfig {
  dbPath?: string;
  analysis: AnalysisConfig;
  notes: NotesConfig;
}

// --- Session Notes (Agent SDK analysis) ---

export interface SessionNote {
  id: string;
  session_id: string;
  content: string;
  mermaid: string | null;
  model: string | null;
  agent_turns: number | null;
  cost_usd: number | null;
  generated_at: string;
}

// --- Daily Notes ---

export interface DailyNote {
  id: string;
  date: string;
  content: string;
  sessions_json: string;
  model: string | null;
  agent_turns: number | null;
  cost_usd: number | null;
  generated_at: string;
}

// --- Hook Types ---

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  [key: string]: unknown;
}

export interface SessionStartInput extends HookInput {
  type: "SessionStart";
}

export interface StopInput extends HookInput {
  type: "Stop";
  stop_reason?: string;
}

export interface PostCompactInput extends HookInput {
  type: "PostCompact";
  compact_summary?: string;
}

export interface SessionEndInput extends HookInput {
  type: "SessionEnd";
}
