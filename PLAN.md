# Keddy — Full Implementation Plan

## Context

Keddy is a session intelligence tool for Claude Code. It captures every coding session, organizes transcripts into navigable timelines with plan version tracking, and provides MCP tools for Claude to search past sessions. It is NOT a memory injection layer — it's a session organizer with search.

**Problem:** Claude Code sessions generate rich decision-making context (plans, revisions, architectural discussions, direction changes) that vanishes after the session ends. JSONL transcripts are unreadable. Compaction loses context.

**Solution:** Auto-capture sessions via hooks, extract structure programmatically (plans, segments, milestones), store in SQLite, surface via dashboard + MCP tools.

**Repository:** `emireaksay-8867/keddy` at `~/Documents/GitHub/keddy`
**Git identity:** Emir Enes Aksay / emire.aksay@gmail.com (per-repo config)
**GitHub auth:** emireaksay-8867 (active via `gh auth`)

---

## Phase 1: Repository Scaffold

Create `~/Documents/GitHub/keddy`, init git with per-repo config, create GitHub repo.

**Files:**
- `package.json` — name: "keddy", version: "0.1.0", license: Apache-2.0, bin: keddy → dist/cli/index.js
  - deps: better-sqlite3, @modelcontextprotocol/sdk, hono, @hono/node-server, zod, open
  - devDeps: typescript, tsup, vite, vitest, @types/better-sqlite3, @types/node, tailwindcss, @tailwindcss/vite, react, react-dom, react-router, @types/react, @types/react-dom
  - optionalDeps: @anthropic-ai/sdk
- `tsconfig.json` — target ES2022, module NodeNext, strict, outDir dist
- `tsup.config.ts` — entries: cli/index, capture/handler, mcp/server; format cjs; external better-sqlite3
- `.gitignore`, `.nvmrc` (22), `.editorconfig`

**Commit:** "chore: initialize keddy repository"

## Phase 2: Shared Types

- `src/types.ts` — All TypeScript interfaces: Session, Exchange, ToolCall, Plan, PlanStatus, Segment, SegmentType, Milestone, MilestoneType, Decision, CompactionEvent, SessionLink, ParsedExchange, KeddyConfig, AnalysisConfig, AnalysisFeature

**Commit:** "feat: add shared type definitions"

## Phase 3: Database Layer

- `src/db/index.ts` — initDb(dbPath?), getDb(), closeDb(). Path: KEDDY_DB env || ~/.keddy/keddy.db. WAL mode, foreign_keys ON, busy_timeout 5000
- `src/db/schema.ts` — 9 tables: sessions, exchanges, tool_calls, plans, segments, milestones, decisions, compaction_events, session_links. FTS5 virtual table on exchanges(user_prompt). Indexes on all foreign keys
- `src/db/queries.ts` — Insert/update/query prepared statements for all tables. Key queries: insertSession, upsertSession, insertExchange, insertToolCall, insertPlan, insertSegment, insertMilestone, insertDecision, insertCompactionEvent, getSession, getSessionExchanges, getSessionPlans, getSessionSegments, getSessionMilestones, searchSessions (FTS5), getRecentSessions, getStats, getConfig, setConfig

**Commit:** "feat: add database layer with schema and queries"

## Phase 4: JSONL Parser

- `src/capture/parser.ts` — Core parser. Two modes:
  1. `parseTranscript(filePath)` — Full parse, returns all exchanges with tool calls, metadata
  2. `parseLatestExchanges(filePath, since?)` — Efficient tail parse for Stop hook

  **Detection rules (all deterministic):**
  - User messages: `type === "user"` AND NOT `isCompactSummary`
  - Assistant messages: `type === "assistant"`
  - Tool uses: content blocks with `type === "tool_use"` (extract name, input, id)
  - Tool results: content blocks with `type === "tool_result"` (match by tool_use_id)
  - Plan mode enter: `tool_use.name === "EnterPlanMode"`
  - Plan mode exit: `tool_use.name === "ExitPlanMode"` (input.plan has full text)
  - Plan approved: tool_result contains `"User has approved your plan"`
  - Plan rejected: tool_result contains `"doesn't want to proceed"`
  - User feedback: parse text after `"the user said:\n"` in rejection tool_result
  - User interrupt: text content `=== "[Request interrupted by user]"` or `"[Request interrupted by user for tool use]"`
  - Compaction boundary: `type === "system" && subtype === "compact_boundary"` with `compactMetadata`
  - Compact summary: `isCompactSummary === true` on subsequent user entry
  - Session continuation: `forkedFrom` field on first entries
  - SKIP: `type === "progress"`, `type === "queue-operation"`, `type === "file-history-snapshot"`
  - Metadata: sessionId, cwd, gitBranch, version, slug, timestamp from entries

