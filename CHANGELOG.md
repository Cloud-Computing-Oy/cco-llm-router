# Changelog

## [0.13.0] - 2026-08-26

### Added

- Added the opt-in `auto:laptop-assisted` chain for opportunistic Ollama GPU
  workers, with matching TypeScript and Python behavior.
- Added bounded health probes, request timeouts, concurrency limits, and a
  circuit breaker so an offline or busy laptop falls through quickly.
- Documented private Tailscale Serve setup and demand-loaded Ollama models.
- Added conservative automatic task routing for alias-free TypeScript and
  Python helper calls: short low-risk work prefers the laptop, while code,
  long-context, reasoning, high-risk, confidential, and restricted work stays
  on stronger routes.
- Selected the verified `qwen2.5:7b` model for the 8 GiB laptop worker.

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
[0.13.0]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.12.0...v0.13.0
