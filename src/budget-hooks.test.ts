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
  return { label: modelId, provider, modelId, model: { specificationVersion: 'v4', ...model } };
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

test('a reservation failure aborts the chain without recording a provider failure', async () => {
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
      candidate('google', 'gemini-2.5-flash', {
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
        withBudgetContext({ taskId: 'task-3', phase: 'artifact' }, () =>
          Promise.resolve(model.doGenerate({} as never)),
        ),
      /budget exceeded/,
    );
    assert.equal(calls, 0);
  } finally {
    setBudgetHooks(undefined);
  }
});

test('a settle failure on the success path is surfaced once and does not retry', async () => {
  let providerCalls = 0;
  let settleCalls = 0;
  setBudgetHooks({
    reserve: async () => ({ reservationId: `r-${providerCalls}`, upperBoundUsd: 1 }),
    settle: async () => {
      settleCalls++;
      throw new Error('ledger down');
    },
  });
  try {
    const model = createFallbackModel([
      candidate('deepseek', 'deepseek-flash', {
        doGenerate: async () => {
          providerCalls++;
          return { usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
        },
        doStream: async () => ({ stream: new ReadableStream() }),
      }),
      candidate('google', 'gemini-2.5-flash', {
        doGenerate: async () => {
          providerCalls++;
          return {};
        },
        doStream: async () => ({ stream: new ReadableStream() }),
      }),
    ] as never);
    await assert.rejects(
      () =>
        withBudgetContext({ taskId: 'task-4', phase: 'artifact' }, () =>
          Promise.resolve(model.doGenerate({} as never)),
        ),
      /ledger down/,
    );
    assert.equal(providerCalls, 1);
    assert.equal(settleCalls, 1);
  } finally {
    setBudgetHooks(undefined);
  }
});

test('stream settle is once at finish, once on missing finish, and once on error', async () => {
  let settles = 0;
  setBudgetHooks({
    reserve: async () => ({ reservationId: 'r-stream', upperBoundUsd: 1 }),
    settle: async () => {
      settles++;
    },
  });
  try {
    const finishStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', textDelta: 'hi' });
        controller.enqueue({
          type: 'finish',
          usage: { inputTokens: { total: 3 }, outputTokens: { total: 4 } },
        });
        controller.close();
      },
    });
    const finishModel = createFallbackModel([
      candidate('deepseek', 'deepseek-flash', {
        doGenerate: async () => ({}),
        doStream: async () => ({ stream: finishStream }),
      }),
    ] as never);
    const finishResult = await withBudgetContext({ taskId: 'task-5', phase: 'artifact' }, () =>
      finishModel.doStream({} as never),
    );
    const finishReader = finishResult.stream.getReader();
    for (;;) {
      if ((await finishReader.read()).done) break;
    }
    finishReader.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settles, 1);

    settles = 0;
    const missingFinish = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', textDelta: 'hi' });
        controller.close();
      },
    });
    const missingModel = createFallbackModel([
      candidate('deepseek', 'deepseek-flash', {
        doGenerate: async () => ({}),
        doStream: async () => ({ stream: missingFinish }),
      }),
    ] as never);
    const missingResult = await withBudgetContext({ taskId: 'task-6', phase: 'artifact' }, () =>
      missingModel.doStream({} as never),
    );
    const missingReader = missingResult.stream.getReader();
    for (;;) {
      if ((await missingReader.read()).done) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settles, 1);
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

test('direct routes take the managed wrapper only while budget hooks are installed', async () => {
  const { createRouter } = await import('./router');
  const router = createRouter();
  const opts = { perCallKeys: { deepseek: 'sk-test' } };
  assert.notEqual((router.resolveModel('deepseek:deepseek-flash', opts).model as { provider?: string }).provider, 'fallback');
  const recorded = hooksRecorder();
  try {
    assert.equal((router.resolveModel('deepseek:deepseek-flash', opts).model as { provider?: string }).provider, 'fallback');
    assert.equal(recorded.reserves.length, 0, 'resolution alone must not reserve');
  } finally {
    setBudgetHooks(undefined);
  }
});

test('single-candidate alias routes take the managed wrapper while hooks are installed', async () => {
  const { createRouter } = await import('./router');
  const router = createRouter({
    aliases: { 'test-single': [{ provider: 'deepseek', model: 'deepseek-flash' }] },
  });
  const opts = { perCallKeys: { deepseek: 'sk-test' } };
  assert.notEqual((router.resolveModel('test-single', opts).model as { provider?: string }).provider, 'fallback');
  hooksRecorder();
  try {
    assert.equal((router.resolveModel('test-single', opts).model as { provider?: string }).provider, 'fallback');
  } finally {
    setBudgetHooks(undefined);
  }
});

test('direct routes take the managed wrapper when the caller opts in', async () => {
  setBudgetHooks(undefined);
  const { createRouter } = await import('./router');
  const router = createRouter();
  const opts = { perCallKeys: { deepseek: 'sk-test' } };
  assert.notEqual((router.resolveModel('deepseek:deepseek-flash', opts).model as { provider?: string }).provider, 'fallback');
  const managed = router.resolveModel('deepseek:deepseek-flash', { ...opts, managedTelemetry: true });
  assert.equal((managed.model as { provider?: string }).provider, 'fallback');
});

test('single-candidate alias routes take the managed wrapper when the caller opts in', async () => {
  setBudgetHooks(undefined);
  const { createRouter } = await import('./router');
  const router = createRouter({ aliases: { 'test-single': [{ provider: 'deepseek', model: 'deepseek-flash' }] } });
  const opts = { perCallKeys: { deepseek: 'sk-test' } };
  assert.notEqual((router.resolveModel('test-single', opts).model as { provider?: string }).provider, 'fallback');
  const managed = router.resolveModel('test-single', { ...opts, managedTelemetry: true });
  assert.equal((managed.model as { provider?: string }).provider, 'fallback');
});
