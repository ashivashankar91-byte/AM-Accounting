import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { RlsTenantContext } from '@amacc/shared-kernel';
import { makeTestPrisma, cleanupTenant } from '../support/db';
import { OemProfileService } from '../../src/application/profile-service';
import { OemWarrantyService } from '../../src/application/warranty-service';
import { OemValidationError } from '../../src/domain/errors';

const prisma = makeTestPrisma();
const tenantId = `test-tenant-${randomUUID()}`;
const storeId = 'STORE-1';

const profiles = new OemProfileService(prisma as any);
const warranty = new OemWarrantyService(prisma as any);

beforeAll(async () => {
  RlsTenantContext.set(tenantId);
  await prisma.$connect();
  await profiles.create(tenantId, { make: 'FORD' }, 'tester');
});
afterAll(async () => { await cleanupTenant(prisma, tenantId); await prisma.$disconnect(); });

describe('S105 Warranty Audit Chargeback & Reserve', () => {
  it('accepted chargeback creates a contra item lineaged to the original claim — never mutates applied history', async () => {
    const notice = await warranty.createNotice(tenantId, storeId, 'FORD', null, '2026-07-15', [
      { originalClaimItemRef: 'CLAIM-C-1001', amount: '450.00' },
      { originalClaimItemRef: 'CLAIM-C-1002', amount: '320.50' },
    ], 'tester');
    expect(notice.lines).toHaveLength(2);

    const accepted = await warranty.disposeLine(tenantId, notice.lines[0].id, 'ACCEPTED', 'tester');
    expect(accepted.disposition).toBe('ACCEPTED');
    expect(accepted.contraItemRef).toBe(`CONTRA-${notice.lines[0].id}`);

    const disputed = await warranty.disposeLine(tenantId, notice.lines[1].id, 'DISPUTED', 'tester');
    expect(disputed.disposition).toBe('DISPUTED');
    expect(disputed.contraItemRef).toBeNull(); // dispute posts nothing

    const evidence = await warranty.addEvidence(tenantId, notice.lines[1].id, 'EVID-DOC-1', 'RO copy attached', 'tester');
    expect(evidence.evidenceRef).toBe('EVID-DOC-1');

    await expect(warranty.disposeLine(tenantId, notice.lines[0].id, 'DISPUTED', 'tester')).rejects.toThrow(OemValidationError);
  });

  it('reserve preview/approve/draw/rollforward — reserve never goes debit', async () => {
    await warranty.setReserveConfig(tenantId, storeId, '2.5000', '2026-01-01', 'tester'); // 2.5%
    const preview = await warranty.previewReserve(tenantId, storeId, '2026-07', '10000.00', 'tester');
    expect(Number(preview.computedAccrual)).toBe(250); // 2.5% of 10000

    await expect(warranty.drawReserve(tenantId, storeId, 'nonexistent', 'tester')).rejects.toThrow();

    const approved = await warranty.approveReservePreview(tenantId, preview.id, 'tester');
    expect(approved.status).toBe('APPROVED');

    const notice = await warranty.createNotice(tenantId, storeId, 'FORD', null, '2026-07-20', [
      { originalClaimItemRef: 'CLAIM-C-9001', amount: '100.00' },
    ], 'tester');
    const line = await warranty.disposeLine(tenantId, notice.lines[0].id, 'ACCEPTED', 'tester');

    const draw1 = await warranty.drawReserve(tenantId, storeId, line.id, 'tester');
    expect(Number(draw1.drawAmount)).toBe(100); // within the 250 approved balance
    expect(Number(draw1.excessToExpense)).toBe(0);

    const rollforward1 = await warranty.reserveRollforward(tenantId, storeId);
    expect(rollforward1.balance).toBe(150); // 250 - 100

    // Draw more than remaining balance — excess spills to expense, reserve never negative.
    const notice2 = await warranty.createNotice(tenantId, storeId, 'FORD', null, '2026-07-21', [
      { originalClaimItemRef: 'CLAIM-C-9002', amount: '400.00' },
    ], 'tester');
    const line2 = await warranty.disposeLine(tenantId, notice2.lines[0].id, 'ACCEPTED', 'tester');
    const draw2 = await warranty.drawReserve(tenantId, storeId, line2.id, 'tester');
    expect(Number(draw2.drawAmount)).toBe(150); // remaining balance only
    expect(Number(draw2.excessToExpense)).toBe(250); // 400 - 150

    const rollforward2 = await warranty.reserveRollforward(tenantId, storeId);
    expect(rollforward2.balance).toBe(0); // never negative
  });

  it('previewReserve refuses without an active reserve rate config', async () => {
    const otherStore = 'STORE-NO-CONFIG';
    await expect(warranty.previewReserve(tenantId, otherStore, '2026-07', '10000.00', 'tester')).rejects.toThrow(OemValidationError);
  });
});
