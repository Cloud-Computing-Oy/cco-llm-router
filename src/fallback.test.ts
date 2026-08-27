import assert from 'node:assert/strict';
import test from 'node:test';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import { createFallbackModel } from './fallback';

const options = {} as Parameters<LanguageModelV3['doGenerate']>[0];
const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function candidate(
  label: string,
  call: () => Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>>,
) {
  return {
    label,
    provider: 'deepseek' as const,
    modelId: label,
    model: {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: label,
      supportedUrls: {},
      doGenerate: call,
    } as unknown as LanguageModel,
  };
}

test('tries the whole chain after permanent and previously unknown provider errors', async () => {
  const calls: string[] = [];
  const model = createFallbackModel([
    candidate('gone', async () => {
      calls.push('gone');
      throw new Error('The model does not exist or you do not have access to it');
    }),
    candidate('auth', async () => {
      calls.push('auth');
      throw new Error('permission denied');
    }),
    candidate('working', async () => {
      calls.push('working');
      return {
        content: [],
        finishReason: { unified: 'stop', raw: undefined },
        usage: zeroUsage,
        warnings: [],
      };
    }),
  ]);

  await model.doGenerate(options);
  assert.deepEqual(calls, ['gone', 'auth', 'working']);
});

test('does not fall through after caller cancellation', async () => {
  const calls: string[] = [];
  const aborted = new Error('request aborted');
  aborted.name = 'AbortError';
  const model = createFallbackModel([
    candidate('cancelled', async () => {
      calls.push('cancelled');
      throw aborted;
    }),
    candidate('unused', async () => {
      calls.push('unused');
      return {
        content: [],
        finishReason: { unified: 'stop', raw: undefined },
        usage: zeroUsage,
        warnings: [],
      };
    }),
  ]);

  await assert.rejects(async () => model.doGenerate(options), { name: 'AbortError' });
  assert.deepEqual(calls, ['cancelled']);
});
