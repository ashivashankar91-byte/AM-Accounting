import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { makeFakePrisma, makeFakeEvents } from './support/fake-prisma';
import {
  SettlementService, ChargebackAlreadyDispositionedError,
} from '../src/application/settlement-service';
import { SettlementConservationError } from '../src/domain/settlement';
import { UnconfiguredSettlementAdapter } from '../src/infrastructure/settlement-adapter';

const TENANT = 'tenant-s055';

describe('SettlementService (S055)', () => {
  let prisma: any;
  let settlement: SettlementService;

  beforeEach(() => {
    container.reset();
    prisma = makeFakePrisma();
    container.registerInstance('PrismaClient', prisma);
    container.registerInstance('IEventPublisher', makeFakeEvents());
    container.registerInstance('SettlementAdapter', new UnconfiguredSettlementAdapter());
    container.register('SettlementService', { useClass: SettlementService });
    settlement = container.resolve('SettlementService');
  });

  it('reports SETTLEMENT_FEED_NOT_CONFIGURED truthfully — no real processor wired', () => {
    expect(settlement.getAdapterStatus()).toEqual({ state: 'SETTLEMENT_FEED_NOT_CONFIGURED' });
  });

  it('imports a batch and proves gross - fee = net', async () => {
    const batch = await settlement.importBatch({
      tenantId: TENANT, entityId: 'e1', bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
      batchReference: 'BATCH-1', settlementDate: '2026-08-01', grossAmount: '100.00', feeAmount: '3.00', netAmount: '97.00',
      idempotencyKey: 'imp-1', actor: 'controller-1',
    });
    expect(batch.idempotent).toBe(false);
    expect(Number(batch.grossAmount) - Number(batch.feeAmount)).toBeCloseTo(Number(batch.netAmount));
  });

  it('rejects a batch where gross - fee != net (conservation)', async () => {
    await expect(
      settlement.importBatch({
        tenantId: TENANT, entityId: 'e1', bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
        batchReference: 'BATCH-BAD', settlementDate: '2026-08-01', grossAmount: '100.00', feeAmount: '3.00', netAmount: '90.00',
        idempotencyKey: 'imp-bad', actor: 'controller-1',
      }),
    ).rejects.toBeInstanceOf(SettlementConservationError);
  });

  it('is idempotent on idempotencyKey', async () => {
    const dto = {
      tenantId: TENANT, entityId: 'e1', bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
      batchReference: 'BATCH-2', settlementDate: '2026-08-01', grossAmount: '50.00', feeAmount: '2.00', netAmount: '48.00',
      idempotencyKey: 'imp-2', actor: 'controller-1',
    };
    const first = await settlement.importBatch(dto);
    const second = await settlement.importBatch(dto);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('posts a batch exactly once, emitting a never-netted fee-recognition event', async () => {
    const batch = await settlement.importBatch({
      tenantId: TENANT, entityId: 'e1', bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
      batchReference: 'BATCH-3', settlementDate: '2026-08-01', grossAmount: '100.00', feeAmount: '3.00', netAmount: '97.00',
      idempotencyKey: 'imp-3', actor: 'controller-1',
    });
    const posted = await settlement.postBatch(TENANT, batch.id, 'controller-1');
    expect(posted.status).toBe('POSTED');
    const events = prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.settlement.fee.recognized');
    expect(events).toHaveLength(1);
    expect(events[0].payload.accountingAmounts.some((a: any) => a.kind === 'FEE')).toBe(true);

    const postedAgain = await settlement.postBatch(TENANT, batch.id, 'controller-1');
    expect(postedAgain.idempotent).toBe(true);
    expect(prisma.cashOutboxEvent._rows.filter((e: any) => e.eventType === 'cash.settlement.fee.recognized')).toHaveLength(1);
  });

  it('unmatched settlement lines land in an explicit worklist, never auto-absorbed', async () => {
    const item = await settlement.addToWorklist({ tenantId: TENANT, bankAccountCode: 'OPERATING-001', amount: '25.00', cardLast4: '4242' });
    expect(item.status).toBe('OPEN');
    const list = await settlement.listWorklist(TENANT, { status: 'OPEN' });
    expect(list).toHaveLength(1);
    const resolved = await settlement.resolveWorklistItem(TENANT, item.id, 'controller-1');
    expect(resolved.status).toBe('RESOLVED');
  });

  it('chargeback disposition creates its adjustment exactly once — a second disposition attempt is rejected', async () => {
    const chargeback = await settlement.intakeChargeback({ tenantId: TENANT, entityId: 'e1', amount: '30.00', actor: 'controller-1' });
    const adjustment = await settlement.dispositionChargeback({ tenantId: TENANT, chargebackId: chargeback.id, dispositionAction: 'CUSTOMER_RESPONSIBILITY', actor: 'controller-1' });
    expect(adjustment.dispositionAction).toBe('CUSTOMER_RESPONSIBILITY');
    expect(prisma.settlementAdjustment._rows.filter((a: any) => a.chargebackId === chargeback.id)).toHaveLength(1);

    await expect(
      settlement.dispositionChargeback({ tenantId: TENANT, chargebackId: chargeback.id, dispositionAction: 'MERCHANT_ABSORBED', actor: 'controller-1' }),
    ).rejects.toBeInstanceOf(ChargebackAlreadyDispositionedError);
    expect(prisma.settlementAdjustment._rows.filter((a: any) => a.chargebackId === chargeback.id)).toHaveLength(1);
  });
});
