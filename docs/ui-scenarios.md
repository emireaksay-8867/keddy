# UI Scenarios: Facts-First Data Foundation

## The Core Shift

**Current**: Timeline organized by guessed labels → "Discussion → Implementing → Debugging"
**Proposed**: Timeline organized by what actually happened → tools, files, tokens, timing — with AI labels as an optional overlay

---

## 1. Sessions List

### Current
```
┌─────────────────────────────────────────────────────────────────┐
│ keddy-project · 34 sessions                        Last: 2h ago│
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Filter sessions...                                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Today                                                           │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Fix parser token counting                          2h ago   │ │
│ │ keddy · main · 45m · 12 exchanges                          │ │
│ │ [plan] › [build] › [test] › [debug] › [build]             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Add dashboard settings page                        5h ago   │ │
│ │ keddy · feat/settings · 1h 20m · 28 exchanges              │ │
│ │ [discuss] › [plan] › [build] › [build] › [test] +2         │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ These segment labels are GUESSES. "discuss" just means         │
│ no tools were used. "build" just means an Edit tool was used.  │
│ A skill invocation with no tool calls = "discuss". Wrong.      │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed — Without AI
```
┌─────────────────────────────────────────────────────────────────┐
│ keddy-project · 34 sessions                        Last: 2h ago│
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Filter sessions...                                          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Today                                                           │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Session #142                                       2h ago   │ │
│ │ keddy · main · 45m · 12 exchanges                          │ │
│ │                                                             │ │
│ │  ██░░░░░░░░░░░░░█████████████████░░████████░░██████████    │ │
│ │  ↑plan     read  edit edit edit edit  bash    edit edit     │ │
│ │                                       ✓test                │ │
│ │                                                             │ │
│ │  opus 4.6 · 180k tokens · 8 files · ● commit  ✓ tests     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ The bar is a FACTUAL activity strip. Each segment is sized     │
│ proportional to exchange count. Colors represent tool types,   │
│ not guessed intent. Milestones sit on the bar where they       │
│ happened. No interpretation — just what occurred.              │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Session #141                                       5h ago   │ │
│ │ keddy · feat/settings · 1h 20m · 28 exchanges              │ │
│ │                                                             │ │
│ │  ░░░░██░░░░░░░░░░░░░░░░░██████████████████████░░░░████░░   │ │
│ │  chat plan  read read read  edit edit edit edit  bash bash  │ │
│ │                                                   ✗test    │ │
│ │                                                             │ │
│ │  opus 4.6 · 340k tokens · 14 files · ⑂ branch  ✗ tests    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Title is generic (session number) without AI. But you see      │
│ everything that matters: what tools ran, how many tokens,      │ │
│ what milestones happened, how many files were touched.         │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed — With AI
```
┌─────────────────────────────────────────────────────────────────┐
│ Today                                                           │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Fix parser token counting                          2h ago   │ │
│ │ keddy · main · 45m · 12 exchanges                          │ │
│ │                                                             │ │
│ │  ██░░░░░░░░░░░░░█████████████████░░████████░░██████████    │ │
│ │  ↑plan     read  edit edit edit edit  bash    edit edit     │ │
│ │                                       ✓test                │ │
│ │                                                             │ │
│ │  opus 4.6 · 180k tokens · 8 files · ● commit  ✓ tests     │ │
│ │                                                             │ │
│ │  AI: planned → implemented fix → tested → fixed edge case  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Same factual strip. AI adds the title and a one-line narrative │
│ below. The narrative is clearly marked as AI-generated.        │
│ Remove it and the session card still makes complete sense.     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Session Detail — Timeline View

### Current
```
┌─────────────────────────────────────────────────────────────────┐
│ ← Fix parser token counting                                    │
│ keddy · main · Started 3:15 PM · 45 min · 12 exchanges        │
│ Milestones: 2 · Plans: 1                                       │
│                                                                 │
│ [Timeline]  [Full Transcript]                     [↑ Newest]   │
│                                                                 │
│ ── Plans ──────────────────────────────────────────────────     │
│ │ v1 [approved] Fix token counting in parser by...             │
│                                                                 │
│ ── Timeline ───────────────────────────────────────────────     │
│                                                                 │
│  ● [Discussion]  2 exchanges · 3 min          3:15 PM          │
│  │  You: I'm seeing wrong token counts in the dashboard...     │
│  │  Claude: Let me look at the parser to understand...         │
│  │  Files: — · Tools: 0                                        │
│  │                                                              │
│  ● [Planning]  1 exchange · 2 min             3:18 PM          │
│  │  You: Let's plan this out                                   │
│  │  Claude: I'll fix the token extraction in parser.ts...      │
│  │  Files: — · Tools: 2                                        │
│  │                                                              │
│  ● [Implementing]  4 exchanges · 15 min       3:20 PM          │
│  │  AI: Modified parser to extract usage fields from...        │
│  │  You: Also handle the cache tokens                          │
│  │  Claude: I'll add cache_read and cache_creation...          │
│  │  +2 more exchanges                                          │
│  │  Files: parser.ts, types.ts · Tools: 12                     │
│  │                                                              │
│  ◆ ● commit: "fix: token counting in parser"                   │
│  ◆ ✓ tests passed (14 passed)                                  │
│  │                                                              │
│  ● [Debugging]  3 exchanges · 12 min          3:35 PM          │
│  │  You: The cache tokens are still wrong                      │
│  │  Claude: I see the issue — the field name is...             │
│  │  +1 more exchanges                                          │
│  │  Files: parser.ts · Tools: 8                                │
│  │                                                              │
│  ● [Implementing]  2 exchanges · 8 min        3:47 PM          │
│  │  You: ok now also update the schema                         │
│  │  Claude: I'll add the columns to the exchanges table...     │
│  │  Files: schema.ts, queries.ts · Tools: 6                    │
│                                                                 │
│ Problem: "Discussion" vs "Implementing" vs "Debugging" are     │
│ guesses. The "Debugging" segment is just "edits + errors".     │
│ Could have been iterating on a new feature.                    │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed — Without AI

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Session #142                                                  │
│ keddy · main · Started 3:15 PM · 45 min · 12 exchanges        │
│ opus 4.6 · 180k tokens · 8 files                               │
│                                                                 │
│ [Timeline]  [Full Transcript]  [Stats]            [↑ Newest]   │
│                                                                 │
│ ── Session Bar ────────────────────────────────────────────     │
│                                                                 │
│  ██░░░░░░░░░░░░░░░█████████████████░░████████░░██████████      │
│  3:15    3:18      3:20              3:35       3:47   4:00     │
│  ↑plan          ● commit  ✓ test                                │
│                                                                 │
│ ── Plans ──────────────────────────────────────────────────     │
│ │ v1 [approved] Fix token counting in parser by...             │
│                                                                 │
│ ── Activity ───────────────────────────────────────────────     │
│                                                                 │
│  ○  2 exchanges · 3 min · 12k tokens             3:15 PM       │
│  │  You: I'm seeing wrong token counts in the dashboard...     │
│  │  Claude: Let me look at the parser to understand...         │
│  │  Tools: —                                                    │
│  │  Files: —                                                    │
│  │                                                              │
│  ◈  1 exchange · 2 min · 8k tokens    ↑plan      3:18 PM       │
│  │  You: Let's plan this out                                   │
│  │  Claude: I'll fix the token extraction in parser.ts...      │
│  │  Tools: EnterPlanMode, ExitPlanMode                         │
│  │  Mode: plan                                                  │
│  │                                                              │
│  ◉  4 exchanges · 15 min · 62k tokens            3:20 PM       │
│  │  You: Also handle the cache tokens                          │
│  │  Claude: I'll add cache_read and cache_creation...          │
│  │  +2 more exchanges                                          │
│  │  Tools: Read ×3, Grep ×2, Edit ×4, Write ×1, Bash ×2       │
│  │  Files: parser.ts (4 edits), types.ts (2 edits)             │
│  │                                                              │
│  ── ● commit: "fix: token counting in parser" ─────────────    │
│  ── ✓ tests: 14 passed ────────────────────────────────────    │
│  │                                                              │
│  ◉  3 exchanges · 12 min · 45k tokens            3:35 PM       │
│  │  You: The cache tokens are still wrong                      │
│  │  Claude: I see the issue — the field name is...             │
│  │  +1 more exchanges                                          │
│  │  Tools: Read ×2, Grep ×1, Edit ×3, Bash ×2 (1 error)       │
│  │  Files: parser.ts (3 edits)                                 │
│  │                                                              │
│  ◉  2 exchanges · 8 min · 38k tokens             3:47 PM       │
│  │  You: ok now also update the schema                         │
│  │  Claude: I'll add the columns to the exchanges table...     │
│  │  Tools: Read ×2, Edit ×3, Bash ×1                           │
│  │  Files: schema.ts (2 edits), queries.ts (1 edit)            │
│                                                                 │
│ KEY DIFFERENCES:                                                │
│ • No guessed labels like "Discussion" or "Debugging"           │
│ • You see actual tool breakdown per group                      │
│ • Token counts show effort per group                           │
│ • File edits show exactly what was touched and how many times  │
│ • Bash errors shown as fact ("1 error"), not as "debugging"    │
│ • Groups are split by natural boundaries:                      │
│   - plan mode entry/exit                                       │
│   - milestones (commits, test runs)                            │
│   - file-focus shifts (working on different files)             │
│   - interrupts                                                  │
│   - compaction events                                           │
│ • The dot style hints at density:                              │
│   ○ = no tools (conversation only)                             │
│   ◈ = special mode (plan, etc.)                                │
│   ◉ = tools used (sized by count? or just filled)              │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed — With AI

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Fix parser token counting                    ✦ AI Analyzed   │
│ keddy · main · Started 3:15 PM · 45 min · 12 exchanges        │
│ opus 4.6 · 180k tokens · 8 files                               │
│                                                                 │
│ [Timeline]  [Full Transcript]  [Stats]            [↑ Newest]   │
│                                                                 │
│ ── Session Bar ────────────────────────────────────────────     │
│                                                                 │
│  ██░░░░░░░░░░░░░░░█████████████████░░████████░░██████████      │
│  3:15    3:18      3:20              3:35       3:47   4:00     │
│  ↑plan          ● commit  ✓ test                                │
│                                                                 │
│ ── Plans ──────────────────────────────────────────────────     │
│ │ v1 [approved] Fix token counting in parser by...             │
│                                                                 │
│ ── Activity ───────────────────────────────────────────────     │
│                                                                 │
│  ○  2 exchanges · 3 min · 12k tokens             3:15 PM       │
│  │  ┌ ✦ Problem scoping — identified token count mismatch ┐   │
│  │  └─────────────────────────────────────────────────────-┘   │
│  │  You: I'm seeing wrong token counts in the dashboard...     │
│  │  Claude: Let me look at the parser to understand...         │
│  │  Tools: —                                                    │
│  │  Files: —                                                    │
│  │                                                              │
│  ◈  1 exchange · 2 min · 8k tokens    ↑plan      3:18 PM       │
│  │  ┌ ✦ Planned approach: extract usage from JSONL fields ┐   │
│  │  └────────────────────────────────────────────────────--┘   │
│  │  You: Let's plan this out                                   │
│  │  Claude: I'll fix the token extraction in parser.ts...      │
│  │  Tools: EnterPlanMode, ExitPlanMode                         │
│  │  Mode: plan                                                  │
│  │                                                              │
│  ◉  4 exchanges · 15 min · 62k tokens            3:20 PM       │
│  │  ┌ ✦ Implemented token extraction + cache fields ──────┐   │
│  │  └────────────────────────────────────────────────────--┘   │
│  │  You: Also handle the cache tokens                          │
│  │  Claude: I'll add cache_read and cache_creation...          │
│  │  +2 more exchanges                                          │
│  │  Tools: Read ×3, Grep ×2, Edit ×4, Write ×1, Bash ×2       │
│  │  Files: parser.ts (4 edits), types.ts (2 edits)             │
│  │                                                              │
│  ── ● commit: "fix: token counting in parser" ─────────────    │
│  ── ✓ tests: 14 passed ────────────────────────────────────    │
│  │                                                              │
│  ◉  3 exchanges · 12 min · 45k tokens            3:35 PM       │
│  │  ┌ ✦ Fixed cache field name mismatch ─────────────────┐    │
│  │  └────────────────────────────────────────────────────-┘    │
│  │  You: The cache tokens are still wrong                      │
│  │  Claude: I see the issue — the field name is...             │
│  │  +1 more exchanges                                          │
│  │  Tools: Read ×2, Grep ×1, Edit ×3, Bash ×2 (1 error)       │
│  │  Files: parser.ts (3 edits)                                 │
│  │                                                              │
│  ◉  2 exchanges · 8 min · 38k tokens             3:47 PM       │
│  │  ┌ ✦ Extended schema to store token data ─────────────┐    │
│  │  └────────────────────────────────────────────────────-┘    │
│  │  You: ok now also update the schema                         │
│  │  Claude: I'll add the columns to the exchanges table...     │
│  │  Tools: Read ×2, Edit ×3, Bash ×1                           │
│  │  Files: schema.ts (2 edits), queries.ts (1 edit)            │
│                                                                 │
│ KEY DIFFERENCES FROM WITHOUT-AI:                               │
│ • Session title is AI-generated (not "Session #142")           │
│ • Each group has an AI summary card (✦ marked)                 │
│ • The AI summary IS the label — not a fixed category like      │
│   "Debugging" but a specific description of what happened      │
│ • All factual data remains identical underneath                │
│ • Remove AI and nothing breaks — you just lose the narrative   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Stats Tab (NEW — only possible with facts-first)

