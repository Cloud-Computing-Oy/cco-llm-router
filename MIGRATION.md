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
| **LexAI** | Different API surface — uses `generateText(LLMRequest)` / `generateJson<T>(LLMRequest)` rather than `resolveModel(alias) + generateText(model, …)`. 26 call sites. Cohere `rerank` already in the shared package, but LexAI's `callCohere` chat helper isn't. | Slice 17: add `generateText` / `generateJson` convenience helpers to `@cloud-computing-oy/llm-router` that match LexAI's request shape; then mechanical search/replace on the 26 imports. |
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
