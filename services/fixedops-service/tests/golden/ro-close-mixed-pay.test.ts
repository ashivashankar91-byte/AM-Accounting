import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/serializable-retry', () => ({
  withSerializableRetry: async (prisma: any, fn: (tx: any) => Promise<any>) => fn(prisma),
}));

import { RoCloseService } from '../../src/application/ro-close-service';
import { AccountMappingService } from '../../src/application/account-mapping-service';
import { ExceptionService } from '../../src/application/exception-service';
import { WipModeService } from '../../src/application/wip-mode-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { FakePostingEventProducer } from '../support/fake-posting-client';
import { FakeTaxClient } from '../support/fake-tax-client';
import { ROLES_BY_FAMILY, EVENT_FAMILY } from '../../src/domain/account-mapping-roles';

/**
 * S059 golden test — mixed-pay (C+W+I) repair-order close, Accounting-
 * authored fixture values for certification only (never real GL account
 * numbers — accounts stay ACCOUNT_MAPPING_VALUES_PENDING/TEST_FIXTURE
 * throughout; only the role STRUCTURE and dollar conservation are proven
 * here). Fixture RO-GOLDEN-001:
 *
 *   Line  PayType  Category  Sale     Cost
 *   l1    C        LABOR     200.00   80.00
 *   l2    C        PARTS     75.00    30.00
 *   l3    W        LABOR     150.00   60.00
 *   l4    W        SUBLET    40.00    25.00
 *   l5    I        PARTS     50.00    20.00
 *   l6    I        MISC      10.00     0.00
 *   --------------------------------------------
 *   Total          525.00
 *
 * Customer-pay (C) lines are the only ones tax-eligible; the fake tax
 * client returns a flat $22.00 tax on the $275.00 C-pay subtotal.
 */
function makeService() {
  const prisma = new FakePrismaClient();
  const postingClient = new FakePostingEventProducer();
  const taxClient = new FakeTaxClient();
  const mapping = new AccountMappingService(prisma as any);
  const exceptions = new ExceptionService(prisma as any);
  const wipMode = new WipModeService(prisma as any);
  const service = new RoCloseService(prisma as any, postingClient, taxClient, mapping, exceptions, wipMode);
  return { prisma, postingClient, taxClient, mapping, service };
}

async function resolveAllMappings(prisma: FakePrismaClient, tenantId: string, legalEntityId: string, families: string[]) {
  for (const family of families) {
    for (const role of (ROLES_BY_FAMILY as any)[family] ?? []) {
      await (prisma as any).fixedOpsAccountMapping.create({
        data: { tenantId, legalEntityId, eventFamily: family, role, status: 'RESOLVED', accountNumber: null },
      });
    }
  }
}

const GOLDEN_LINES = [
  { lineId: 'l1', payType: 'C' as const, category: 'LABOR' as const, saleAmount: '200.00', costAmount: '80.00' },
  { lineId: 'l2', payType: 'C' as const, category: 'PARTS' as const, saleAmount: '75.00', costAmount: '30.00' },
  { lineId: 'l3', payType: 'W' as const, category: 'LABOR' as const, saleAmount: '150.00', costAmount: '60.00' },
  { lineId: 'l4', payType: 'W' as const, category: 'SUBLET' as const, saleAmount: '40.00', costAmount: '25.00' },
  { lineId: 'l5', payType: 'I' as const, category: 'PARTS' as const, saleAmount: '50.00', costAmount: '20.00' },
  { lineId: 'l6', payType: 'I' as const, category: 'MISC' as const, saleAmount: '10.00', costAmount: '0.00' },
];
const GOLDEN_TOTAL_SALE_CENTS = 20000 + 7500 + 15000 + 4000 + 5000 + 1000; // 52500
const GOLDEN_TOTAL_SALE = '525.00';
const baseReq = { tenantId: 'gt1', legalEntityId: 'gle1', storeId: 'gs1', roNumber: 'RO-GOLDEN-001', businessDate: '2026-08-01', actor: 'accounting-golden', correlationId: 'corr-golden-1' };

