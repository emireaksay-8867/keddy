# Contributing to Keddy

Thank you for your interest in contributing to Keddy!

## Development Setup

```bash
git clone https://github.com/emireaksay-8867/keddy.git
cd keddy
npm install
npm test
```

## Pull Request Process

1. Fork the repository and create a feature branch
2. Write tests for any new functionality
3. Ensure all tests pass: `npm test`
4. Ensure type checking passes: `npm run typecheck`
5. Submit a PR with a clear description of the changes

## Coding Standards

- TypeScript strict mode
- NodeNext module resolution (use `.js` extensions in imports)
- No AI required for core features — programmatic-first approach
- Tests in `tests/` directory using vitest
- Fixtures in `tests/fixtures/`

## Reporting Issues

Use [GitHub Issues](https://github.com/emireaksay-8867/keddy/issues) with the provided templates.
