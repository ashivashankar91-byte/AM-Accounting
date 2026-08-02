import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/serializable-retry', () => ({
  withSerializableRetry: async (prisma: any, fn: (tx: any) => Promise<any>) => fn(prisma),
}));

import { WarrantyClaimService } from '../../src/application/warranty-claim-service';
import { AccountMappingService } from '../../src/application/account-mapping-service';
import { FakePrismaClient } from '../support/fake-prisma';
import { FakePostingEventProducer } from '../support/fake-posting-client';
import { ROLES_BY_FAMILY, EVENT_FAMILY } from '../../src/domain/account-mapping-roles';
import { AccountMappingPendingError, FixedOpsValidationError, NotFoundError } from '../../src/domain/errors';

async function resolveAllMappings(prisma: FakePrismaClient, tenantId: string, legalEntityId: string, families: string[]) {
  for (const family of families) {
    for (const role of (ROLES_BY_FAMILY as any)[family] ?? []) {
      await (prisma as any).fixedOpsAccountMapping.create({
        data: { tenantId, legalEntityId, eventFamily: family, role, status: 'RESOLVED', accountNumber: null },
      });
    }
  }
}

function makeService() {
  const prisma = new FakePrismaClient();
  const postingClient = new FakePostingEventProducer();
  const mapping = new AccountMappingService(prisma as any);
  const service = new WarrantyClaimService(prisma as any, postingClient, mapping);
  return { prisma, postingClient, mapping, service };
}

async function seedClaim(prisma: FakePrismaClient, overrides: Record<string, unknown> = {}) {
  return (prisma as any).warrantyClaimItem.create({
    data: {
      tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1',
      claimNumber: 'CLAIM-1', saleAmount: '300.00', remainingAmount: '300.00',
      status: 'BORN', birthSourceEventId: 'evt-birth', birthJournalEntryId: 'je-birth',
      ...overrides,
    },
  });
}

