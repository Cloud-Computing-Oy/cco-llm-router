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
