import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepseekModel } from './deepseek';

test('uses the chat-completions model adapter for tool-call compatible DeepSeek requests', () => {
  const model = deepseekModel('deepseek-chat', { apiKey: 'test-key' }) as unknown as { provider?: string; modelId?: string };
  assert.equal(model.provider, 'deepseek.chat');
  assert.equal(model.modelId, 'deepseek-chat');
});
