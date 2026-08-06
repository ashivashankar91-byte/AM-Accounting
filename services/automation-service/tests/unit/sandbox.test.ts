/**
 * S022 — the rule simulation sandbox.
 *
 * The whole point of this capability is a negative: it must never post and
 * never mutate. The engine is therefore a pure function with no repository, no
 * posting client and no clock, and these tests assert both halves — that the
 * arithmetic and diffs are deterministic, and that the engine refuses an
 * evaluation context which even *exposes* a write surface.
 */

import { describe, it, expect } from 'vitest';
import {
  runSandboxSimulation, assertNoWriteSurface, SANDBOX_PROTECTED_SURFACES, SandboxRunInput,
} from '../../src/domain/sandbox-engine';

const RULES = [
  { ruleCode: 'R-PARTS', matchField: 'department', matchValue: 'PARTS', debitAccount: '5100', creditAccount: '2100' },
  { ruleCode: 'R-SERVICE', matchField: 'department', matchValue: 'SERVICE', debitAccount: '5200', creditAccount: '2100' },
];

const ROWS = [
  { sourceRef: 'INV-1', department: 'PARTS', amount: '100.00' },
  { sourceRef: 'INV-2', department: 'SERVICE', amount: '250.50' },
  { sourceRef: 'INV-3', department: 'BODY', amount: '75.00' },
];

function input(overrides: Partial<SandboxRunInput> = {}): SandboxRunInput {
  return { sandboxId: 'sbx-1', scenarioType: 'HISTORICAL_REPLAY', rulePackVersion: 'rp-1', rows: ROWS, rules: RULES, ...overrides };
}

