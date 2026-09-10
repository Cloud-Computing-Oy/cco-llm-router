# Auto-Refreshing Model Availability & Pricing Data in cco-llm-router

**Date:** 2026-09-10
**Status:** Design approved (brainstorming 2026-09-10) — pending spec review
**Author:** Claude Code + Jarmo (Cloud Computing Oy)

## 1. Context and problem

On 2026-09-10 the Page Studio generator was diagnosed as failing with
instant `llm_error` results. Root cause chain: llm-router 0.19.0's
`chatJsonStrict` resolves aliases against a module-level singleton while
Page Studio registered its aliases on a discarded `createRouter()`
instance. After that was fixed, a second failure surfaced: **the
hardcoded chain models were stale** — Google had retired
`gemini-2.5-pro` and `gemini-2.5-flash` ("no longer available to new
users"), and the router's own default chains (0.19.0 and HEAD) still
reference them.

Hardcoded `PRICING` (pricing.ts) and `MODEL_CATALOG` (catalog.ts) tables
rot at release cadence. Every consumer ships its own copy; a provider
retirement or price change requires a router release plus consumer
bumps before the platform heals.

## 2. Goals / Non-goals

**Goals**

- Provider model retirements stop breaking chains: a `retired` model is
  filtered out of any chain at resolve time without a code release.
- Pricing stays current: `estimateCostUSD`, `priceOf`, and
  `withinBudget` reflect live, reviewed prices.
- Fully automatic for consumers: no side processes, no config changes.
- Offline-safe: the bundled snapshot keeps the router fully functional
  with no network, exactly as today.

**Non-goals**

- The router never rewrites alias chains automatically. Chains remain
  curated in code (`router.ts`); the data layer only filters hops and
  supplies pricing.
- No runtime calls to provider APIs from consumer processes. All
  provider API interaction happens in CI.
- No approval-gate automation in this iteration; retirement alerts to
  cc-os can be a phase-2 item.

## 3. Architecture overview

```
┌────────────────────────┐     ┌──────────────────────────────┐
│ GitHub Actions (CI)     │     │ cco-llm-router repo           │
│  nightly + on data PRs  │     │  pricing.json (curated, PR)   │
│  1. provider list-      │     │  catalog.ts (unchanged)       │
│     models checks       │     │  router.ts (unchanged)        │
│  2. merge with pricing  │     │  model-data.ts (new runtime)  │
│  3. validate schema     │     └──────────────┬───────────────┘
│  4. publish release     │                    │ npm package bundles
└──────────┬─────────────┘                    │ model-data.json snapshot
           │ model-data.json                  ▼
           ▼                        ┌──────────────────────┐
  GitHub Releases (latest/download) │ consumer process      │
                                    │  poller (default 6 h) │
                                    │  atomic swap          │
                                    │  resolveModel reads   │
                                    └──────────────────────┘
```

- **pricing.json** (new, in repo): curated prices, updated by PR like
  the current `PRICING` table. Source of truth for pricing.
- **model-data.json** (generated, published): merged availability +
  pricing dataset, schema-validated, published as a GitHub Release
  asset with a stable URL.
- **model-data.ts** (new, runtime): bundled snapshot + background
  poller + atomic swap; consulted by `resolveModel` filters.

## 4. Dataset schema (`model-data.json`)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-10T12:00:00Z",
  "models": [
    {
      "provider": "google",
      "model": "gemini-2.5-pro",
      "status": "retired",
      "retiredAt": "2026-09-01",
      "pricing": { "inputPerM": 1.25, "outputPerM": 5 }
    },
    {
      "provider": "google",
      "model": "gemini-3.1-p",
      "status": "available",
      "pricing": { "inputPerM": 2.5, "outputPerM": 10 }
    }
  ]
}
```

- `schemaVersion`: integer; routers reject datasets newer than their
  supported version and fall back to the snapshot.
- `status`: `available` | `retired`. Anything else (e.g. `unknown`
  after a failed CI check) is **carryover** — see §7.
- `retiredAt`: optional ISO date, informational (diagnostics only).
- `pricing`: per-million-token USD, same shape as the current
  `PRICING` table.
- `generatedAt`: freshness diagnostics only.

## 5. CI publication pipeline

A GitHub Action in this repo, triggered nightly and on pushes touching
`pricing.json` / `catalog.ts`:

1. **Availability checks** — best-effort per provider against their
   list-models APIs, using org-level secrets where a key is required.
   A check failure leaves the previous status in place; it never
   removes a model.
2. **Merge** with `pricing.json` into `model-data.json`.
3. **Validate** against the zod schema; abort the publish on failure.
4. **Publish** to GitHub Releases with the stable URL
   `https://github.com/Cloud-Computing-Oy/cco-llm-router/releases/latest/download/model-data.json`.