### Without AI
```
┌─────────────────────────────────────────────────────────────────┐
│ [Timeline]  [Full Transcript]  [Stats]                          │
│                                                                 │
│ ── Token Usage ────────────────────────────────────────────     │
│                                                                 │
│  Input:  142,000 tokens                                        │
│  Output:  38,000 tokens                                        │
│  Cache read:  98,000 tokens (69% cache hit rate)               │
│  Cache created: 44,000 tokens                                  │
│  Total: 180,000 tokens                                         │
│                                                                 │
│  Token flow over time:                                          │
│  ▁▂▃▅▇█▇▅▃▁  ←— spikes at heavy edit exchanges                │
│  3:15      3:35      4:00                                      │
│                                                                 │
│ ── Tool Usage ─────────────────────────────────────────────     │
│                                                                 │
│  Edit     ████████████░░░  10                                  │
│  Read     ███████░░░░░░░░   7                                  │
│  Bash     █████░░░░░░░░░░   5                                  │
│  Grep     ███░░░░░░░░░░░░   3                                  │
│  Write    █░░░░░░░░░░░░░░   1                                  │
│                                                                 │
│  Tool errors: 1 (Bash)                                         │
│                                                                 │
│ ── Files ──────────────────────────────────────────────────     │
│                                                                 │
│  parser.ts      7 edits, 5 reads                               │
│  types.ts       2 edits, 1 read                                │
│  schema.ts      2 edits, 1 read                                │
│  queries.ts     1 edit,  1 read                                │
│                                                                 │
│ ── Model ──────────────────────────────────────────────────     │
│                                                                 │
│  claude-opus-4-6  ████████████████  12/12 exchanges            │
│                                                                 │
│ ── Timing ─────────────────────────────────────────────────     │
│                                                                 │
│  Total duration:    45 min                                     │
│  Avg turn time:     ~3.8 min                                   │
│  Longest turn:      6.2 min (exchange #7)                      │
│                                                                 │
│ All of this is FACTUAL. No interpretation needed.              │
│ Not possible with current system because tokens, model,        │
│ and timing data are thrown away.                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. How Groups Are Split (Without AI)

Current system: split by guessed "type" changes.
Proposed: split by **observable boundaries**.

```
DEFINITIVE BOUNDARIES (always split):
──────────────────────────────────────
  ↑plan    Plan mode entered           ← EnterPlanMode tool
  ↓plan    Plan mode exited            ← ExitPlanMode tool
  ⚡       User interrupt              ← is_interrupt flag
  ━━━━━    Compaction                  ← compact_boundary entry
  ● ✓ ✗   Milestone (commit/test/etc) ← regex on Bash commands

