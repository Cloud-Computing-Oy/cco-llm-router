# Changelog

## [0.19.0] - 2026-08-29

### Changed

- Reorder `auto:smart`, `auto:code`, `auto:reasoning`, and `auto:big` by
  ascending price ($/M input+output) after the reliability-first
  `deepseek-v4-flash` slot, instead of the prior hand-curated order.
  Prices within $0.25/M of each other are treated as a tie and keep their
  prior relative order, so a marginally cheaper generalist model can't
  bump a task-suited specialist (e.g. `zai:glm-5.3-flash` stays ahead of
  plain Llama-3.3-70B in `auto:code`). `zai:glm-5.3` moves out of the
  fixed slot right after Flash into its price-ordered position in each
  chain.

## [0.18.0] - 2026-08-29

### Added

- Add the flagship `zai:glm-5.3` route alongside GLM-5.3-Flash in
  TypeScript and Python, reviewed at its permanent $1.40/M input and
  $4.40/M output list price.
- Wire `glm-5.3` into the default `auto:smart`, `auto:code`,
  `auto:reasoning`, and `auto:big` chains right after GLM-5.3-Flash, as
  an escalation for tasks that need more capability. `family:glm` now
  resolves to both models in that order. The explicit
  `auto:glm-flash-pilot` alias is unchanged and still selects
  `zai:glm-5.3-flash` only.

## [0.17.1] - 2026-08-28

### Fixed

- Preserve `NODE_ENV` explicitly when building the secret-scrubbed Claude child
  environment, keeping the package compatible with Next.js projects whose
  global `ProcessEnv` type requires that field.

## [0.17.0] - 2026-08-27

### Added

- Add reviewed Qwen, Kimi, GLM, Llama, MiniMax, Mistral, Gemma, and Nemotron
  family routes, with OpenAI-compatible DashScope, Z.ai, MiniMax, Mistral, and
  NVIDIA NIM adapters in TypeScript and Python.
- Add the verified `glm-5.3-flash` route with task-specific priority for smart,
  coding, reasoning, and large-context work in TypeScript and Python.
- Track GLM-5.3-Flash at its permanent $0.15/M input and $0.50/M output list
  price, allowing normal automatic routing while retaining provider budgets.
- Exclude other unknown-price catalog models from automatic routing until the
  caller explicitly approves them.

## [0.16.0] - 2026-08-27

### Changed

- Prioritize the currently available DeepSeek V4 Flash model for general,
  coding, reasoning, and large-context cloud routes.
- Replace Groq's retired `llama-3.3-70b-versatile` default with the available
  `qwen/qwen3.6-27b` model.
- Try every available provider before failing a request, regardless of an
  upstream provider's error wording. Caller cancellation still stops
  immediately, and a full-chain retry happens only when every failure was
  transient.

## [0.15.2] - 2026-08-27

### Fixed

- Normalize Claude Code's late conversation-level `system` messages into the
  leading system instruction so Gemini-compatible fallback providers accept
  multi-request Claude Code sessions.

## [0.15.1] - 2026-08-27

### Fixed

- Ship the npm CLI entry points as executable JavaScript bundles so Node can
  run `claude-router` and `cco-llm-usage` from `node_modules`.

## [0.15.0] - 2026-08-27

### Added

- Added the opt-in `claude-router` launcher and loopback-only Anthropic
  Messages API gateway for using the existing router chains from Claude Code.
- Added authenticated JSON, SSE, token-counting, multi-turn, and tool-call
  compatibility with provider credentials isolated from the Claude process.

## [0.14.0] - 2026-08-26

### Added

- Added the guarded `auto:facf-laptop` route while preserving the legacy
  `auto:laptop-assisted` alias.

## [0.13.1] - 2026-08-26

### Fixed

- Preserved the executable `cco-llm-usage` CLI entry in npm 11 package
  publication by marking its shebang-bearing script executable.

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
[0.13.1]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.13.0...v0.13.1
[0.14.0]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.13.1...v0.14.0
[0.15.0]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.14.0...v0.15.0
[0.15.1]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.15.0...v0.15.1
[0.15.2]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.15.1...v0.15.2
[0.17.0]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/Cloud-Computing-Oy/cco-llm-router/compare/v0.15.2...v0.16.0