5. **Alert (phase 2)**: retirements and large price moves open an issue
   with a suggested PR so cc-os can review.

The bundled snapshot in the npm package is generated from the same
`schema` + `pricing.json` at release time, so consumers without network
never regress.

## 6. Runtime integration (`model-data.ts`)

- On process start, load the **bundled snapshot** as the live dataset.
- **Poller** (default 6 h) fetches the stable URL, validates with zod,
  and performs an **atomic swap** — a single mutable reference, never
  mutated mid-request.
- Env configuration:
  - `CCO_MODEL_DATA_URL` (default: the stable release URL)
  - `CCO_MODEL_DATA_REFRESH_HOURS` (default 6; `0` disables — full
    opt-out, behavior identical to today)
- **Safety rules** — see §7.
- `getModelDataStatus()` exposes source, `fetchedAt`, last error, and
  applied changes for diagnostics (cc-os monitoring).

### resolveModel changes

- `isAvailable` filter additionally skips models with `status:
  "retired"` in the live dataset.
- `hasReviewedAutomaticPricing` becomes "pricing entry exists in the
  live dataset" (absent → filtered unless `allowUnknownPricing`, as
  today).
- `priceOf` / `estimateCostUSD` / `withinBudget` read live prices.

Nothing else changes: chain definitions, ordering, fallback logic, and
data-class rules are untouched.

## 7. Behavioral rules

1. **Retired mid-chain** → the hop is filtered at resolve time.
   In-flight failures fall back to the next hop (existing behavior).
2. **All hops unavailable** → existing "No available provider" error,
   with an improved message naming the reason (retired vs missing key)
   and pointing at `CCO_MODEL_DATA_URL` / `getModelDataStatus()`.
3. **Unknown / absent status** → carryover: never removes a model due
   to CI failure. `retired` is the only status that removes a hop.
   Models absent from the dataset are treated as available (the
   pricing gate still applies).
4. **Stale data** → never degrades service. If CI is down for weeks,
   the last good dataset stays in effect; a warning is logged once the
   dataset age exceeds 7 days.
5. **Price changes** → take effect on swap; budget gates follow live
   prices. Sudden increases may trigger existing `onBudgetWarning`
   callbacks — intended.
6. **Schema compatibility** → datasets with `schemaVersion` higher than
   the router supports are rejected (snapshot fallback). Old router
   versions keep working on their snapshot indefinitely.
7. **Bricking guard** → a candidate dataset is rejected entirely if it
   would retire *all* hops of any default alias chain that currently
   has at least one available hop. The previous dataset stays active
   and a warning is logged.
8. **Local providers** (Ollama et al.) are never in the dataset and are
   always treated as available — the data layer cannot disable local
   chains.

## 8. Testing

1. **Unit** (node:test, deterministic with injected clock/fetcher):
   - schema validation incl. rejection of unknown `schemaVersion`
   - atomicity of the swap (no mid-request mutation)
   - retired-hop filtering in `resolveModel`
   - carryover/unknown semantics
   - bricking guard (dataset retiring all hops of an active chain)
   - poller scheduling, fetch failure → keep previous, offline fallback
2. **CI contract**: the publishing job self-checks — every `available`
   entry is API-verified (else `unknown`), JSON validates before
   publish, and the release asset URL is fetch-tested.
3. **Integration**: run the Page Studio 21-case generator benchmark
   against a router build with live data (the autoresearch harness in
   Dynamic-Site-Builder/scripts/autoresearch serves as the regression
   test).
4. **Incident regression**: the gemini-2.5 retirement is replayed with
   a test dataset; the chain must silently skip the retired models.

## 9. Rollout

1. Ship as router **0.21.0** (new module + pricing.json + CI workflow).
2. Bump **Page Studio first** (incident owner; its chain comparison is
   run by then), then cc-code, cc-os, and remaining consumers per the
   existing consumer-bump practice.
3. Opt-out is per-consumer (`CCO_MODEL_DATA_REFRESH_HOURS=0`); no
   forced migration.
4. Phase 2 (follow-up, out of scope here): cc-os retirement alerts and
   approval-gated chain-change proposals.
