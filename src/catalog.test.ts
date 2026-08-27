import assert from 'node:assert/strict';
import test from 'node:test';

import { listCatalog } from './catalog';
import { createRouter } from './router';

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
    [{ provider: 'zai', model: 'glm-5' }],
  );
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
