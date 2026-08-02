/**
 * S052 — LIVE DATABASE integration tests. Unlike every other cash-service
 * test (which mocks Prisma), these run against a real PostgreSQL instance
 * and prove guarantees a mock cannot: real unique-constraint concurrency,
 * the append-only/immutability triggers, real Postgres RLS enforcement
 * under the non-superuser amacc_app role, and atomicity of a genuinely
 * committed transaction. Mirrors coa-service/tests/live-db/posting-live.test.ts.
 *
 * Skipped entirely unless LIVE_DATABASE_URL is set. This file's
 * LIVE_DATABASE_URL is expected to authenticate as a role that bypasses RLS
 * (the migration superuser) for the general application-flow tests; the RLS
 * tests explicitly reconnect as amacc_app and set app.current_tenant_id via
 * a single-connection session (raw SQL — no pooling hazard), per
 * coa-service's documented pattern for proving real tenant isolation.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import { DrawerService } from '../../src/application/cash-drawer-service';
import { ReceiptSequenceService } from '../../src/application/receipt-sequence-service';
import { ReceiptService } from '../../src/application/cash-receipt-service';
import { ToleranceService } from '../../src/application/tolerance-service';
import { BlindCloseService } from '../../src/application/blind-close-service';
import { ReconciliationService } from '../../src/application/reconciliation-service';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_ROLE_DB_URL = process.env['LIVE_DATABASE_APP_ROLE_URL']; // amacc_app, for RLS tests

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('Live database — cash-service atomicity, idempotency, RLS, concurrency', () => {
  let prisma: PrismaClient;
  let drawers: DrawerService;
  let receipts: ReceiptService;
  let blindClose: BlindCloseService;
  let recon: ReconciliationService;

  const TENANT = `live-test-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();
  const STORE = randomUUID();
  const STORE_CODE = 'LTST';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    container.reset();
    container.registerInstance('PrismaClient', prisma as any);
    container.registerInstance('IEventPublisher', noopEvents as any);
    container.register('DrawerService', { useClass: DrawerService });
    container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
    container.registerInstance('CashReceiptPostingPort', { submit: async () => {} } as any);
    container.register('ReceiptService', { useClass: ReceiptService });
    container.register('ToleranceService', { useClass: ToleranceService });
    container.register('BlindCloseService', { useClass: BlindCloseService });
    container.register('ReconciliationService', { useClass: ReconciliationService });
    drawers = container.resolve('DrawerService');
    receipts = container.resolve('ReceiptService');
    blindClose = container.resolve('BlindCloseService');
    recon = container.resolve('ReconciliationService');
  });

  afterAll(async () => {
    await prisma.cashVarianceApproval.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashDrawerVariance.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashBlindCountLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashBlindCount.deleteMany({ where: { tenantId: TENANT } });
    // cash_drawer_movement is append-only by design (trg_cash_drawer_movement_append_only)
    // — even this superuser connection is blocked by the trigger (triggers,
    // unlike RLS, are not bypassed by BYPASSRLS/superuser). Test-cleanup-only
    // bypass: disable/re-enable the trigger around this one DELETE, a
    // privilege the amacc_app runtime role never has (not the table owner).
    await prisma.$executeRawUnsafe('ALTER TABLE cash_drawer_movement DISABLE TRIGGER trg_cash_drawer_movement_append_only');
    await prisma.cashDrawerMovement.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$executeRawUnsafe('ALTER TABLE cash_drawer_movement ENABLE TRIGGER trg_cash_drawer_movement_append_only');
    await prisma.cashReceiptTender.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceipt.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashDrawer.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashReceiptSequence.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  async function openLiveDrawer(cashierId: string, terminalCode: string) {
    return drawers.open({
      tenantId: TENANT, entityId: ENTITY, storeId: STORE, storeCode: STORE_CODE, terminalCode,
      cashierId, businessDate: '2026-07-29', openingFloat: 100, actor: cashierId,
    });
  }

  it('receipt creation commits header + tenders + movement + audit + outbox atomically against a real transaction', async () => {
    const drawer = await openLiveDrawer('live-cashier-1', 'LIVE-T1');
    const result = await receipts.createReceipt({
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-LIVE-1',
      totalAmount: 75, tenders: [{ tenderType: 'CASH', amount: 75 }], idempotencyKey: randomUUID(), actor: 'live-cashier-1',
    });
    expect(result.idempotent).toBe(false);

    const tenders = await prisma.cashReceiptTender.findMany({ where: { receiptId: result.id } });
    expect(tenders).toHaveLength(1);
    const movements = await prisma.cashDrawerMovement.findMany({ where: { drawerId: drawer.id, movementType: 'CASH_RECEIPT' } });
    expect(movements).toHaveLength(1);
    const auditRows = await prisma.auditOutboxEvent.findMany({ where: { tenantId: TENANT, docId: result.id } });
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it('re-creating with the SAME idempotencyKey returns the original receipt — proven against a real unique constraint, not a mock', async () => {
    const drawer = await openLiveDrawer('live-cashier-2', 'LIVE-T2');
    const idempotencyKey = randomUUID();
    const dto = {
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-LIVE-2',
      totalAmount: 40, tenders: [{ tenderType: 'CASH' as const, amount: 40 }], idempotencyKey, actor: 'live-cashier-2',
    };
    const first = await receipts.createReceipt(dto);
    const second = await receipts.createReceipt(dto);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);
    const count = await prisma.cashReceipt.count({ where: { tenantId: TENANT, idempotencyKey } });
    expect(count).toBe(1);
  });

  it('20 concurrent duplicate-idempotencyKey submissions create exactly ONE receipt (real unique-constraint race)', async () => {
    const drawer = await openLiveDrawer('live-cashier-3', 'LIVE-T3');
    const idempotencyKey = randomUUID();
    const dto = {
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-LIVE-3',
      totalAmount: 10, tenders: [{ tenderType: 'CASH' as const, amount: 10 }], idempotencyKey, actor: 'live-cashier-3',
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => receipts.createReceipt(dto)));
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const count = await prisma.cashReceipt.count({ where: { tenantId: TENANT, idempotencyKey } });
    expect(count).toBe(1);
  });

  it('the append-only trigger rejects a direct UPDATE of a drawer movement, bypassing the application layer entirely', async () => {
    const drawer = await openLiveDrawer('live-cashier-4', 'LIVE-T4');
    const movement = await prisma.cashDrawerMovement.findFirstOrThrow({ where: { drawerId: drawer.id, movementType: 'OPEN_FLOAT' } });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE cash_drawer_movement SET amount = 999 WHERE id = $1`, movement.id),
    ).rejects.toThrow(/append-only/);
  });

  it('one active drawer per (tenant, cashier, store) is enforced by a real DB partial unique index, not just the app pre-check', async () => {
    const drawer = await openLiveDrawer('live-cashier-active-1', 'LIVE-ACTIVE-T1');
    // Bypass DrawerService.open()'s app-level pre-check entirely — insert a
    // second OPEN drawer for the SAME (tenant, cashier, store) directly via
    // raw SQL, proving cash_drawer_active_cashier_location_uq is the real
    // backstop, not merely a redundant check the app already made.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO cash_drawer (id, tenant_id, entity_id, store_id, store_code, terminal_code, cashier_id, business_date, opening_float, opened_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, 0, $9, 'OPEN')`,
        randomUUID(), TENANT, ENTITY, STORE, STORE_CODE, 'LIVE-ACTIVE-T1B', 'live-cashier-active-1', '2026-07-29', 'live-cashier-active-1',
      ),
    ).rejects.toThrow(/Key \(tenant_id, cashier_id, store_id\)/);
    // the index is partial (WHERE status <> 'RECONCILED'), not absolute.
    await prisma.$executeRawUnsafe(`UPDATE cash_drawer SET status = 'RECONCILED' WHERE id = $1`, drawer.id);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO cash_drawer (id, tenant_id, entity_id, store_id, store_code, terminal_code, cashier_id, business_date, opening_float, opened_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, 0, $9, 'OPEN')`,
        randomUUID(), TENANT, ENTITY, STORE, STORE_CODE, 'LIVE-ACTIVE-T1C', 'live-cashier-active-1', '2026-07-29', 'live-cashier-active-1',
      ),
    ).resolves.toBeTruthy();
  });

  it('one active drawer per (tenant, terminal) is enforced by a real DB partial unique index — a second cashier cannot open the SAME terminal', async () => {
    const drawer = await openLiveDrawer('live-cashier-active-2', 'LIVE-ACTIVE-T2');
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO cash_drawer (id, tenant_id, entity_id, store_id, store_code, terminal_code, cashier_id, business_date, opening_float, opened_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, 0, $9, 'OPEN')`,
        randomUUID(), TENANT, ENTITY, STORE, STORE_CODE, 'LIVE-ACTIVE-T2', 'live-cashier-active-2b', '2026-07-29', 'live-cashier-active-2b',
      ),
    ).rejects.toThrow(/Key \(tenant_id, terminal_code\)/);
  });

  it('the immutability trigger rejects a direct UPDATE of an issued receipt total, bypassing the application layer entirely', async () => {
    const drawer = await openLiveDrawer('live-cashier-5', 'LIVE-T5');
    const receipt = await receipts.createReceipt({
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-LIVE-5',
      totalAmount: 20, tenders: [{ tenderType: 'CASH', amount: 20 }], idempotencyKey: randomUUID(), actor: 'live-cashier-5',
    });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE cash_receipt SET total_amount = 9999 WHERE id = $1`, receipt.id),
    ).rejects.toThrow(/immutable/);
  });

  it('void preserves the original receipt and creates a compensating movement, proven end-to-end against real Postgres', async () => {
    const drawer = await openLiveDrawer('live-cashier-6', 'LIVE-T6');
    const receipt = await receipts.createReceipt({
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-LIVE-6',
      totalAmount: 30, tenders: [{ tenderType: 'CASH', amount: 30 }], idempotencyKey: randomUUID(), actor: 'live-cashier-6',
    });
    await receipts.voidReceipt({ tenantId: TENANT, receiptId: receipt.id, reason: 'live-db test void', actor: 'live-cashier-6' });
    const stillThere = await prisma.cashReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(stillThere.status).toBe('VOIDED');
    expect(Number(stillThere.totalAmount)).toBe(30); // original amount preserved
    const reversal = await prisma.cashDrawerMovement.findFirstOrThrow({ where: { receiptId: receipt.id, movementType: 'CASH_VOID_REVERSAL' } });
    expect(Number(reversal.amount)).toBe(-30);
  });

  it('a full drawer lifecycle reconciles exactly: open -> receipt -> blind close -> reconcile, expected == counted', async () => {
    const drawer = await openLiveDrawer('live-cashier-7', 'LIVE-T7');
    await receipts.createReceipt({
      tenantId: TENANT, entityId: ENTITY, drawerId: drawer.id, sourceDocType: 'SERVICE_RO', sourceDocId: 'RO-LIVE-7',
      totalAmount: 60, tenders: [{ tenderType: 'CASH', amount: 60 }], idempotencyKey: randomUUID(), actor: 'live-cashier-7',
    });
    const close = await blindClose.submit({
      tenantId: TENANT, drawerId: drawer.id, countedCash: 160, checkCount: 0, checkTotal: 0, retainedFloat: 0, actor: 'live-cashier-7',
    });
    expect(close.status).toBe('BLIND_COUNT_SUBMITTED');
    const view = await recon.getReconciliation(TENANT, drawer.id);
    expect(Number(view.variance.expectedCash)).toBe(160);
    expect(Number(view.variance.cashVariance)).toBe(0);
    const reconciled = await recon.reconcile({ tenantId: TENANT, drawerId: drawer.id, actor: 'supervisor-live-1' });
    expect(reconciled.status).toBe('RECONCILED');
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS is effective under the non-superuser amacc_app role — Tenant A cannot read Tenant B rows', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const drawerA = await openLiveDrawer('rls-cashier-a', 'RLS-T-A');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownRows = await client.query('SELECT id FROM cash_drawer WHERE id = $1', [drawerA.id]);
      expect(ownRows.rowCount).toBe(1);

      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossTenantRows = await client.query('SELECT id FROM cash_drawer WHERE id = $1', [drawerA.id]);
      expect(crossTenantRows.rowCount).toBe(0);

      // A cross-tenant INSERT attempt is also rejected (WITH CHECK), not just filtered on read.
      await expect(
        client.query(
          `INSERT INTO cash_drawer (id, tenant_id, entity_id, store_id, store_code, terminal_code, cashier_id, business_date, opening_float, opened_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
          [randomUUID(), TENANT, ENTITY, STORE, STORE_CODE, 'RLS-FORGE', 'forger', '2026-07-29', 'forger'],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
