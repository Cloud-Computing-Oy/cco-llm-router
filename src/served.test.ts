import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFallbackModel } from './fallback';
import {
  errorClassOf,
  getServedCandidate,
  isRetryableClass,
  withServedCandidate,
} from './served';

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

test('stream telemetry is recorded once, at finish, with usage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-stream-'));
  const log = join(dir, 'served.jsonl');
  process.env.CCO_LLM_SERVED_LOG = log;
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', textDelta: 'hi' });
        controller.enqueue({
          type: 'finish',
          usage: { inputTokens: { total: 3 }, outputTokens: { total: 4 } },
        });
        controller.close();
      },
    });
    const only = candidate('only', 'deepseek', 'deepseek-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }),
      doStream: async () => ({ stream }),
    });
    const model = createFallbackModel([only] as never);
    const { result, served } = await withServedCandidate(() => model.doStream({} as never));
    assert.equal(served, undefined, 'the wrapper resolves when the stream object is returned');
    const reader = result.stream.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { served: boolean; usage?: { inputTokens: number } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].served, true);
    assert.deepEqual(lines[0].usage, { inputTokens: 3, outputTokens: 4 });
  } finally {
    delete process.env.CCO_LLM_SERVED_LOG;
  }
});

test('the second fallback pass numbers attempts after the chain length', async () => {
  process.env.CCO_LLM_FALLBACK_RETRY_DELAY_MS = '0';
  try {
    let calls = 0;
    const flaky = candidate('flaky', 'deepseek', 'deepseek-flash', {
      doGenerate: async () => {
        calls++;
        if (calls === 1) throw new Error('429 rate limit');
        return { usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
      },
      doStream: async () => ({ stream: new ReadableStream() }),
    });
    const model = createFallbackModel([flaky] as never);
    const { served } = await withServedCandidate(() => model.doGenerate({} as never));
    assert.equal(calls, 2);
    assert.equal(served?.attempt, 2, 'one-candidate chain: pass 2 starts at 1 + 1');
  } finally {
    delete process.env.CCO_LLM_FALLBACK_RETRY_DELAY_MS;
  }
});

test('a total failure carries the last attempt on the error', async () => {
  const first = candidate('first', 'deepseek', 'deepseek-flash', {
    doGenerate: async () => {
      throw new Error('permanent failure');
    },
    doStream: async () => {
      throw new Error('permanent failure');
    },
  });
  const model = createFallbackModel([first] as never);
  await assert.rejects(
    () => withServedCandidate(() => model.doGenerate({} as never)),
    (error: Error & { servedCandidate?: { served: boolean; attempt: number } }) => {
      assert.equal(error.servedCandidate?.served, false);
      assert.equal(error.servedCandidate?.attempt, 1);
      return true;
    },
  );
});

test('errorClassOf is stable for the common provider failures', () => {
  assert.equal(errorClassOf(new Error('429 rate limit')), 'rate_limit');
  assert.equal(errorClassOf(new Error('insufficient quota')), 'quota');
  assert.equal(errorClassOf(new Error('ETIMEDOUT')), 'timeout');
  assert.equal(errorClassOf(new Error('ECONNRESET')), 'network');
  assert.equal(errorClassOf(new Error('service unavailable 503')), 'unavailable');
  assert.equal(errorClassOf(new Error('weird failure')), 'provider_error');
  assert.equal(isRetryableClass('unavailable'), true);
  assert.equal(isRetryableClass('provider_error'), false);
});

test('an in-band error part records a failed attempt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-err-'));
  const log = join(dir, 'served.jsonl');
  process.env.CCO_LLM_SERVED_LOG = log;
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'error', error: new Error('429 rate limit') });
        controller.close();
      },
    });
    const only = candidate('only', 'deepseek', 'deepseek-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }),
      doStream: async () => ({ stream }),
    });
    const model = createFallbackModel([only] as never);
    const { result } = await withServedCandidate(() => model.doStream({} as never));
    const reader = result.stream.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { served: boolean; errorClass?: string });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].served, false);
    assert.equal(lines[0].errorClass, 'rate_limit');
  } finally {
    delete process.env.CCO_LLM_SERVED_LOG;
  }
});

test('cancelling after a recorded finish does not overwrite the success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'served-cancel-'));
  const log = join(dir, 'served.jsonl');
  process.env.CCO_LLM_SERVED_LOG = log;
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'finish',
          usage: { inputTokens: { total: 3 }, outputTokens: { total: 4 } },
        });
      },
    });
    const only = candidate('only', 'deepseek', 'deepseek-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }),
      doStream: async () => ({ stream }),
    });
    const model = createFallbackModel([only] as never);
    const { result } = await withServedCandidate(() => model.doStream({} as never));
    const reader = result.stream.getReader();
    await reader.read(); // the finish part
    await reader.cancel('done');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { served: boolean });
    assert.equal(lines.length, 1, 'one candidate record, not a success plus an abort');
    assert.equal(lines[0].served, true);
  } finally {
    delete process.env.CCO_LLM_SERVED_LOG;
  }
});
