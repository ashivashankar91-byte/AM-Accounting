/**
 * S077 — Dealer Trades, LIVE DATABASE integration tests.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/vehicle-accounting-client';
import { VehicleUnitService } from '../../src/application/vehicle-unit-service';
import { DealerTradeService } from '../../src/application/dealer-trade-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { ScriptedPostingEngineClient, RecordingPostingRecoveryClient, StubScheduleServiceClient } from './fakes';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('Live database — S077 Dealer Trades', () => {
  let prisma: PrismaClient;
  let engine: ScriptedPostingEngineClient;
  let unitSvc: VehicleUnitService;
  let tradeSvc: DealerTradeService;
  const TENANT = `veh-s077-${randomUUID()}`;
  const ENTITY = 'entity-1';
  const STORE = 'store-1';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    engine = new ScriptedPostingEngineClient();
    const orchestrator = new PostingOrchestrator(engine, new RecordingPostingRecoveryClient());
    unitSvc = new VehicleUnitService(prisma, orchestrator, new StubScheduleServiceClient());
    tradeSvc = new DealerTradeService(prisma, orchestrator, new StubScheduleServiceClient());
  });

  afterAll(async () => {
    await prisma.dealerTradeSettlement.deleteMany({ where: { tenantId: TENANT } });
    await prisma.dealerTrade.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleCostComponent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleStockInEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.vehicleUnit.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  async function stockInUnit(invoiceCost: string) {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    await unitSvc.stockIn(TENANT, 'test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00400', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost,
    });
    return stockNumber;
  }

  it('outbound relieves the unit exactly and books a gain when agreedValue > bookValue (AC)', async () => {
    const stockNumber = await stockInUnit('9000.00');
    const tradeNumber = `TRD-${randomUUID().slice(0, 8)}`;
    const result = await tradeSvc.outbound(TENANT, 'test-actor', {
      tradeNumber, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'ABC Motors',
      stockNumber, agreedValue: '9500.00', eventId: randomUUID(),
    });
    expect(result.trade!.status).toBe('OPEN');
    expect(result.trade!.gainLossDirection).toBe('GAIN');
    expect(Number(result.trade!.gainLossAmount)).toBe(500);

    const unit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(unit!.bookValue)).toBe(0); // fully relieved
    expect(unit!.disposedAt).toBeTruthy();
    expect(unit!.disposalType).toBe('DEALER_TRADE_OUTBOUND');
  });

  it('outbound books a loss when agreedValue < bookValue, and EVEN with no gain/loss leg when equal', async () => {
    const stockLoss = await stockInUnit('9000.00');
    const lossResult = await tradeSvc.outbound(TENANT, 'test-actor', {
      tradeNumber: `TRD-${randomUUID().slice(0, 8)}`, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'XYZ Motors',
      stockNumber: stockLoss, agreedValue: '8500.00', eventId: randomUUID(),
    });
    expect(lossResult.trade!.gainLossDirection).toBe('LOSS');
    expect(Number(lossResult.trade!.gainLossAmount)).toBe(500);

    const stockEven = await stockInUnit('9000.00');
    const evenResult = await tradeSvc.outbound(TENANT, 'test-actor', {
      tradeNumber: `TRD-${randomUUID().slice(0, 8)}`, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'Even Motors',
      stockNumber: stockEven, agreedValue: '9000.00', eventId: randomUUID(),
    });
    expect(evenResult.trade!.gainLossDirection).toBe('EVEN');
    expect(evenResult.trade!.gainLossAmount).toBeNull();
  });

  it('inbound unit is born at ACV', async () => {
    const stockNumber = `STK-${randomUUID().slice(0, 8)}`;
    const tradeNumber = `TRD-${randomUUID().slice(0, 8)}`;
    const result = await tradeSvc.inbound(TENANT, 'test-actor', {
      tradeNumber, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'Inbound Motors',
      stockNumber, vin: '1FTFW1E5XNFA00401', status: 'USED', acv: '7000.00', eventId: randomUUID(),
    });
    expect(result.trade!.status).toBe('OPEN');
    const unit = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(Number(unit!.bookValue)).toBe(7000);
    expect(unit!.acquisitionType).toBe('DEALER_TRADE_IN');
  });

  it('settlement closes items and nets exactly per trade doc math on fixtures (AC)', async () => {
    const tradeNumber = `TRD-${randomUUID().slice(0, 8)}`;

    const outStock = await stockInUnit('9000.00');
    await tradeSvc.outbound(TENANT, 'test-actor', {
      tradeNumber, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'Both-Way Motors',
      stockNumber: outStock, agreedValue: '9500.00', eventId: randomUUID(),
    });
    await tradeSvc.inbound(TENANT, 'test-actor', {
      tradeNumber, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'Both-Way Motors',
      stockNumber: `STK-${randomUUID().slice(0, 8)}`, vin: '1FTFW1E5XNFA00402', status: 'USED', acv: '8000.00', eventId: randomUUID(),
    });

    const settlement = await tradeSvc.settle(TENANT, 'controller-1', { tradeNumber, eventId: randomUUID() });
    expect(settlement.settlement!.status).toBe('POSTED');
    expect(Number(settlement.settlement!.nettedAmount)).toBe(8000); // min(9500, 8000)
    expect(Number(settlement.settlement!.cashDifferenceAmount)).toBe(1500);
    expect(settlement.settlement!.cashDifferencePending).toBe(true); // CE-09 leg, PENDING

    const [outbound, inbound] = await Promise.all([
      prisma.dealerTrade.findUnique({ where: { tenantId_tradeNumber_direction: { tenantId: TENANT, tradeNumber, direction: 'OUTBOUND' } } }),
      prisma.dealerTrade.findUnique({ where: { tenantId_tradeNumber_direction: { tenantId: TENANT, tradeNumber, direction: 'INBOUND' } } }),
    ]);
    expect(outbound!.status).toBe('SETTLED');
    expect(inbound!.status).toBe('SETTLED');
  });

  it('duplicate settlement (same idempotencyKey) is idempotent', async () => {
    const tradeNumber = `TRD-${randomUUID().slice(0, 8)}`;
    const outStock = await stockInUnit('5000.00');
    await tradeSvc.outbound(TENANT, 'test-actor', {
      tradeNumber, entityId: ENTITY, storeId: STORE, counterpartyDealer: 'Idem Motors',
      stockNumber: outStock, agreedValue: '5000.00', eventId: randomUUID(),
    });
    const idempotencyKey = randomUUID();
    const first = await tradeSvc.settle(TENANT, 'controller-1', { tradeNumber, eventId: randomUUID(), idempotencyKey });
    const second = await tradeSvc.settle(TENANT, 'controller-1', { tradeNumber, eventId: randomUUID(), idempotencyKey });
    expect((second as any).idempotent).toBe(true);
    expect(second.settlement!.id).toBe(first.settlement!.id);
  });
});
