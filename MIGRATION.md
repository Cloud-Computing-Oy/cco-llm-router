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
| **page-studio** | Uses raw `openai` SDK (`new OpenAI()`, `openai.chat.completions.create(...)`) rather than the AI SDK abstraction. ~5–10 call sites in `server/routes.ts` + scripts. | Slice 18: rewrite each call as `resolveModel('auto:smart') → generateText({ model, … })`. |

## Not yet consumed — Python services

`@cloud-computing-oy/llm-router` is a Node-only package. The following CCO
services are Python and need a sibling Python package
(`cco-llm-router-py`) before they can adopt the same routing pattern:

- `ai-chatbot` (dev, FastAPI)
- `lexai-chatbot` (dev, FastAPI)
- `knowledge-assistant` (dev, FastAPI + RAG)
- `strategy-dashboard` (dev, likely Streamlit)

Suggested slice (when prioritised): publish `cco-llm-router` to PyPI
(or a private GitHub Packages PyPI mirror) with the same alias names
(`auto:smart`, `auto:translate`, etc.) and a `resolve_model()` API. Each
service migrates by importing it and replacing direct `openai`/`google`
SDK calls.

## Won't migrate (intentional)

| Service | Reason |
|---------|--------|
| **aisdr** | Only the autoresearch evaluation scripts (`scripts/autoresearch/*.ts`) call an LLM. Production runtime is direct DB / API integration. No router needed. |
| **invoicify-staging** | Uses Google **Genkit** framework, not the AI SDK. Migrating would be a framework swap, not a router swap. |
| **lakiapuri** | No LLM calls — knowledge base is markdown loaded via the NotebookLM bridge + naïve token-score search. |

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
