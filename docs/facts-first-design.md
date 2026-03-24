# Facts-First Data Foundation — Full Design

## Philosophy

Every piece of data Keddy stores falls into one of two categories:

1. **Facts** — directly observable from the JSONL. No interpretation. A tool was called, a model was used, N tokens were consumed, the user interrupted. These are always correct.

2. **Interpretations** — what the user was *trying to do*. Debugging, exploring, implementing. These require judgment and belong exclusively to the AI layer.

The current system mixes these. The proposed system separates them completely.

---

## All Definitive Signals from Claude Code

### Per-Exchange Signals (from JSONL)

| Signal | Source Field | What It Tells You | Currently Captured? |
|--------|-------------|-------------------|-------------------|
| **Model** | `message.model` | Which Claude model responded | NO |
| **Input tokens** | `message.usage.input_tokens` | Context size | NO |
| **Output tokens** | `message.usage.output_tokens` | Response size | NO |
| **Cache read tokens** | `message.usage.cache_read_input_tokens` | Prompt cache hits | NO |
| **Cache write tokens** | `message.usage.cache_creation_input_tokens` | New cache entries | NO |
| **Stop reason** | `message.stop_reason` | "end_turn", "tool_use", null (interrupted) | NO |
| **Permission mode** | `permissionMode` | "default", "acceptEdits", "bypassPermissions" | NO |
| **Is sidechain** | `isSidechain` | Inside a subagent? | NO |
| **Entrypoint** | `entrypoint` | "cli", "claude-vscode", "cursor" | NO (session only) |
| **CWD** | `cwd` | Working directory (can change mid-session) | NO (session only) |
| **Git branch** | `gitBranch` | Branch (can change mid-session) | NO (session only) |
| **Tool calls** | `content[].tool_use` | Exact tools used | YES (names + input) |
| **Tool errors** | `tool_result.is_error` | Which tools failed | YES |
| **Is interrupt** | Message text match | User pressed Escape | YES |
| **Is compact summary** | `isCompactSummary` flag | Post-compaction exchange | YES |
| **Timestamp** | `timestamp` | When it happened | YES |
| **Has images** | `content[].type === "image"` | Screenshots/images attached | Partial (count only) |
| **Has thinking** | `content[].type === "thinking"` | Extended thinking used | NO (filtered out) |

### Per-Tool-Call Signals

| Signal | Source | What It Tells You | Currently Captured? |
|--------|--------|-------------------|-------------------|
| **Skill invocation** | `Skill` tool, input.skill | User ran /commit, /review-pr, etc. | NO |
| **Subagent spawn** | `Agent` tool, input.subagent_type | "Explore", "Plan", "general-purpose" | NO (just counted) |
| **Subagent description** | `Agent` tool, input.description | What the subagent was tasked with | NO |
| **Plan mode enter** | `EnterPlanMode` tool | Entered plan mode | YES |
| **Plan mode exit** | `ExitPlanMode` tool + result | Left plan mode + approval/rejection | YES |
| **Task created** | `TaskCreate` tool | New task tracked | YES |
| **Task updated** | `TaskUpdate` tool | Task status changed | YES |
| **Web search** | `WebSearch` tool, input.query | Research query | NO (just tool name) |
| **Web fetch** | `WebFetch` tool, input.url | URL fetched for research | NO (just tool name) |
| **MCP tool** | `mcp__*` tool name | External tool/service used | Partial (counted) |
| **File read** | `Read` tool, input.file_path | Which file was read | Partial (in segments) |
| **File edit** | `Edit` tool, input.file_path | Which file was modified | Partial (in segments) |
| **File write** | `Write` tool, input.file_path | Which file was created/rewritten | Partial (in segments) |
| **File search** | `Glob`/`Grep` tool | What patterns were searched | NO (just tool name) |
| **Bash command** | `Bash` tool, input.command | Exact command run | Partial (for milestones) |
| **Bash description** | `Bash` tool, input.description | What the command does | NO |
| **Git operations** | Bash regex | commit, push, PR, branch | YES (milestones) |
| **Test runs** | Bash regex | test command + pass/fail | YES (milestones) |

### Per-Session Signals