describe('WarrantyClaimService — S065', () => {
  it('submit() moves a BORN claim to SUBMITTED and is idempotent thereafter', async () => {
    const { prisma, service } = makeService();
    await seedClaim(prisma);

    const first = await service.submit({ tenantId: 't1', claimNumber: 'CLAIM-1', actor: 'tester', correlationId: 'c1' });
    expect(first.idempotent).toBe(false);
    expect(first.status).toBe('SUBMITTED');

    const second = await service.submit({ tenantId: 't1', claimNumber: 'CLAIM-1', actor: 'tester', correlationId: 'c2' });
    expect(second.idempotent).toBe(true); // already SUBMITTED, no-op
  });

  it('remit() reduces remainingAmount by exactly the remitted amount and closes the claim when fully remitted', async () => {
    const { prisma, service } = makeService();
    await seedClaim(prisma);

    const partial = await service.remit({ tenantId: 't1', claimNumber: 'CLAIM-1', remittedAmount: '100.00', sourceReceiptId: 'r1', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' });
    expect(partial.idempotent).toBe(false);
    let claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', claimNumber: 'CLAIM-1' } });
    expect(claim.remainingAmount).toBe(200);
    expect(claim.status).toBe('PARTIALLY_REMITTED');

    await service.remit({ tenantId: 't1', claimNumber: 'CLAIM-1', remittedAmount: '200.00', sourceReceiptId: 'r2', sourceEventId: 'evt-2', correlationId: 'c2', actor: 'tester' });
    claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', claimNumber: 'CLAIM-1' } });
    expect(claim.remainingAmount).toBe(0);
    expect(claim.status).toBe('CLOSED');
  });

  it('remit() is idempotent on sourceEventId — replay does not double-reduce the balance', async () => {
    const { prisma, service } = makeService();
    await seedClaim(prisma);
    const req = { tenantId: 't1', claimNumber: 'CLAIM-1', remittedAmount: '100.00', sourceReceiptId: 'r1', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' };

    await service.remit(req);
    const second = await service.remit(req);
    expect(second.idempotent).toBe(true);

    const claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', claimNumber: 'CLAIM-1' } });
    expect(claim.remainingAmount).toBe(200); // reduced once, not twice
  });

  it('remit() refuses a remittance that exceeds the remaining balance — never over-applies', async () => {
    const { prisma, service } = makeService();
    await seedClaim(prisma);
    await expect(service.remit({ tenantId: 't1', claimNumber: 'CLAIM-1', remittedAmount: '400.00', sourceReceiptId: 'r1', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' }))
      .rejects.toThrow(FixedOpsValidationError);
  });

  it('disposition(WRITE_DOWN) posts a journal and reduces remainingAmount by the disposition amount', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION]);
    await seedClaim(prisma);

    const result = await service.disposition({ tenantId: 't1', claimNumber: 'CLAIM-1', type: 'WRITE_DOWN', amount: '200.00', reason: 'factory short-pay', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' });

    expect(result.idempotent).toBe(false);
    expect(postingClient.submitted).toHaveLength(1);
    const claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', claimNumber: 'CLAIM-1' } });
    expect(claim.remainingAmount).toBe(100);
    expect(claim.status).toBe('SHORT_PAY_DISPOSITIONED');
  });

  it('disposition(DENIAL) zeroes the remaining balance regardless of the disposition amount', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION]);
    await seedClaim(prisma);

    await service.disposition({ tenantId: 't1', claimNumber: 'CLAIM-1', type: 'DENIAL', amount: '50.00', reason: 'not covered', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' });

    const claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', claimNumber: 'CLAIM-1' } });
    expect(claim.remainingAmount).toBe(0);
    expect(claim.status).toBe('DENIED');
  });

  it('disposition() is idempotent on sourceEventId — replay returns the original disposition, no duplicate journal', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION]);
    await seedClaim(prisma);
    const req = { tenantId: 't1', claimNumber: 'CLAIM-1', type: 'WRITE_DOWN' as const, amount: '200.00', reason: 'r', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' };

    const first = await service.disposition(req);
    const second = await service.disposition(req);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('disposition() rejects when the mapping is unresolved — claim balance and status are untouched', async () => {
    const { prisma, postingClient, service } = makeService();
    await seedClaim(prisma);

    await expect(service.disposition({ tenantId: 't1', claimNumber: 'CLAIM-1', type: 'WRITE_DOWN', amount: '200.00', reason: 'r', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' }))
      .rejects.toThrow(AccountMappingPendingError);
    expect(postingClient.submitted).toHaveLength(0);

    const claim = await (prisma as any).warrantyClaimItem.findFirst({ where: { tenantId: 't1', claimNumber: 'CLAIM-1' } });
    expect(claim.remainingAmount).toBe('300.00');
    expect(claim.status).toBe('BORN');
  });

  it('operations against a nonexistent claim throw NotFoundError', async () => {
    const { service } = makeService();
    await expect(service.submit({ tenantId: 't1', claimNumber: 'NOPE', actor: 'tester', correlationId: 'c1' })).rejects.toThrow(NotFoundError);
  });

  it('aging() sums remainingAmount only across non-CLOSED/non-DENIED claims', async () => {
    const { prisma, service } = makeService();
    await seedClaim(prisma, { claimNumber: 'CLAIM-OPEN', remainingAmount: '300.00', status: 'BORN' });
    await seedClaim(prisma, { claimNumber: 'CLAIM-CLOSED', remainingAmount: '0.00', status: 'CLOSED' });
    await seedClaim(prisma, { claimNumber: 'CLAIM-DENIED', remainingAmount: '0.00', status: 'DENIED' });

    const report = await service.aging('t1');

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].claimNumber).toBe('CLAIM-OPEN');
    expect(report.totalRemainingCents).toBe(30000);
  });
});
