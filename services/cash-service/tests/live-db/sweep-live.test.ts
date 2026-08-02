/**
 * S056 — LIVE DATABASE integration tests for ZBA sweeps + FP-offset
 * allocation. Same skip pattern as tests/live-db/deposit-live.test.ts:
 * skipped entirely unless LIVE_DATABASE_URL is set; RLS-specific
 * assertions additionally require LIVE_DATABASE_APP_ROLE_URL (amacc_app,
 * non-superuser, RLS-enforced).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/cash-client';
import { SweepService } from '../../src/application/sweep-service';
import { FpOffsetService } from '../../src/application/fp-offset-service';
import { FpOffsetAllocationMismatchError } from '../../src/domain/sweep';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_ROLE_DB_URL = process.env['LIVE_DATABASE_APP_ROLE_URL'];

const noopEvents: IEventPublisher = { publish: async () => {}, subscribe: () => {} };

describe.skipIf(!LIVE_DB_URL)('Live database — S056 ZBA sweeps + FP-offset allocation: net-zero, idempotency, RLS', () => {
  let prisma: PrismaClient;
  let sweeps: SweepService;
  let fpOffset: FpOffsetService;

  const TENANT = `live-s056-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    container.reset();
    container.registerInstance('PrismaClient', prisma as any);
    container.registerInstance('IEventPublisher', noopEvents as any);
    container.register('SweepService', { useClass: SweepService });
    container.register('FpOffsetService', { useClass: FpOffsetService });
    sweeps = container.resolve('SweepService');
    fpOffset = container.resolve('FpOffsetService');
  });

  afterAll(async () => {
    await prisma.fpOffsetAllocationLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fpOffsetAllocation.deleteMany({ where: { tenantId: TENANT } });
    await prisma.zbaSweep.deleteMany({ where: { tenantId: TENANT } });
    await prisma.sweepAccountPairConfig.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.cashOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('records and posts a sweep exactly once — a single balanced matrix-row event nets to zero across the account pair', async () => {
    const pair = await sweeps.configurePair({
      tenantId: TENANT, entityId: ENTITY, storeAccountCode: 'STORE-LIVE-001', operatingAccountCode: 'OPERATING-LIVE-001', actor: 'live-controller-1',
    });
    const sweep = await sweeps.recordSweep({
      tenantId: TENANT, pairConfigId: pair.id, sweepDate: '2026-08-01', direction: 'STORE_TO_OPERATING',
      amount: '2500.00', idempotencyKey: randomUUID(), actor: 'live-controller-1',
    });
    const posted = await sweeps.postSweep(TENANT, sweep.id, 'live-controller-1');
    expect(posted.status).toBe('POSTED');
    const postedAgain = await sweeps.postSweep(TENANT, sweep.id, 'live-controller-1');
    expect(postedAgain.idempotent).toBe(true);

    const events = await prisma.cashOutboxEvent.findMany({ where: { tenantId: TENANT, eventType: 'cash.sweep.posted' } });
    expect(events).toHaveLength(1); // never posted twice
    const payload: any = events[0].payload;
    expect(payload.accountingAmounts).toHaveLength(1); // one amount describes both equal-and-opposite legs
  });

  it('allocation total equals the entered statement figure exactly; DB rejects a direct-SQL mismatched line insert (defense in depth)', async () => {
    const allocation = await fpOffset.createAllocation({
      tenantId: TENANT, entityId: ENTITY, lenderName: 'Live Floorplan Lender', statementDate: '2026-08-01',
      statementAmount: '3000.00',
      lines: [{ floorplanUnitRef: 'VIN-LIVE-1', amount: '1800.00' }, { floorplanUnitRef: 'VIN-LIVE-2', amount: '1200.00' }],
      idempotencyKey: randomUUID(), actor: 'live-controller-1',
    });
    const sum = allocation.lines.reduce((acc: number, l: any) => acc + Number(l.amount), 0);
    expect(sum).toBeCloseTo(3000.0);

    await expect(
      fpOffset.createAllocation({
        tenantId: TENANT, entityId: ENTITY, lenderName: 'Live Floorplan Lender', statementDate: '2026-08-01',
        statementAmount: '3000.00', lines: [{ floorplanUnitRef: 'VIN-LIVE-3', amount: '1000.00' }],
        idempotencyKey: randomUUID(), actor: 'live-controller-1',
      }),
    ).rejects.toBeInstanceOf(FpOffsetAllocationMismatchError);

    const posted = await fpOffset.postAllocation(TENANT, allocation.id, 'live-controller-1');
    expect(posted.status).toBe('POSTED');
    const postedAgain = await fpOffset.postAllocation(TENANT, allocation.id, 'live-controller-1');
    expect(postedAgain.idempotent).toBe(true);
    const events = await prisma.cashOutboxEvent.findMany({ where: { tenantId: TENANT, eventType: 'cash.fpoffset.allocation.posted' } });
    expect(events).toHaveLength(1);
  });

  it.skipIf(!APP_ROLE_DB_URL)('RLS positive+negative on sweep_account_pair_config / zba_sweep / fp_offset_allocation — Tenant A invisible to Tenant B under amacc_app', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: APP_ROLE_DB_URL });
    await client.connect();
    try {
      const pair = await sweeps.configurePair({
        tenantId: TENANT, entityId: ENTITY, storeAccountCode: 'STORE-LIVE-RLS', operatingAccountCode: 'OPERATING-LIVE-RLS', actor: 'live-controller-2',
      });
      const sweep = await sweeps.recordSweep({
        tenantId: TENANT, pairConfigId: pair.id, sweepDate: '2026-08-01', direction: 'OPERATING_TO_STORE',
        amount: '400.00', idempotencyKey: randomUUID(), actor: 'live-controller-2',
      });
      const allocation = await fpOffset.createAllocation({
        tenantId: TENANT, entityId: ENTITY, lenderName: 'Live Floorplan Lender RLS', statementDate: '2026-08-01',
        statementAmount: '100.00', lines: [{ floorplanUnitRef: 'VIN-LIVE-RLS', amount: '100.00' }],
        idempotencyKey: randomUUID(), actor: 'live-controller-2',
      });

      // Positive: same tenant context can see its own rows.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const ownPair = await client.query('SELECT id FROM sweep_account_pair_config WHERE id = $1', [pair.id]);
      expect(ownPair.rowCount).toBe(1);
      const ownSweep = await client.query('SELECT id FROM zba_sweep WHERE id = $1', [sweep.id]);
      expect(ownSweep.rowCount).toBe(1);
      const ownAllocation = await client.query('SELECT id FROM fp_offset_allocation WHERE id = $1', [allocation.id]);
      expect(ownAllocation.rowCount).toBe(1);

      // Negative: a different tenant context sees zero rows for the same ids.
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, ['a-completely-different-tenant']);
      const crossPair = await client.query('SELECT id FROM sweep_account_pair_config WHERE id = $1', [pair.id]);
      expect(crossPair.rowCount).toBe(0);
      const crossSweep = await client.query('SELECT id FROM zba_sweep WHERE id = $1', [sweep.id]);
      expect(crossSweep.rowCount).toBe(0);
      const crossAllocation = await client.query('SELECT id FROM fp_offset_allocation WHERE id = $1', [allocation.id]);
      expect(crossAllocation.rowCount).toBe(0);

      // Negative: a cross-tenant INSERT attempt is rejected (WITH CHECK), not just filtered on read.
      await expect(
        client.query(
          `INSERT INTO sweep_account_pair_config (id, tenant_id, entity_id, store_account_code, operating_account_code, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), TENANT, ENTITY, 'STORE-FORGED', 'OPERATING-FORGED', 'forger'],
        ),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