| Signal | Source | Currently Captured? |
|--------|--------|-------------------|
| **Session ID** | `sessionId` | YES |
| **Slug** | `slug` | YES |
| **Claude version** | `version` | YES |
| **JSONL path** | Hook stdin | YES |
| **Project path** | Hook stdin / `cwd` | YES |
| **Forked from** | `forkedFrom` field | YES |
| **Custom title** | `custom-title` entry | YES |
| **Entrypoint** | First entry's `entrypoint` | Partial (not tracked if changes) |

### Session-Level Events (from system messages)

| Signal | Source | Currently Captured? |
|--------|--------|-------------------|
| **Compaction** | `compact_boundary` subtype | YES |
| **Pre-compaction tokens** | `compactMetadata.preTokens` | YES |
| **Exchanges before/after** | `compactMetadata` | YES |
| **Turn duration** | `turn_duration` subtype | NO |
| **Hook errors** | `hookErrors` array | NO |
| **Queue enqueue** | `queue-operation` type | NO |
| **Queue dequeue** | `queue-operation` type | NO |

---

## What to Capture (New)

### Priority 1: High-value, easy to extract

These are single fields we're already parsing past but not storing:

```
Per exchange:
  model              → new column on exchanges
  input_tokens       → new column on exchanges
  output_tokens      → new column on exchanges
  cache_read_tokens  → new column on exchanges
  cache_write_tokens → new column on exchanges
  stop_reason        → new column on exchanges
  has_thinking       → new column on exchanges (boolean)
  permission_mode    → new column on exchanges
```

### Priority 2: Tool-level enrichment

Extract specific high-value fields from tool inputs:

```
Per tool call:
  skill_name         → extracted when tool_name === "Skill" (input.skill)
  subagent_type      → extracted when tool_name === "Agent" (input.subagent_type)
  subagent_desc      → extracted when tool_name === "Agent" (input.description)
  web_query          → extracted when tool_name === "WebSearch" (input.query)
  web_url            → extracted when tool_name === "WebFetch" (input.url)
  file_path          → extracted from Read/Edit/Write/Glob/Grep (input.file_path or input.path)
  bash_command       → extracted when tool_name === "Bash" (input.command)
  bash_description   → extracted when tool_name === "Bash" (input.description)
```

These don't need new tables — they're structured fields on tool_calls, or a new lightweight `exchange_facts` view.

### Priority 3: Session-level events

```
  turn_durations     → extract from system messages with subtype "turn_duration"
  queue_operations   → count enqueues per exchange gap (user thinking time)
  branch_changes     → detect when gitBranch changes mid-session
  cwd_changes        → detect when cwd changes mid-session
  entrypoint         → per-exchange (detect IDE switches)
```

---

## Grouping: Boundaries Not Labels

### Definitive Boundaries (always split)

These are observable events that naturally divide a session:

| Boundary | Signal | Confidence |
|----------|--------|-----------|
| **Plan mode** | EnterPlanMode / ExitPlanMode | 100% — tool call |
| **Compaction** | compact_boundary system message | 100% — system event |
| **User interrupt** | is_interrupt flag | 100% — user action |
| **Milestone** | Git commit/push/PR/branch, test pass/fail | 95% — regex on bash |
| **Skill invocation** | Skill tool call | 100% — tool call |
| **Branch change** | gitBranch field differs | 100% — observable |
| **Model switch** | model field differs | 100% — observable |

### Soft Boundaries (configurable, suggest split)

| Boundary | Signal | Heuristic |
|----------|--------|-----------|
| **File focus shift** | files_written set changes completely | Medium — could be same task |
| **Long pause** | >10 min gap between exchanges | Medium — user might have been reading |
| **Tool pattern shift** | Went from all-reads to all-edits | Low — still heuristic |

### What Each Group Contains (facts only)

