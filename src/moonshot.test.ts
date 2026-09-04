import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALIASES, createRouter } from './router';
import { estimateCostUSD, priceOf } from './pricing';

test('Kimi K3 ships in the top-tier default chains', () => {
  for (const alias of ['auto:smart', 'auto:reasoning', 'auto:big', 'auto:paid']) {
    assert.equal(
      DEFAULT_ALIASES[alias].some((spec) => spec.provider === 'moonshot' && spec.model === 'kimi-k3'),
      true,
      alias,
    );
  }
  // Cost-sensitive chains stay clear of Kimi K3's $3/$15 price point.
  for (const alias of ['auto:fast', 'auto:translate', 'auto:code', 'auto:cheap', 'auto:local']) {
    assert.equal(
      DEFAULT_ALIASES[alias].some((spec) => spec.provider === 'moonshot'),
      false,
      alias,
    );
  }
});

test('Kimi K3 resolves without any opt-in flag', () => {
  const router = createRouter();
  const key = { perCallKeys: { moonshot: 'test-key' } };
  assert.deepEqual(router.resolveModel('family:kimi', key).specs, [
    { provider: 'moonshot', model: 'kimi-k3' },
  ]);
  assert.deepEqual(router.resolveModel('moonshot:kimi-k3', key).specs, [
    { provider: 'moonshot', model: 'kimi-k3' },
  ]);
});

test('Moonshot supports BYOK without a process-level key', () => {
  const router = createRouter();
  const resolved = router.resolveModel('auto:kimi-pilot', {
    perCallKeys: { moonshot: 'test-key' },
  });

  assert.deepEqual(resolved.specs, [{ provider: 'moonshot', model: 'kimi-k3' }]);
  const model = resolved.model as { provider?: string; modelId?: string };
  assert.equal(model.provider, 'openai.chat');
  assert.equal(model.modelId, 'kimi-k3');
});

test('Kimi K3 uses conservative cache-miss pricing', () => {
  assert.deepEqual(priceOf('moonshot', 'kimi-k3'), { inputPerM: 3, outputPerM: 15 });
  assert.equal(estimateCostUSD('moonshot', 'kimi-k3', 1_000_000, 1_000_000), 18);
});
