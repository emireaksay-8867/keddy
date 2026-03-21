# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email: emire.aksay@gmail.com
3. Include a description, steps to reproduce, and potential impact

We will respond within 48 hours and work on a fix promptly.

## Scope

Keddy stores session data locally in SQLite. Security considerations include:
- SQL injection in search queries (mitigated via parameterized queries + FTS5 sanitization)
- File path traversal in JSONL parsing
- API key storage in config files (not in database)