```typescript
interface ActivityGroup {
  // Identity
  exchange_start: number;
  exchange_end: number;
  started_at: string;
  ended_at: string;

  // What happened (counts)
  exchange_count: number;
  tool_counts: Record<string, number>;    // { Read: 5, Edit: 3, Bash: 2 }
  error_count: number;

  // What was touched
  files_read: string[];
  files_written: string[];

  // Cost / effort
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  duration_ms: number;

  // Definitive markers present in this group
  markers: GroupMarker[];
  // e.g. { type: "plan_mode", at: 3 }
  // e.g. { type: "skill", name: "commit", at: 7 }
  // e.g. { type: "milestone", kind: "test_pass", at: 8 }
  // e.g. { type: "web_research", queries: ["react server components"], at: 5 }
  // e.g. { type: "subagent", subagent_type: "Explore", at: 4 }

  // What split this group from the next
  boundary: BoundaryType;

  // AI layer (optional, always null without AI)
  ai_summary: string | null;
  ai_label: string | null;
}
```

---

## User Scenarios: Dashboard

### Scenario 1: "What did I do today?"

**Current**: List of sessions with guessed segment chips
```
[discuss] › [plan] › [build] › [debug] › [build]
```
You can't tell sessions apart. Every session looks like plan→build→debug.

**Proposed without AI**:
```
Session #142 · keddy · main · 45m · 12 exchanges
██░░░░░░░░░░░█████████████░░████████░░██████████
↑plan       ● commit  ✓ test
opus 4.6 · 180k tokens · 8 files

Session #141 · keddy · feat/settings · 1h 20m · 28 exchanges
░░░░██░░░░░░░░░░░██████████████████░░░░████░░░░░
    ↑plan  /commit            ✗ test   /review-pr
opus 4.6 · 340k tokens · 14 files · ⑂ PR created
```

Now you can immediately see: session 142 was a quick focused fix (one commit, tests passed). Session 141 was longer, tests failed, and ended with a PR. The activity strip shows the *shape* of work — heavy editing in the middle, reading at the start.

**Proposed with AI** — same strips, plus:
```
Fix parser token counting                           2h ago
...strip...
✦ Fixed token extraction from JSONL, added cache field support

Add dashboard settings page                          5h ago
...strip...
✦ Built settings UI with API key config, hit test failures on validation
```

### Scenario 2: "How much did this session cost me?"

**Current**: Not possible. Tokens aren't stored.

**Proposed** — Stats tab on session detail:
```
Token Usage
  Input:  142,000 tokens
  Output:  38,000 tokens
  Cache:   98,000 read (69% hit rate) · 44,000 created

  Estimated cost: ~$2.40 (opus 4.6 pricing)

  Token flow:
  ▁▂▃▅▇█▇▅▃▁  ← spikes at heavy exchanges
  3:15      4:00
```

This is **huge** for users who care about costs. They can see which sessions burn tokens and which are cache-efficient.

### Scenario 3: "Where did my time go?"

**Current**: You see segment labels but no timing or effort data.

**Proposed** — Each group shows duration + tokens:
```
○  2 exchanges · 3 min · 12k tokens              3:15 PM
   Tools: —

◈  1 exchange · 2 min · 8k tokens    ↑plan       3:18 PM
   Tools: EnterPlanMode, ExitPlanMode

◉  4 exchanges · 15 min · 62k tokens             3:20 PM
   Tools: Read ×3, Grep ×2, Edit ×4, Write ×1, Bash ×2
   Files: parser.ts (4 edits), types.ts (2 edits)
```

The 15-minute, 62k-token group is where the real work happened. You can see it immediately. No label needed.

### Scenario 4: "I used /commit but the timeline shows 'discussion'"

**Current**: Skill invocations aren't detected. A `/commit` with no Edit tools = "discussion".

**Proposed**: Skills are definitive markers:
```
◈  1 exchange · 1 min · 5k tokens    /commit     3:50 PM
   Tools: Skill(commit), Bash(git)
   Milestone: ● commit "fix: parser token counting"
```

The `/commit` skill is shown as a marker on the group. Same for `/review-pr`, `/plan`, `/simplify`, etc. These are **user-initiated workflows** — the most definitive signal of intent possible.

### Scenario 5: "Show me all the research Claude did"

**Current**: WebSearch/WebFetch are just tool names, no detail.

