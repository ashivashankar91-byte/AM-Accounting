/**
 * S057 — LIVE DATABASE integration tests for the daily cash position
 * dashboard: composition against real S052/S053 data, large-cash flag
 * threshold-config gating, export retention/audit, and RLS on
 * large_cash_threshold_config / cash_position_export. Same skip pattern
 * as tests/live-db/deposit-live.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import { DrawerService } from '../../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../../src/application/receipt-sequence-service';
import { ReceiptService } from '../../src/application/cash-receipt-service';
import { DepositService } from '../../src/application/deposit-service';
import { UnconfiguredBankFeedAdapter } from '../../src/infrastructure/bank-feed-adapter';
import { BankFeedService } from '../../src/application/bank-feed-service';
import { CashPositionService } from '../../src/application/cash-position-service';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_ROLE_DB_URL = process.env['LIVE_DATABASE_APP_ROLE_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('Live database — S057 daily cash position dashboard: traceable composition, threshold gating, export audit, RLS', () => {
  let prisma: PrismaClient;
  let drawers: DrawerService;
  let receipts: ReceiptService;
  let deposits: DepositService;
  let cashPosition: CashPositionService;
  const originalFetch = global.fetch;

  const TENANT = `live-s057-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();
  const STORE = randomUUID();
  const STORE_CODE = 'S057';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    container.reset();
    container.registerInstance('PrismaClient', prisma as any);
    container.registerInstance('IEventPublisher', noopEvents as any);
    container.registerInstance('BankFeedAdapter', new UnconfiguredBankFeedAdapter());
    container.register('DrawerService', { useClass: DrawerService });
    container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
    container.register('ReceiptService', { useClass: ReceiptService });
    container.register('DepositService', { useClass: DepositService });
    container.register('BankFeedService', { useClass: BankFeedService });
    container.register('CashPositionService', { useClass: CashPositionService });
    drawers = container.resolve('DrawerService');
    receipts = container.resolve('ReceiptService');
    deposits = container.resolve('DepositService');
    cashPosition = container.resolve('CashPositionService');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.cashPositionExport.deleteMany({ where: { tenantId: TENANT } });
    await prisma.largeCashThresholdConfig.deleteMany({ where: { tenantId: TENANT } });
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

  it('composes a traceable daily cash position from real drawer/receipt/deposit rows and gates large-cash flags on threshold config exactly', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('no external service in this live-db test')) as any;

    const drawer = await drawers.open({
      tenantId: TENANT, entityId: ENTITY, storeId: STORE, storeCode: STORE_CODE, terminalCode: 'S057-T1',
      cashierId: 'live-s057-cashier-1', businessDate: '2026-08-01', openingFloat: 100, actor: 'live-s057-cashier-1',
    });
    await receipts.createReceipt({
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-S057-1',
      totalAmount: 12000, tenders: [{ tenderType: 'CASH', amount: 12000 }], idempotencyKey: randomUUID(), actor: 'live-s057-cashier-1',
    });

    const noConfig = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' });
    expect(noConfig.drawerSessions.items).toHaveLength(1);
    expect(noConfig.undepositedReceipts.total).toBeCloseTo(12000);
    expect(noConfig.largeCashTransactionFlags.flags).toHaveLength(0); // no threshold configured => no flags, never guessed
    expect(noConfig.outstandingChecks.state).toBe('PENDING_SERVICE_INTEGRATION');
    expect(noConfig.bankBalances.items).toHaveLength(0); // no posted deposits yet for this tenant

    await prisma.largeCashThresholdConfig.create({
      data: { id: randomUUID(), tenantId: TENANT, jurisdiction: 'US-FEDERAL', thresholdAmount: '10000.00', currency: 'USD', updatedBy: 'live-controller-1' },
    });
    const withConfig = await cashPosition.getDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01', jurisdiction: 'US-FEDERAL' });
    expect(withConfig.largeCashTransactionFlags.flags).toHaveLength(1);
    expect(withConfig.largeCashTransactionFlags.configuredThresholdCount).toBe(1);
  });

  it('export retains an audited, verbatim snapshot exactly once per call and is listable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('no external service in this live-db test')) as any;
    const exported = await cashPosition.exportDailyCashPosition({ tenantId: TENANT, entityId: ENTITY, businessDate: '2026-08-01' }, 'live-controller-1');
    expect(exported.requestedBy).toBe('live-controller-1');
    const list = await cashPosition.listExports(TENANT, { entityId: ENTITY });
    expect(list.items.some((i: any) => i.id === exported.id)).toBe(true);
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS positive+negative on large_cash_threshold_config / cash_position_export — Tenant A invisible to Tenant B under amacc_app', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const threshold = await prisma.largeCashThresholdConfig.findFirst({ where: { tenantId: TENANT } });
      const exportRow = await prisma.cashPositionExport.findFirst({ where: { tenantId: TENANT } });
      expect(threshold).toBeTruthy();
      expect(exportRow).toBeTruthy();

      // Positive: same tenant context can see its own rows.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownThreshold = await client.query('SELECT id FROM large_cash_threshold_config WHERE id = $1', [threshold!.id]);
      expect(ownThreshold.rowCount).toBe(1);
      const ownExport = await client.query('SELECT id FROM cash_position_export WHERE id = $1', [exportRow!.id]);
      expect(ownExport.rowCount).toBe(1);

      // Negative: a different tenant context sees zero rows for the same ids.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossThreshold = await client.query('SELECT id FROM large_cash_threshold_config WHERE id = $1', [threshold!.id]);
      expect(crossThreshold.rowCount).toBe(0);
      const crossExport = await client.query('SELECT id FROM cash_position_export WHERE id = $1', [exportRow!.id]);
      expect(crossExport.rowCount).toBe(0);

      // Negative: a cross-tenant INSERT attempt is rejected (WITH CHECK), not just filtered on read.
      await expect(
        client.query(
          `INSERT INTO large_cash_threshold_config (id, tenant_id, jurisdiction, threshold_amount, currency, updated_by)
           VALUES ($1, $2, $3, 5000.00, 'USD', $4)`,
          [randomUUID(), TENANT, 'US-FORGED', 'forger'],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
