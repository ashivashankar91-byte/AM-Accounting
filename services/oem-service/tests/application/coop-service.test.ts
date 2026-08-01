import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { RlsTenantContext } from '@amacc/shared-kernel';
import { makeTestPrisma, cleanupTenant } from '../support/db';
import { FakeApDocumentSource } from '../support/fakes';
import { OemProfileService } from '../../src/application/profile-service';
import { OemCoopService } from '../../src/application/coop-service';
import { OemValidationError } from '../../src/domain/errors';

const prisma = makeTestPrisma();
const tenantId = `test-tenant-${randomUUID()}`;
const storeId = 'STORE-1';

const profiles = new OemProfileService(prisma as any);
const apDocs = new FakeApDocumentSource([
  { apDocumentId: 'AP-1', tenantId, storeId, vendorName: 'Radio Co-op', amount: '800.00', documentDate: '2026-07-05' },
]);
const coop = new OemCoopService(prisma as any, apDocs);

beforeAll(async () => {
  RlsTenantContext.set(tenantId);
  await prisma.$connect();
  await profiles.create(tenantId, { make: 'FORD' }, 'tester');
});
afterAll(async () => { await cleanupTenant(prisma, tenantId); await prisma.$disconnect(); });

describe('S106 Co-op Advertising Claims', () => {
  it('claim package totals equal selected spend exactly; evidence required per line', async () => {
    const program = await coop.registerProgram(tenantId, 'FORD', 'FORD-COOP-2026', 'PERCENT_OF_SALES', '5.0000', 'Standard co-op terms', 'tester');
    const claim = await coop.createClaim(tenantId, storeId, program.id, 'tester');

    await expect(coop.addClaimLine(tenantId, claim.id, 'AP-1', 'Radio ad spend', '800.00', '', 'tester')).rejects.toThrow(OemValidationError);

    await coop.addClaimLine(tenantId, claim.id, 'AP-1', 'Radio ad spend', '800.00', 'EVID-1', 'tester');
    await coop.addClaimLine(tenantId, claim.id, 'AP-2', 'Print ad spend', '425.00', 'EVID-2', 'tester');

    const full = await coop.getClaim(tenantId, claim.id);
    expect(Number(full.totalSpend)).toBe(1225);
    expect(full.lines.reduce((s: number, l: any) => s + Number(l.amount), 0)).toBe(1225);
  });

  it('exports the claim, then response entry drives item creation per line', async () => {
    const claims = await coop.listClaims(tenantId, storeId);
    const claim = claims[0];

    const exported = await coop.exportClaim(tenantId, claim.id, 'tester');
    expect(exported.status).toBe('EXPORTED');
    await expect(coop.addClaimLine(tenantId, claim.id, 'AP-3', 'x', '10.00', 'e', 'tester')).rejects.toThrow(OemValidationError);

    const full = await coop.getClaim(tenantId, claim.id);
    const [line1, line2] = full.lines;

    const approved = await coop.recordLineResponse(tenantId, line1.id, 'APPROVED', line1.amount.toString(), 'tester');
    expect(approved.receivableItemRef).toBe(`COOP-RECV-${line1.id}`);

    const denied = await coop.recordLineResponse(tenantId, line2.id, 'DENIED', null, 'tester');
    expect(denied.receivableItemRef).toBeNull();
    expect(Number(denied.approvedAmount)).toBe(0);

    await expect(coop.recordLineResponse(tenantId, line1.id, 'DENIED', null, 'tester')).rejects.toThrow(OemValidationError);
  });

  it('denial write-off conserves: writeOffAmount equals the full denied amount', async () => {
    const claims = await coop.listClaims(tenantId, storeId);
    const claim = claims[0];
    const full = await coop.getClaim(tenantId, claim.id);
    const deniedLine = full.lines.find((l: any) => l.responseStatus === 'DENIED');

    const writtenOff = await coop.writeOffDenied(tenantId, deniedLine.id, 'tester');
    expect(writtenOff.writeOffAmount.toString()).toBe(writtenOff.amount.toString());

    await expect(coop.writeOffDenied(tenantId, deniedLine.id, 'tester')).rejects.toThrow(OemValidationError);
  });

  it('accrual preview = approved rate x entered qualifying sales; approve gate enforced', async () => {
    const programs = await coop.listPrograms(tenantId);
    const program = programs[0];
    const preview = await coop.previewAccrual(tenantId, storeId, program.id, '2026-07', '20000.00', 'tester');
    expect(Number(preview.computedAmount)).toBe(1000); // 5% of 20000

    const approved = await coop.approveAccrual(tenantId, preview.id, 'tester');
    expect(approved.status).toBe('APPROVED');
    await expect(coop.approveAccrual(tenantId, preview.id, 'tester')).rejects.toThrow(OemValidationError);
  });
});
