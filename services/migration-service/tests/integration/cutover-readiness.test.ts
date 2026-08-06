/**
 * Cutover readiness. Cutover is irreversible domain authority, so the gate in
 * front of it is nine explicit prerequisites and a dual-identity ceremony.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, stageAndValidate, driveToReadyForCutover,
  BALANCED_TB_ROWS, TENANT, LE, OPERATOR, APPROVER, CONTROLLER,
} from '../helpers/service-harness';

const STATEMENT_MISMATCH = 'I think this is probably fine';

describe('readiness reporting', () => {
  it('reports every unmet prerequisite on a fresh run rather than just the first', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const readiness = await s.runService.computeReadiness(TENANT, run.runId);
    expect(readiness.unmet.length).toBeGreaterThan(1);
    expect(readiness.ready).toBe(false);
  });

  it('does not auto-advance a run just because its gates passed', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('VALIDATED');
  });

  it('refuses READY_FOR_CUTOVER while prerequisites are unmet', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.runService.transition(TENANT, run.runId, 'RECONCILED', CONTROLLER, 'Reconciliation reviewed');
    await expect(s.runService.transition(TENANT, run.runId, 'READY_FOR_CUTOVER', CONTROLLER, 'forcing'))
      .rejects.toThrow(/prerequisites not met/i);
  });

  it('records the freeze attestation with its author before it counts', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const before = await s.runService.computeReadiness(TENANT, run.runId);
    expect(before.unmet).toContain('FREEZE_NOT_ATTESTED');

    await s.runService.attestFreeze(TENANT, run.runId, CONTROLLER, 'Legacy frozen at 2025-12-31T23:59:59Z');
    const after = await s.runService.computeReadiness(TENANT, run.runId);
    expect(after.unmet).not.toContain('FREEZE_NOT_ATTESTED');
    expect((await s.runService.get(TENANT, run.runId)).frozenAt).toBeTruthy();
  });

  it('requires delta extraction after the freeze', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    expect((await s.runService.computeReadiness(TENANT, run.runId)).unmet).toContain('DELTA_EXTRACTION_INCOMPLETE');
    await s.runService.markDeltaComplete(TENANT, run.runId, OPERATOR, 'SNAP-DELTA-001');
    expect((await s.runService.computeReadiness(TENANT, run.runId)).unmet).not.toContain('DELTA_EXTRACTION_INCOMPLETE');
  });

  it('requires backup and rollback-plan evidence supplied at preparation', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const readiness = await s.runService.computeReadiness(TENANT, run.runId);
    expect(readiness.unmet).toContain('BACKUP_RESTORE_EVIDENCE_MISSING');
    expect(readiness.unmet).toContain('ROLLBACK_PLAN_NOT_DEMONSTRATED');
  });

  it('reaches READY_FOR_CUTOVER only once every prerequisite is genuinely satisfied', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const readiness = await s.runService.computeReadiness(TENANT, run.runId);
    expect(readiness.unmet).toEqual([]);
    expect(readiness.ready).toBe(true);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('READY_FOR_CUTOVER');
  });

  it('reports the CE-15 close readiness source truthfully', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    const readiness = await s.runService.computeReadiness(TENANT, run.runId);
    expect(readiness.ce15Detail).toBeTruthy();
  });

  it('blocks readiness when CE-15 withholds close approval', async () => {
    const s = makeServices();
    s.h.closeReadiness.approved = false;
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.runService.attestFreeze(TENANT, run.runId, CONTROLLER, 'Legacy source frozen at 2025-12-31T23:59:59Z');
    await s.runService.markDeltaComplete(TENANT, run.runId, OPERATOR, 'SNAP-DELTA-001');
    expect((await s.runService.computeReadiness(TENANT, run.runId)).unmet).toContain('CE15_READINESS_NOT_APPROVED');
  });
});

describe('cutover ceremony', () => {
  it('publishes the irreversible-effect statement with the ceremony', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement, ceremony } = await s.cutoverService.getCeremony(TENANT, run.runId);
    expect(irreversibleEffectStatement).toMatch(/irreversible/i);
    expect(ceremony.state).toBe('PREPARED');
  });

  it('pins the freeze timestamp and transformation versions into the ceremony record', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { ceremony } = await s.cutoverService.getCeremony(TENANT, run.runId);
    expect(ceremony.freezeTimestamp).toBeTruthy();
    expect((ceremony.transformationVersions as string[]).length).toBeGreaterThan(0);
  });

  it('refuses final approval by the preparer', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
    await expect(s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: CONTROLLER, acknowledgedStatement: irreversibleEffectStatement,
    })).rejects.toThrow(/preparer|may not/i);
  });

  it('refuses approval when the acknowledged statement does not match', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    await expect(s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: STATEMENT_MISMATCH,
    })).rejects.toThrow(/statement/i);
  });

  it('accepts approval from a second identity that acknowledges the statement', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
    const approved = await s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
    });
    expect(approved.state).toBe('APPROVED');
    expect(approved.approverIdentity).toBe(APPROVER);
    expect(approved.preparedBy).toBe(CONTROLLER);
  });

  it('refuses approval before a ceremony has been prepared', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await expect(s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: 'anything',
    })).rejects.toThrow(/prepared/i);
  });

  it('refuses execution before approval', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    await expect(s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER }))
      .rejects.toThrow();
  });
});

describe('executing the cutover', () => {
  async function approveAndExecute(s: ReturnType<typeof makeServices>) {
    const { run } = await driveToReadyForCutover(s);
    const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
    await s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
    });
    const result = await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
    return { run, result };
  }

  it('completes the ceremony and the run', async () => {
    const s = makeServices();
    const { run, result } = await approveAndExecute(s);
    expect(result.state).toBe('COMPLETE');
    expect(result.idempotentReplay).toBe(false);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('CUTOVER_COMPLETE');
  });

  it('publishes cutover initiated and complete events', async () => {
    const s = makeServices();
    await approveAndExecute(s);
    const types = s.h.events.types();
    expect(types).toContain('migration.cutover.initiated');
    expect(types).toContain('migration.cutover.complete');
  });

  it('leaves an audit trail naming the preparer and the approver', async () => {
    const s = makeServices();
    const { run } = await approveAndExecute(s);
    const audit = await s.runService.getAudit(TENANT, run.runId);
    const actions = (audit as any[]).map((a) => a.action);
    expect(actions).toContain('CUTOVER_PREPARED');
    expect(actions).toContain('CUTOVER_APPROVED');
    expect(actions).toContain('CUTOVER_EXECUTED');
    expect((audit as any[]).find((a) => a.action === 'CUTOVER_PREPARED').actor).toBe(CONTROLLER);
    expect((audit as any[]).find((a) => a.action === 'CUTOVER_APPROVED').actor).toBe(APPROVER);
  });

  it('records the run start and completion timestamps', async () => {
    const s = makeServices();
    const { run } = await approveAndExecute(s);
    const final = await s.runService.get(TENANT, run.runId);
    expect(final.startedAt).toBeTruthy();
    expect(final.completedAt).toBeTruthy();
  });
});
