import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordUsage } from './usage';

test('usage state is private and valid after an atomic write', () => {
  const root = mkdtempSync(join(tmpdir(), 'cco-router-usage-'));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    recordUsage('moonshot', 'kimi-k3', 100, 20);
    const state = join(root, 'cco-llm-router', 'usage.json');
    const parsed = JSON.parse(readFileSync(state, 'utf8')) as { providers: object };
    assert.ok(parsed.providers);
    assert.equal(statSync(state).mode & 0o077, 0);
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
