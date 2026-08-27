# Open Model Family Catalog — Shaping Notes

## Scope

Add first-class, version-tolerant support for Qwen, Kimi, GLM, Llama,
MiniMax, Mistral, Gemma, and Nemotron model families. Support direct vendor
APIs, approved aggregators, and self-hosted OpenAI-compatible endpoints without
assuming that every model is open source or shares the same license.

## Decisions

- Use vendor adapters for DashScope, Moonshot, Z.ai, MiniMax, Mistral, and
  NVIDIA NIM.
- Represent family, capabilities, license class, lifecycle, and pricing status
  in a catalog independent from fallback aliases.
- Allow future model versions through direct `provider:model` selection.
- Automatic aliases may use only models with explicit prices or an explicitly
  declared zero-cost local/free route.
- Unknown price is not zero and is excluded from automatic cost optimization.
- Runtime `/models` discovery supplements, but never silently rewrites, the
  reviewed catalog.
- Preserve data-class restrictions and exhaustive fallback behavior.

## Context

- **Visuals:** None.
- **References:** Existing router providers, pricing, budgets, and aliases;
  official vendor model/API documentation reviewed on 2026-08-27.
- **Product alignment:** Enables cost-first provider diversity for CCO Code
  Agent without vendor lock-in.

## Standards Applied

No Agent OS standards index exists. Repository audit, secret isolation,
fail-closed pricing, and TypeScript/Python parity are feature-local standards.
