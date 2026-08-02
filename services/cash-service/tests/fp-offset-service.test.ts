import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { makeFakePrisma, makeFakeEvents } from './support/fake-prisma';
import { FpOffsetService, FpOffsetInputError, FpOffsetAllocationNotPostableError } from '../src/application/fp-offset-service';
import { FpOffsetAllocationMismatchError } from '../src/domain/sweep';

const TENANT = 'tenant-s056-fp';

describe('FpOffsetService (S056)', () => {
  let prisma: any;
  let fpOffset: FpOffsetService;

  beforeEach(() => {
    container.reset();
    prisma = makeFakePrisma();
    container.registerInstance('PrismaClient', prisma);
    container.registerInstance('IEventPublisher', makeFakeEvents());
    container.register('FpOffsetService', { useClass: FpOffsetService });
    fpOffset = container.resolve('FpOffsetService');
  });

  it('allocates a manually entered statement figure across lines that sum to it exactly (AC)', async () => {
    const allocation = await fpOffset.createAllocation({
      tenantId: TENANT, entityId: 'e1', lenderName: 'ACME Floorplan Finance', statementDate: '2026-08-01',
      statementAmount: '1500.00',
      lines: [{ floorplanUnitRef: 'VIN-AAA', amount: '900.00' }, { floorplanUnitRef: 'VIN-BBB', amount: '600.00' }],
      idempotencyKey: 'fp-1', actor: 'controller-1',
    });
    expect(allocation.idempotent).toBe(false);
    const sum = allocation.lines.reduce((acc: number, l: any) => acc + Number(l.amount), 0);
    expect(sum).toBeCloseTo(1500.0);
  });

  it('rejects an allocation whose lines do not sum to the entered statement figure — no invented interest math to force-balance it', async () => {
    await expect(
      fpOffset.createAllocation({
        tenantId: TENANT, entityId: 'e1', lenderName: 'ACME Floorplan Finance', statementDate: '2026-08-01',
        statementAmount: '1000.00',
        lines: [{ floorplanUnitRef: 'VIN-CCC', amount: '400.00' }, { floorplanUnitRef: 'VIN-DDD', amount: '400.00' }],
        idempotencyKey: 'fp-bad', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(FpOffsetAllocationMismatchError);
  });

  it('is idempotent on idempotencyKey', async () => {
    const dto = {
      tenantId: TENANT, entityId: 'e1', lenderName: 'ACME Floorplan Finance', statementDate: '2026-08-01',
      statementAmount: '250.00', lines: [{ floorplanUnitRef: 'VIN-EEE', amount: '250.00' }],
      idempotencyKey: 'fp-idem-1', actor: 'controller-1',
    };
    const first = await fpOffset.createAllocation(dto);
    const second = await fpOffset.createAllocation(dto);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('requires at least one line', async () => {
    await expect(
      fpOffset.createAllocation({
        tenantId: TENANT, entityId: 'e1', lenderName: 'ACME Floorplan Finance', statementDate: '2026-08-01',
        statementAmount: '100.00', lines: [], idempotencyKey: 'fp-empty', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(FpOffsetInputError);
  });

  it('posts an allocation exactly once, emitting the entered statement figure verbatim (no calculation)', async () => {
    const allocation = await fpOffset.createAllocation({
      tenantId: TENANT, entityId: 'e1', lenderName: 'ACME Floorplan Finance', statementDate: '2026-08-01',
      statementAmount: '800.00', lines: [{ floorplanUnitRef: 'VIN-FFF', amount: '800.00' }],
      idempotencyKey: 'fp-post-1', actor: 'controller-1',
    });
    const posted = await fpOffset.postAllocation(TENANT, allocation.id, 'controller-1');
    expect(posted.status).toBe('POSTED');

    const events = prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.fpoffset.allocation.posted');
    expect(events).toHaveLength(1);
    expect(events[0].payload.accountingAmounts[0].amount).toBe('800.00');

    const postedAgain = await fpOffset.postAllocation(TENANT, allocation.id, 'controller-1');
    expect(postedAgain.idempotent).toBe(true);
    expect(prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.fpoffset.allocation.posted')).toHaveLength(1);
  });

  it('rejects posting an allocation not in a postable (DRAFT) state', async () => {
    const allocation = await fpOffset.createAllocation({
      tenantId: TENANT, entityId: 'e1', lenderName: 'ACME Floorplan Finance', statementDate: '2026-08-01',
      statementAmount: '50.00', lines: [{ floorplanUnitRef: 'VIN-GGG', amount: '50.00' }],
      idempotencyKey: 'fp-status-1', actor: 'controller-1',
    });
    // Force a non-DRAFT, non-POSTED status (e.g. a hypothetical future
    // VOID state) to confirm the guard rejects rather than silently posting.
    await prisma.fpOffsetAllocation.update({ where: { id: allocation.id }, data: { status: 'VOID' } });
    await expect(fpOffset.postAllocation(TENANT, allocation.id, 'controller-1')).rejects.toBeInstanceOf(FpOffsetAllocationNotPostableError);
  });
});
