import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALIASES, createRouter } from './router';
import { estimateCostUSD, priceOf } from './pricing';

test('Kimi K3 is available only through the explicit pilot alias', () => {
  assert.deepEqual(DEFAULT_ALIASES['auto:kimi-pilot'], [
    { provider: 'moonshot', model: 'kimi-k3' },
  ]);

  for (const [alias, chain] of Object.entries(DEFAULT_ALIASES)) {
    if (alias === 'auto:kimi-pilot') continue;
    assert.equal(chain.some((spec) => spec.provider === 'moonshot'), false, alias);
  }
});

test('Moonshot supports BYOK without a process-level key', () => {
  const router = createRouter();
  const resolved = router.resolveModel('auto:kimi-pilot', {
    perCallKeys: { moonshot: 'test-key' },
  });

  assert.deepEqual(resolved.specs, [{ provider: 'moonshot', model: 'kimi-k3' }]);
});

test('Kimi K3 uses conservative cache-miss pricing', () => {
  assert.deepEqual(priceOf('moonshot', 'kimi-k3'), { inputPerM: 3, outputPerM: 15 });
  assert.equal(estimateCostUSD('moonshot', 'kimi-k3', 1_000_000, 1_000_000), 18);
});
