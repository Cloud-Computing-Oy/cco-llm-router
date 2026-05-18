#!/usr/bin/env node
/**
 * cco-llm-usage — print current month's per-provider spend and budget status.
 *
 *   $ npx cco-llm-usage
 *
 *     Month: 2026-05  Total: $4.27
 *
 *     provider       calls   in_tokens   out_tokens   cost      budget   used
 *     ────────────────────────────────────────────────────────────────────────
 *     deepinfra      214     1,820,114   612,003      $0.66    $20.00    3%
 *     google-paid    61      412,000     88,200       $0.06    $10.00    1%
 *     anthropic      9       18,000      4,200        $3.54     $5.00   71%
 *     openai         3       2,100       1,800        $0.01     $5.00    0%
 *     ────────────────────────────────────────────────────────────────────────
 *                                                       Used:   $4.27 / $50.00
 *
 * Exits 1 if any provider is over its budget cap. Useful for cron alerts.
 */
import { getCurrentMonthSpend } from '../usage';
import { getBudgetUSD } from '../budget';
import type { Provider } from '../types';

const PROVIDERS: Provider[] = [
  'anthropic',
  'openai',
  'google',
  'google-paid',
  'groq',
  'openrouter',
  'ollama',
  'deepinfra',
  'together',
];

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

const { month, totalUSD, perProvider } = getCurrentMonthSpend();

let totalBudget = 0;
let overBudget = false;

console.log(`Month: ${month}  Total: ${fmtUSD(totalUSD)}\n`);
console.log(
  'provider'.padEnd(14) +
    'calls'.padStart(8) +
    'in_tokens'.padStart(14) +
    'out_tokens'.padStart(14) +
    'cost'.padStart(10) +
    'budget'.padStart(10) +
    'used'.padStart(8),
);
console.log('─'.repeat(78));

for (const p of PROVIDERS) {
  const u = perProvider[p];
  const cap = getBudgetUSD(p);
  totalBudget += cap;
  if (!u && cap === 0) continue;
  const spent = u?.costUSD ?? 0;
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
  if (cap > 0 && spent >= cap) overBudget = true;
  console.log(
    p.padEnd(14) +
      fmtInt(u?.calls ?? 0).padStart(8) +
      fmtInt(u?.inputTokens ?? 0).padStart(14) +
      fmtInt(u?.outputTokens ?? 0).padStart(14) +
      fmtUSD(spent).padStart(10) +
      (cap > 0 ? fmtUSD(cap) : '-').padStart(10) +
      (cap > 0 ? `${pct}%` : '-').padStart(8),
  );
}

console.log('─'.repeat(78));
console.log(
  `${' '.repeat(60)}Used: ${fmtUSD(totalUSD)}${totalBudget > 0 ? ` / ${fmtUSD(totalBudget)}` : ''}`,
);

process.exit(overBudget ? 1 : 0);
