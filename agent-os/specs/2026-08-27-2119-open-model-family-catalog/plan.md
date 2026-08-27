# Open Model Family Catalog — Implementation Plan

## Task 1: Save Spec Documentation

Save scope, standards, references, and this plan before implementation.

Validation: `test -s agent-os/specs/2026-08-27-2119-open-model-family-catalog/plan.md`

## Task 2: Add Provider Adapters

Add DashScope, Z.ai, MiniMax, Mistral, and NVIDIA NIM providers with explicit
Chat Completions transport, BYOK, environment availability, budgets, and
secret-redaction coverage. Retain Moonshot for Kimi.

Acceptance: every configured provider resolves direct model IDs; missing keys
fail closed; credentials never reach logs or child environments.

Validation: provider unit tests, TypeScript typecheck, Python tests.

## Task 3: Add Version-Tolerant Model Catalog

Create catalog entries for Qwen, Kimi, GLM, Llama, MiniMax, Mistral, Gemma,
and Nemotron with provider/model IDs, capabilities, lifecycle, license class,
and pricing status.

Acceptance: family queries return current reviewed entries; direct provider
selectors accept future model IDs without catalog edits.

Validation: catalog schema and family coverage tests.

## Task 4: Enforce Cost and Capability Safety

Make unknown price distinct from zero, exclude unknown-price paid models from
automatic aliases, and select only models meeting required tool/reasoning/
context capabilities.

Acceptance: unknown-priced routes cannot enter automatic cost ordering;
explicit selection remains available with an explicit override.

Validation: pricing and capability-selection tests.

## Task 5: Add Family Aliases and Discovery

Add reviewed family aliases and bounded provider model-list discovery. Runtime
discovery reports drift but does not silently activate models.

Acceptance: all eight requested families have at least one supported route;
retired IDs are not automatic defaults.

Validation: alias parity tests and authenticated model-list smoke tests where
credentials exist.

## Task 6: Documentation, Audit, and Stacked PR

Document configuration, licensing boundaries, model selection, and costs;
validate both implementations; run diff-scoped strict SARIF audit; open a PR
stacked on router PR #26.

## Non-Goals

- Shipping model weights, claiming OSI-open-source status, automatically
  accepting new catalog models, or enabling unknown-cost models by default.

## Risks and Rollback

- Vendor IDs and prices drift: keep reviewed catalog metadata and live drift
  reporting separate.
- Aggregator behavior differs: prefer direct vendor APIs, then tested
  aggregators.
- The stacked branch can be closed without changing the existing aliases.