describe('sandbox simulation', () => {
  it('produces one balanced journal per matched row and skips unmatched rows', () => {
    const out = runSandboxSimulation(input());
    expect(out.proposedJournals).toHaveLength(2);
    for (const j of out.proposedJournals) {
      const debit = j.lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = j.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(debit).toBeCloseTo(credit, 2);
    }
    expect(out.proposedJournals.map((j) => j.sourceRef)).toEqual(['INV-1', 'INV-2']);
  });

  it('applies rules in declaration order and stops at the first match', () => {
    const out = runSandboxSimulation(input({
      rules: [
        { ruleCode: 'FIRST', matchField: 'department', matchValue: 'PARTS', debitAccount: '1', creditAccount: '2' },
        { ruleCode: 'SECOND', matchField: 'department', matchValue: 'PARTS', debitAccount: '3', creditAccount: '4' },
      ],
      rows: [{ sourceRef: 'INV-1', department: 'PARTS', amount: '10.00' }],
    }));
    expect(out.proposedJournals).toHaveLength(1);
    expect(out.proposedJournals[0]!.ruleCode).toBe('FIRST');
    expect(out.ruleHits).toEqual([{ ruleCode: 'FIRST', hits: 1 }, { ruleCode: 'SECOND', hits: 0 }]);
  });

  it('is deterministic: two runs of the same scenario are byte-identical', () => {
    const a = runSandboxSimulation(input());
    const b = runSandboxSimulation(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.mutationProof.inputHash).toBe(b.mutationProof.inputHash);
    expect(a.mutationProof.outputHash).toBe(b.mutationProof.outputHash);
  });

  it('changes the input hash when the scenario changes, so a diff is attributable', () => {
    const a = runSandboxSimulation(input());
    const b = runSandboxSimulation(input({ rulePackVersion: 'rp-2' }));
    expect(a.mutationProof.inputHash).not.toBe(b.mutationProof.inputHash);
  });

  it('renders money to two decimal places and never as a float artefact', () => {
    const out = runSandboxSimulation(input({
      rows: [{ sourceRef: 'INV-9', department: 'PARTS', amount: 0.1 + 0.2 }],
    }));
    expect(out.proposedJournals[0]!.lines[0]!.debit).toBe('0.30');
  });

  it('treats a missing or non-numeric amount as zero rather than NaN', () => {
    const out = runSandboxSimulation(input({
      rows: [
        { sourceRef: 'A', department: 'PARTS' },
        { sourceRef: 'B', department: 'PARTS', amount: 'not-a-number' },
      ],
    }));
    expect(out.proposedJournals.map((j) => j.lines[0]!.debit)).toEqual(['0.00', '0.00']);
  });

  it('diffs the simulation against actual journals in both directions', () => {
    const out = runSandboxSimulation(input({
      actual: [
        { sourceRef: 'INV-1', ruleCode: 'ACTUAL', lines: [{ accountCode: '5100', debit: '100.00', credit: '0.00' }] },
        { sourceRef: 'INV-2', ruleCode: 'ACTUAL', lines: [{ accountCode: '5200', debit: '999.99', credit: '0.00' }] },
        { sourceRef: 'INV-8', ruleCode: 'ACTUAL', lines: [{ accountCode: '5300', debit: '5.00', credit: '0.00' }] },
      ],
    }));
    expect(out.diffVsActual.identical).toBe(1);
    expect(out.diffVsActual.amountDifferences).toEqual([
      { sourceRef: 'INV-2', simulated: '250.50', actual: '999.99' },
    ]);
    expect(out.diffVsActual.onlyInActual).toEqual(['INV-8']);
    expect(out.diffVsActual.onlyInSimulation).toEqual([]);
  });

  it('reports an empty diff, not an error, when there is nothing to compare against', () => {
    const out = runSandboxSimulation(input({ actual: [] }));
    expect(out.diffVsActual.onlyInSimulation).toEqual(['INV-1', 'INV-2']);
    expect(out.diffVsActual.identical).toBe(0);
    expect(out.diffVsActual.amountDifferences).toEqual([]);
  });

  it('handles an empty scenario without inventing journals', () => {
    const out = runSandboxSimulation(input({ rows: [] }));
    expect(out.proposedJournals).toEqual([]);
    expect(out.ruleHits.every((r) => r.hits === 0)).toBe(true);
  });

  it('always emits a mutation proof of zero postings and zero mutations', () => {
    const out = runSandboxSimulation(input());
    expect(out.mutationProof.postingsAttempted).toBe(0);
    expect(out.mutationProof.rowsMutated).toBe(0);
    expect(out.mutationProof.protectedSurfaces).toEqual(SANDBOX_PROTECTED_SURFACES);
    expect(out.mutationProof.statement).toContain('Zero postings were attempted');
  });

  it('names the CE-07 posting path among the surfaces it proves it did not touch', () => {
    expect(SANDBOX_PROTECTED_SURFACES.join(' ')).toContain('CE-07 governed posting');
    expect(SANDBOX_PROTECTED_SURFACES).toContain('automation_executions');
  });
});

describe('sandbox write-surface refusal', () => {
  it('accepts a context with no write surface', () => {
    expect(() => assertNoWriteSurface({ read: () => 1, rows: [] }, 'sbx-1')).not.toThrow();
    expect(() => assertNoWriteSurface(null, 'sbx-1')).not.toThrow();
    expect(() => assertNoWriteSurface(undefined, 'sbx-1')).not.toThrow();
    expect(() => assertNoWriteSurface('a string', 'sbx-1')).not.toThrow();
  });

  it('refuses a context carrying a posting client', () => {
    expect(() => assertNoWriteSurface({ post: () => 1 }, 'sbx-1')).toThrowError(/write surfaces/);
  });

  it('refuses a context carrying persistence methods', () => {
    for (const surface of ['create', 'update', 'delete', 'upsert', 'executeRaw']) {
      expect(() => assertNoWriteSurface({ [surface]: () => 1 }, 'sbx-1'), surface).toThrow();
    }
  });

  it('sees through the prototype chain, so a class instance cannot smuggle a writer in', () => {
    class Sneaky {
      read() { return 1; }
      createJournalEntry() { return 1; }
    }
    expect(() => assertNoWriteSurface(new Sneaky(), 'sbx-1')).toThrowError(/createJournalEntry/);
  });

  it('reports a typed refusal naming the sandbox and the offending surface', () => {
    try {
      assertNoWriteSurface({ post: () => 1 }, 'sbx-42');
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.name).toBe('SandboxMutationError');
      expect(JSON.stringify(err.details ?? {})).toContain('sbx-42');
    }
  });
});
