/**
 * A rehearsal exercises the full conversion path with no production authority.
 * Migration principle 4 — every run is uniquely identified, tenant- and
 * LE-scoped, transformation-version pinned, repeatable and restartable.
 */
import { describe, it, expect } from 'vitest';
import {
  makeServices, stageAndValidate, driveToReadyForCutover,
  BALANCED_TB_ROWS, TENANT, LE, OPERATOR, CONTROLLER,
} from '../helpers/service-harness';

describe('run identity and modes', () => {
  it('accepts the three canonical modes', async () => {
    const s = makeServices();
    for (const mode of ['REHEARSAL', 'PARALLEL', 'CUTOVER']) {
      const run = await s.runService.create({
        tenantId: TENANT, legalEntityId: LE, mode, transformationVersion: 'ce16.v1', actor: OPERATOR,
      });
      expect(run.mode).toBe(mode);
    }
  });

  it('refuses an unrecognised mode', async () => {
    const s = makeServices();
    await expect(s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'DRY_RUN', transformationVersion: 'ce16.v1', actor: OPERATOR,
    })).rejects.toThrow(/Unknown migration mode/);
  });

  it('starts every run in DISCOVERED with an audit record', async () => {
    const s = makeServices();
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    expect(run.state).toBe('DISCOVERED');
    const audit = await s.runService.getAudit(TENANT, run.runId);
    expect((audit as any[])[0].action).toBe('RUN_CREATED');
  });

  it('publishes a run created event', async () => {
    const s = makeServices();
    await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    expect(s.h.events.types()).toContain('migration.run.created');
  });

  it('pins the transformation version on the run', async () => {
    const s = makeServices();
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v9', actor: OPERATOR,
    });
    expect(run.transformationVersion).toBe('ce16.v9');
  });

  it('scopes runs to their legal entity', async () => {
    const s = makeServices();
    await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    await s.runService.create({ tenantId: TENANT, legalEntityId: 'LE-CERT-002', mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    const scoped = await s.runService.list(TENANT, { legalEntityId: LE });
    expect((scoped as any[]).every((r) => r.legalEntityId === LE)).toBe(true);
    expect((scoped as any[]).length).toBe(1);
  });

  it('filters runs by state and mode', async () => {
    const s = makeServices();
    await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'CUTOVER', transformationVersion: 'v', actor: OPERATOR });
    await s.runService.create({ tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'v', actor: OPERATOR });
    expect(((await s.runService.list(TENANT, { mode: 'CUTOVER' })) as any[])).toHaveLength(1);
    expect(((await s.runService.list(TENANT, { state: 'DISCOVERED' })) as any[])).toHaveLength(2);
  });
});

describe('a rehearsal exercises the whole path', () => {
  it('reaches READY_FOR_CUTOVER without ever executing a cutover', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const fresh = await s.runService.get(TENANT, run.runId);
    expect(fresh.mode).toBe('REHEARSAL');
    expect(fresh.state).toBe('READY_FOR_CUTOVER');
    expect(fresh.completedAt).toBeFalsy();
  });

  it('produces gate evidence a real cutover can be judged against', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const gates = await s.stagingService.listGates(TENANT, run.runId);
    expect(new Set((gates as any[]).map((g) => g.gateCode))).toEqual(new Set(['G1', 'G2', 'G3', 'G4', 'G5']));
    expect((gates as any[]).every((g) => g.result === 'PASS')).toBe(true);
  });

  it('records who evaluated the gates and when', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    const gates = await s.stagingService.listGates(TENANT, run.runId);
    expect((gates as any[]).every((g) => g.evaluatedBy === OPERATOR && !!g.evaluatedAt)).toBe(true);
  });

  it('re-evaluates gates so a stale FAIL cannot outlive its fix', async () => {
    const s = makeServices();
    const { run } = await stageAndValidate(s, BALANCED_TB_ROWS);
    await s.stagingService.validate({ tenantId: TENANT, runId: run.runId, actor: CONTROLLER, agingAsOf: '2025-12-31' });
    const gates = (await s.stagingService.listGates(TENANT, run.runId)) as any[];
    expect(gates.length).toBe(10);
    const readiness = await s.runService.computeReadiness(TENANT, run.runId);
    expect(readiness.allGatesPassed).toBe(true);
  });
});