describe('S059 golden — mixed-pay (C+W+I) RO close conservation', () => {
  it('posts exactly ONE journal for the whole mixed-pay distribution, never one per pay-type segment', async () => {
    const { prisma, postingClient, taxClient, service } = makeService();
    await resolveAllMappings(prisma, 'gt1', 'gle1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER, EVENT_FAMILY.RO_CLOSE_WARRANTY, EVENT_FAMILY.RO_CLOSE_INTERNAL]);
    taxClient.nextResult = { status: 'CALCULATED', taxResultId: 'tax-golden-1', totalTax: '22.00' };

    const result = await service.closeRo({ ...baseReq, sourceEventId: 'evt-golden-1', totalSaleAmount: GOLDEN_TOTAL_SALE, lines: GOLDEN_LINES });

    expect(result.status).toBe('POSTED');
    expect(postingClient.submitted).toHaveLength(1);
    expect(postingClient.submitted[0].payload.lines).toHaveLength(6);
  });

  it('conserves Σ distribution-line sale amounts = RO total to the cent (no line dropped/duplicated)', async () => {
    const { prisma, service, taxClient } = makeService();
    await resolveAllMappings(prisma, 'gt1', 'gle1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER, EVENT_FAMILY.RO_CLOSE_WARRANTY, EVENT_FAMILY.RO_CLOSE_INTERNAL]);
    taxClient.nextResult = { status: 'CALCULATED', taxResultId: 'tax-golden-2', totalTax: '22.00' };

    const result = await service.closeRo({ ...baseReq, roNumber: 'RO-GOLDEN-002', sourceEventId: 'evt-golden-2', totalSaleAmount: GOLDEN_TOTAL_SALE, lines: GOLDEN_LINES });

    const lines: any[] = await (prisma as any).roDistributionLine.findMany({ where: { roCloseSubmissionId: result.submissionId } });
    expect(lines).toHaveLength(6);
    const sumSaleCents = lines.reduce((acc, l) => acc + Math.round(Number(l.saleAmount) * 100), 0);
    expect(sumSaleCents).toBe(GOLDEN_TOTAL_SALE_CENTS);

    // No line is dropped, duplicated, or reassigned to the wrong pay type.
    const byLineId = new Map(GOLDEN_LINES.map((l) => [l.lineId, l]));
    expect(lines).toHaveLength(byLineId.size);
    for (const stored of lines) {
      const original = byLineId.get(stored.lineId);
      expect(original).toBeTruthy();
      expect(stored.payType).toBe(original!.payType);
      expect(Math.round(Number(stored.saleAmount) * 100)).toBe(Math.round(Number(original!.saleAmount) * 100));
    }
  });

  it('creates a governed warranty claim receivable projection for the W-pay lines, none for C/I', async () => {
    const { prisma, service, taxClient } = makeService();
    await resolveAllMappings(prisma, 'gt1', 'gle1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER, EVENT_FAMILY.RO_CLOSE_WARRANTY, EVENT_FAMILY.RO_CLOSE_INTERNAL]);
    taxClient.nextResult = { status: 'CALCULATED', taxResultId: 'tax-golden-3', totalTax: '22.00' };

    await service.closeRo({ ...baseReq, roNumber: 'RO-GOLDEN-003', sourceEventId: 'evt-golden-3', totalSaleAmount: GOLDEN_TOTAL_SALE, lines: GOLDEN_LINES });

    const claims: any[] = await (prisma as any).warrantyClaimItem.findMany({ where: { tenantId: 'gt1', roNumber: 'RO-GOLDEN-003' } });
    expect(claims).toHaveLength(1); // one claim item for the RO's W-pay lines, not per-line
    expect(claims[0].status).toBe('BORN');
    // PENDING_CE07_TECHNICAL_RECONCILIATION — real per fixedops-service's
    // documented CE-07/CE-08 event-shape gap; asserted here so a future fix
    // to coa-service's outbox event shape is a deliberate, visible change to
    // this golden test rather than a silent drift.
    expect(claims[0].scheduleProjectionPending).toBe(true);
  });

  it('proves the fixed role structure per pay type: rejects the whole close when the WARRANTY family role set is unresolved, even though CUSTOMER and INTERNAL are fully resolved', async () => {
    const { prisma, postingClient, service, taxClient } = makeService();
    // Deliberately resolve only C and I — W stays pending, proving the
    // package's per-pay-type fixed role set (ROLES_BY_FAMILY.RO_CLOSE_WARRANTY:
    // WARRANTY_CLAIM_RECEIVABLE, WARRANTY_LABOR_SALES, WARRANTY_PARTS_SALES,
    // WARRANTY_SUBLET_INCOME, COS_LABOR, LABOR_IN_PROCESS_OFFSET, COS_PARTS,
    // INVENTORY_OFFSET, COS_SUBLET, SUBLET_ACCRUAL_OFFSET) is independently
    // enforced per family, and an unresolved mapping in ONE pay type blocks
    // the ENTIRE mixed-pay close (no partial post).
    await resolveAllMappings(prisma, 'gt1', 'gle1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER, EVENT_FAMILY.RO_CLOSE_INTERNAL]);
    taxClient.nextResult = { status: 'CALCULATED', taxResultId: 'tax-golden-4', totalTax: '22.00' };

    await expect(
      service.closeRo({ ...baseReq, roNumber: 'RO-GOLDEN-004', sourceEventId: 'evt-golden-4', totalSaleAmount: GOLDEN_TOTAL_SALE, lines: GOLDEN_LINES }),
    ).rejects.toThrow();
    expect(postingClient.submitted).toHaveLength(0); // never a partial post

    // assertFamilyResolved validates roles in ROLES_BY_FAMILY order and
    // fails fast on the first unresolved one (never over-queries once a
    // family is known to block the close) — so exactly the FIRST role in
    // the package's fixed WARRANTY role list was looked up (created blank),
    // and it is the one causing the rejection. This proves the family's
    // validation walks the exact fixed role list, in order, nothing
    // invented, rather than some ad hoc subset.
    const mappingRows: any[] = await (prisma as any).fixedOpsAccountMapping.findMany({
      where: { tenantId: 'gt1', legalEntityId: 'gle1', eventFamily: EVENT_FAMILY.RO_CLOSE_WARRANTY },
    });
    expect(mappingRows).toHaveLength(1);
    expect(mappingRows[0].role).toBe(ROLES_BY_FAMILY[EVENT_FAMILY.RO_CLOSE_WARRANTY][0]);
    expect(mappingRows[0].status).toBe('ACCOUNT_MAPPING_VALUES_PENDING');
  });
});
