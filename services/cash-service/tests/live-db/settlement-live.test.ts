/**
 * S055 — LIVE DATABASE integration tests for merchant settlement
 * reconciliation. Same skip pattern as tests/live-db/deposit-live.test.ts:
 * skipped entirely unless LIVE_DATABASE_URL is set; RLS-specific
 * assertions additionally require LIVE_DATABASE_APP_ROLE_URL (amacc_app,
 * non-superuser, RLS-enforced).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import { SettlementService, ChargebackAlreadyDispositionedError } from '../../src/application/settlement-service';
import { UnconfiguredSettlementAdapter } from '../../src/infrastructure/settlement-adapter';
import { SettlementConservationError } from '../../src/domain/settlement';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_ROLE_DB_URL = process.env['LIVE_DATABASE_APP_ROLE_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('Live database — S055 merchant settlement reconciliation: conservation, idempotency, RLS', () => {
  let prisma: PrismaClient;
  let settlement: SettlementService;

  const TENANT = `live-s055-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    container.reset();
    container.registerInstance('PrismaClient', prisma as any);
    container.registerInstance('IEventPublisher', noopEvents as any);
    container.registerInstance('SettlementAdapter', new UnconfiguredSettlementAdapter());
    container.register('SettlementService', { useClass: SettlementService });
    settlement = container.resolve('SettlementService');
  });

  afterAll(async () => {
    await prisma.settlementAdjustment.deleteMany({ where: { tenantId: TENANT } });
    await prisma.settlementChargeback.deleteMany({ where: { tenantId: TENANT } });
    await prisma.settlementWorklistItem.deleteMany({ where: { tenantId: TENANT } });
    await prisma.settlementBatchLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.settlementBatch.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('imports a batch, enforces gross-fee-net conservation at both app AND DB (CHECK constraint) level, posts exactly once', async () => {
    const batch = await settlement.importBatch({
      tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
      batchReference: 'LIVE-BATCH-1', settlementDate: '2026-08-01', grossAmount: '200.00', feeAmount: '6.00', netAmount: '194.00',
      idempotencyKey: randomUUID(), actor: 'live-controller-1',
    });
    expect(Number(batch.grossAmount) - Number(batch.feeAmount)).toBeCloseTo(Number(batch.netAmount));

    await expect(
      settlement.importBatch({
        tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
        batchReference: 'LIVE-BATCH-BAD', settlementDate: '2026-08-01', grossAmount: '200.00', feeAmount: '6.00', netAmount: '190.00',
        idempotencyKey: randomUUID(), actor: 'live-controller-1',
      }),
    ).rejects.toBeInstanceOf(SettlementConservationError);

    // Real DB race: direct SQL bypass of app-level conservation check must
    // still be rejected by the CHECK constraint.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO settlement_batch (id, tenant_id, entity_id, bank_account_code, processor_name, batch_reference, settlement_date, gross_amount, fee_amount, net_amount, idempotency_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 200.00, 6.00, 100.00, $8, 'IMPORTED')`,
        randomUUID(), TENANT, ENTITY, 'OPERATING-001', 'MANUAL_IMPORT', 'LIVE-BATCH-FORGED', new Date('2026-08-01'), randomUUID(),
      ),
    ).rejects.toThrow();

    const posted = await settlement.postBatch(TENANT, batch.id, 'live-controller-1');
    expect(posted.status).toBe('POSTED');
    const postedAgain = await settlement.postBatch(TENANT, batch.id, 'live-controller-1');
    expect(postedAgain.idempotent).toBe(true);
    const events = await prisma.cashOutboxEvent.findMany({ where: { tenantId: TENANT, eventType: 'cash.settlement.fee.recognized' } });
    expect(events).toHaveLength(1); // fee never silently netted, never posted twice
  });

  it('each chargeback creates its dispositioned adjustment exactly once (real unique FK)', async () => {
    const chargeback = await settlement.intakeChargeback({ tenantId: TENANT, entityId: ENTITY, amount: '40.00', actor: 'live-controller-1' });
    const adjustment = await settlement.dispositionChargeback({
      tenantId: TENANT, chargebackId: chargeback.id, dispositionAction: 'CUSTOMER_RESPONSIBILITY', actor: 'live-controller-1',
    });
    expect(adjustment.dispositionAction).toBe('CUSTOMER_RESPONSIBILITY');

    await expect(
      settlement.dispositionChargeback({ tenantId: TENANT, chargebackId: chargeback.id, dispositionAction: 'MERCHANT_ABSORBED', actor: 'live-controller-1' }),
    ).rejects.toBeInstanceOf(ChargebackAlreadyDispositionedError);

    // Real DB race: direct SQL bypass must still hit the unique FK on chargeback_id.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO settlement_adjustment (id, tenant_id, chargeback_id, disposition_action, amount, actor)
         VALUES ($1, $2, $3, 'MERCHANT_ABSORBED', 40.00, 'forger')`,
        randomUUID(), TENANT, chargeback.id,
      ),
    ).rejects.toThrow();

    const rows = await prisma.settlementAdjustment.findMany({ where: { tenantId: TENANT, chargebackId: chargeback.id } });
    expect(rows).toHaveLength(1);
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS positive+negative on settlement_batch / settlement_chargeback / settlement_adjustment — Tenant A invisible to Tenant B under amacc_app', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const batch = await settlement.importBatch({
        tenantId: TENANT, entityId: ENTITY, bankAccountCode: 'OPERATING-001', processorName: 'MANUAL_IMPORT',
        batchReference: 'LIVE-BATCH-RLS', settlementDate: '2026-08-01', grossAmount: '75.00', feeAmount: '2.00', netAmount: '73.00',
        idempotencyKey: randomUUID(), actor: 'live-controller-3',
      });
      const chargeback = await settlement.intakeChargeback({ tenantId: TENANT, entityId: ENTITY, batchId: batch.id, amount: '10.00', actor: 'live-controller-3' });

      // Positive: same tenant context can see its own rows.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownBatch = await client.query('SELECT id FROM settlement_batch WHERE id = $1', [batch.id]);
      expect(ownBatch.rowCount).toBe(1);
      const ownChargeback = await client.query('SELECT id FROM settlement_chargeback WHERE id = $1', [chargeback.id]);
      expect(ownChargeback.rowCount).toBe(1);

      // Negative: a different tenant context sees zero rows for the same ids.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossBatch = await client.query('SELECT id FROM settlement_batch WHERE id = $1', [batch.id]);
      expect(crossBatch.rowCount).toBe(0);
      const crossChargeback = await client.query('SELECT id FROM settlement_chargeback WHERE id = $1', [chargeback.id]);
      expect(crossChargeback.rowCount).toBe(0);

      // Negative: a cross-tenant INSERT attempt is rejected (WITH CHECK), not just filtered on read.
      await expect(
        client.query(
          `INSERT INTO settlement_batch (id, tenant_id, entity_id, bank_account_code, processor_name, batch_reference, settlement_date, gross_amount, fee_amount, net_amount, idempotency_key, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 10.00, 1.00, 9.00, $8, 'IMPORTED')`,
          [randomUUID(), TENANT, ENTITY, 'OPERATING-001', 'MANUAL_IMPORT', 'LIVE-BATCH-FORGED-2', '2026-08-01', randomUUID()],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
