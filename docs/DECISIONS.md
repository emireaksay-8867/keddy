# Technical Decisions

## Why Session Intelligence, Not Memory

Keddy is not a memory injection layer. It's a session organizer with search.

- **Memory tools** (Mem0, Zep, Claude-Mem) inject context into prompts, competing with compaction
- **Session intelligence** captures and organizes sessions after the fact, without affecting behavior
- Sessions contain rich decision-making context that memory summaries lose

## Why Programmatic-First

All core features work without AI:
- Plan extraction uses deterministic tool_use name matching
- Segment classification uses tool distribution heuristics
- Milestone detection uses regex on Bash inputs
- Search uses FTS5 full-text search

AI is opt-in for titles, summaries, and decision extraction.

## Why Local-First

- Session data stays on disk at `~/.keddy/keddy.db`
- No cloud, no telemetry, no accounts
- Works offline
- Users own their data

## Why SQLite

- Zero configuration — no server process needed
- Single file — easy to backup, move, delete
- WAL mode — concurrent reads without blocking
- FTS5 — built-in full-text search
- better-sqlite3 — synchronous API, no async overhead for local DB

## Why Apache 2.0

- Permissive enough for adoption
- Patent protection for contributors
- Compatible with most enterprise policies

## Why 4 Hooks

| Hook | Why |
|------|-----|
| SessionStart (sync) | Upsert session before any exchanges. Sync to inject additionalContext. |
| Stop (async) | Capture each exchange incrementally. Async to not block Claude. |
| PostCompact (async) | Record compaction events when they happen. |
| SessionEnd (async) | Full transcript parse + analysis at session close. |
