import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { selectAutomaticAliasAsync, type AutomaticRoutingInput } from './automatic-routing';
import { resolveAutomaticAlias } from './helpers';
import { __clearJevCache } from './jev-routing';

const ENV_KEYS = [
  'CCO_ROUTER_JEV',
  'TYPESAFE_API_KEY',
  'TYPESAFE_API_URL',
  'TYPESAFE_MODEL',
  'CCO_LLM_JEV_TIMEOUT_MS',
] as const;

const AUTH = 'Bearer test-key';

const LAPTOP: AutomaticRoutingInput = { prompt: 'Summarise this short note.', dataClass: 'public' };

type StubReply = { status: number; body: string } | 'hang';

type Stub = {
  url: string;
  requests: () => number;
  problems: () => string[];
  close: () => Promise<void>;
};

async function startStub(reply: (body: Record<string, unknown>) => StubReply): Promise<Stub> {
  let count = 0;
  const problems: string[] = [];
  const server = createServer((req, res) => {
    count += 1;
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        problems.push('request body was not valid JSON');
      }
      if (req.headers.authorization !== AUTH) {
        problems.push(`unexpected authorization header: ${String(req.headers.authorization)}`);
      }
      if (body.model !== 'jev-latest') {
        problems.push(`unexpected model: ${String(body.model)}`);
      }
      const questions = body.questions as Record<string, unknown> | undefined;
      if (!questions || !('route' in questions) || !('high_risk' in questions)) {
        problems.push('request is missing the route and/or high_risk questions');
      }
      if (problems.length > 0) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      const out = reply(body);
      if (out === 'hang') return; // never respond: exercise the client timeout
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/v1/systemone`,
    requests: () => count,
    problems: () => problems,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function withStub(
  reply: (body: Record<string, unknown>) => StubReply,
  env: Record<string, string>,
  fn: (stub: Stub) => Promise<void>,
): Promise<void> {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  __clearJevCache();

  const stub = await startStub(reply);
  process.env.TYPESAFE_API_URL = stub.url;
  try {
    await fn(stub);
    // Every request the stub saw must have carried the expected model,
    // questions and bearer token.
    assert.deepEqual(stub.problems(), []);
  } finally {
    __clearJevCache();
    await stub.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const jevBody = (choice: string, probability: number, noul = 0.1): string =>
  JSON.stringify({
    model: 'jev-1.13.0',
    answers: {
      route: {
        type: 'choice',
        choice,
        confidence: probability,
        probabilities: {
          'auto:facf-laptop': 1 - probability,
          'auto:code': probability,
          'auto:smart': 0,
          'auto:reasoning': 0,
          'auto:big': 0,
        },
      },
      high_risk: { type: 'noul', noul },
    },
  });

const ENABLED = { CCO_ROUTER_JEV: '1', TYPESAFE_API_KEY: 'test-key' };

test('Jev stays off without CCO_ROUTER_JEV and the server sees no request', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.91) }), { TYPESAFE_API_KEY: 'test-key' }, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:facf-laptop');
    assert.equal(stub.requests(), 0);
  });
});

test('Jev stays off when TYPESAFE_API_KEY is missing and the server sees no request', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.91) }), { CCO_ROUTER_JEV: '1' }, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:facf-laptop');
    assert.equal(stub.requests(), 0);
  });
});

test('deterministic non-laptop routes never consult the server', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.91) }), ENABLED, async (stub) => {
    const cases: Array<[AutomaticRoutingInput, string]> = [
      [{ prompt: 'Review this tax calculation.' }, 'auto:reasoning'],
      [{ prompt: 'Implement a TypeScript function.' }, 'auto:code'],
      [{ prompt: 'x'.repeat(12_001) }, 'auto:big'],
      [{ prompt: 'Analyse this proposal.' }, 'auto:smart'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(await selectAutomaticAliasAsync(input), expected);
    }
    assert.equal(stub.requests(), 0);
  });
});

test('a confident Jev choice overrides the laptop fallback', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.91) }), ENABLED, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:code');
    assert.equal(stub.requests(), 1);
  });
});

test('a Jev choice below the probability floor falls back to the laptop', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.55) }), ENABLED, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:facf-laptop');
    assert.equal(stub.requests(), 1);
  });
});

test('a high-risk noul overrides a laptop choice', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:facf-laptop', 0.9, 0.8) }), ENABLED, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:reasoning');
    assert.equal(stub.requests(), 1);
  });
});

test('HTTP 500 falls back to the laptop', async () => {
  await withStub(() => ({ status: 500, body: '{}' }), ENABLED, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:facf-laptop');
    assert.equal(stub.requests(), 1);
  });
});

test('malformed JSON falls back to the laptop', async () => {
  await withStub(() => ({ status: 200, body: 'not-json' }), ENABLED, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:facf-laptop');
    assert.equal(stub.requests(), 1);
  });
});

test('a server that never responds within the timeout falls back to the laptop', async () => {
  await withStub(
    () => 'hang',
    { ...ENABLED, CCO_LLM_JEV_TIMEOUT_MS: '100' },
    async (stub) => {
      assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:facf-laptop');
      assert.equal(stub.requests(), 1);
    },
  );
});

test('the cache answers a repeated state without a second request', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.91) }), ENABLED, async (stub) => {
    assert.equal(await selectAutomaticAliasAsync(LAPTOP), 'auto:code');
    assert.equal(await selectAutomaticAliasAsync({ ...LAPTOP }), 'auto:code');
    assert.equal(stub.requests(), 1);
  });
});

test('chat alias resolution consults Jev when enabled', async () => {
  await withStub(() => ({ status: 200, body: jevBody('auto:code', 0.91) }), ENABLED, async (stub) => {
    assert.equal(
      await resolveAutomaticAlias({ system: '', prompt: 'Summarise this short note.', dataClass: 'public' }),
      'auto:code',
    );
    assert.equal(stub.requests(), 1);
    assert.deepEqual(stub.problems(), []);

    delete process.env.CCO_ROUTER_JEV;
    __clearJevCache();

    assert.equal(
      await resolveAutomaticAlias({ system: '', prompt: 'Summarise this short note.', dataClass: 'public' }),
      'auto:facf-laptop',
    );
    assert.equal(stub.requests(), 1);
  });
});
