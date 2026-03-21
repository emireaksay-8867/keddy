# keddy

**Session intelligence for Claude Code** — navigable timelines, plan tracking, and past session search.

Claude Code sessions generate rich context — plans, revisions, architectural decisions, direction changes — that vanishes when the session ends. JSONL transcripts are unreadable. Compaction loses context.

Keddy auto-captures sessions via hooks, extracts structure programmatically, stores everything in SQLite, and surfaces it via a dashboard and MCP tools.

## Features

- **Auto-capture** — 4 Claude Code hooks capture every session automatically
- **Navigable timelines** — Sessions organized into typed segments (implementing, debugging, exploring, etc.)
- **Plan version tracking** — Every plan version with approval/rejection status and user feedback
- **Milestone detection** — Git commits, pushes, PRs, branches, test runs extracted automatically
- **Full-text search** — FTS5 search across all session prompts
- **MCP tools** — 4 tools for Claude to search past sessions and plans
- **Dashboard** — React-based web UI on port 3737
- **AI analysis** (optional) — Session titles, segment summaries, decision extraction via Anthropic API
- **Local-first** — Everything stays in `~/.keddy/keddy.db`. No cloud. No telemetry.

## Quick Start

```bash
# Install
npm install -g keddy

# Initialize (installs hooks, creates DB, registers MCP)
keddy init

# Start coding with Claude Code — sessions are auto-captured

# Open the dashboard
keddy open

# Import historical sessions
keddy import

# Check status
keddy status
```

## Architecture

```
Hooks → Parser → Analyzer → SQLite ← MCP Server
                                    ← Dashboard API ← React UI
```

**4 Claude Code hooks:**
| Hook | Mode | Purpose |
|------|------|---------|
| SessionStart | sync | Register session, inject context |
| Stop | async | Capture latest exchange |
| PostCompact | async | Record compaction event |
| SessionEnd | async | Full parse + analysis |

**Programmatic analysis** (no AI needed):
- **Segments**: planning, implementing, testing, debugging, exploring, discussion, pivot, deploying
- **Plans**: version tracking with approval/rejection/feedback
- **Milestones**: git commit, push, PR, branch, test pass/fail

## MCP Tools

When registered via `keddy init`, Claude can use these tools:

| Tool | Description |
|------|-------------|
| `keddy_search_sessions` | Full-text search across sessions |
| `keddy_get_session` | Get full session details with timeline |
| `keddy_get_plans` | Get plan versions with text and feedback |
| `keddy_recent_activity` | Summary of recent sessions |

## Configuration

```bash
# View all config
keddy config

# Enable AI analysis
keddy config set analysis.enabled true
keddy config set analysis.apiKey sk-ant-...

# Per-feature control
keddy config set analysis.features.sessionTitles.enabled true
keddy config set analysis.features.decisionExtraction.enabled false
```

Config stored at `~/.keddy/config.json`.

## Development

```bash
git clone https://github.com/emireaksay-8867/keddy.git
cd keddy
npm install
npm run build:cli   # Build CLI + server
npm test            # Run tests
npm run dev         # Watch mode (CLI + dashboard)
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict, NodeNext modules)
- **Database**: SQLite via better-sqlite3 (WAL mode, FTS5)
- **Build**: tsup (CLI/server), Vite (dashboard)
- **API**: Hono
- **Frontend**: React 19, Tailwind CSS v4, React Router v7
- **MCP**: @modelcontextprotocol/sdk
- **Tests**: vitest

## License

Apache-2.0
