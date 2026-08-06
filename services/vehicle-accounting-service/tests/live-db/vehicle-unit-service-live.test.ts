/**
 * S074 — Vehicle Unit Ledger & Stock-In, LIVE DATABASE integration tests.
 * Real PostgreSQL + real Prisma transactions/P2002-race handling; coa-service
 * itself is a scripted double (see tests/live-db/fakes.ts's header comment
 * for why that boundary, specifically, is the one legitimately out of
 * process here).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/vehicle-accounting-client';
import { VehicleUnitService } from '../../src/application/vehicle-unit-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { ScriptedPostingEngineClient, RecordingPostingRecoveryClient, StubScheduleServiceClient } from './fakes';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('Live database — S074 Vehicle Unit Ledger & Stock-In', () => {
  let prisma: PrismaClient;
  let engine: ScriptedPostingEngineClient;
  let recovery: RecordingPostingRecoveryClient;
  let svc: VehicleUnitService;
  const TENANT = `veh-s074-${randomUUID()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    engine = new ScriptedPostingEngineClient();
    recovery = new RecordingPostingRecoveryClient();
    const orchestrator = new PostingOrchestrator(engine, recovery);
    svc = new VehicleUnitService(prisma, orchestrator, new StubScheduleServiceClient());
  });

  afterAll(async () => {
    await prisma.vehicleCostComponent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleStockInEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleCostComponentEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleReconCostEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleUnit.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('one stock-in = one journal + one unit item; cost components sum exactly (AC)', async () => {
    engine.nextOutcome = 'POSTED';
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    const eventId = randomUUID();

    const result = await svc.stockIn(TENANT, 'test-actor', {
      eventId, stockNumber, vin: '1FTFW1E5XNFA00099', entityId: 'entity-1', storeId: 'store-1',
      status: 'NEW', acquisitionType: 'PURCHASE',
      invoiceCost: '25000.00', transportCost: '350.00', packCost: '150.00', packRole: 'PACK_INCOME', equipmentCost: '899.99',
    });

    expect(result.idempotent).toBe(false);
    expect(result.unit).toBeTruthy();
    expect(result.stockInEvent!.status).toBe('POSTED');
    expect(result.followUps).toHaveLength(3); // transport, pack, equipment

    const detail = await svc.getUnit(TENANT, stockNumber);
    expect(detail.tieOut.tiesOut).toBe(true);
    expect(detail.tieOut.bookValueCents).toBe(2_500_000 + 35_000 + 15_000 + 89_999);
    expect(detail.costComponents.map((c) => c.componentType).sort()).toEqual(['EQUIPMENT', 'INVOICE', 'PACK', 'TRANSPORT'].sort());
  });

  it('a duplicate stock event (same eventId) returns the original result — idempotent (AC)', async () => {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    const eventId = randomUUID();
    const input = {
      eventId, stockNumber, vin: '1FTFW1E5XNFA00100', entityId: 'entity-1', storeId: 'store-1',
      status: 'NEW' as const, acquisitionType: 'PURCHASE' as const, invoiceCost: '18000.00',
    };
    const first = await svc.stockIn(TENANT, 'test-actor', input);
    const second = await svc.stockIn(TENANT, 'test-actor', input);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.unit!.id).toBe(first.unit!.id);
    expect(engine.submittedEnvelopes.filter((e) => e.eventId === eventId)).toHaveLength(1); // coa-service short-circuits before a second submit is even needed
  });

  it('a duplicate stockNumber under a DIFFERENT eventId is refused (DUPLICATE_STOCK_NUMBER)', async () => {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    await svc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00101', entityId: 'entity-1', storeId: 'store-1',
      status: 'NEW', acquisitionType: 'PURCHASE', invoiceCost: '18000.00',
    });
    await expect(
      svc.stockIn(TENANT, 'test-actor', {
        eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00102', entityId: 'entity-1', storeId: 'store-1',
        status: 'NEW', acquisitionType: 'PURCHASE', invoiceCost: '19000.00',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_STOCK_NUMBER' });
  });

  it('a REJECTED posting (e.g. ACCOUNT_MAPPING_VALUES_PENDING) still creates the unit shell with bookValue 0, and reports an S021 dead letter', async () => {
    engine.nextOutcome = 'REJECTED';
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    const result = await svc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00103', entityId: 'entity-1', storeId: 'store-1',
      status: 'NEW', acquisitionType: 'PURCHASE', invoiceCost: '20000.00',
    });
    expect(result.stockInEvent!.status).toBe('REJECTED');
    expect(Number(result.unit!.bookValue)).toBe(0);
    expect(result.postingResult!.deadLetterReported).toBe(true);
    expect(recovery.calls.some((c) => c.envelope.eventId === result.stockInEvent!.eventId)).toBe(true);
    engine.nextOutcome = 'POSTED';
  });

  it('reconditioning cost add (CE-11 boundary) increments the unit book value and cost-buildup lineage', async () => {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    await svc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00104', entityId: 'entity-1', storeId: 'store-1',
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '12000.00',
    });
    const recon = await svc.addReconCost(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber, roNumber: 'RO-9001', amount: '450.00' });
    expect(recon.event!.status).toBe('POSTED');

    const detail = await svc.getUnit(TENANT, stockNumber);
    expect(detail.tieOut.bookValueCents).toBe(1_200_000 + 45_000);
    expect(detail.tieOut.tiesOut).toBe(true);
    expect(detail.reconEvents).toHaveLength(1);
  });

  it('duplicate stock-in run concurrently races safely to exactly one unit (P2002 reconciliation)', async () => {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    const eventId = randomUUID();
    const input = {
      eventId, stockNumber, vin: '1FTFW1E5XNFA00105', entityId: 'entity-1', storeId: 'store-1',
      status: 'NEW' as const, acquisitionType: 'PURCHASE' as const, invoiceCost: '15000.00',
    };
    const [a, b] = await Promise.all([svc.stockIn(TENANT, 'test-actor', input), svc.stockIn(TENANT, 'test-actor', input)]);
    expect(a.unit!.id).toBe(b.unit!.id);
    const units = await prisma.vehicleUnit.findMany({ where: { tenantId: TENANT, stockNumber } });
    expect(units).toHaveLength(1);
  });

  it('duplicate cost-component-add run concurrently races safely — bookValue increments EXACTLY once, never double-counted', async () => {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    await svc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00106', entityId: 'entity-1', storeId: 'store-1',
      status: 'NEW', acquisitionType: 'PURCHASE', invoiceCost: '10000.00',
    });
    const eventId = randomUUID();
    const beforeUnit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });

    const [a, b] = await Promise.all([
      svc.addCostComponent(TENANT, 'test-actor', { stockNumber, componentType: 'TRANSPORT', amount: '350.00', eventId }),
      svc.addCostComponent(TENANT, 'test-actor', { stockNumber, componentType: 'TRANSPORT', amount: '350.00', eventId }),
    ]);
    expect(a.event!.id).toBe(b.event!.id);

    const afterUnit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(afterUnit!.bookValue)).toBe(Number(beforeUnit!.bookValue) + 350); // NOT +700

    const components = await prisma.vehicleCostComponent.findMany({ where: { tenantId: TENANT, unitId: afterUnit!.id, componentType: 'TRANSPORT' } });
    expect(components).toHaveLength(1);
  });
});
