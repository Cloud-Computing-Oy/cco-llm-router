import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAutomaticAlias } from './automatic-routing';
import { createRouter } from './router';

test('routes only public or synthetic short work to the FACF laptop', () => {
  assert.equal(selectAutomaticAlias({ prompt: 'Summarise this short note.' }), 'auto:smart');
  assert.equal(
    selectAutomaticAlias({ prompt: 'Summarise this short note.', dataClass: 'public' }),
    'auto:facf-laptop',
  );
  assert.equal(
    selectAutomaticAlias({ prompt: 'Summarise this short note.', dataClass: 'synthetic' }),
    'auto:facf-laptop',
  );
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

test('explicit FACF laptop aliases fail closed for internal data', () => {
  const router = createRouter();
  assert.throws(
    () => router.resolveModel('auto:facf-laptop', { dataClass: 'internal' }),
    /only dataClass="public" or "synthetic"/,
  );
  assert.throws(
    () => router.resolveModel('auto:laptop-assisted'),
    /only dataClass="public" or "synthetic"/,
  );
});