SOFT BOUNDARIES (suggest split, can be tuned):
──────────────────────────────────────
  📁       File focus shift            ← files_written changes completely
  🔄       Model change               ← model field differs
  ⏸        Long gap                    ← >10 min between exchanges
  🔀       Tool pattern shift          ← went from all-reads to all-edits

Example of how a session gets split:

  Exchange 1: chat (no tools)          ─┐
  Exchange 2: chat (no tools)          ─┘ Group A: 2 exchanges
                                          (no tools, conversation)
  ─── ↑plan ─── boundary ───
  Exchange 3: EnterPlanMode            ─┐
  Exchange 4: ExitPlanMode             ─┘ Group B: 2 exchanges
                                          (plan mode active)
  ─── ↓plan ─── boundary ───
  Exchange 5: Read, Grep               ─┐
  Exchange 6: Read, Read, Edit         ─┤
  Exchange 7: Edit, Edit, Bash         ─┤ Group C: 4 exchanges
  Exchange 8: Edit, Bash               ─┘ (mixed tools, same files)

  ─── ● commit ─── boundary ───
  ─── ✓ tests ─── boundary ───
  Exchange 9: Read, Grep               ─┐
  Exchange 10: Edit, Edit, Bash(err)   ─┤ Group D: 3 exchanges
  Exchange 11: Edit, Bash              ─┘ (same file focus)

  ─── file focus shift ─── boundary ───
  Exchange 12: Read, Edit, Edit, Bash  ─┐ Group E: 1 exchange
                                       ─┘ (new files: schema, queries)

  No labels. Just groups with their factual tool/file breakdown.
  AI can label them if enabled. Without AI, the data speaks.
