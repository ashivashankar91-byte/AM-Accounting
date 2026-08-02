/**
 * S075 — Demo Reclass & Depreciation, LIVE DATABASE integration tests.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/vehicle-accounting-client';
import { VehicleUnitService } from '../../src/application/vehicle-unit-service';
import { DemoService } from '../../src/application/demo-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { ScriptedPostingEngineClient, RecordingPostingRecoveryClient, StubScheduleServiceClient } from './fakes';
import { HttpPostingEngineClient } from '../../src/infrastructure/posting-engine-client';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('Live database — S075 Demo Reclass & Depreciation', () => {
  let prisma: PrismaClient;
  let engine: ScriptedPostingEngineClient;
  let unitSvc: VehicleUnitService;
  let demoSvc: DemoService;
  const TENANT = `veh-s075-${randomUUID()}`;
  const ENTITY = 'entity-1';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    engine = new ScriptedPostingEngineClient();
    const orchestrator = new PostingOrchestrator(engine, new RecordingPostingRecoveryClient());
    unitSvc = new VehicleUnitService(prisma, orchestrator, new StubScheduleServiceClient());
    // reverseAdjustment calls postingEngineClient.reverseJournal — the
    // scripted engine implements the same PostingEngineClient interface,
    // so it doubles for both roles here.
    demoSvc = new DemoService(prisma, orchestrator, engine as unknown as HttpPostingEngineClient);

    await prisma.demoDepreciationBasisConfig.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, percentPerPeriodBp: 200, periodLengthDays: 30, updatedBy: 'test-actor' },
    });
  });

  afterAll(async () => {
    await prisma.demoValueAdjustment.deleteMany({ where: { tenantId: TENANT } });
    await prisma.demoReclass.deleteMany({ where: { tenantId: TENANT } });
    await prisma.demoDepreciationBasisConfig.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleCostComponent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleStockInEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleUnit.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  async function stockInNewUnit(invoiceCost = '20000.00') {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    await unitSvc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00200', entityId: ENTITY, storeId: 'store-1',
      status: 'NEW', acquisitionType: 'PURCHASE', invoiceCost,
    });
    return stockNumber;
  }

  it('reclass NEW -> DEMO conserves unit value exactly (AC)', async () => {
    const stockNumber = await stockInNewUnit();
    const before = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    const result = await demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber });
    expect(result.reclass!.status).toBe('POSTED');
    const after = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(after!.status).toBe('DEMO');
    expect(Number(after!.bookValue)).toBe(Number(before!.bookValue)); // conserved
  });

  it('reclass is refused on a non-NEW unit', async () => {
    const stockNumber = await stockInNewUnit();
    await demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber });
    await expect(demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber })).rejects.toThrow();
  });

  it('preview-approve: adjustment posted equals the approved preview exactly (AC), nothing auto-posts on preview', async () => {
    const stockNumber = await stockInNewUnit('10000.00');
    await demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber });

    const preview = await demoSvc.previewAdjustment(TENANT, 'accountant-1', { stockNumber });
    expect(preview.status).toBe('PENDING_PREVIEW');
    // Nothing posted yet — unit book value unchanged.
    const stillUnchanged = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(stillUnchanged!.bookValue)).toBe(1_000_000 / 100);

    const approved = await demoSvc.approveAdjustment(TENANT, 'accountant-1', {
      adjustmentId: preview.id, approvedAmount: preview.proposedAmount.toString(), eventId: randomUUID(),
    });
    expect(approved.adjustment.status).toBe('POSTED');
    expect(approved.adjustment.approvedAmount!.toString()).toBe(preview.proposedAmount.toString());

    const afterApproval = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    const expectedRemaining = 1_000_000 - Number(preview.proposedAmount) * 100;
    expect(Math.round(Number(afterApproval!.bookValue) * 100)).toBe(expectedRemaining);
  });

  it('approving with an amount that does not match the exact preview is rejected', async () => {
    const stockNumber = await stockInNewUnit('10000.00');
    await demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber });
    const preview = await demoSvc.previewAdjustment(TENANT, 'accountant-1', { stockNumber });
    await expect(
      demoSvc.approveAdjustment(TENANT, 'accountant-1', { adjustmentId: preview.id, approvedAmount: '999999.00', eventId: randomUUID() }),
    ).rejects.toThrow();
  });

  it('reversal is symmetric: reversing a posted adjustment restores the book value (AC)', async () => {
    const stockNumber = await stockInNewUnit('10000.00');
    await demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber });
    const preview = await demoSvc.previewAdjustment(TENANT, 'accountant-1', { stockNumber });
    const approved = await demoSvc.approveAdjustment(TENANT, 'accountant-1', {
      adjustmentId: preview.id, approvedAmount: preview.proposedAmount.toString(), eventId: randomUUID(),
    });
    const afterApproval = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });

    await demoSvc.reverseAdjustment(TENANT, 'controller-1', { adjustmentId: approved.adjustment.id, reason: 'Data entry correction' });

    const afterReversal = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(afterReversal!.bookValue)).toBe(Number(afterApproval!.bookValue) + Number(approved.adjustment.approvedAmount));
    expect(Number(afterReversal!.bookValue)).toBe(1_000_000 / 100);
  });

  it('rejecting a preview requires a reason and never posts', async () => {
    const stockNumber = await stockInNewUnit('10000.00');
    await demoSvc.reclass(TENANT, 'test-actor', { eventId: randomUUID(), stockNumber });
    const preview = await demoSvc.previewAdjustment(TENANT, 'accountant-1', { stockNumber });
    const rejected = await demoSvc.rejectAdjustment(TENANT, 'accountant-1', { adjustmentId: preview.id, reason: 'Basis looks wrong this period' });
    expect(rejected.status).toBe('REJECTED');
    const unit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(unit!.bookValue)).toBe(1_000_000 / 100);
  });
});
