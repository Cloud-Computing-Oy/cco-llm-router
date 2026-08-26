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
    return new Response('{}', { status: 200 });
  };

  const lease = await acquireOllamaLease();
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
