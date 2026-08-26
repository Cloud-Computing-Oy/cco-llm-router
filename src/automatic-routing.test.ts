import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAutomaticAlias } from './automatic-routing';

test('routes ordinary short work to the opportunistic laptop', () => {
  assert.equal(selectAutomaticAlias({ prompt: 'Summarise this short note.' }), 'auto:laptop-assisted');
});

test('keeps high-risk and reasoning work on stronger routes', () => {
  assert.equal(selectAutomaticAlias({ prompt: 'Review this tax calculation.' }), 'auto:reasoning');
  assert.equal(
    selectAutomaticAlias({ prompt: 'Compare options.', taskRisk: 'high' }),
    'auto:reasoning',
  );
  assert.equal(selectAutomaticAlias({ prompt: 'Analyse this proposal.' }), 'auto:smart');
});

test('routes large context and code away from the small laptop model', () => {
  assert.equal(selectAutomaticAlias({ prompt: 'x'.repeat(12_001) }), 'auto:big');
  assert.equal(selectAutomaticAlias({ prompt: 'Implement a TypeScript function.' }), 'auto:code');
});

test('does not automatically send confidential data to a fallback cloud chain', () => {
  assert.equal(
    selectAutomaticAlias({ prompt: 'Rewrite this.', dataClass: 'confidential' }),
    'auto:smart',
  );
});
