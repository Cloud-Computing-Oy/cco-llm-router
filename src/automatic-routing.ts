import { classifyWithJev, jevRoutingEnabled } from './jev-routing';

export type TaskRisk = 'low' | 'standard' | 'high';
export type TaskKind = 'general' | 'light' | 'code' | 'reasoning' | 'large-context';

export type AutomaticRoutingInput = {
  system?: string;
  prompt: string;
  dataClass?: 'public' | 'synthetic' | 'internal' | 'confidential' | 'restricted';
  taskRisk?: TaskRisk;
  taskKind?: TaskKind;
};

const HIGH_RISK =
  /\b(legal|law|contract|tax|accounting|medical|diagnos|investment|financial advice|security|credential|production|deploy|migration|delete|oikeud|laki|sopimu|vero|kirjanp|lääke|diagnoo|sijoitu|tietotur|tunnus|tuotanto|julkais|migraatio|poista)\w*/i;
const REASONING =
  /\b(reason|analyse|analyze|evaluate|strategy|architecture|audit|investigate|root cause|plan|päättele|analysoi|arvioi|strategia|arkkitehtuuri|auditoi|tutki|juurisyy|suunnittele)\w*/i;
const CODE = /\b(code|implement|function|class|typescript|python|sql|koodi|toteuta|funktio|luokka)\w*/i;

/**
 * Conservative, deterministic task routing. Explicit caller metadata wins;
 * prompt heuristics only keep obviously light work on the laptop.
 */
export function selectAutomaticAlias(input: AutomaticRoutingInput): string {
  const text = `${input.system ?? ''}\n${input.prompt}`;
  const dataClass = input.dataClass ?? 'internal';

  if (input.taskRisk === 'high' || HIGH_RISK.test(text)) return 'auto:reasoning';
  if (input.taskKind === 'reasoning') return 'auto:reasoning';
  if (input.taskKind === 'large-context' || input.prompt.length > 12_000) return 'auto:big';
  if (input.taskKind === 'code' || CODE.test(text)) return 'auto:code';
  if (dataClass !== 'public' && dataClass !== 'synthetic') return 'auto:smart';
  if (input.taskRisk === 'standard' && REASONING.test(text)) return 'auto:reasoning';
  if (REASONING.test(text)) return 'auto:smart';
  return 'auto:facf-laptop';
}

/**
 * Async variant that adds an optional, default-off Jev second opinion for the
 * one ambiguous case: the auto:facf-laptop fallback. When Jev is disabled,
 * unconfigured, slow, or wrong, the result is identical to the synchronous
 * classifier. The model cannot weaken data isolation: the deterministic
 * function only reaches the laptop fallback for public or synthetic data, so
 * internal, confidential, and restricted prompts are never sent to Jev.
 */
export async function selectAutomaticAliasAsync(
  input: AutomaticRoutingInput,
  opts?: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const deterministic = selectAutomaticAlias(input);
  if (deterministic !== 'auto:facf-laptop' || !jevRoutingEnabled(opts?.env ?? process.env)) {
    return deterministic;
  }
  const jev = await classifyWithJev(input, opts);
  return jev ? jev.alias : deterministic;
}
