import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { vi } from 'vitest';
vi.mock('../../src/lib/serializable-retry', () => ({
  withSerializableRetry: async (prisma: any, fn: (tx: any) => Promise<any>) => fn(prisma),
}));

import { RoCloseService } from '../../src/application/ro-close-service';
import { RoReversalService } from '../../src/application/ro-reversal-service';
import { AccountMappingService } from '../../src/application/account-mapping-service';
import { ExceptionService } from '../../src/application/exception-service';
import { WipModeService } from '../../src/application/wip-mode-service';
import { WarrantyClaimService } from '../../src/application/warranty-claim-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { FakePostingEventProducer } from '../support/fake-posting-client';
import { FakeTaxClient } from '../support/fake-tax-client';
import { ROLES_BY_FAMILY, EVENT_FAMILY } from '../../src/domain/account-mapping-roles';

function makeServices() {
  const prisma = new FakePrismaClient();
  const postingClient = new FakePostingEventProducer();
  const taxClient = new FakeTaxClient();
  const mapping = new AccountMappingService(prisma as any);
  const exceptions = new ExceptionService(prisma as any);
  const wipMode = new WipModeService(prisma as any);
  const closeService = new RoCloseService(prisma as any, postingClient, taxClient, mapping, exceptions, wipMode);
  const reversalService = new RoReversalService(prisma as any, postingClient);
  const warrantyService = new WarrantyClaimService(prisma as any, postingClient, mapping);
  return { prisma, postingClient, closeService, reversalService, warrantyService, mapping };
}

async function resolveAllMappings(prisma: FakePrismaClient, tenantId: string, legalEntityId: string, families: string[]) {
  for (const family of families) {
    for (const role of (ROLES_BY_FAMILY as any)[family] ?? []) {
      await (prisma as any).fixedOpsAccountMapping.create({ data: { tenantId, legalEntityId, eventFamily: family, role, status: 'RESOLVED' } });
    }
  }
}

const baseReq = { tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-200', businessDate: '2026-08-01', actor: 'tester', correlationId: 'corr-1' };

describe('RoReversalService.reverse — S060', () => {
  it('reverses a closed RO symmetrically and is idempotent on (roNumber, closeVersion, action)', async () => {
    const { prisma, closeService, reversalService } = makeServices();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.RO_CLOSE_CUSTOMER]);
    await closeService.closeRo({ ...baseReq, sourceEventId: 'evt-close-1', totalSaleAmount: '100.00', lines: [{ lineId: 'l1', payType: 'C', category: 'LABOR', saleAmount: '100.00' }] });

    const first = await reversalService.reverse({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-200', action: 'REOPEN', actor: 'tester', correlationId: 'corr-2', sourceEventId: 'evt-reopen-1' });
    expect(first.idempotent).toBe(false);
    expect(first.status).toBe('COMPLETED');
    expect(first.reversalJournalEntryId).toBeTruthy();

    const ro = await (prisma as any).repairOrder.findFirst({ where: { tenantId: 't1', roNumber: 'RO-200' } });
    expect(ro.status).toBe('REOPENED');

    const second = await reversalService.reverse({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-200', action: 'REOPEN', actor: 'tester', correlationId: 'corr-3', sourceEventId: 'evt-reopen-2' });
    expect(second.idempotent).toBe(true);
    expect(second.reversalId).toBe(first.reversalId);
  });

  it('refuses reopen with a named refusal code once a warranty claim has a remittance', async () => {
    const { prisma, closeService, reversalService, warrantyService } = makeServices();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.RO_CLOSE_WARRANTY, EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION]);
    await closeService.closeRo({ ...baseReq, roNumber: 'RO-300', sourceEventId: 'evt-close-w', totalSaleAmount: '200.00', lines: [{ lineId: 'l1', payType: 'W', category: 'LABOR', saleAmount: '200.00' }] });

    const claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', roNumber: 'RO-300' } });
    await warrantyService.remit({ tenantId: 't1', claimNumber: claim.claimNumber, remittedAmount: '200.00', sourceReceiptId: 'receipt-1', sourceEventId: 'evt-remit-1', correlationId: 'corr-4', actor: 'tester' });

    const result = await reversalService.reverse({ tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-300', action: 'REOPEN', actor: 'tester', correlationId: 'corr-5', sourceEventId: 'evt-reopen-refused' });
    expect(result.status).toBe('REFUSED');
    expect(result.refusalCode).toBe('CLAIM_CASH_APPLIED');
  });
});
