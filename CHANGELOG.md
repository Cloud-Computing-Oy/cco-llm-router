# Changelog

## [0.12.0] - 2026-07-31

### Security

- Added Apache-2.0 licensing and a public vulnerability-reporting policy.
- Added explicit data classification and opt-in requirements for the Kimi
  public-data pilot in both TypeScript and Python.
- Made direct provider selectors obey local budget checks by default; bypass
  now requires an explicit application option.
- Replaced mutable GitHub Action tags with full commit pins.
- Added CodeQL, Dependabot, deterministic TypeScript/Python CI, and npm's
  seven-day minimum package release age.

### Changed

- Replaced organization-specific migration and infrastructure details with
  public, reusable documentation.
- Clarified that local usage and budget tracking is best-effort, per-host, and
  not a billing or security authority.
- Separated public source releases from npm and PyPI publication decisions.
- Updated the Python package to 0.5.0.

[0.12.0]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.11.1...v0.12.0
