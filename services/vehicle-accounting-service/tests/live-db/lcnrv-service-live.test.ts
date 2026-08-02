/**
 * S076 — Used LCNRV Write-downs, LIVE DATABASE integration tests.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/vehicle-accounting-client';
import { VehicleUnitService } from '../../src/application/vehicle-unit-service';
import { LcnrvService } from '../../src/application/lcnrv-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { ScriptedPostingEngineClient, RecordingPostingRecoveryClient, StubScheduleServiceClient } from './fakes';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('Live database — S076 Used LCNRV Write-downs', () => {
  let prisma: PrismaClient;
  let engine: ScriptedPostingEngineClient;
  let unitSvc: VehicleUnitService;
  let lcnrvSvc: LcnrvService;
  const TENANT = `veh-s076-${randomUUID()}`;
  const ENTITY = 'entity-1';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    engine = new ScriptedPostingEngineClient();
    const orchestrator = new PostingOrchestrator(engine, new RecordingPostingRecoveryClient());
    unitSvc = new VehicleUnitService(prisma, orchestrator, new StubScheduleServiceClient());
    lcnrvSvc = new LcnrvService(prisma, orchestrator);

    await prisma.lcnrvThresholdConfig.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, maxWriteDownAmount: '1000.00', updatedBy: 'test-actor' },
    });
  });

  afterAll(async () => {
    await prisma.lcnrvWriteDown.deleteMany({ where: { tenantId: TENANT } });
    await prisma.lcnrvMarketEvidence.deleteMany({ where: { tenantId: TENANT } });
    await prisma.lcnrvThresholdConfig.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleCostComponent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleStockInEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleUnit.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  async function stockInUsedUnit(invoiceCost: string) {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    await unitSvc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00300', entityId: ENTITY, storeId: 'store-1',
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost,
    });
    return stockNumber;
  }

  it('write-down within threshold posts, unit item reflects new basis exactly (AC)', async () => {
    const stockNumber = await stockInUsedUnit('12000.00');
    const evidence = await lcnrvSvc.addMarketEvidence(TENANT, 'accountant-1', { stockNumber, marketValue: '11500.00', source: 'MANHEIM_MMR', reference: 'ref-1' });

    const result = await lcnrvSvc.writeDown(TENANT, 'accountant-1', { stockNumber, evidenceId: evidence.id, reason: 'Market softened this cycle', eventId: randomUUID() });
    expect(result.status).toBe('POSTED');
    expect(Number(result.writeDown!.writeDownAmount)).toBe(500); // 12000 - 11500

    const unit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(unit!.bookValue)).toBe(11500);
    expect(Number(unit!.cumulativeWriteDown)).toBe(500);
  });

  it('write-down above threshold is refused deterministically, audited, and does not touch book value (AC)', async () => {
    const stockNumber = await stockInUsedUnit('12000.00');
    const evidence = await lcnrvSvc.addMarketEvidence(TENANT, 'accountant-1', { stockNumber, marketValue: '9000.00', source: 'AUCTION_COMP' }); // 3000 writedown > 1000 threshold

    const result = await lcnrvSvc.writeDown(TENANT, 'accountant-1', { stockNumber, evidenceId: evidence.id, reason: 'Large market drop', eventId: randomUUID() });
    expect(result.status).toBe('REFUSED');
    expect(result.writeDown!.status).toBe('REFUSED');
    expect(result.writeDown!.refusalReason).toMatch(/threshold/i);

    const unit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(unit!.bookValue)).toBe(12000); // untouched
  });

  it('no write-down needed when market value is at or above book value', async () => {
    const stockNumber = await stockInUsedUnit('12000.00');
    const evidence = await lcnrvSvc.addMarketEvidence(TENANT, 'accountant-1', { stockNumber, marketValue: '12500.00', source: 'MANUAL_APPRAISAL' });
    const result = await lcnrvSvc.writeDown(TENANT, 'accountant-1', { stockNumber, evidenceId: evidence.id, reason: 'Routine review', eventId: randomUUID() });
    expect(result.status).toBe('NOT_NEEDED');
  });

  it('audit trail references the entered evidence (AC)', async () => {
    const stockNumber = await stockInUsedUnit('12000.00');
    const evidence = await lcnrvSvc.addMarketEvidence(TENANT, 'accountant-1', { stockNumber, marketValue: '11800.00', source: 'MANHEIM_MMR' });
    const result = await lcnrvSvc.writeDown(TENANT, 'accountant-1', { stockNumber, evidenceId: evidence.id, reason: 'Aging inventory', eventId: randomUUID() });
    expect(result.writeDown!.evidenceId).toBe(evidence.id);

    const audits = await prisma.auditOutboxEvent.findMany({ where: { tenantId: TENANT, docType: 'VEHICLE_UNIT', action: 'LCNRV_WRITE_DOWN_POSTED' } });
    expect(audits.some((a) => (a.after as any)?.evidenceId === evidence.id)).toBe(true);
  });

  it('duplicate write-down ceremony (same idempotencyKey) returns the original — idempotent', async () => {
    const stockNumber = await stockInUsedUnit('12000.00');
    const evidence = await lcnrvSvc.addMarketEvidence(TENANT, 'accountant-1', { stockNumber, marketValue: '11700.00', source: 'MANHEIM_MMR' });
    const eventId = randomUUID();
    const first = await lcnrvSvc.writeDown(TENANT, 'accountant-1', { stockNumber, evidenceId: evidence.id, reason: 'Aging', eventId });
    const second = await lcnrvSvc.writeDown(TENANT, 'accountant-1', { stockNumber, evidenceId: evidence.id, reason: 'Aging', eventId });
    expect((second as any).idempotent).toBe(true);
    expect((second as any).writeDown.id).toBe((first as any).writeDown.id);
  });
});
