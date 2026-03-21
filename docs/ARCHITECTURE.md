# Keddy Architecture

## Overview

Keddy is a local-first session intelligence tool for Claude Code. It captures, analyzes, and surfaces coding session data through three interfaces: hooks (capture), MCP (AI access), and dashboard (human access).

## Data Flow

```
Claude Code Session
       │
       ├─ SessionStart hook (sync) ──► SQLite: upsert session
       │
       ├─ Stop hook (async) ─────────► Parser ──► SQLite: insert exchange + tool calls
       │
       ├─ PostCompact hook (async) ──► SQLite: insert compaction event
       │
       └─ SessionEnd hook (async) ──► Parser (full) ──► Analyzer ──► SQLite
                                                           │
                                                    ┌──────┼──────┐
                                                    ▼      ▼      ▼
                                                 Plans  Segments  Milestones
```

## Components

### 1. JSONL Parser (`src/capture/parser.ts`)

Parses Claude Code's JSONL transcript format. Handles:
- Multi-turn tool exchanges (user→assistant+tool→result→assistant)
- Plan mode (EnterPlanMode/ExitPlanMode)
- Compaction boundaries and summaries
- User interrupts
- Forked sessions
- Noise filtering (progress, queue-operation, file-history-snapshot)

### 2. Programmatic Analyzer

No AI required. All analysis is deterministic.

- **Plans** (`plans.ts`): Extracts plan versions from ExitPlanMode inputs, tracks approval/rejection/supersession
- **Segments** (`segments.ts`): Classifies exchanges via sliding window into 8 types based on tool distribution
- **Milestones** (`milestones.ts`): Regex extraction of git operations and test commands from Bash tool inputs

### 3. Database (`src/db/`)

Single SQLite file at `~/.keddy/keddy.db`. WAL mode for concurrent reads.

**Tables:** sessions, exchanges, tool_calls, plans, segments, milestones, decisions, compaction_events, session_links, config
**Search:** FTS5 virtual table on exchange user_prompts

### 4. MCP Server (`src/mcp/server.ts`)

Long-lived process with single DB connection. 4 tools exposed via StdioServerTransport.

### 5. Dashboard

- **API:** Hono on port 3737
- **Frontend:** React 19 + Tailwind v4 SPA

## Design Decisions

1. **Programmatic-first:** Core features never require AI. AI is an optional enhancement layer.
2. **Single database:** All projects in one SQLite file. Enables cross-project search.
3. **Idempotent writes:** Exchange and tool_call insertion is idempotent (UNIQUE constraints + duplicate detection).
4. **FTS5 sanitization:** Search queries are sanitized to prevent FTS5 syntax errors from user input.
