/**
 * Cohere Rerank wrapper. Reranking is a separate API surface from chat
 * generation, so it lives outside the LanguageModel/router abstraction.
 * Most CCO services use it to refine top-K from a vector search before
 * passing chunks into the answer LLM.
 *
 *   import { rerank } from '@cco/llm-router/cohere';
 *   const top = await rerank({
 *     query: 'family reunification visa for non-EU spouse',
 *     documents: pgvectorChunks.map(c => c.text),
 *     topN: 5,
 *   });
 */

const COHERE_API = 'https://api.cohere.com/v2';

export type RerankParams = {
  query: string;
  documents: string[];
  topN?: number;
  model?: string;
};

export type RerankResult = {
  index: number;
  relevanceScore: number;
};

export const cohereAvailable = Boolean(process.env.COHERE_API_KEY);

export async function rerank(params: RerankParams): Promise<RerankResult[]> {
  const key = process.env.COHERE_API_KEY;
  if (!key) throw new Error('COHERE_API_KEY not set');
  if (params.documents.length === 0) return [];

  const res = await fetch(`${COHERE_API}/rerank`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model ?? 'rerank-v4.0-pro',
      query: params.query,
      documents: params.documents,
      top_n: params.topN ?? params.documents.length,
    }),
  });
  if (!res.ok) {
    throw new Error(`cohere rerank ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    results: Array<{ index: number; relevance_score: number }>;
  };
  return data.results.map((r) => ({ index: r.index, relevanceScore: r.relevance_score }));
}
