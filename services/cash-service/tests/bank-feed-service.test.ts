import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { makeFakePrisma, uuid } from './support/fake-prisma';
import { BankFeedService, BankFeedLineAlreadyMatchedError } from '../src/application/bank-feed-service';
import { UnconfiguredBankFeedAdapter } from '../src/infrastructure/bank-feed-adapter';

const TENANT = 'tenant-s053-feed';

describe('BankFeedService (S053)', () => {
  let prisma: any;
  let bankFeed: BankFeedService;

  beforeEach(() => {
    container.reset();
    prisma = makeFakePrisma();
    container.registerInstance('PrismaClient', prisma);
    container.registerInstance('BankFeedAdapter', new UnconfiguredBankFeedAdapter());
    container.register('BankFeedService', { useClass: BankFeedService });
    bankFeed = container.resolve('BankFeedService');
  });

  it('reports BANK_FEED_NOT_CONFIGURED truthfully when no adapter is wired', () => {
    expect(bankFeed.getAdapterStatus()).toEqual({ state: 'BANK_FEED_NOT_CONFIGURED' });
  });

  it('syncFeed imports nothing and reports the unconfigured state — never fakes automatic ingestion', async () => {
    const result = await bankFeed.syncFeed(TENANT, 'OPERATING-001', 'controller-1');
    expect(result).toEqual({ state: 'BANK_FEED_NOT_CONFIGURED', imported: 0 });
    expect(prisma.bankFeedLine._rows).toHaveLength(0);
  });

  it('manual import is always available regardless of adapter state', async () => {
    const line = await bankFeed.importManualLine({
      tenantId: TENANT, bankAccountCode: 'OPERATING-001', amount: '100.00', valueDate: '2026-08-01', actor: 'controller-1',
    });
    expect(line.status).toBe('UNMATCHED');
    expect(line.source).toBe('MANUAL');
  });

  it('matches a manual feed line to a deposit exactly once (idempotent on same target, rejects a different target)', async () => {
    const line = await bankFeed.importManualLine({
      tenantId: TENANT, bankAccountCode: 'OPERATING-001', amount: '100.00', valueDate: '2026-08-01', actor: 'controller-1',
    });
    const depositId = uuid();
    prisma.cashDeposit._rows.push({
      id: depositId, tenantId: TENANT, entityId: 'e1', storeId: 's1', bankAccountCode: 'OPERATING-001',
      businessDate: new Date(), status: 'OPEN', totalAmount: '100.00', idempotencyKey: uuid(), preparedBy: 'x', preparedAt: new Date(), version: 1, createdAt: new Date(),
    });

    const matched = await bankFeed.matchLine({ tenantId: TENANT, feedLineId: line.id, depositId, actor: 'controller-1' });
    expect(matched.status).toBe('MATCHED');

    const again = await bankFeed.matchLine({ tenantId: TENANT, feedLineId: line.id, depositId, actor: 'controller-1' });
    expect(again.idempotent).toBe(true);

    const otherDepositId = uuid();
    prisma.cashDeposit._rows.push({
      id: otherDepositId, tenantId: TENANT, entityId: 'e1', storeId: 's1', bankAccountCode: 'OPERATING-001',
      businessDate: new Date(), status: 'OPEN', totalAmount: '100.00', idempotencyKey: uuid(), preparedBy: 'x', preparedAt: new Date(), version: 1, createdAt: new Date(),
    });
    await expect(
      bankFeed.matchLine({ tenantId: TENANT, feedLineId: line.id, depositId: otherDepositId, actor: 'controller-1' }),
    ).rejects.toBeInstanceOf(BankFeedLineAlreadyMatchedError);
  });
});
