import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFallbackModel } from './fallback';
import { errorClassOf, getServedCandidate, withServedCandidate } from './served';

type AnyModel = {
  doGenerate: (options: unknown) => Promise<unknown>;
  doStream: (options: unknown) => Promise<unknown>;
};

function candidate(label: string, provider: string, modelId: string, model: AnyModel) {
  return { label, provider, modelId, model };
}

test('the served candidate is the one that answered, not the chain head', async () => {
  const first = candidate('first', 'deepseek', 'deepseek-flash', {
    doGenerate: async () => {
      throw new Error('429 rate limit');
    },
    doStream: async () => {
      throw new Error('429 rate limit');
    },
  });
  const second = candidate('second', 'deepseek', 'deepseek-v4-pro', {
    doGenerate: async () => ({
      usage: { inputTokens: { total: 11 }, outputTokens: { total: 7 } },
    }),
    doStream: async () => ({ stream: new ReadableStream() }),
  });

  const model = createFallbackModel([first, second] as never);
  const { served } = await withServedCandidate(() => model.doGenerate({} as never));
  assert.ok(served);
  assert.equal(served!.chainIndex, 1);
  assert.equal(served!.attempt, 2);
  assert.equal(served!.served, true);
  assert.equal(served!.provider, 'deepseek');
  assert.equal(served!.model, 'deepseek-v4-pro');
  assert.deepEqual(served!.usage, { inputTokens: 11, outputTokens: 7 });
  assert.equal(getServedCandidate(), undefined, 'outside the wrapper the value is gone');
});

test('CCO_LLM_SERVED_LOG records failed attempts and the served candidate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-log-'));
  const log = join(dir, 'served.jsonl');
  process.env.CCO_LLM_SERVED_LOG = log;
  try {
    const first = candidate('first', 'deepseek', 'deepseek-flash', {
      doGenerate: async () => {
        throw new Error('rate limit 429');
      },
      doStream: async () => {
        throw new Error('rate limit 429');
      },
    });
    const second = candidate('second', 'google', 'gemini-2.5-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 1 }, outputTokens: { total: 2 } } }),
      doStream: async () => ({ stream: new ReadableStream() }),
    });
    const model = createFallbackModel([first, second] as never);
    await withServedCandidate(() => model.doGenerate({} as never));
    const lines = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { served: boolean; errorClass?: string; model: string });
    assert.equal(lines.length, 2);
    assert.equal(lines[0].served, false);
    assert.equal(lines[0].errorClass, 'rate_limit');
    assert.equal(lines[1].served, true);
    assert.equal(lines[1].model, 'gemini-2.5-flash');
  } finally {
    delete process.env.CCO_LLM_SERVED_LOG;
  }
});

test('errorClassOf is stable for the common provider failures', () => {
  assert.equal(errorClassOf(new Error('429 rate limit')), 'rate_limit');
  assert.equal(errorClassOf(new Error('insufficient quota')), 'quota');
  assert.equal(errorClassOf(new Error('ETIMEDOUT')), 'timeout');
  assert.equal(errorClassOf(new Error('ECONNRESET')), 'network');
  assert.equal(errorClassOf(new Error('service unavailable 503')), 'unavailable');
  assert.equal(errorClassOf(new Error('weird failure')), 'provider_error');
});
