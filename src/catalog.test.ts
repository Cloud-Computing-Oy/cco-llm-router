import assert from 'node:assert/strict';
import test from 'node:test';

import { listCatalog } from './catalog';
import { createRouter, DEFAULT_ALIASES } from './router';

test('catalog covers every supported open-model family', () => {
  const families = new Set(listCatalog().map((entry) => entry.family));
  assert.deepEqual(
    [...families].sort(),
    ['gemma', 'glm', 'kimi', 'llama', 'minimax', 'mistral', 'nemotron', 'qwen'],
  );
});

test('family routing fails closed when only unknown-price models remain', () => {
  const router = createRouter();
  const perCallKeys = { zai: 'test-key' };
  assert.throws(
    () => router.resolveModel('family:glm', { perCallKeys }),
    /No reviewed-price provider.*allowUnknownPricing=true/,
  );
  assert.deepEqual(
    router.resolveModel('family:glm', { perCallKeys, allowUnknownPricing: true }).specs,
    [{ provider: 'zai', model: 'glm-5.3-flash' }],
  );
});

test('GLM Flash has task-specific priority without entering specialist chains', () => {
  const router = createRouter();
  const options = { perCallKeys: { zai: 'test-key' }, allowUnknownPricing: true };
  assert.deepEqual(router.resolveModel('auto:glm-flash-pilot', options).specs, [
    { provider: 'zai', model: 'glm-5.3-flash' },
  ]);
  assert.deepEqual(router.resolveModel('family:glm', options).specs, [
    { provider: 'zai', model: 'glm-5.3-flash' },
  ]);

  for (const alias of ['auto:smart', 'auto:code', 'auto:big']) {
    assert.deepEqual(DEFAULT_ALIASES[alias][1], {
      provider: 'zai',
      model: 'glm-5.3-flash',
    });
  }
  assert.deepEqual(DEFAULT_ALIASES['auto:reasoning'][2], {
    provider: 'zai',
    model: 'glm-5.3-flash',
  });

  for (const alias of ['auto:fast', 'auto:translate', 'auto:cheap', 'auto:paid']) {
    assert.equal(
      DEFAULT_ALIASES[alias].some((spec) => spec.provider === 'zai'),
      false,
      alias,
    );
  }
});

test('future direct models on new providers require an explicit pricing override', () => {
  const router = createRouter();
  const perCallKeys = { nvidia: 'test-key' };
  assert.throws(
    () => router.resolveModel('nvidia:future-model', { perCallKeys }),
    /Pricing is not reviewed.*allowUnknownPricing=true/,
  );
});

test('Qwen family keeps the reviewed free route ahead of paid fallback', () => {
  const router = createRouter();
  const resolved = router.resolveModel('family:qwen', {
    perCallKeys: { groq: 'test-key', dashscope: 'test-key' },
  });
  assert.deepEqual(resolved.specs, [{ provider: 'groq', model: 'qwen/qwen3.6-27b' }]);
});
