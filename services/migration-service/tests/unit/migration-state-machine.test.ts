import { describe, it, expect } from 'vitest';
import {
  MigrationState, MigrationMode, isValidTransition, assertTransitionAllowed, applyMigrationTransition,
  evaluateCutoverReadiness, isPrePromotionState, InvalidMigrationTransitionError,
  CutoverPrerequisiteError, MigrationSoDViolationError, CutoverReadinessInput,
} from '../../src/domain/migration-state-machine';

const satisfiedReadiness: CutoverReadinessInput = {
  allGatesPassed: true,
  unexplainedDiffs: 0,
  blockingExceptions: 0,
  freezeDeclared: true,
  deltaExtractionComplete: true,
  allComparisonPeriodsSignedOff: true,
  ce15ReadinessApproved: true,
  backupRestoreEvidence: true,
  rollbackPlanDemonstrated: true,
};

describe('migration state machine', () => {
  it('exposes every canonical CE-16 state', () => {
    expect(Object.values(MigrationState)).toEqual([
      'DISCOVERED', 'MAPPED', 'STAGED', 'VALIDATED', 'RECONCILED', 'READY_FOR_CUTOVER',
      'CUTOVER_IN_PROGRESS', 'CUTOVER_COMPLETE', 'ROLLED_BACK', 'MANUAL_REVIEW_REQUIRED',
    ]);
  });

  it('exposes the three run modes', () => {
    expect(Object.values(MigrationMode).sort()).toEqual(['CUTOVER', 'PARALLEL', 'REHEARSAL']);
  });

  it('allows the forward path through the happy sequence', () => {
    const path = [
      MigrationState.DISCOVERED, MigrationState.MAPPED, MigrationState.STAGED, MigrationState.VALIDATED,
      MigrationState.RECONCILED, MigrationState.READY_FOR_CUTOVER, MigrationState.CUTOVER_IN_PROGRESS,
      MigrationState.CUTOVER_COMPLETE,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(isValidTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('refuses to skip validation on the way to cutover', () => {
    expect(isValidTransition(MigrationState.STAGED, MigrationState.READY_FOR_CUTOVER)).toBe(false);
    expect(() => assertTransitionAllowed(MigrationState.STAGED, MigrationState.CUTOVER_COMPLETE))
      .toThrow(InvalidMigrationTransitionError);
  });

  it('treats CUTOVER_COMPLETE as terminal apart from rollback', () => {
    expect(isValidTransition(MigrationState.CUTOVER_COMPLETE, MigrationState.STAGED)).toBe(false);
    expect(isValidTransition(MigrationState.CUTOVER_COMPLETE, MigrationState.ROLLED_BACK)).toBe(true);
  });

  it('treats ROLLED_BACK as fully terminal', () => {
    for (const state of Object.values(MigrationState)) {
      expect(isValidTransition(MigrationState.ROLLED_BACK, state)).toBe(false);
    }
  });

  it('classifies pre-promotion states', () => {
    expect(isPrePromotionState(MigrationState.DISCOVERED)).toBe(true);
    expect(isPrePromotionState(MigrationState.VALIDATED)).toBe(true);
    expect(isPrePromotionState(MigrationState.CUTOVER_COMPLETE)).toBe(false);
  });
});

describe('cutover readiness evaluation', () => {
  it('reports no unmet prerequisites when everything is satisfied', () => {
    expect(evaluateCutoverReadiness(satisfiedReadiness)).toEqual([]);
  });

  it.each([
    ['allGatesPassed', { allGatesPassed: false }],
    ['unexplainedDiffs', { unexplainedDiffs: 3 }],
    ['blockingExceptions', { blockingExceptions: 1 }],
    ['freezeDeclared', { freezeDeclared: false }],
    ['deltaExtractionComplete', { deltaExtractionComplete: false }],
    ['allComparisonPeriodsSignedOff', { allComparisonPeriodsSignedOff: false }],
    ['ce15ReadinessApproved', { ce15ReadinessApproved: false }],
    ['backupRestoreEvidence', { backupRestoreEvidence: false }],
    ['rollbackPlanDemonstrated', { rollbackPlanDemonstrated: false }],
  ])('reports %s as unmet when it is not satisfied', (_label, override) => {
    const unmet = evaluateCutoverReadiness({ ...satisfiedReadiness, ...override } as CutoverReadinessInput);
    expect(unmet.length).toBeGreaterThan(0);
  });

  it('reports every unmet prerequisite at once rather than the first', () => {
    const unmet = evaluateCutoverReadiness({
      allGatesPassed: false, unexplainedDiffs: 2, blockingExceptions: 1, freezeDeclared: false,
      deltaExtractionComplete: false, allComparisonPeriodsSignedOff: false, ce15ReadinessApproved: false,
      backupRestoreEvidence: false, rollbackPlanDemonstrated: false,
    });
    expect(unmet).toHaveLength(9);
  });
});

describe('applyMigrationTransition', () => {
  it('blocks READY_FOR_CUTOVER while any prerequisite is unmet', () => {
    expect(() => applyMigrationTransition(
      MigrationState.RECONCILED, MigrationState.READY_FOR_CUTOVER,
      { actor: 'user-a', readiness: { ...satisfiedReadiness, unexplainedDiffs: 1 } },
    )).toThrow(CutoverPrerequisiteError);
  });

  it('permits READY_FOR_CUTOVER once every prerequisite is met', () => {
    expect(applyMigrationTransition(
      MigrationState.RECONCILED, MigrationState.READY_FOR_CUTOVER,
      { actor: 'user-a', readiness: satisfiedReadiness },
    )).toBe(MigrationState.READY_FOR_CUTOVER);
  });

  it('refuses to start cutover when the preparer is also the approver', () => {
    expect(() => applyMigrationTransition(
      MigrationState.READY_FOR_CUTOVER, MigrationState.CUTOVER_IN_PROGRESS,
      { actor: 'user-a', cutoverApproval: { preparedBy: 'user-a', approvedBy: 'user-a' } },
    )).toThrow(MigrationSoDViolationError);
  });

  it('refuses to start cutover with no recorded approver at all', () => {
    expect(() => applyMigrationTransition(
      MigrationState.READY_FOR_CUTOVER, MigrationState.CUTOVER_IN_PROGRESS,
      { actor: 'user-a', cutoverApproval: { preparedBy: 'user-a', approvedBy: null } },
    )).toThrow(CutoverPrerequisiteError);
  });

  it('starts cutover when preparer and approver are distinct identities', () => {
    expect(applyMigrationTransition(
      MigrationState.READY_FOR_CUTOVER, MigrationState.CUTOVER_IN_PROGRESS,
      { actor: 'user-b', cutoverApproval: { preparedBy: 'user-a', approvedBy: 'user-b' } },
    )).toBe(MigrationState.CUTOVER_IN_PROGRESS);
  });

  it('allows MANUAL_REVIEW_REQUIRED from any working state', () => {
    for (const from of [MigrationState.DISCOVERED, MigrationState.MAPPED, MigrationState.STAGED, MigrationState.VALIDATED]) {
      expect(applyMigrationTransition(from, MigrationState.MANUAL_REVIEW_REQUIRED, { actor: 'user-a' }))
        .toBe(MigrationState.MANUAL_REVIEW_REQUIRED);
    }
  });
});