**Commit:** "feat: add JSONL transcript parser"

## Phase 5: Programmatic Analyzer

- `src/capture/plans.ts` — Walk exchanges for EnterPlanMode/ExitPlanMode pairs. Extract plan text, detect approval/rejection, extract user feedback, assign version numbers. Return Plan[]
- `src/capture/segments.ts` — Sliding window (3 exchanges) segment detection:
  - "planning": EnterPlanMode active
  - "implementing": >=50% Edit/Write tool calls
  - "testing": Bash with test/jest/vitest/pytest
  - "debugging": tool errors + subsequent edits/discussion
  - "exploring": mostly Read/Grep/Glob, no edits
  - "discussion": no tool calls
  - "pivot": user interrupt + direction change
  - "deploying": git push/deploy commands
  - Merge adjacent same-type. Min 2 exchanges per segment. Track files + tool counts per segment
- `src/capture/milestones.ts` — Regex on Bash tool inputs:
  - `git commit -m` → commit + message
  - `git push` → push + remote/branch
  - `gh pr create` → PR
  - `git checkout -b` → branch
  - test commands → test_pass/test_fail based on error status
- `src/capture/github.ts` — Parse git remote URL → owner/repo. Construct commit/branch/file URLs. Optional: shell to `gh pr view --json` for PR enrichment if gh available

**Commit:** "feat: add programmatic analyzer (segments, plans, milestones, github)"

## Phase 6: Capture Handler (Hooks)

- `src/capture/handler.ts` — Main hook entry, reads stdin JSON, routes by event:
  - **SessionStart** (sync): upsert session, count previous sessions, write stdout with additionalContext nudge
  - **Stop** (async): parse latest exchange from JSONL, store exchange + tool calls, detect new compaction boundaries
  - **PostCompact** (async): store compaction event with summary from stdin `compact_summary`
  - **SessionEnd** (async): mark session ended, run full transcript parse, run programmatic analysis (segments/plans/milestones), store all results, detect session links (shared files with recent sessions), optionally trigger AI analysis

**Hook registration (4 hooks):**
```json
{
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /path/dist/capture/handler.js SessionStart" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "command": "node /path/dist/capture/handler.js Stop", "async": true }] }],
  "PostCompact": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/dist/capture/handler.js PostCompact", "async": true }] }],
  "SessionEnd": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/dist/capture/handler.js SessionEnd", "async": true }] }]
}
```

**Reference:** `/Users/hasanberaaksay/Documents/GitHub/KEDDY/cli/lib/claude.js` for hook install/remove pattern
**Reference:** `/Users/hasanberaaksay/Documents/GitHub/KEDDY/hooks/capture.js` for stdin parsing and stdout injection

**Commit:** "feat: add capture handler with 4 Claude Code hooks"

## Phase 7: CLI

