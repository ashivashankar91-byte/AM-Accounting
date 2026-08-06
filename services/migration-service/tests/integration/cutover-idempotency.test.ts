/**
 * Cutover rule 10 — a second cutover execution produces the same result, no
 * second set of effects, and no error.
 */
import { describe, it, expect } from 'vitest';
import { makeServices, driveToReadyForCutover, TENANT, APPROVER, CONTROLLER } from '../helpers/service-harness';

async function completedCutover(s: ReturnType<typeof makeServices>) {
  const { run } = await driveToReadyForCutover(s);
  const { irreversibleEffectStatement } = await s.cutoverService.getCeremony(TENANT, run.runId);
  await s.cutoverService.approve({
    tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: irreversibleEffectStatement,
  });
  const first = await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
  return { run, first, statement: irreversibleEffectStatement };
}

describe('repeating a completed cutover', () => {
  it('does not raise an error', async () => {
    const s = makeServices();
    const { run } = await completedCutover(s);
    await expect(s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER }))
      .resolves.toBeTruthy();
  });

  it('reports the replay explicitly rather than pretending it did the work again', async () => {
    const s = makeServices();
    const { run } = await completedCutover(s);
    const second = await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
    expect(second.idempotentReplay).toBe(true);
    expect(second.state).toBe('COMPLETE');
  });

  it('returns the same final run state', async () => {
    const s = makeServices();
    const { run, first } = await completedCutover(s);
    const second = await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
    expect(second.runState).toBe(first.runState);
    expect((await s.runService.get(TENANT, run.runId)).state).toBe('CUTOVER_COMPLETE');
  });

  it('does not publish a second pair of cutover events', async () => {
    const s = makeServices();
    const { run } = await completedCutover(s);
    const before = s.h.events.types().filter((t) => t === 'migration.cutover.complete').length;
    await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
    const after = s.h.events.types().filter((t) => t === 'migration.cutover.complete').length;
    expect(after).toBe(before);
  });

  it('does not append a second CUTOVER_EXECUTED audit record', async () => {
    const s = makeServices();
    const { run } = await completedCutover(s);
    await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
    const audit = await s.runService.getAudit(TENANT, run.runId);
    expect((audit as any[]).filter((a) => a.action === 'CUTOVER_EXECUTED')).toHaveLength(1);
  });

  it('does not post a second conversion journal', async () => {
    const s = makeServices();
    const { run } = await completedCutover(s);
    const before = s.h.posting.requests.length;
    await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: APPROVER });
    expect(s.h.posting.requests).toHaveLength(before);
  });

  it('is idempotent even when the replay is executed by a different identity', async () => {
    const s = makeServices();
    const { run } = await completedCutover(s);
    const second = await s.cutoverService.execute({ tenantId: TENANT, runId: run.runId, actor: CONTROLLER });
    expect(second.idempotentReplay).toBe(true);
  });
});

describe('repeating an approval', () => {
  it('keeps the original approver rather than reassigning it', async () => {
    const s = makeServices();
    const { run, statement } = await completedCutover(s);
    const reapproved = await s.cutoverService.approve({
      tenantId: TENANT, runId: run.runId, actor: APPROVER, acknowledgedStatement: statement,
    }).catch((e) => e);
    if (!(reapproved instanceof Error)) expect(reapproved.approverIdentity).toBe(APPROVER);
    const { ceremony } = await s.cutoverService.getCeremony(TENANT, run.runId);
    expect(ceremony.approverIdentity).toBe(APPROVER);
  });
});

describe('posting-level idempotency', () => {
  it('resolves the same conversion batch to the same idempotency identity across promotion attempts', async () => {
    const s = makeServices();
    const { run } = await driveToReadyForCutover(s);
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: 'LE-CERT-001', runId: run.runId, actor: CONTROLLER });
    const identityFirst = s.h.posting.requests[0]!.idempotencyIdentity;
    await s.promotionService.promote({ tenantId: TENANT, legalEntityId: 'LE-CERT-001', runId: run.runId, actor: CONTROLLER });
    expect(s.h.posting.requests).toHaveLength(1);
    expect(s.h.posting.seenIdentities()).toEqual([identityFirst]);
  });
});
