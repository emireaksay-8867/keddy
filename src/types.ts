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
  metadata: string | null; // JSON string
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
}

export type MilestoneType =
  | "commit"
  | "push"
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
  tool_calls: ParsedToolCall[];
  timestamp: string;
  is_interrupt: boolean;
  is_compact_summary: boolean;
  metadata?: Record<string, unknown>;
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
    planDiffAnalysis: AnalysisFeature;
    sessionNotes: AnalysisFeature;
  };
}

export interface KeddyConfig {
  dbPath?: string;
  analysis: AnalysisConfig;
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