**Proposed**: Web research queries are extracted:
```
◉  3 exchanges · 8 min · 45k tokens              2:30 PM
   Tools: WebSearch ×2, WebFetch ×3, Read ×1
   🔍 "react server components streaming"
   🔍 "next.js app router data fetching patterns"
   🌐 https://nextjs.org/docs/app/building-your-application/data-fetching
   🌐 https://react.dev/reference/rsc/server-components
   🌐 https://vercel.com/blog/understanding-react-server-components
```

You can see exactly what was researched. Not "querying" — the actual queries and URLs.

### Scenario 6: "Claude spawned a bunch of subagents, what were they doing?"

**Current**: Agent tool calls are just counted. Subagent type/description lost.

**Proposed**: Subagent spawns are markers with detail:
```
◉  2 exchanges · 12 min · 95k tokens             4:10 PM
   Tools: Agent ×3, Read ×2, Edit ×5
   🔀 Explore: "Find all authentication middleware"
   🔀 Explore: "Analyze database migration patterns"
   🔀 general-purpose: "Run test suite and fix failures"
   Files: auth.ts (3 edits), middleware.ts (2 edits)
```

### Scenario 7: "Which model was used?"

**Current**: Only claude_version at session level. No per-exchange model.

**Proposed**: Model shown per group, highlighted when it changes:
```
◉  4 exchanges · 15 min · 62k tokens   opus 4.6   3:20 PM
   ...

◉  2 exchanges · 3 min · 8k tokens     haiku 4.5  3:35 PM  ← model switch!
   ...

◉  3 exchanges · 10 min · 45k tokens   opus 4.6   3:38 PM
   ...
```

Users using `/fast` mode or mixed models can see exactly where model switches happen and correlate with output quality.

### Scenario 8: "How cache-efficient was this session?"

**Current**: Not possible.

**Proposed** — Stats tab:
```
Cache Efficiency
  ████████████████░░░░  82% cache hit rate

  Read from cache:   312,000 tokens (saved ~$3.12)
  Created cache:      68,000 tokens
  Cold input:         42,000 tokens

  Cache efficiency over time:
  ░▓▓█████████████████  ← cold start, then high cache reuse
  exchange 1          exchange 12
```

### Scenario 9: "The session got compacted — did I lose context?"

**Current**: Shows compaction marker with token count.

**Proposed**: Compaction is a definitive boundary with before/after:
```
━━━ Compaction ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tokens: 180,000 → 45,000 (75% reduction)
  Exchanges: 12 → 4 (8 compressed)

  After compaction:
  ◉  3 exchanges · 8 min · 32k tokens             4:15 PM
     Tools: Read ×4, Edit ×2, Bash ×1 (1 error)
     ↑ error rate increased after compaction
```

The "error rate increased after compaction" is an AI insight. Without AI, you just see the factual error count — but the data is there for the user to notice it themselves.

### Scenario 10: "I want to see all the files I touched"

**Current**: Files shown per segment, but segment grouping is wrong so file associations are wrong.

**Proposed** — Files tab or section:
```
Files Touched (8 files)

  parser.ts       ████████████  7 edits, 5 reads
  types.ts        ████░░░░░░░░  2 edits, 1 read
  schema.ts       ████░░░░░░░░  2 edits, 1 read
  queries.ts      ██░░░░░░░░░░  1 edit, 1 read
  handler.ts      ░░░░░░░░░░░░  0 edits, 3 reads (read-only)
  server.ts       ░░░░░░░░░░░░  0 edits, 2 reads (read-only)
  package.json    ░░░░░░░░░░░░  0 edits, 1 read (read-only)
  tsconfig.json   ░░░░░░░░░░░░  0 edits, 1 read (read-only)
```

This is purely factual — extracted from tool inputs. No guessing needed.

### Scenario 11: "What skills did I use in this project?"

**Current**: Not tracked at all.

**Proposed** — project-level aggregation:
```
Skills Used (last 30 days)
  /commit      ████████████  23 times across 15 sessions
  /review-pr   ████░░░░░░░░   8 times across 6 sessions
  /plan        ███░░░░░░░░░   5 times across 5 sessions
  /simplify    █░░░░░░░░░░░   2 times across 2 sessions
```

---

## User Scenarios: MCP Layer

The MCP layer serves **Claude itself** — giving it context about past work. Facts-first makes this dramatically better.

### Scenario M1: "Continue where I left off"

