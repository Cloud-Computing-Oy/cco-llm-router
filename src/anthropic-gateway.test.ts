import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createClaudeChildEnvironment,
  listenAnthropicGateway,
  normalizeAnthropicPrompt,
  toModelMessages,
  type GatewayConfig,
  type GatewayGenerate,
} from './anthropic-gateway';

const config: GatewayConfig = {
  alias: 'auto:code',
  dataClass: 'internal',
  token: 'test-token',
  host: '127.0.0.1',
};

const generated = {
  text: 'done',
  toolCalls: [],
  finishReason: 'stop',
  usage: { inputTokens: 12, outputTokens: 3 },
};

const stub: GatewayGenerate = async () => generated;

test('keeps provider credentials in the gateway process, not the Claude child', () => {
  const child = createClaudeChildEnvironment(
    {
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'do-not-forward',
      GOOGLE_GENERATIVE_AI_API_KEY_2: 'do-not-forward',
      ANTHROPIC_API_KEY: 'do-not-forward',
    },
    'http://127.0.0.1:1234',
    'ephemeral',
  );
  assert.equal(child.PATH, '/usr/bin');
  assert.equal(child.OPENAI_API_KEY, undefined);
  assert.equal(child.GOOGLE_GENERATIVE_AI_API_KEY_2, undefined);
  assert.equal(child.ANTHROPIC_API_KEY, '');
  assert.equal(child.ANTHROPIC_AUTH_TOKEN, 'ephemeral');
  assert.equal(child.ANTHROPIC_BASE_URL, 'http://127.0.0.1:1234');
});

async function withGateway(
  generate: GatewayGenerate,
  fn: (baseUrl: string) => Promise<void>,
) {
  const { server, host, port } = await listenAnthropicGateway(config, generate);
  try {
    await fn(`http://${host}:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const request = {
  model: 'claude-sonnet-4-6',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'hello' }],
};

test('maps Anthropic text, tool calls, and tool results to AI SDK messages', () => {
  assert.deepEqual(
    toModelMessages([
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'contents' }],
      },
    ]),
    [
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          {
            type: 'tool-call',
            toolCallId: 'tool-1',
            toolName: 'Read',
            input: { file_path: 'a.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tool-1',
            toolName: 'Read',
            output: { type: 'text', value: 'contents' },
          },
        ],
      },
    ],
  );
});

test('removes late system messages from provider conversation history', () => {
  const prompt = normalizeAnthropicPrompt({
    model: 'claude-sonnet-5',
    max_tokens: 128,
    system: [{ type: 'text', text: 'primary instructions' }],
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'late metadata from Claude Code' },
    ],
  });
  assert.deepEqual(prompt.messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(prompt.system, 'primary instructions\n\nlate metadata from Claude Code');
});

test('keeps health public but requires the ephemeral token for API requests', async () => {
  await withGateway(stub, async (baseUrl) => {
    const hello = await fetch(`${baseUrl}/api/hello`, { method: 'HEAD' });
    assert.equal(hello.status, 200);
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', alias: 'auto:code' });

    const denied = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    assert.equal(denied.status, 401);
  });
});

test('returns an Anthropic-compatible non-streaming response', async () => {
  let observedAlias = '';
  await withGateway(
    async (_request, actualConfig) => {
      observedAlias = actualConfig.alias;
      return generated;
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/messages?beta=true`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.token,
        },
        body: JSON.stringify(request),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.type, 'message');
      assert.deepEqual(body.content, [{ type: 'text', text: 'done' }]);
      assert.deepEqual(body.usage, { input_tokens: 12, output_tokens: 3 });
      assert.equal(observedAlias, 'auto:code');
    },
  );
});

test('returns Anthropic SSE events including tool calls', async () => {
  await withGateway(
    async () => ({
      text: '',
      toolCalls: [{ toolCallId: 'tool-2', toolName: 'Bash', input: { command: 'pwd' } }],
      finishReason: 'tool-calls',
      usage: { inputTokens: 20, outputTokens: 8 },
    }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...request, stream: true }),
      });
      assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      const body = await response.text();
      assert.match(body, /event: message_start/);
      assert.match(body, /"type":"tool_use","id":"tool-2","name":"Bash"/);
      assert.match(body, /"partial_json":"{\\"command\\":\\"pwd\\"}"/);
      assert.match(body, /"stop_reason":"tool_use"/);
      assert.match(body, /event: message_stop/);
    },
  );
});

test('supports token counting without invoking a provider', async () => {
  let calls = 0;
  await withGateway(
    async () => {
      calls += 1;
      return generated;
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.token,
        },
        body: JSON.stringify(request),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { input_tokens: number };
      assert.ok(body.input_tokens > 0);
      assert.equal(calls, 0);
    },
  );
});
