#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClaudeChildEnvironment, listenAnthropicGateway } from '../anthropic-gateway';

const allowedDataClasses = ['public', 'synthetic', 'internal', 'confidential', 'restricted'] as const;

async function main() {
  const alias = process.env.CCO_CLAUDE_ROUTER_ALIAS ?? 'auto:code';
  const dataClass = process.env.CCO_CLAUDE_ROUTER_DATA_CLASS ?? 'internal';
  if (!allowedDataClasses.includes(dataClass as (typeof allowedDataClasses)[number])) {
    throw new Error(`Invalid CCO_CLAUDE_ROUTER_DATA_CLASS: ${dataClass}`);
  }

  const token = randomBytes(32).toString('hex');
  const { server, host, port } = await listenAnthropicGateway({
    alias,
    dataClass: dataClass as (typeof allowedDataClasses)[number],
    token,
  });

  const child = spawn(process.env.CCO_CLAUDE_COMMAND ?? 'claude', process.argv.slice(2), {
    stdio: 'inherit',
    env: createClaudeChildEnvironment(process.env, `http://${host}:${port}`, token),
  });

  const stop = (signal: NodeJS.Signals) => child.kill(signal);
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  process.exitCode = exitCode;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