**Current `keddy_project_status`**: Returns active plan text + pending tasks + last milestone.

**Proposed**: Same tool, richer response:
```json
{
  "last_session": {
    "id": "abc123",
    "ended_at": "2025-03-24T14:30:00Z",
    "duration_min": 45,
    "exchange_count": 12,
    "model": "claude-opus-4-6",
    "last_group": {
      "tools": { "Edit": 3, "Bash": 1 },
      "files_written": ["schema.ts", "queries.ts"],
      "last_milestone": { "type": "test_pass", "at": "14:28" },
      "stop_reason": "end_turn"
    }
  },
  "active_plan": { ... },
  "pending_tasks": [ ... ],
  "recent_milestones": [ ... ]
}
```

Claude can now say: "Last session ended after passing tests on schema.ts and queries.ts. The plan was approved and implemented. Picking up from there..."

### Scenario M2: "What was tried before that didn't work?"

**Current**: Search transcripts for keywords. Tool errors are stored but not queryable.

**Proposed new tool — `keddy_file_history`**:
```
Input: { file: "src/parser.ts", days: 7 }

Output:
  Session #142 (2h ago): 7 edits, 5 reads. Last milestone: ✓ tests passed.
  Session #138 (yesterday): 4 edits, 2 reads, 2 bash errors. No test run.
  Session #135 (3 days ago): 1 edit, 8 reads. Exploring only.

  Tool errors on this file:
    Session #138, exchange 8: Bash error — "TypeError: Cannot read property 'tokens' of undefined"
    Session #138, exchange 9: Bash error — "Test failed: expected 42, got undefined"
```

Claude now knows: "parser.ts had errors in session #138 that weren't resolved with tests. Session #142 fixed it. Let me check what changed between them."

### Scenario M3: "How should I approach this file?"

**Proposed new tool — `keddy_tool_patterns`**:
```
Input: { file: "src/db/schema.ts" }

Output:
  Typical workflow for this file:
    Read (5 sessions) → Edit (4 sessions) → Bash: npm test (3 sessions)

  Co-edited files: queries.ts (4/5 sessions), types.ts (3/5 sessions)

  Common tools: Edit (18 calls), Read (12 calls), Bash (8 calls)
  Test runs after edits: 3/4 sessions (75%)
  Test pass rate: 2/3 (67%)
```

Claude learns the patterns: "When I edit schema.ts, I usually need to update queries.ts and types.ts too, and I should run tests after."

### Scenario M4: "Am I on the right track?"

**Proposed enhancement to `keddy_project_status`**:
```json
{
  "session_so_far": {
    "exchange_count": 8,
    "total_tokens": 120000,
    "error_count": 3,
    "compaction_count": 0,
    "files_written": ["parser.ts"],
    "files_read": ["parser.ts", "types.ts", "handler.ts", "schema.ts"],
    "interrupts": 1,
    "skills_used": [],
    "plan_status": "approved",
    "tasks_completed": 2,
    "tasks_pending": 3
  }
}
```

Claude can self-assess: "I've hit 3 errors and the user interrupted once. I should re-read the plan and check if I'm still aligned."

### Scenario M5: "What research was done?"

**Proposed new tool — `keddy_search_research`**:
```
Input: { query: "server components", days: 30 }

Output:
  Session #130 (5 days ago):
    🔍 "react server components streaming"
    🔍 "next.js app router data fetching patterns"
    🌐 https://nextjs.org/docs/app/building-your-application/data-fetching
    🌐 https://react.dev/reference/rsc/server-components
    Context: Working on API route migration

  Session #125 (12 days ago):
    🔍 "react server components vs client components performance"
    🌐 https://vercel.com/blog/understanding-react-server-components
    Context: Initial architecture planning
```

Claude doesn't re-research things it already found. It can reference past URLs and findings.

### Scenario M6: "What decisions led to this architecture?"