- `src/cli/index.ts` — Entry point with shebang, command router
- `src/cli/init.ts` — Check ~/.claude exists, create ~/.keddy/, init DB, install hooks into ~/.claude/settings.json (reuse pattern from mano's claude.js), register MCP in project .mcp.json, offer historical import
- `src/cli/open.ts` — Start dashboard server, open browser via `open` package
- `src/cli/status.ts` — Show hook status, session count, DB size, MCP registration
- `src/cli/config.ts` — Read/write ~/.keddy/config.json. `keddy config set analysis.apiKey sk-ant-...`
- `src/cli/import.ts` — Scan ~/.claude/projects/ for JSONL files, parse each, store sessions. Show progress. Handle duplicates (skip by session_id)

**Commit:** "feat: add CLI (init, open, status, config, import)"

## Phase 8: MCP Server

- `src/mcp/server.ts` — McpServer with StdioServerTransport, 4 tools:
  1. `keddy_search_sessions(query, project?, days?, limit?)` — FTS5 search on exchanges + plan text + session titles
  2. `keddy_get_session(sessionId)` — Full session with segments, plans, milestones, decisions, compaction events
  3. `keddy_get_plans(sessionId?)` — Plan versions with text, feedback, status. Without sessionId: recent plans
  4. `keddy_recent_activity(days?)` — Session list with outcomes, default 7 days

**Reference:** `/Users/hasanberaaksay/Documents/GitHub/KEDDY/mcp/server.mjs` for McpServer pattern, zod schemas, textResult helper

**Commit:** "feat: add MCP server with 4 session intelligence tools"

## Phase 9: Dashboard API

- `src/dashboard/server.ts` — Hono app with @hono/node-server, port 3737, CORS, static file serving
- `src/dashboard/routes/sessions.ts` — GET /api/sessions (list, search, paginate), GET /api/sessions/:id (detail), GET /api/sessions/:id/exchanges, POST /api/sessions/:id/title (rename), POST /api/sessions/:id/analyze
- `src/dashboard/routes/plans.ts` — GET /api/sessions/:id/plans
- `src/dashboard/routes/stats.ts` — GET /api/stats (overview numbers)
- `src/dashboard/routes/config.ts` — GET/PUT /api/config (settings page)

**Commit:** "feat: add Hono dashboard API"

## Phase 10: Dashboard Frontend

**Tech:** React 19, Vite, Tailwind v4, shadcn/ui components, React Router v7

- `src/dashboard/app/main.tsx` — React entry
- `src/dashboard/app/App.tsx` — Router: /, /sessions/:id, /sessions/:id/plans, /settings
- `src/dashboard/app/lib/api.ts` — Fetch wrappers
- `src/dashboard/app/lib/types.ts` — Frontend types
- `src/dashboard/app/lib/constants.ts` — Segment colors, tool icons, type labels
- `index.html` — Vite entry HTML
- `vite.config.ts` — Proxy /api to localhost:3737, build output to dist/dashboard/public
- `src/dashboard/app/pages/Sessions.tsx` — Session list with search, project filter, segment mini-bars
- `src/dashboard/app/pages/SessionDetail.tsx` — Vertical timeline with segment cards, inline plans, milestones, compaction markers. Click-to-expand exchanges
- `src/dashboard/app/pages/PlanViewer.tsx` — Plan versions tabbed/listed, full text, feedback, changes
- `src/dashboard/app/pages/Settings.tsx` — Config GUI: AI toggles per-feature/per-model, MCP status, data management
- `src/dashboard/app/components/Timeline.tsx` — Vertical timeline layout
- `src/dashboard/app/components/SegmentCard.tsx` — Type badge, exchange range, files, tool counts
- `src/dashboard/app/components/PlanCard.tsx` — Plan version with status, steps, feedback
- `src/dashboard/app/components/SessionCard.tsx` — List card with mini-bar, badges, metadata
- `src/dashboard/app/components/ExchangeView.tsx` — Expandable exchange with prompt, response, tool calls
- `src/dashboard/app/components/SearchBar.tsx` — Search + filters

**Commit:** "feat: add React dashboard with sessions, timeline, plans, settings"

## Phase 11: AI Analysis Layer (Optional)

- `src/analysis/index.ts` — Orchestrator: check config, run enabled features, store results
- `src/analysis/providers.ts` — Provider abstraction (Anthropic via SDK, OpenAI-compatible for ollama)
- `src/analysis/titles.ts` — Generate session title from first/last exchanges
- `src/analysis/summaries.ts` — Generate segment summaries
- `src/analysis/decisions.ts` — Extract decision points with context

**Config structure:**
```json
{
  "analysis": {
    "enabled": false,
    "provider": "anthropic",
    "apiKey": "",
    "features": {
      "sessionTitles": { "enabled": true, "model": "claude-haiku-4-5-20251001" },
      "segmentSummaries": { "enabled": true, "model": "claude-haiku-4-5-20251001" },
      "decisionExtraction": { "enabled": false, "model": "claude-haiku-4-5-20251001" },
      "planDiffAnalysis": { "enabled": false, "model": "claude-sonnet-4-6" },
      "sessionNotes": { "enabled": false, "model": "claude-sonnet-4-6" }
    }
  }
}
```

**Commit:** "feat: add optional AI analysis with configurable providers and features"

## Phase 12: Tests

Using vitest.

**Fixtures:**
- `tests/fixtures/sample-session.jsonl` — 5 exchanges, Read/Edit/Bash tools, git commit
- `tests/fixtures/sample-with-plans.jsonl` — EnterPlanMode/ExitPlanMode, approval, rejection with feedback, 2 plan versions
- `tests/fixtures/sample-with-compaction.jsonl` — compact_boundary + isCompactSummary entries
- `tests/fixtures/sample-interrupt.jsonl` — [Request interrupted by user] + direction change

**Test files:**
- `tests/parser.test.ts` — Exchange extraction, tool call detection, plan mode detection, compaction detection, interrupt detection, metadata extraction, skip types
- `tests/plans.test.ts` — Plan text extraction, approval/rejection, user feedback parsing, version numbering
- `tests/segments.test.ts` — Implementing sequences, exploring, debugging, pivots, minimum segment size, window merging
- `tests/milestones.test.ts` — Git commit/push/PR/branch regex, test command detection
- `tests/github.test.ts` — SSH and HTTPS remote URL parsing, URL construction
- `tests/db.test.ts` — Insert session → exchanges → query back, FTS5 search, stats
- `tests/mcp.test.ts` — Tool handler responses with mock DB data

**vitest.config.ts** at project root.

**Commit:** "test: add comprehensive test suite with fixtures"

## Phase 13: Documentation + Open Source Files

- `CLAUDE.md` — Project instructions: architecture, conventions, DB schema, how hooks work, testing, what NOT to do
- `README.md` — Professional README: description, badges, screenshot placeholder, quick start (npx keddy init), feature list, architecture diagram, configuration, MCP tools docs
- `docs/DECISIONS.md` — All decisions from this planning session (why session intelligence not memory, why programmatic-first, why local-first, why Apache 2.0, pricing tiers, competitor analysis)
- `docs/PRODUCT.md` — Free/Pro/Team tier definitions with features
- `docs/ARCHITECTURE.md` — Technical design document
- `docs/COMPETITORS.md` — Mem0, Zep, Claude-Mem comparison
- `LICENSE` — Apache 2.0 full text
- `CONTRIBUTING.md` — Dev setup, PR process, coding standards
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- `SECURITY.md` — Vulnerability reporting
- `CHANGELOG.md` — v0.1.0 notes
- `.env.example` — KEDDY_DB, ANTHROPIC_API_KEY (optional)
- `.github/workflows/ci.yml` — lint + typecheck + test + build on push/PR
- `.github/workflows/release.yml` — npm publish on tag
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`

**Commit:** "docs: add documentation, LICENSE, and GitHub templates"

## Phase 14: Plugin + Package Prep

- `.claude-plugin/plugin.json` — `{ "name": "keddy", "version": "0.1.0", "description": "Session intelligence for Claude Code" }`
- `hooks/hooks.json` — Hook definitions in plugin format (alternative to settings.json registration)
- Final `package.json` adjustments: files field, prepublishOnly script, engines

**Commit:** "chore: prepare npm package and Claude Code plugin"

## Phase 15: Create GitHub Repo + Push

- `gh repo create emireaksay-8867/keddy --public --description "Session intelligence for Claude Code"`
- `git remote add origin`
- `git push -u origin main`

## Phase 16: End-to-End Testing + Iteration

After all code is written:
1. Build: `npm run build`
2. Run tests: `npm test` — iterate until all pass
3. Test `keddy init` manually — verify hooks in ~/.claude/settings.json
4. Start a Claude Code session — verify Stop hook captures exchanges
5. Run `keddy open` — verify dashboard renders sessions
6. Test MCP tools — verify keddy_search_sessions returns results
7. Test historical import — verify existing sessions are imported
8. Fix any issues found, re-run tests
9. Iterate until everything works cleanly

---

## Key Technical Decisions

1. **3 hooks (not 4):** SessionStart (sync), Stop (async), SessionEnd (async). PostCompact may or may not work reliably — detect compaction from JSONL parsing instead (always reliable since the data is in the file). If PostCompact works, add it as a bonus.
2. **No bridge.cjs pattern:** Unlike Mano's compiled bridge, Keddy uses tsup to compile directly. No intermediate CJS bundle needed.
3. **Single database:** ~/.keddy/keddy.db stores all projects. Project isolation via `project_path` column. Better for cross-project search.
4. **Programmatic-first:** All core features work without AI. AI is enhancement layer, never required.
5. **FTS5 for search:** Full-text search on exchange prompts and plan text. No embeddings needed for MVP.
6. **Dashboard port 3737:** Avoids conflicts with common ports.
7. **Session title:** First user prompt truncated to 80 chars (programmatic). AI-generated title when analysis enabled.
