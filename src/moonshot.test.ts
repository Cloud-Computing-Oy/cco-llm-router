import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALIASES, createRouter } from './router';
import { estimateCostUSD, priceOf } from './pricing';

test('Kimi K3 is available only through explicit pilot routes', () => {
  assert.deepEqual(DEFAULT_ALIASES['auto:kimi-pilot'], [
    { provider: 'moonshot', model: 'kimi-k3' },
  ]);

  for (const [alias, chain] of Object.entries(DEFAULT_ALIASES)) {
    if (alias === 'auto:kimi-pilot' || alias === 'family:kimi') continue;
    assert.equal(chain.some((spec) => spec.provider === 'moonshot'), false, alias);
  }
});

test('Kimi family route keeps the public-data pilot guard', () => {
  const router = createRouter();
  const key = { perCallKeys: { moonshot: 'test-key' } };
  assert.throws(() => router.resolveModel('family:kimi', key), /explicit public-data pilot/);
  assert.deepEqual(
    router.resolveModel('family:kimi', {
      ...key,
      allowPilot: true,
      dataClass: 'public',
    }).specs,
    [{ provider: 'moonshot', model: 'kimi-k3' }],
  );
});

test('Moonshot supports BYOK without a process-level key', () => {
  const router = createRouter();
  const resolved = router.resolveModel('auto:kimi-pilot', {
    perCallKeys: { moonshot: 'test-key' },
    allowPilot: true,
    dataClass: 'public',
  });

  assert.deepEqual(resolved.specs, [{ provider: 'moonshot', model: 'kimi-k3' }]);
  const model = resolved.model as { provider?: string; modelId?: string };
  assert.equal(model.provider, 'openai.chat');
  assert.equal(model.modelId, 'kimi-k3');
});

test('Moonshot pilot fails closed without public-data opt-in', () => {
  const router = createRouter();
  const key = { perCallKeys: { moonshot: 'test-key' } };

  assert.throws(
    () => router.resolveModel('auto:kimi-pilot', key),
    /explicit public-data pilot/,
  );
  assert.throws(
    () =>
      router.resolveModel('moonshot:kimi-k3', {
        ...key,
        allowPilot: true,
        dataClass: 'confidential',
      }),
    /explicit public-data pilot/,
  );
});

test('Kimi K3 uses conservative cache-miss pricing', () => {
  assert.deepEqual(priceOf('moonshot', 'kimi-k3'), { inputPerM: 3, outputPerM: 15 });
  assert.equal(estimateCostUSD('moonshot', 'kimi-k3', 1_000_000, 1_000_000), 18);
});
