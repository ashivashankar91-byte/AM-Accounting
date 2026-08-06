import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { makeFakePrisma, makeFakeEvents } from './support/fake-prisma';
import { SweepService } from '../src/application/sweep-service';
import { SweepInputError, SweepConfigNotFoundError, SweepNotPostableError } from '../src/domain/sweep';

const TENANT = 'tenant-s056';

describe('SweepService (S056)', () => {
  let prisma: any;
  let sweeps: SweepService;

  beforeEach(async () => {
    container.reset();
    prisma = makeFakePrisma();
    container.registerInstance('PrismaClient', prisma);
    container.registerInstance('IEventPublisher', makeFakeEvents());
    container.register('SweepService', { useClass: SweepService });
    sweeps = container.resolve('SweepService');
  });

  it('configures a store/operating account pair idempotently', async () => {
    const dto = { tenantId: TENANT, entityId: 'e1', storeAccountCode: 'STORE-101', operatingAccountCode: 'OPERATING-001', actor: 'controller-1' };
    const first = await sweeps.configurePair(dto);
    expect(first.idempotent).toBe(false);
    const second = await sweeps.configurePair(dto);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('rejects recording a sweep against an unknown pair config', async () => {
    await expect(
      sweeps.recordSweep({
        tenantId: TENANT, pairConfigId: 'nonexistent', sweepDate: '2026-08-01', direction: 'STORE_TO_OPERATING',
        amount: '500.00', idempotencyKey: 'sweep-1', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(SweepConfigNotFoundError);
  });

  it('rejects an invalid direction', async () => {
    const pair = await sweeps.configurePair({ tenantId: TENANT, entityId: 'e1', storeAccountCode: 'STORE-102', operatingAccountCode: 'OPERATING-002', actor: 'controller-1' });
    await expect(
      sweeps.recordSweep({
        tenantId: TENANT, pairConfigId: pair.id, sweepDate: '2026-08-01', direction: 'SIDEWAYS',
        amount: '100.00', idempotencyKey: 'sweep-bad-dir', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(SweepInputError);
  });

  it('is idempotent on idempotencyKey — a sweep is recorded exactly once', async () => {
    const pair = await sweeps.configurePair({ tenantId: TENANT, entityId: 'e1', storeAccountCode: 'STORE-103', operatingAccountCode: 'OPERATING-003', actor: 'controller-1' });
    const dto = {
      tenantId: TENANT, pairConfigId: pair.id, sweepDate: '2026-08-01', direction: 'STORE_TO_OPERATING' as const,
      amount: '750.00', idempotencyKey: 'sweep-idem-1', actor: 'controller-1',
    };
    const first = await sweeps.recordSweep(dto);
    const second = await sweeps.recordSweep(dto);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('posts a sweep exactly once with a single balanced matrix-row event that nets to zero (AC)', async () => {
    const pair = await sweeps.configurePair({ tenantId: TENANT, entityId: 'e1', storeAccountCode: 'STORE-104', operatingAccountCode: 'OPERATING-004', actor: 'controller-1' });
    const sweep = await sweeps.recordSweep({
      tenantId: TENANT, pairConfigId: pair.id, sweepDate: '2026-08-01', direction: 'OPERATING_TO_STORE',
      amount: '1200.00', idempotencyKey: 'sweep-post-1', actor: 'controller-1',
    });
    const posted = await sweeps.postSweep(TENANT, sweep.id, 'controller-1');
    expect(posted.status).toBe('POSTED');

    const events = prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.sweep.posted');
    expect(events).toHaveLength(1);
    // AC: sweep pair nets exactly zero — one amount/one event describes
    // both legs of equal magnitude, so there is exactly one GROSS amount
    // representing the single balanced pair (not two separately entered
    // and potentially mismatched figures).
    expect(events[0].payload.accountingAmounts).toHaveLength(1);
    expect(events[0].payload.accountingAmounts[0].amount).toBe('1200.00');
    expect(events[0].payload.metadata.fromAccount).toBe('OPERATING-004');
    expect(events[0].payload.metadata.toAccount).toBe('STORE-104');

    const postedAgain = await sweeps.postSweep(TENANT, sweep.id, 'controller-1');
    expect(postedAgain.idempotent).toBe(true);
    expect(prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.sweep.posted')).toHaveLength(1);
  });

  it('rejects posting a VOID sweep', async () => {
    const pair = await sweeps.configurePair({ tenantId: TENANT, entityId: 'e1', storeAccountCode: 'STORE-105', operatingAccountCode: 'OPERATING-005', actor: 'controller-1' });
    const sweep = await sweeps.recordSweep({
      tenantId: TENANT, pairConfigId: pair.id, sweepDate: '2026-08-01', direction: 'STORE_TO_OPERATING',
      amount: '300.00', idempotencyKey: 'sweep-void-1', actor: 'controller-1',
    });
    await sweeps.voidSweep(TENANT, sweep.id, 'duplicate entry', 'controller-1');
    await expect(sweeps.postSweep(TENANT, sweep.id, 'controller-1')).rejects.toBeInstanceOf(SweepNotPostableError);
  });
});