**Proposed new tool — `keddy_decision_trail`**:
```
Input: { file: "src/db/schema.ts", include_plans: true }

Output:
  Plan v1 (Session #120): "Use SQLite with WAL mode, single file at ~/.keddy/keddy.db"
    Status: approved → implemented

  Plan v3 (Session #128): "Add FTS5 for full-text search on exchanges"
    Status: approved → implemented
    User feedback: "don't add trigram, FTS5 is enough"

  Plan v5 (Session #135): "Add exchange_facts columns for token tracking"
    Status: drafted (current)

  Related decisions (AI-extracted):
    "Chose better-sqlite3 over sql.js for performance"
    "WAL mode for concurrent read/write from hooks"
```

### Scenario M7: SessionStart hook context injection

**Current**: Returns text blob with plan excerpt + task list.

**Proposed**: Returns structured facts:
```
You're continuing work on keddy (main branch).

Last session (#142, 2h ago):
  - 12 exchanges, 45 min, opus 4.6
  - Ended after: ✓ tests passed, ● committed "fix: parser token counting"
  - Files modified: parser.ts, types.ts, schema.ts, queries.ts
  - Stop reason: end_turn (completed normally)

Active plan (v3, approved):
  "Add exchange_facts columns for token/model/duration tracking..."

Pending tasks:
  ○ Add model column to exchanges table
  ○ Extract token counts from JSONL usage field
  ◐ Update parser to capture stop_reason (in progress)

Recent errors (last 3 sessions):
  None — clean run streak

This file was last modified: schema.ts (2h ago), queries.ts (2h ago)
```

Claude starts with complete context. No guessing, no stale assumptions.

---

## What Gets Removed

| Current Feature | What Happens | Why |
|----------------|-------------|-----|
| `classifyExchange()` | **Deleted** | Heuristic guessing — the core problem |
| `SegmentType` enum (10 types) | **Deleted** | "discussion", "implementing" etc. are interpretations |
| Segment merging logic | **Replaced** | Boundary-based splitting instead |
| Singleton segment absorption | **Deleted** | Artifacts of bad classification |
| `segment_type` column | **Kept but nullable** | Only populated by AI layer |
| Tool proportion thresholds | **Deleted** | "≥40% reads = exploring" is a guess |

## What Gets Added

| New Feature | Type | Purpose |
|------------|------|---------|
| `model` on exchanges | Column | Per-exchange model tracking |
| `input_tokens`, `output_tokens` | Columns | Token usage |
| `cache_read_tokens`, `cache_write_tokens` | Columns | Cache efficiency |
| `stop_reason` | Column | How the turn ended |
| `has_thinking` | Column | Extended thinking used |
| `permission_mode` | Column | User's permission stance |
| `skill_name` on tool_calls | Column | Extracted skill name |
| `subagent_type` on tool_calls | Column | Extracted subagent type |
| `file_path` on tool_calls | Column | Extracted file path |
| `bash_command` on tool_calls | Column | Extracted bash command |
| Activity groups (boundary-based) | Logic | Replace heuristic segments |
| `boundary_type` on segments | Column | What caused the split |
| `ai_label` on segments | Column | AI-only classification |
| Token aggregation queries | Queries | Cost analysis |
| File operation queries | Queries | File-centric views |
| Skill/subagent queries | Queries | Workflow tracking |

## What Stays the Same

| Feature | Why It Stays |
|---------|-------------|
| **Plans** | Based on definitive EnterPlanMode/ExitPlanMode signals |
| **Plan status** | Based on exact string matches + implementation tracking |
| **Milestones** | Based on git/test command regex (high confidence) |
| **Tasks** | Based on TaskCreate/TaskUpdate tool calls |
| **Compaction events** | Based on compact_boundary system messages |
| **FTS search** | Searches actual content |
| **Session links** | Based on forkedFrom field |
| **Exchange content** | Direct from JSONL |

---

## Migration Path

This is an additive change. Nothing breaks:

1. **Add new columns** to exchanges and tool_calls (nullable, backfill later)
2. **Update parser** to extract new fields from JSONL
3. **Add boundary-based grouping** alongside existing segments
4. **Update dashboard** to use new data (activity strips, tool breakdowns, stats)
5. **Update MCP tools** to return richer data
6. **Deprecate** classifyExchange but keep segment_type column for AI
7. **Backfill** existing sessions by re-parsing their JSONL files (import command already exists)

No data loss. No schema breaks. Existing sessions get richer when re-parsed.
