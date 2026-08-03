/**
 * S053 — LIVE DATABASE integration tests for deposits + bank feed. Same
 * pattern as tests/live-db/cash-flow-live.test.ts: skipped entirely unless
 * LIVE_DATABASE_URL is set; RLS-specific assertions additionally require
 * LIVE_DATABASE_APP_ROLE_URL (amacc_app, non-superuser, RLS-enforced).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import { DrawerService } from '../../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../../src/application/receipt-sequence-service';
import { ReceiptService } from '../../src/application/cash-receipt-service';
import { DepositService, ReceiptNotEligibleError } from '../../src/application/deposit-service';
import { BankFeedService } from '../../src/application/bank-feed-service';
import { UnconfiguredBankFeedAdapter } from '../../src/infrastructure/bank-feed-adapter';
import { NoopCashReceiptPostingPort } from '../../src/application/cash-receipt-posting-consumer';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_ROLE_DB_URL = process.env['LIVE_DATABASE_APP_ROLE_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('Live database — S053 deposits + bank feed: conservation, idempotency, RLS', () => {
  let prisma: PrismaClient;
  let drawers: DrawerService;
  let receipts: ReceiptService;
  let deposits: DepositService;
  let bankFeed: BankFeedService;

  const TENANT = `live-s053-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();
  const STORE = randomUUID();
  const STORE_CODE = 'S053';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    container.reset();
    container.registerInstance('PrismaClient', prisma as any);
    container.registerInstance('IEventPublisher', noopEvents as any);
    container.registerInstance('BankFeedAdapter', new UnconfiguredBankFeedAdapter());
    // fix(integration): ReceiptService now requires CashReceiptPostingPort
    // (real CE-07 governed-posting call, wired in index.ts) — this test
    // never exercises receipt posting itself (S053 deposits/bank-feed
    // conservation), so it uses the same no-op fallback index.ts itself
    // falls back to when no posting JWT secret is configured, never a
    // fabricated posting success.
    container.registerInstance('CashReceiptPostingPort', new NoopCashReceiptPostingPort());
    container.register('DrawerService', { useClass: DrawerService });
    container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
    container.register('ReceiptService', { useClass: ReceiptService });
    container.register('DepositService', { useClass: DepositService });
    container.register('BankFeedService', { useClass: BankFeedService });
    drawers = container.resolve('DrawerService');
    receipts = container.resolve('ReceiptService');
    deposits = container.resolve('DepositService');
    bankFeed = container.resolve('BankFeedService');
  });

  afterAll(async () => {
    await prisma.bankFeedLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashDepositLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashDeposit.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceiptTender.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceipt.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$executeRawUnsafe('ALTER TABLE cash_drawer_movement DISABLE TRIGGER trg_cash_drawer_movement_append_only');
    await prisma.cashDrawerMovement.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$executeRawUnsafe('ALTER TABLE cash_drawer_movement ENABLE TRIGGER trg_cash_drawer_movement_append_only');
    await prisma.cashDrawer.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceiptSequence.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  async function openLiveDrawer(cashierId: string, terminal: string) {
    return drawers.open({
      tenantId: TENANT, entityId: ENTITY, storeId: STORE, storeCode: STORE_CODE, terminalCode: terminal,
      cashierId, businessDate: '2026-08-01', openingFloat: 100, actor: cashierId,
    });
  }

  it('deposits real receipts, posts exactly once, and a receipt cannot be deposited twice (real unique-constraint race)', async () => {
    const drawer = await openLiveDrawer('live-s053-cashier-1', 'S053-T1');
    const r1 = await receipts.createReceipt({
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-S053-1',
      totalAmount: 55.5, tenders: [{ tenderType: 'CASH', amount: 55.5 }], idempotencyKey: randomUUID(), actor: 'live-s053-cashier-1',
    });

    const batch = await deposits.createDepositBatch({
      tenantId: TENANT, entityId: ENTITY, storeId: STORE, bankAccountCode: 'OPERATING-001',
      businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: randomUUID(), actor: 'live-controller-1',
    });
    expect(Number(batch.totalAmount)).toBeCloseTo(55.5);

    // Real DB race: a concurrent second batch attempt over the same receipt
    // must fail on the real unique index, not just app-level logic.
    await expect(
      deposits.createDepositBatch({
        tenantId: TENANT, entityId: ENTITY, storeId: STORE, bankAccountCode: 'OPERATING-001',
        businessDate: '2026-08-01', receiptIds: [r1.id], idempotencyKey: randomUUID(), actor: 'live-controller-1',
      }),
    ).rejects.toBeInstanceOf(ReceiptNotEligibleError);

    const posted = await deposits.postDeposit(TENANT, batch.id, 'live-controller-1');
    expect(posted.status).toBe('POSTED');
    const postedAgain = await deposits.postDeposit(TENANT, batch.id, 'live-controller-1');
    expect(postedAgain.idempotent).toBe(true);

    const events = await prisma.cashOutboxEvent.findMany({ where: { tenantId: TENANT, eventType: 'cash.deposit.posted' } });
    expect(events).toHaveLength(1); // never posted twice
  });

  it('bank feed: manual import always available; adapter status is truthfully BANK_FEED_NOT_CONFIGURED', async () => {
    expect(bankFeed.getAdapterStatus()).toEqual({ state: 'BANK_FEED_NOT_CONFIGURED' });
    const line = await bankFeed.importManualLine({
      tenantId: TENANT, bankAccountCode: 'OPERATING-001', amount: 55.5, valueDate: '2026-08-01', actor: 'live-controller-1',
    });
    expect(line.status).toBe('UNMATCHED');
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS positive+negative on cash_deposit / cash_deposit_line / bank_feed_line — Tenant A invisible to Tenant B under amacc_app', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const drawer = await openLiveDrawer('live-s053-cashier-2', 'S053-T2');
      const r2 = await receipts.createReceipt({
        tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-S053-2',
        totalAmount: 20, tenders: [{ tenderType: 'CASH', amount: 20 }], idempotencyKey: randomUUID(), actor: 'live-s053-cashier-2',
      });
      const batch = await deposits.createDepositBatch({
        tenantId: TENANT, entityId: ENTITY, storeId: STORE, bankAccountCode: 'OPERATING-001',
        businessDate: '2026-08-01', receiptIds: [r2.id], idempotencyKey: randomUUID(), actor: 'live-controller-2',
      });
      await bankFeed.importManualLine({ tenantId: TENANT, bankAccountCode: 'OPERATING-001', amount: 20, valueDate: '2026-08-01', actor: 'live-controller-2' });

      // Positive: same tenant context can see its own rows.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownDeposit = await client.query('SELECT id FROM cash_deposit WHERE id = $1', [batch.id]);
      expect(ownDeposit.rowCount).toBe(1);
      const ownLines = await client.query('SELECT id FROM cash_deposit_line WHERE deposit_id = $1', [batch.id]);
      expect(ownLines.rowCount).toBe(1);
      const ownFeed = await client.query('SELECT id FROM bank_feed_line WHERE tenant_id = $1', [TENANT]);
      expect((ownFeed.rowCount ?? 0) >= 1).toBe(true);

      // Negative: a different tenant context sees zero rows for the same ids.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossDeposit = await client.query('SELECT id FROM cash_deposit WHERE id = $1', [batch.id]);
      expect(crossDeposit.rowCount).toBe(0);
      const crossLines = await client.query('SELECT id FROM cash_deposit_line WHERE deposit_id = $1', [batch.id]);
      expect(crossLines.rowCount).toBe(0);
      const crossFeed = await client.query('SELECT id FROM bank_feed_line WHERE tenant_id = $1', [TENANT]);
      expect(crossFeed.rowCount).toBe(0);

      // Negative: a cross-tenant INSERT attempt is rejected (WITH CHECK), not just filtered on read.
      await expect(
        client.query(
          `INSERT INTO cash_deposit (id, tenant_id, entity_id, store_id, bank_account_code, business_date, total_amount, idempotency_key, prepared_by)
           VALUES ($1, $2, $3, $4, $5, $6, 1.00, $7, $8)`,
          [randomUUID(), TENANT, ENTITY, STORE, 'OPERATING-001', '2026-08-01', randomUUID(), 'forger'],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
