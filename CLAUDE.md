# Keddy — Project Instructions

## What is Keddy?

Session intelligence for Claude Code. Captures coding sessions via hooks, organizes transcripts into navigable timelines with plan version tracking, and provides MCP tools for Claude to search past sessions.

## Architecture

```
src/
├── types.ts           # Shared TypeScript interfaces
├── db/                # SQLite database layer (better-sqlite3)
│   ├── index.ts       # initDb(), getDb(), closeDb()
│   ├── schema.ts      # 9 tables + FTS5 + triggers
│   └── queries.ts     # Prepared statements for all operations
├── capture/           # Session capture pipeline
│   ├── parser.ts      # JSONL transcript parser
│   ├── handler.ts     # Hook entry point (reads stdin, routes by event)
│   ├── plans.ts       # Plan extraction (EnterPlanMode/ExitPlanMode)
│   ├── segments.ts    # Segment detection (sliding window)
│   ├── milestones.ts  # Milestone regex (git commit/push/PR/branch/test)
│   └── github.ts      # Git remote URL parsing + URL construction
├── mcp/               # MCP server (4 tools via StdioServerTransport)
│   └── server.ts
├── cli/               # CLI commands
│   ├── index.ts       # Entry point with command router
│   ├── init.ts        # Hook installation + DB init
│   ├── open.ts        # Dashboard server + browser open
│   ├── status.ts      # Health check
│   ├── config.ts      # Read/write ~/.keddy/config.json
│   └── import.ts      # Historical session import
├── dashboard/         # Hono API + React frontend
│   ├── server.ts      # Hono app, port 3737
│   ├── routes/        # API routes
│   └── app/           # React SPA (Vite + Tailwind v4)
└── analysis/          # Optional AI analysis layer
    ├── index.ts       # Orchestrator
    ├── providers.ts   # Anthropic / OpenAI-compatible
    ├── titles.ts      # AI session titles
    ├── summaries.ts   # AI segment summaries
    └── decisions.ts   # AI decision extraction
```

## npm Package

- **Published**: `keddy@0.1.0` on npmjs.com (https://www.npmjs.com/package/keddy)
- **Owner**: `emiraksay` on npm
- **Publish**: `npm publish --access public` (runs tests + build via prepublishOnly)
- **Granular access token** with 2FA bypass is configured for publishing

## Key Conventions

- **Module format**: NodeNext (import with `.js` extensions)
- **Build**: tsup for CLI/server, Vite for dashboard frontend
- **Database**: Single SQLite file at `~/.keddy/keddy.db`, WAL mode
- **No AI required**: All core features are programmatic. AI is opt-in enhancement layer.
- **FTS5**: Full-text search on user prompts. Query sanitization strips quotes and wraps words.

## Database Schema

9 tables: sessions, exchanges, tool_calls, plans, segments, milestones, decisions, compaction_events, session_links. Plus `exchanges_fts` (FTS5) and `config` (key-value).

## How Hooks Work

4 Claude Code hooks:
1. **SessionStart** (sync) — Upserts session, returns additionalContext
2. **Stop** (async) — Parses latest exchange from JSONL
3. **PostCompact** (async) — Stores compaction event
4. **SessionEnd** (async) — Full transcript parse + analysis

## Testing

```bash
npm test          # Run all tests
npm run test:watch # Watch mode
```

Tests use vitest. Fixtures in `tests/fixtures/`. Integration tests use real JSONL from `~/.claude/projects/` when available.

## What NOT to Do

- Don't add memory injection — Keddy is a session organizer, not a memory layer
- Don't require AI for any core functionality
- Don't modify Claude Code settings outside of `keddy init`
- Don't store sensitive data (API keys, credentials) in the database
