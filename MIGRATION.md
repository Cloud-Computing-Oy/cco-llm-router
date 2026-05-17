# Migration status

How CCO services consume `@cloud-computing-oy/llm-router` over time.

## Consumed

| Service | Repo | Notes |
|---------|------|-------|
| `expat-aivozone` | Cloud-Computing-Oy/expat-aivozone | First adopter (Slice 16). Uses `auto:smart`, `auto:fast`, `auto:translate`. |
| `cc-code` (Portfolio Tracker) | Cloud-Computing-Oy/cc-code | Slice 16 Phase 1a. Local router removed, all `resolveModel` imports point to the package. |

## Not yet consumed — Node services

| Service | Blocker | Estimated slice |
|---------|---------|-----------------|
| **LexAI** | LexAI is built on **raw provider SDKs** (`@anthropic-ai/sdk`) and Google **Genkit** (`@genkit-ai/google-genai`), not the Vercel AI SDK. Adopting `@cloud-computing-oy/llm-router` requires **also** pulling in `ai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai` + `ai-sdk-ollama` and rewriting the existing 392-line local `llm-router.ts` from raw-SDK calls to the adapter pattern. The shared package's `chat({ alias, system, prompt })` / `chatJson<T>({...})` helpers (v0.3.0) match LexAI's public API so the 26 call sites in `src/ai/flows/` stay untouched, but the deps + Dockerfile + compose secret + next.config wiring is real surface area. Best done as its own focused slice with side-by-side smoke testing on each affected legal flow since LexAI is in production use by lawyers. | Future slice — see [LexAI's llm-router.ts](https://github.com/Cloud-Computing-Oy/lexai-web/blob/main/web/src/lib/llm-router.ts) and [adapter template](https://github.com/Cloud-Computing-Oy/cco-llm-router/blob/main/MIGRATION.md#lexai-adapter-template) below. |
| **page-studio** | Uses raw `openai` SDK (6 chat-completion + 2 image-generation calls in `server/routes.ts`). **Already routes at the env-var level** via `AI_INTEGRATIONS_OPENAI_BASE_URL` to OpenAI-compatible endpoints. Migrating to the shared router would change its routing contract from env-vars to code-level, and AI SDK doesn't cover image generation as cleanly. | Future slice — only if env-var routing proves insufficient. Key rotation already works via `/etc/cco/keys.env`. |

## Python services — already have framework-level routing

The sibling [`cco-llm-router-py`](https://github.com/Cloud-Computing-Oy/cco-llm-router-py)
v0.1.0 exists as a foundation for new Python services. Investigation of
the existing CCO Python services reveals they all already use
**LangChain/LangGraph** as their LLM framework:

| Service | Framework |
|---------|-----------|
| `ai-chatbot` (dev) | LangGraph + `ChatOpenAI` / `ChatAnthropic` |
| `lexai-chatbot` (dev) | LangGraph + `ChatAnthropic` / `ChatGoogleGenerativeAI` / `ChatOllama` / `ChatOpenAI` |
| `knowledge-assistant` (dev) | LangGraph agents |
| `strategy-dashboard` (dev) | Likely LangChain (image-based, pending source inspection) |

LangChain is itself a routing framework. Replacing it with
`cco-llm-router-py`'s `resolve_model()` API would mean rewriting the
LangGraph state machines, not a router swap.

**These services don't need migration.** They already benefit from
centralized key management via `/etc/cco/keys.env` — LangChain reads
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENAI_API_KEY`, etc.
from the shared file mounted into their containers.

`cco-llm-router-py` v0.1.0 remains available for any **future** Python
service that prefers raw SDKs over a framework, or for a future
LangChain-replacement pass.

## Won't migrate (intentional)

| Service | Reason |
|---------|--------|
| **aisdr** | Only the autoresearch evaluation scripts (`scripts/autoresearch/*.ts`) call an LLM. Production runtime is direct DB / API integration. No router needed. |
| **invoicify-staging** | Uses Google **Genkit** framework, not the AI SDK. Migrating would be a framework swap, not a router swap. |
| **lakiapuri** | No LLM calls — knowledge base is markdown loaded via the NotebookLM bridge + naïve token-score search. |

## Bottom line

The architectural goal was **one place to rotate API keys, propagating
to every service**. That goal is fully achieved via
`/etc/cco/keys.env` + `cco-sync-keys-to-dev`. Whether each service
routes through a shared JS package, LangChain, Genkit, env-var routing,
or its own custom router is downstream code style — *all* of them read
their provider env vars from the same `/etc/cco/keys.env` file.

Two services (`expat-aivozone`, `cc-code`) additionally consume the
shared `@cloud-computing-oy/llm-router` for code reuse and unified
alias semantics. The remaining services have framework-level routing
of their own; migrating them away would be a code rewrite, not
infrastructure cleanup.

## LexAI adapter template

When LexAI's migration is scheduled, replace `web/src/lib/llm-router.ts`
with this thin adapter (the existing 392-line file's logic moves into
the shared package). All 26 call sites under `src/ai/flows/` and
`src/app/api/chatbot/` keep their existing imports.

```ts
// web/src/lib/llm-router.ts (after migration)
import {
  chat as routerChat,
  chatJson as routerChatJson,
} from '@cloud-computing-oy/llm-router';

export type LLMProfile = 'chat' | 'light' | 'batch' | 'contract';

export interface LLMRequest {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  profile?: LLMProfile;
}

const PROFILE_ALIAS: Record<LLMProfile, string> = {
  chat: 'auto:fast',
  light: 'auto:fast',
  batch: 'auto:translate',
  contract: 'auto:smart',
};

export async function generateText(req: LLMRequest): Promise<string> {
  return routerChat({
    alias: PROFILE_ALIAS[req.profile ?? 'chat'],
    system: req.system,
    prompt: req.prompt,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
  });
}

export async function generateJson<T>(req: LLMRequest): Promise<T | null> {
  return routerChatJson<T>({
    alias: PROFILE_ALIAS[req.profile ?? 'chat'],
    system: req.system,
    prompt: req.prompt,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
  });
}
```

Required parallel changes on the LexAI side:

1. `web/package.json` adds:
   `"@cloud-computing-oy/llm-router": "^0.3.0"`,
   `"ai": "^6.0.177"`, `"@ai-sdk/anthropic": "^3.0.78"`,
   `"@ai-sdk/google": "^3.0.72"`, `"@ai-sdk/openai": "^3.0.63"`,
   `"ai-sdk-ollama": "^3.8.4"`.
2. `web/.npmrc` mapping `@cloud-computing-oy` to GH Packages.
3. `web/next.config.ts` adds
   `transpilePackages: ['@cloud-computing-oy/llm-router']`.
4. `deploy/Dockerfile` mounts `npm_token` secret on the install + build
   stages (same pattern expat-aivozone uses).
5. `deploy/docker-compose.yml` declares the `npm_token` secret pointing
   to `/etc/cco/github-packages-token`.
6. Cohere rerank: LexAI already calls `rerank-v4.0-pro` directly via
   the official Cohere SDK; the shared package exports a `rerank()`
   helper at `@cloud-computing-oy/llm-router/cohere` that LexAI can
   optionally adopt to remove that direct dep.
7. Smoke-test each flow (`argumentation-generator`, `memo-writer`,
   `source-researcher`, `fact-identifier`, the 14 contract generators,
   the chatbot route) before declaring done.
