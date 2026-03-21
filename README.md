<p align="center">
  <h1 align="center">keddy</h1>
  <p align="center">
    <strong>Session intelligence for Claude Code</strong>
  </p>
  <p align="center">
    Navigable timelines &bull; Plan version tracking &bull; Past session search
  </p>
  <p align="center">
    <a href="https://github.com/emireaksay-8867/keddy/actions/workflows/ci.yml"><img src="https://github.com/emireaksay-8867/keddy/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/keddy"><img src="https://img.shields.io/npm/v/keddy.svg" alt="npm version"></a>
    <a href="https://github.com/emireaksay-8867/keddy/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
    <a href="https://www.npmjs.com/package/keddy"><img src="https://img.shields.io/npm/dm/keddy.svg" alt="Downloads"></a>
  </p>
</p>

---

Claude Code sessions generate rich context — plans, architectural decisions, direction changes, debugging journeys — that **vanishes when the session ends**. JSONL transcripts are unreadable. Compaction loses context.

**Keddy captures every session automatically**, extracts structure programmatically, and surfaces it through a dashboard and MCP tools — so Claude can learn from your past sessions.

## Why Keddy?

| Without Keddy | With Keddy |
|---|---|
| Sessions disappear after closing | Every session captured and searchable |
| Raw JSONL transcripts are unreadable | Navigable timelines with typed segments |
| Plan iterations are lost | Full plan version history with feedback |
| No way to reference past decisions | FTS5 search + MCP tools for Claude |
| Compaction destroys context | Compaction events tracked with summaries |

## Quick Start

```bash
# Install globally
npm install -g keddy

# Initialize — installs hooks, creates DB, registers MCP
keddy init

# Start coding with Claude Code — sessions are captured automatically

# View your sessions
keddy open

# Import historical sessions from ~/.claude/projects/
keddy import
```

That's it. Every Claude Code session is now captured, analyzed, and searchable.

## How It Works

```
Claude Code Session
    │
    ├── SessionStart ──────► Register session
    ├── Stop (each turn) ──► Capture exchange + tool calls
    ├── PostCompact ───────► Record compaction event
    └── SessionEnd ────────► Full analysis pipeline
                                    │
                              ┌─────┼─────┐
                              ▼     ▼     ▼
                           Plans Segments Milestones
                              │     │     │
                              └─────┼─────┘
                                    ▼
                               SQLite DB
                              ┌─────┼─────┐
                              ▼           ▼
                         Dashboard    MCP Server
                        (port 3737)  (4 tools for Claude)
```

### Programmatic Analysis (No AI Required)

All core features work without any AI API calls:

**Segments** — Each exchange is classified into one of 8 types based on tool usage patterns:

| Segment | Detection |
|---------|-----------|
| `planning` | EnterPlanMode / ExitPlanMode tools |
| `implementing` | 50%+ Edit/Write tool calls |
| `testing` | Bash with test/jest/vitest/pytest commands |
| `debugging` | Tool errors + subsequent edits |
| `exploring` | Mostly Read/Grep/Glob, no edits |
| `discussion` | No tool calls |
| `pivot` | User interrupt + direction change |
| `deploying` | git push / deploy commands |

**Plans** — Every EnterPlanMode/ExitPlanMode pair is tracked with:
- Full plan text
- Approval / rejection / superseded status
- User feedback from rejections
- Sequential version numbers

**Milestones** — Automatically detected from Bash tool inputs:
- Git commits (with message), pushes, branch creation
- PR creation via `gh pr create`
- Test pass/fail detection

### MCP Tools

When registered via `keddy init`, Claude gets 4 tools to search your history:

```
keddy_search_sessions    — Full-text search across all sessions
keddy_get_session        — Get full session with timeline, plans, milestones
keddy_get_plans          — Get plan versions with text and feedback
keddy_recent_activity    — Summary of recent sessions
```

### Optional AI Analysis

Enable AI-powered enhancements with your Anthropic API key:

```bash
keddy config set analysis.enabled true
keddy config set analysis.apiKey sk-ant-...
```

| Feature | Model | Description |
|---------|-------|-------------|
| Session Titles | Haiku | Generate descriptive session titles |
| Segment Summaries | Haiku | Summarize what happened in each segment |
| Decision Extraction | Haiku | Identify key technical decisions |
| Plan Diff Analysis | Sonnet | Analyze changes between plan versions |
| Session Notes | Sonnet | Generate session retrospective notes |

Each feature can be individually enabled/disabled and uses the model of your choice.

## CLI Commands

| Command | Description |
|---------|-------------|
| `keddy init` | Install hooks, create DB, register MCP |
| `keddy open` | Launch dashboard in browser (port 3737) |
| `keddy status` | Show hook status, session count, DB size |
| `keddy config` | View/edit configuration |
| `keddy import` | Import historical sessions from `~/.claude/` |
| `keddy help` | Show help |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Language | TypeScript (strict mode) |
| Database | SQLite via better-sqlite3 (WAL mode, FTS5) |
| CLI Build | tsup |
| API Server | Hono |
| Frontend | React 19, Tailwind CSS v4, Vite |
| MCP | @modelcontextprotocol/sdk |
| Tests | vitest (178 tests) |

## Development

```bash
git clone https://github.com/emireaksay-8867/keddy.git
cd keddy
npm install

npm test              # Run 178 tests
npm run typecheck     # TypeScript strict check
npm run build         # Build CLI + dashboard
npm run dev           # Watch mode
```

## Architecture

```
src/
├── types.ts              # Shared TypeScript interfaces
├── db/                   # SQLite — schema, queries, FTS5
├── capture/              # JSONL parser, hooks, analyzers
│   ├── parser.ts         # Multi-turn exchange extraction
│   ├── handler.ts        # 4 hook entry points
│   ├── plans.ts          # Plan version tracking
│   ├── segments.ts       # Segment classification
│   └── milestones.ts     # Milestone regex detection
├── mcp/server.ts         # 4 MCP tools via StdioServerTransport
├── cli/                  # init, open, status, config, import
├── dashboard/            # Hono API + React SPA
└── analysis/             # Optional AI layer
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md) for detailed design documentation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR process.

## License

[Apache-2.0](LICENSE) — Emir Enes Aksay