```

---

## 5. Session List — Activity Strip Detail

The activity strip replaces the segment flow chips. Here's how it encodes information:

```
CURRENT SEGMENT FLOW:
  [discuss] › [plan] › [build] › [debug] › [build]
  ↑ guessed labels, no size indication, no detail

PROPOSED ACTIVITY STRIP:

  ░░██░░░░░░░░░░░████████████░░░████░░██████
  │  │            │             │      │
  │  │            │             │      └─ edits (files: schema, queries)
  │  │            │             └─ reads + edits + bash errors (file: parser)
  │  │            └─ reads + edits + bash (files: parser, types)
  │  └─ plan mode
  └─ no tools (conversation)

  Color legend (tool-type based, not intent-based):
  ░ = no tools / conversation
  █ = plan mode (always distinct)
  ░ = reads only (Grep, Read, Glob)
  █ = edits (Edit, Write)
  ▓ = bash / commands
  ▒ = mixed

  Markers on the strip:
  ↑ = plan entered
  ● = commit
  ✓ = test pass
  ✗ = test fail
  ↑ = push
  ⑂ = PR created

  Width of each section = proportional to exchange count
```

---

## 6. Full Transcript View

### Current
```
  ── Implementing (exchanges 5-8) ─────────── purple line

  You:  Also handle the cache tokens
  Claude: I'll add cache_read and cache_creation...
         Edit ×4 · Read ×3 · +2 tools
