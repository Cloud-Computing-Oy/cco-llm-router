# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Development

```bash
npm ci
npm test
npm run typecheck

python -m venv .venv
. .venv/bin/activate
python -m pip install -e './py[dev]'
python -m pytest py/tests
python -m ruff check py
```

Keep the TypeScript and Python bindings behaviorally aligned. Add regression
tests to both implementations when changing aliases, provider availability,
budget behavior, data policy, or pricing.

## Pull requests

- Explain the problem, security and compatibility impact, and validation.
- Do not include API keys, prompts, customer data, internal infrastructure, or
  generated usage files.
- Pin new GitHub Actions to full commit SHAs.
- Cite authoritative sources and verification dates for model IDs and prices.
- Keep experimental providers explicit-only until their data handling and
  reliability have been approved.

By contributing, you agree that your contribution is licensed under
Apache-2.0.
