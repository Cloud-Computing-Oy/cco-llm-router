import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireOllamaLease, resetOllamaGateForTests } from './ollama-gate';
import { DEFAULT_ALIASES } from './router';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.OLLAMA_BASE_URL;

test('uses the verified 8 GiB laptop model', () => {
  assert.deepEqual(DEFAULT_ALIASES['auto:laptop-assisted'], [
    { provider: 'ollama', model: 'qwen2.5:7b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' },
    { provider: 'google-paid', model: 'gemini-2.5-flash' },
  ]);
  assert.deepEqual(DEFAULT_ALIASES['auto:facf-laptop'], DEFAULT_ALIASES['auto:laptop-assisted']);
});

test('prioritizes DeepSeek for strong cloud routes', () => {
  for (const alias of ['auto:smart', 'auto:code', 'auto:reasoning', 'auto:big']) {
    assert.deepEqual(DEFAULT_ALIASES[alias][0], {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    });
  }
});

test('does not route to Groq models retired from free and developer tiers', () => {
  const groqModels = Object.values(DEFAULT_ALIASES)
    .flat()
    .filter((spec) => spec.provider === 'groq')
    .map((spec) => spec.model);
  assert.ok(groqModels.length > 0);
  assert.deepEqual(new Set(groqModels), new Set(['qwen/qwen3.6-27b']));
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBaseUrl;
  delete process.env.CCO_LLM_OLLAMA_CIRCUIT_OPEN_MS;
  delete process.env.CCO_LLM_OLLAMA_HEALTH_CACHE_MS;
  delete process.env.CCO_LLM_OLLAMA_MAX_CONCURRENT;
  resetOllamaGateForTests();
});

test('accepts one healthy intermittent worker', async () => {
  process.env.OLLAMA_BASE_URL = 'http://laptop.test:11434/';
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'http://laptop.test:11434/api/tags');
    return new Response('{"models":[{"name":"qwen2.5:7b"}]}', { status: 200 });
  };

  const lease = await acquireOllamaLease('qwen2.5:7b');
  assert.equal(await lease.run(async () => 'gpu-result'), 'gpu-result');
  lease.release();
});

test('opens the circuit after a failed health check', async () => {
  process.env.OLLAMA_BASE_URL = 'http://offline.test:11434';
  process.env.CCO_LLM_OLLAMA_CIRCUIT_OPEN_MS = '1000';
  let checks = 0;
  globalThis.fetch = async () => {
    checks += 1;
    throw new Error('offline');
  };

  await assert.rejects(acquireOllamaLease(), /health check failed/);
  await assert.rejects(acquireOllamaLease(), /circuit open/);
  assert.equal(checks, 1);
});

test('rejects excess concurrent work without queueing it', async () => {
  process.env.OLLAMA_BASE_URL = 'http://laptop.test:11434';
  process.env.CCO_LLM_OLLAMA_MAX_CONCURRENT = '1';
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const lease = await acquireOllamaLease();
  await assert.rejects(acquireOllamaLease(), /worker busy/);
  lease.release();
  const next = await acquireOllamaLease();
  next.release();
});

test('fails closed when the requested model is not installed', async () => {
  process.env.OLLAMA_BASE_URL = 'http://laptop.test:11434';
  globalThis.fetch = async () =>
    new Response('{"models":[{"name":"another-model:latest"}]}', { status: 200 });

  await assert.rejects(acquireOllamaLease('qwen2.5:7b'), /health check failed/);
});
