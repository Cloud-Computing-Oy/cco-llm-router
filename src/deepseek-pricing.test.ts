import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateCostUSD, effectivePrice, priceOf } from './pricing';

// DeepSeek julkaisi V4.1 Flashin 2026-09-10: off-peak $0.15 in / $0.6 out,
// peak $0.3 / $1.2. Peak-ikkunat ovat UTC: 01–04 ja 06–10, ma–pe.
// 2026-09-10 on torstai, 2026-09-12 lauantai.
const PEAK_INSIDE = new Date('2026-09-10T02:00:00Z');
const OFF_PEAK_INSIDE = new Date('2026-09-10T12:00:00Z');
const OFF_PEAK = { inputPerM: 0.15, outputPerM: 0.6 };
const PEAK = { inputPerM: 0.3, outputPerM: 1.2 };

test('V4.1 Flash list price carries DeepSeek published off-peak and peak rates', () => {
  assert.deepEqual(priceOf('deepseek', 'deepseek-flash'), { ...OFF_PEAK, peak: PEAK });
});

test('legacy deepseek-v4-flash id is priced as V4.1 Flash', () => {
  assert.deepEqual(priceOf('deepseek', 'deepseek-v4-flash'), { ...OFF_PEAK, peak: PEAK });
});

test('redirected deepseek-v4-pro id is priced as V4.1 Flash', () => {
  assert.deepEqual(priceOf('deepseek', 'deepseek-v4-pro'), { ...OFF_PEAK, peak: PEAK });
});

test('effectivePrice returns off-peak rates outside peak windows', () => {
  assert.deepEqual(effectivePrice('deepseek', 'deepseek-flash', OFF_PEAK_INSIDE), OFF_PEAK);
});

test('effectivePrice returns peak rates inside a peak window', () => {
  assert.deepEqual(effectivePrice('deepseek', 'deepseek-flash', PEAK_INSIDE), PEAK);
});

test('peak windows are half-open at both UTC boundaries', () => {
  const cases: Array<[string, typeof PEAK]> = [
    ['2026-09-10T01:00:00Z', PEAK], // window start is peak
    ['2026-09-10T04:00:00Z', OFF_PEAK], // window end is off-peak
    ['2026-09-10T06:00:00Z', PEAK], // second window start
    ['2026-09-10T10:00:00Z', OFF_PEAK], // second window end
  ];
  for (const [instant, expected] of cases) {
    assert.deepEqual(effectivePrice('deepseek', 'deepseek-flash', new Date(instant)), expected, instant);
  }
});

test('weekends are off-peak regardless of hour', () => {
  assert.deepEqual(effectivePrice('deepseek', 'deepseek-flash', new Date('2026-09-12T02:00:00Z')), OFF_PEAK);
  assert.deepEqual(effectivePrice('deepseek', 'deepseek-flash', new Date('2026-09-13T07:00:00Z')), OFF_PEAK);
});

test('providers without peak rates are unaffected by peak windows', () => {
  assert.deepEqual(effectivePrice('moonshot', 'kimi-k3', PEAK_INSIDE), { inputPerM: 3, outputPerM: 15 });
  assert.equal(priceOf('moonshot', 'kimi-k3').peak, undefined);
});

test('estimateCostUSD bills the rate in effect at the call instant', () => {
  assert.equal(estimateCostUSD('deepseek', 'deepseek-flash', 1_000_000, 1_000_000, OFF_PEAK_INSIDE), 0.75);
  assert.equal(estimateCostUSD('deepseek', 'deepseek-flash', 1_000_000, 1_000_000, PEAK_INSIDE), 1.5);
});
