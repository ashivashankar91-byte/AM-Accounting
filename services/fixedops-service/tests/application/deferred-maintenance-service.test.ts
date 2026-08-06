import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/serializable-retry', () => ({
  withSerializableRetry: async (prisma: any, fn: (tx: any) => Promise<any>) => fn(prisma),
}));

import { DeferredMaintenanceService } from '../../src/application/deferred-maintenance-service';
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
  const service = new DeferredMaintenanceService(prisma as any, postingClient, mapping);
  return { prisma, postingClient, mapping, service };
}

const baseSell = { tenantId: 't1', legalEntityId: 'le1', storeId: 's1', contractNumber: 'DC-1', soldAmount: '180.00', sourceEventId: 'evt-sale', correlationId: 'c1', actor: 'tester' };

describe('DeferredMaintenanceService — S064', () => {
  it('sell() posts a journal and creates an ACTIVE contract with deferredBalance = soldAmount', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]);

    const contract = await service.sell(baseSell);

    expect(contract.idempotent).toBe(false);
    expect(contract.status).toBe('ACTIVE');
    expect(contract.deferredBalance).toBe('180.00');
    expect(contract.saleJournalEntryId).toBeTruthy();
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('sell() is idempotent on contractNumber — replay returns the original contract, no duplicate journal', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]);

    const first = await service.sell(baseSell);
    const second = await service.sell(baseSell);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    expect(postingClient.submitted).toHaveLength(1);
  });

  it('sell() rejects when DEFERRED_CONTRACT_SALE mapping is unresolved — no contract row is created', async () => {
    const { prisma, postingClient, service } = makeService();

    await expect(service.sell(baseSell)).rejects.toThrow(AccountMappingPendingError);
    expect(postingClient.submitted).toHaveLength(0);

    const contract = await (prisma as any).deferredMaintenanceContract.findFirst({ where: { tenantId: 't1', contractNumber: 'DC-1' } });
    expect(contract).toBeNull();
  });

  it('sell() surfaces a FixedOpsValidationError when posting-engine refuses (never silently creates a mispriced contract)', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]);
    postingClient.nextResult = { status: 'REJECTED', failureReason: 'NO_RULE_MATCH' };

    await expect(service.sell(baseSell)).rejects.toThrow(FixedOpsValidationError);
    const contract = await (prisma as any).deferredMaintenanceContract.findFirst({ where: { tenantId: 't1', contractNumber: 'DC-1' } });
    expect(contract).toBeNull(); // never a partial/mispriced row on refusal
  });

  it('redeem() reduces deferredBalance by exactly the redeemed amount and stays ACTIVE while balance remains', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE, EVENT_FAMILY.DEFERRED_CONTRACT_REDEMPTION]);
    await service.sell(baseSell);

    const redemption = await service.redeem({ tenantId: 't1', contractNumber: 'DC-1', roNumber: 'RO-1', redeemedAmount: '100.00', sourceEventId: 'evt-redeem-1', correlationId: 'c2', actor: 'tester' });

    expect(redemption.idempotent).toBe(false);
    const contract = await (prisma as any).deferredMaintenanceContract.findFirst({ where: { tenantId: 't1', contractNumber: 'DC-1' } });
    expect(contract.deferredBalance).toBe(80);
    expect(contract.status).toBe('ACTIVE');
  });

  it('redeem() moves the contract to FULLY_REDEEMED when the balance reaches exactly zero', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE, EVENT_FAMILY.DEFERRED_CONTRACT_REDEMPTION]);
    await service.sell(baseSell);

    await service.redeem({ tenantId: 't1', contractNumber: 'DC-1', roNumber: 'RO-1', redeemedAmount: '180.00', sourceEventId: 'evt-redeem-1', correlationId: 'c2', actor: 'tester' });

    const contract = await (prisma as any).deferredMaintenanceContract.findFirst({ where: { tenantId: 't1', contractNumber: 'DC-1' } });
    expect(contract.deferredBalance).toBe(0);
    expect(contract.status).toBe('FULLY_REDEEMED');
  });

  it('redeem() refuses a redemption that exceeds the remaining deferred balance', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]);
    await service.sell(baseSell);

    await expect(service.redeem({ tenantId: 't1', contractNumber: 'DC-1', roNumber: 'RO-1', redeemedAmount: '500.00', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' }))
      .rejects.toThrow(FixedOpsValidationError);
  });

  it('redeem() is idempotent on (contractId, roNumber, sourceEventId) — replay does not double-reduce the balance', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE, EVENT_FAMILY.DEFERRED_CONTRACT_REDEMPTION]);
    await service.sell(baseSell);
    const req = { tenantId: 't1', contractNumber: 'DC-1', roNumber: 'RO-1', redeemedAmount: '100.00', sourceEventId: 'evt-redeem-1', correlationId: 'c2', actor: 'tester' };

    await service.redeem(req);
    const second = await service.redeem(req);
    expect(second.idempotent).toBe(true);
    expect(postingClient.submitted).toHaveLength(2); // one for sell, one for the single real redeem

    const contract = await (prisma as any).deferredMaintenanceContract.findFirst({ where: { tenantId: 't1', contractNumber: 'DC-1' } });
    expect(contract.deferredBalance).toBe(80); // reduced once, not twice
  });

  it('redeem() against a nonexistent contract throws NotFoundError', async () => {
    const { service } = makeService();
    await expect(service.redeem({ tenantId: 't1', contractNumber: 'NOPE', roNumber: 'RO-1', redeemedAmount: '10.00', sourceEventId: 'evt-1', correlationId: 'c1', actor: 'tester' }))
      .rejects.toThrow(NotFoundError);
  });

  it('flagExpired() marks expired ACTIVE contracts EXPIRED_UNREDEEMED_BALANCE_DEFERRED WITHOUT posting any recognition journal (D-CE11-01)', async () => {
    const { prisma, postingClient, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]);
    await service.sell({ ...baseSell, expiresAt: '2020-01-01' });
    postingClient.submitted.length = 0; // clear the sale's own posting before the assertion below

    const flagged = await service.flagExpired('t1', new Date('2026-01-01'));

    expect(flagged).toHaveLength(1);
    expect(flagged[0].status).toBe('EXPIRED_UNREDEEMED_BALANCE_DEFERRED');
    expect(flagged[0].deferredBalance).toBe('180.00'); // balance stays deferred — never auto-recognized
    expect(postingClient.submitted).toHaveLength(0); // no journal posted by expiry
  });

  it('flagExpired() never touches a contract that is not yet expired', async () => {
    const { prisma, service } = makeService();
    await resolveAllMappings(prisma, 't1', 'le1', [EVENT_FAMILY.DEFERRED_CONTRACT_SALE]);
    await service.sell({ ...baseSell, expiresAt: '2030-01-01' });

    const flagged = await service.flagExpired('t1', new Date('2026-01-01'));
    expect(flagged).toHaveLength(0);
  });
});
