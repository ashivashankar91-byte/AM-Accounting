import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { AccountMappingPendingError, TaxResultUnavailableError } from '../../src/domain/errors';

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

const baseReq = { tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-100', businessDate: '2026-08-01', actor: 'tester', correlationId: 'corr-1' };

describe('RoCloseService.closeRo — S059', () => {
  it('posts exactly one journal for a mixed-pay (C+W+I) RO close and conserves distribution', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER, EVENT_FAMILY.RO_CLOSE_WARRANTY, EVENT_FAMILY.RO_CLOSE_INTERNAL]);

    const result = await service.closeRo({
      ...baseReq, sourceEventId: 'evt-1', totalSaleAmount: '300.00',
      lines: [
        { lineId: 'l1', payType: 'C', category: 'LABOR', saleAmount: '100.00', costAmount: '40.00' },
        { lineId: 'l2', payType: 'W', category: 'PARTS', saleAmount: '150.00', costAmount: '90.00' },
        { lineId: 'l3', payType: 'I', category: 'MISC', saleAmount: '50.00' },
      ],
    });

    expect(result.idempotent).toBe(false);
    expect(result.status).toBe('POSTED');
    expect(postingClient.submitted).toHaveLength(1); // exactly one journal for the whole mixed-pay close

    const lines = await (prisma as any).roDistributionLine.findMany({ where: { roCloseSubmissionId: result.submissionId } });
    expect(lines).toHaveLength(3);
    const sumSale = lines.reduce((acc: number, l: any) => acc + Math.round(Number(l.saleAmount) * 100), 0);
    expect(sumSale).toBe(30000); // Σ distribution lines = RO total to the cent

    const claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', roNumber: 'RO-100' } });
    expect(claim).toBeTruthy();
    expect(claim.status).toBe('BORN');
    expect(claim.scheduleProjectionPending).toBe(true);
  });

  it('is idempotent on the same sourceEventId — retried close returns the original result, no duplicate journal', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER]);
    const req = { ...baseReq, sourceEventId: 'evt-dup', totalSaleAmount: '100.00', lines: [{ lineId: 'l1', payType: 'C' as const, category: 'LABOR' as const, saleAmount: '100.00' }] };

    const first = await service.closeRo(req);
    const second = await service.closeRo(req);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.submissionId).toBe(first.submissionId);
    expect(postingClient.submitted).toHaveLength(1); // no second posting-engine call
  });

  it('blocks on unavailable customer-pay tax result — never estimates, never proceeds', async () => {
    const { prisma, taxClient, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER]);
    taxClient.nextResult = { status: 'ENGINE_UNAVAILABLE', parkedExceptionId: 'parked-1' };

    await expect(service.closeRo({
      ...baseReq, sourceEventId: 'evt-tax-block', totalSaleAmount: '100.00',
      lines: [{ lineId: 'l1', payType: 'C', category: 'LABOR', saleAmount: '100.00' }],
    })).rejects.toThrow(TaxResultUnavailableError);

    expect(postingClient.submitted).toHaveLength(0); // posting-engine never called

    const submissions = await (prisma as any).roCloseSubmission.findMany({ where: { tenantId: 't1', roNumber: 'RO-100' } });
    expect(submissions).toHaveLength(1);
    expect(submissions[0].status).toBe('BLOCKED_TAX_UNAVAILABLE');

    const exceptions = await (prisma as any).fixedOpsPostingException.findMany({ where: { tenantId: 't1' } });
    expect(exceptions.some((e: any) => e.reasonCode === 'TAX_RESULT_UNAVAILABLE')).toBe(true);
  });

  it('rejects the WHOLE close (never a partial post) when any pay type has an unresolved account mapping', async () => {
    const { postingClient, service } = makeService();
    // No mappings resolved at all — mixed C+I close.
    await expect(service.closeRo({
      ...baseReq, sourceEventId: 'evt-mapping', totalSaleAmount: '150.00',
      lines: [
        { lineId: 'l1', payType: 'I', category: 'LABOR', saleAmount: '100.00' },
        { lineId: 'l2', payType: 'I', category: 'MISC', saleAmount: '50.00' },
      ],
    })).rejects.toThrow(AccountMappingPendingError);
    expect(postingClient.submitted).toHaveLength(0);
  });
});
