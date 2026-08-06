import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { RlsTenantContext } from '@amacc/shared-kernel';
import { makeTestPrisma, cleanupTenant } from '../support/db';
import { FakeDealFinalizedSource } from '../support/fakes';
import { OemProfileService } from '../../src/application/profile-service';
import { OemIncentiveService } from '../../src/application/incentive-service';
import { OemValidationError } from '../../src/domain/errors';

const prisma = makeTestPrisma();
const tenantId = `test-tenant-${randomUUID()}`;
const storeId = 'STORE-1';

const profiles = new OemProfileService(prisma as any);
const dealFinalized = new FakeDealFinalizedSource([
  { tenantId, storeId, dealNumber: 'D-1', make: 'FORD', programId: 'FORD-RDR-Q3', qualifyingUnitCount: 1, eventRef: 'deal.finalized:D-1', deliveredAt: '2026-07-01' },
  { tenantId, storeId, dealNumber: 'D-2', make: 'FORD', programId: 'FORD-RDR-Q3', qualifyingUnitCount: 2, eventRef: 'deal.finalized:D-2', deliveredAt: '2026-07-02' },
  { tenantId, storeId, dealNumber: 'D-3', make: 'FORD', programId: null, qualifyingUnitCount: 1, eventRef: 'deal.finalized:D-3', deliveredAt: '2026-07-03' },
  { tenantId, storeId, dealNumber: 'D-4', make: 'FORD', programId: 'FORD-UNREGISTERED', qualifyingUnitCount: 1, eventRef: 'deal.finalized:D-4', deliveredAt: '2026-07-04' },
]);
const incentives = new OemIncentiveService(prisma as any, dealFinalized);

beforeAll(async () => {
  RlsTenantContext.set(tenantId);
  await prisma.$connect();
  await profiles.create(tenantId, { make: 'FORD' }, 'tester');
});
afterAll(async () => { await cleanupTenant(prisma, tenantId); await prisma.$disconnect(); });

describe('S103A Incentive Registry & Flat RDR Accruals', () => {
  it('registers a flat program', async () => {
    const p = await incentives.registerProgram(tenantId, {
      make: 'FORD', programId: 'FORD-RDR-Q3', amountType: 'FLAT', flatAmountPerUnit: '500.00', effectiveFrom: '2026-01-01',
    }, 'tester');
    expect(p.amountType).toBe('FLAT');
  });

  it('accrues exactly registered flat amount x qualifying units; unregistered/untagged programs are skipped with a visibility flag, never silently accrued', async () => {
    const { accrued, unaccrued } = await incentives.accrueFromDeliveries(tenantId, storeId, '2026-01-01', 'tester');
    expect(accrued).toHaveLength(2); // D-1, D-2
    const d1 = accrued.find((a: any) => a.dealNumber === 'D-1');
    const d2 = accrued.find((a: any) => a.dealNumber === 'D-2');
    expect(Number(d1.accruedAmount)).toBe(500); // 500 x 1
    expect(Number(d2.accruedAmount)).toBe(1000); // 500 x 2

    expect(unaccrued).toContainEqual({ dealNumber: 'D-3', reason: 'NO_PROGRAM_TAGGED' });
    expect(unaccrued).toContainEqual({ dealNumber: 'D-4', reason: 'UNREGISTERED_PROGRAM' });
  });

  it('re-running accrual over the same deliveries is idempotent (unique per program+deal)', async () => {
    const before = await incentives.listAccruals(tenantId, storeId);
    const { accrued } = await incentives.accrueFromDeliveries(tenantId, storeId, '2026-01-01', 'tester');
    const after = await incentives.listAccruals(tenantId, storeId);
    expect(after).toHaveLength(before.length);
    expect(accrued).toHaveLength(2);
  });

  it('true-up conserves: accrual amount adjusts by exactly the entered adjustment', async () => {
    const accruals = await incentives.listAccruals(tenantId, storeId);
    const d1 = accruals.find((a: any) => a.dealNumber === 'D-1');
    const { accrual } = await incentives.trueUp(tenantId, d1.id, '25.00', 'factory statement true-up', null, 'tester');
    expect(Number(accrual.accruedAmount)).toBe(525);
    expect(accrual.status).toBe('TRUED_UP');
  });

  it('receivable tie sums open accruals and flags the GL-movement side as pending (CE-07 not wired)', async () => {
    const tie = await incentives.receivableTie(tenantId, storeId);
    expect(Number(tie.totalOpenIncentiveReceivable)).toBeCloseTo(1525, 2); // 525 + 1000
    expect(tie.glMovementSourceIsPending).toBe(true);
  });

  it('rejects a FLAT program registration with no flatAmountPerUnit', async () => {
    await expect(
      incentives.registerProgram(tenantId, { make: 'FORD', programId: 'BAD', amountType: 'FLAT', effectiveFrom: '2026-01-01' } as any, 'tester'),
    ).rejects.toThrow(OemValidationError);
  });
});
