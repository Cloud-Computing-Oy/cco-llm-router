import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackModel } from './fallback';
import {
  setBudgetHooks,
  withBudgetContext,
  type ReserveHookInput,
  type SettleHookInput,
} from './budget-hooks';
import { withServedCandidate } from './served';

type AnyModel = {
  doGenerate: (options: unknown) => Promise<unknown>;
  doStream: (options: unknown) => Promise<unknown>;
};

function candidate(provider: string, modelId: string, model: AnyModel) {
  return { label: modelId, provider, modelId, model };
}

function hooksRecorder() {
  const reserves: ReserveHookInput[] = [];
  const settles: SettleHookInput[] = [];
  setBudgetHooks({
    reserve: async (input) => {
      reserves.push(input);
      return { reservationId: `r-${reserves.length}`, upperBoundUsd: 0.1 };
    },
    settle: async (input) => {
      settles.push(input);
    },
  });
  return { reserves, settles };
}

test('managed calls reserve before every candidate and settle both outcomes', async () => {
  const recorded = hooksRecorder();
  try {
    const first = candidate('deepseek', 'deepseek-flash', {
      doGenerate: async () => {
        throw new Error('429 rate limit');
      },
      doStream: async () => {
        throw new Error('429 rate limit');
      },
    });
    const second = candidate('google', 'gemini-2.5-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 4 }, outputTokens: { total: 5 } } }),
      doStream: async () => ({ stream: new ReadableStream() }),
    });
    const model = createFallbackModel([first, second] as never);
    const { served } = await withBudgetContext({ taskId: 'task-1', phase: 'artifact' }, () =>
      withServedCandidate(() => model.doGenerate({} as never)),
    );
    assert.equal(served?.model, 'gemini-2.5-flash');
    assert.equal(recorded.reserves.length, 2);
    assert.equal(recorded.reserves[0].candidateId, 'deepseek:deepseek-flash#0#1');
    assert.equal(recorded.reserves[1].candidateId, 'google:gemini-2.5-flash#1#2');
    assert.equal(recorded.settles.length, 2);
    assert.equal(recorded.settles[0].usage, null);
    assert.equal(recorded.settles[0].served?.served, false);
    assert.deepEqual(recorded.settles[1].usage, { inputTokens: 4, outputTokens: 5 });
    assert.equal(recorded.settles[1].served?.served, true);
  } finally {
    setBudgetHooks(undefined);
  }
});

test('a failed reservation prevents the provider call', async () => {
  let calls = 0;
  setBudgetHooks({
    reserve: async () => {
      throw new Error('budget exceeded');
    },
    settle: async () => undefined,
  });
  try {
    const model = createFallbackModel([
      candidate('deepseek', 'deepseek-flash', {
        doGenerate: async () => {
          calls++;
          return {};
        },
        doStream: async () => {
          calls++;
          return { stream: new ReadableStream() };
        },
      }),
    ] as never);
    await assert.rejects(
      () =>
        withBudgetContext({ taskId: 'task-2', phase: 'artifact' }, () =>
          Promise.resolve(model.doGenerate({} as never)),
        ),
      /budget exceeded/,
    );
    assert.equal(calls, 0);
  } finally {
    setBudgetHooks(undefined);
  }
});

test('hooks without a budget context fail closed; no hooks leaves routing unchanged', async () => {
  setBudgetHooks({
    reserve: async () => ({ reservationId: 'r', upperBoundUsd: 0.1 }),
    settle: async () => undefined,
  });
  const managed = createFallbackModel([
    candidate('deepseek', 'deepseek-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }),
      doStream: async () => ({ stream: new ReadableStream() }),
    }),
  ] as never);
  try {
    await assert.rejects(() => Promise.resolve(managed.doGenerate({} as never)), /budget context puuttuu/);
  } finally {
    setBudgetHooks(undefined);
  }

  const unmanaged = createFallbackModel([
    candidate('deepseek', 'deepseek-flash', {
      doGenerate: async () => ({ usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }),
      doStream: async () => ({ stream: new ReadableStream() }),
    }),
  ] as never);
  await assert.doesNotReject(() => Promise.resolve(unmanaged.doGenerate({} as never)));
});