```

### Proposed — Without AI
```
  ── Group C (exchanges 5-8) · 15 min · 62k tokens ── ░░███

  You:  Also handle the cache tokens
  Claude: I'll add cache_read and cache_creation...
         Read ×3 · Grep ×2 · Edit ×4 · Write ×1 · Bash ×2
         Files: parser.ts, types.ts
```

### Proposed — With AI
```
  ── Group C (exchanges 5-8) · 15 min · 62k tokens ── ░░███
     ✦ Implemented token extraction + cache fields

  You:  Also handle the cache tokens
  Claude: I'll add cache_read and cache_creation...
         Read ×3 · Grep ×2 · Edit ×4 · Write ×1 · Bash ×2
         Files: parser.ts, types.ts
```

---

## 7. What Stays the Same

These parts of the UI don't change because they're already based on solid signals:

| Feature | Why it stays |
|---------|-------------|
| **Plans section** | Based on definitive EnterPlanMode/ExitPlanMode tools |
| **Plan status badges** | Based on exact string matches in tool results |
| **Milestones** | Based on git command regex (high confidence) |
| **Tasks section** | Based on TaskCreate/TaskUpdate tool calls |
| **Compaction events** | Based on compact_boundary JSONL entries |
| **Full transcript** | Direct exchange content, no interpretation |
| **Search (FTS)** | Searches actual content, no classification needed |
| **Sidebar/navigation** | Project/session structure, no classification |

---

## 8. Summary: What Changes

| Component | Current | Without AI | With AI |
|-----------|---------|-----------|---------|
| **Session title** | AI or generic | Session #{id} | AI-generated title |
| **Segment flow** | Guessed label chips | Activity strip (tool-colored, proportional) | Same strip + AI narrative line |
| **Session meta** | Duration, exchanges | + tokens, model, files count | Same |
| **Timeline groups** | Labeled segments (Discussion, Implementing...) | Unlabeled groups split by boundaries | Groups + AI summary card each |
| **Group detail** | Label + file count + tool count | Tool breakdown + file edits + tokens + timing | Same + AI label |
| **Stats tab** | Doesn't exist | Token usage, tool usage, file heatmap, timing | Same |
| **Segment types** | 10 heuristic categories | None (boundaries only) | AI-generated (free-form, specific) |

**The fundamental change**: Instead of seeing "Debugging (3 exchanges)" you see
"3 exchanges · 12 min · 45k tokens · Read ×2, Edit ×3, Bash ×2 (1 error) · parser.ts"
— and if AI is on, it adds "✦ Fixed cache field name mismatch" on top.

The facts are always there. The story is optional.
