/**
 * CE-17 S022 — The sandbox's structural guarantee.
 *
 * A simulation must be incapable of touching the world, not merely
 * well-behaved about it. The sandbox runs against a frozen input set through a
 * port surface that has no write methods on it at all, and every run emits a
 * mutation proof enumerating the write surfaces it did not reach.
 *
 * If a caller ever hands the runner something that looks like a live writer,
 * `assertNoWriteSurface` refuses the run rather than trusting it to behave.
 */

import { createHash } from 'crypto';
import { SandboxMutationError } from './errors';

/** Names that would indicate a live mutation capability leaked into a run. */
const FORBIDDEN_SURFACES = [
  'post', 'create', 'update', 'delete', 'upsert', 'write', 'save',
  'executeRaw', 'queryRaw', 'commit', 'approveJournalEntry',
];

export const SANDBOX_PROTECTED_SURFACES = [
  'CE-07 governed posting',
  'GL journal entries',
  'CE-08 schedules / open items',
  'CE-09 AP / AR / cash records',
  'automation_items',
  'automation_executions',
];

export function assertNoWriteSurface(context: unknown, sandboxId: string): void {
  if (context === null || context === undefined) return;
  if (typeof context !== 'object' && typeof context !== 'function') return;
  const surface = new Set<string>();
  let cursor: any = context;
  while (cursor && cursor !== Object.prototype) {
    Object.getOwnPropertyNames(cursor).forEach((n) => surface.add(n));
    cursor = Object.getPrototypeOf(cursor);
  }
  const offending = [...surface].filter((name) =>
    FORBIDDEN_SURFACES.some((f) => name.toLowerCase() === f.toLowerCase() || name.toLowerCase().startsWith(f.toLowerCase())));
  if (offending.length > 0) {
    throw new SandboxMutationError(
      `Sandbox run refused: the supplied evaluation context exposes write surfaces [${offending.join(', ')}].`,
      { sandboxId, offending },
    );
  }
}

export interface SimulatedJournalLine {
  accountCode: string;
  debit: string;
  credit: string;
  memo?: string;
}

export interface SimulatedJournal {
  sourceRef: string;
  ruleCode: string;
  lines: SimulatedJournalLine[];
}

export interface SandboxRunInput {
  sandboxId: string;
  scenarioType: string;
  rulePackVersion: string | null;
  /** Frozen scenario rows. Never read live during a run. */
  rows: Record<string, unknown>[];
  /** Deterministic rule definitions: match on a field value, emit lines. */
  rules: {
    ruleCode: string;
    matchField: string;
    matchValue: string;
    debitAccount: string;
    creditAccount: string;
  }[];
  /** Actual journals to diff against, when replaying history. */
  actual?: SimulatedJournal[];
}

export interface SandboxRunOutput {
  proposedJournals: SimulatedJournal[];
  ruleHits: { ruleCode: string; hits: number }[];
  diffVsActual: {
    onlyInSimulation: string[];
    onlyInActual: string[];
    amountDifferences: { sourceRef: string; simulated: string; actual: string }[];
    identical: number;
  };
  mutationProof: {
    postingsAttempted: 0;
    rowsMutated: 0;
    protectedSurfaces: string[];
    inputHash: string;
    outputHash: string;
    statement: string;
  };
}

function money(value: unknown): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function journalTotal(j: SimulatedJournal): string {
  const total = j.lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  return total.toFixed(2);
}

/**
 * Pure. Takes rows and rules, returns proposed journals and a diff. It has no
 * repository, no client and no clock, which is precisely why it cannot post.
 * Rules are applied in declaration order so two runs of the same scenario
 * produce byte-identical output.
 */
export function runSandboxSimulation(input: SandboxRunInput): SandboxRunOutput {
  const proposedJournals: SimulatedJournal[] = [];
  const ruleHits = input.rules.map((r) => ({ ruleCode: r.ruleCode, hits: 0 }));

  input.rows.forEach((row, index) => {
    for (let i = 0; i < input.rules.length; i += 1) {
      const rule = input.rules[i]!;
      if (String(row[rule.matchField] ?? '') !== rule.matchValue) continue;
      ruleHits[i]!.hits += 1;
      const amount = money(row['amount']);
      proposedJournals.push({
        sourceRef: String(row['sourceRef'] ?? `row-${index}`),
        ruleCode: rule.ruleCode,
        lines: [
          { accountCode: rule.debitAccount, debit: amount, credit: '0.00', memo: `SIMULATED ${rule.ruleCode}` },
          { accountCode: rule.creditAccount, debit: '0.00', credit: amount, memo: `SIMULATED ${rule.ruleCode}` },
        ],
      });
      break;
    }
  });

  const actual = input.actual ?? [];
  const simByRef = new Map(proposedJournals.map((j) => [j.sourceRef, j]));
  const actByRef = new Map(actual.map((j) => [j.sourceRef, j]));

  const onlyInSimulation = [...simByRef.keys()].filter((k) => !actByRef.has(k)).sort();
  const onlyInActual = [...actByRef.keys()].filter((k) => !simByRef.has(k)).sort();
  const amountDifferences: { sourceRef: string; simulated: string; actual: string }[] = [];
  let identical = 0;
  [...simByRef.keys()].sort().forEach((ref) => {
    const a = actByRef.get(ref);
    if (!a) return;
    const s = simByRef.get(ref)!;
    const simTotal = journalTotal(s);
    const actTotal = journalTotal(a);
    if (simTotal === actTotal) identical += 1;
    else amountDifferences.push({ sourceRef: ref, simulated: simTotal, actual: actTotal });
  });

  const output = { proposedJournals, ruleHits, diffVsActual: { onlyInSimulation, onlyInActual, amountDifferences, identical } };

  return {
    ...output,
    mutationProof: {
      postingsAttempted: 0,
      rowsMutated: 0,
      protectedSurfaces: SANDBOX_PROTECTED_SURFACES,
      inputHash: stableHash({ rows: input.rows, rules: input.rules, rulePackVersion: input.rulePackVersion }),
      outputHash: stableHash(output),
      statement:
        'This simulation ran against a frozen input set through a read-only evaluator with no posting client, ' +
        'no repository handle and no transaction. Zero postings were attempted and zero rows were mutated.',
    },
  };
}
