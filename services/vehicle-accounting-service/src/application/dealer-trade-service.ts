// S077 — Dealer Trades (outbound / inbound / settlement).
import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/vehicle-accounting-client';
import { buildEnvelope } from '../domain/event-envelope';
import { computeOutboundTrade, computeSettlement, requirePositiveTradeCents } from '../domain/dealer-trade';
import { toCents, centsToDollarString } from '../domain/money';
import { validateStockIn, StockInValidationError } from '../domain/stock-in';
import { PostingOrchestrator } from './posting-orchestrator';
import { ScheduleServiceClient } from '../infrastructure/schedule-client';
import { SCHEDULE_NUMBERS } from '../domain/rule-pack-definitions';
import { UnitNotFoundError, VehicleAccountingInputError, TradeNotFoundError, TradeAlreadySettledError, DuplicateStockNumberError } from './errors';
import { auditOutboxEvent } from '../infrastructure/audit';
import { withP2002Retry } from '../infrastructure/db-retry';

export const EVENT_TYPES = {
  OUTBOUND: 'vehicle.dealer-trade-outbound.v1',
  INBOUND: 'vehicle.dealer-trade-inbound.v1',
  SETTLED: 'vehicle.dealer-trade-settled.v1',
} as const;

function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

/** schedule-service's ScheduleDetail.controlNumber is VarChar(10) — mirrors
 * coa-service's own truncation (posting-service.ts's scheduleControlNumber)
 * exactly, so a query by this truncated key finds the same row the bridge
 * event created. */
function scheduleControlNumber(tradeNumber: string): string {
  return tradeNumber.slice(0, 10);
}

export interface OutboundInput {
  tradeNumber: string;
  entityId: string;
  storeId: string;
  counterpartyDealer: string;
  stockNumber: string;
  agreedValue: string;
  eventId: string;
  idempotencyKey?: string;
}

export interface InboundInput {
  tradeNumber: string;
  entityId: string;
  storeId: string;
  counterpartyDealer: string;
  stockNumber: string;
  vin: string;
  status: 'NEW' | 'USED' | 'DEMO' | 'WHOLESALE';
  acv: string;
  eventId: string;
  idempotencyKey?: string;
}

export interface SettleInput {
  tradeNumber: string;
  eventId: string;
  idempotencyKey?: string;
  /** Evidence of the trade doc's cash-difference leg, if any — a CE-09
   * concept this service does not post (PENDING_UPSTREAM_TECHNICAL_
   * RECONCILIATION). Recorded, never silently dropped. */
  cashDifferenceNote?: string;
}

@injectable()
export class DealerTradeService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject(ScheduleServiceClient) private readonly scheduleClient: ScheduleServiceClient,
  ) {}

  // ── Outbound: unit leaves at agreed value ────────────────────────────────
  async outbound(tenantId: string, actor: string, input: OutboundInput) {
    const idempotencyKey = input.idempotencyKey ?? input.eventId;
    const existingByKey = await this.prisma.dealerTrade.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existingByKey) return { idempotent: true, trade: existingByKey };

    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);
    if (unit.disposedAt) throw new VehicleAccountingInputError(`Unit ${input.stockNumber} has already been disposed.`);

    const agreedValueCents = requirePositiveTradeCents('agreedValue', input.agreedValue);
    const bookValueCents = toCents(unit.bookValue.toString());
    const computation = computeOutboundTrade(agreedValueCents, bookValueCents);

    const correlationId = input.idempotencyKey ?? input.eventId;
    const payload: Record<string, unknown> = {
      tradeNumber: input.tradeNumber,
      stockNumber: input.stockNumber,
      agreedValue: centsToDollarString(agreedValueCents),
      bookValue: centsToDollarString(bookValueCents),
      tradeOutcome: computation.outcome,
    };
    if (computation.outcome !== 'EVEN') payload['gainLossAmount'] = centsToDollarString(computation.gainLossCents);

    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: input.entityId,
      eventType: EVENT_TYPES.OUTBOUND,
      occurredAt: nowIso(),
      businessDate: today(),
      sourceEntityType: 'DEALER_TRADE',
      sourceEntityId: input.tradeNumber,
      correlationId,
      payload,
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: input.entityId, storeId: input.storeId, sourceTransactionId: input.tradeNumber });
    const posted = result.status === 'POSTED';

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      // Concurrency guard — see vehicle-unit-service.ts's addCostComponent()
      // for the full rationale: bookValue decrement/disposedAt are additive/
      // one-time changes that must apply AT MOST ONCE across every retry of
      // a racing duplicate outbound submission (verified live).
      const alreadyApplied = await tx.dealerTrade.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
      if (alreadyApplied) return alreadyApplied;

      if (posted) {
        await tx.vehicleUnit.update({
          where: { id: unit.id },
          data: { bookValue: { decrement: new Prisma.Decimal(centsToDollarString(bookValueCents)) }, disposedAt: new Date(), disposalType: 'DEALER_TRADE_OUTBOUND' },
        });
      }
      const trade = await tx.dealerTrade.create({
        data: {
          id: randomUUID(), tenantId, entityId: input.entityId, storeId: input.storeId,
          tradeNumber: input.tradeNumber, direction: 'OUTBOUND', counterpartyDealer: input.counterpartyDealer,
          unitId: unit.id, agreedValue: new Prisma.Decimal(centsToDollarString(agreedValueCents)),
          bookValueAtTrade: new Prisma.Decimal(centsToDollarString(bookValueCents)),
          gainLossAmount: computation.outcome === 'EVEN' ? null : new Prisma.Decimal(centsToDollarString(computation.gainLossCents)),
          gainLossDirection: computation.outcome,
          status: posted ? 'OPEN' : 'OPEN',
          eventId: input.eventId, postingExecutionId: result.executionId,
          journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null, actor, idempotencyKey,
        },
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'DEALER_TRADE', docId: trade.id, actor,
        action: posted ? 'DEALER_TRADE_OUTBOUND_POSTED' : 'DEALER_TRADE_OUTBOUND_POSTING_FAILED',
        after: { tradeNumber: input.tradeNumber, status: result.status },
      });
      return trade;
    }));

    return { idempotent: false, trade: created, postingResult: result };
  }

  // ── Inbound: unit arrives, born at ACV ───────────────────────────────────
  async inbound(tenantId: string, actor: string, input: InboundInput) {
    const idempotencyKey = input.idempotencyKey ?? input.eventId;
    const existingByKey = await this.prisma.dealerTrade.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existingByKey) return { idempotent: true, trade: existingByKey };

    const already = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (already) throw new DuplicateStockNumberError(input.stockNumber);

    let acvCents: number;
    try {
      const validated = validateStockIn({
        stockNumber: input.stockNumber, vin: input.vin, entityId: input.entityId, storeId: input.storeId,
        status: input.status, acquisitionType: 'DEALER_TRADE_IN', invoiceCost: input.acv,
      });
      acvCents = validated.invoiceCostCents;
    } catch (err) {
      if (err instanceof StockInValidationError) throw new VehicleAccountingInputError(err.message);
      throw err;
    }

    const correlationId = input.idempotencyKey ?? input.eventId;
    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: input.entityId,
      eventType: EVENT_TYPES.INBOUND,
      occurredAt: nowIso(),
      businessDate: today(),
      sourceEntityType: 'DEALER_TRADE',
      sourceEntityId: input.tradeNumber,
      correlationId,
      payload: { tradeNumber: input.tradeNumber, stockNumber: input.stockNumber, vin: input.vin, acv: centsToDollarString(acvCents) },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: input.entityId, storeId: input.storeId, sourceTransactionId: input.tradeNumber });
    const posted = result.status === 'POSTED';

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      const unit = await tx.vehicleUnit.upsert({
        where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } },
        create: {
          id: randomUUID(), tenantId, entityId: input.entityId, storeId: input.storeId, vin: input.vin,
          stockNumber: input.stockNumber, status: input.status, acquisitionType: 'DEALER_TRADE_IN',
          bookValue: posted ? new Prisma.Decimal(centsToDollarString(acvCents)) : new Prisma.Decimal(0),
        },
        update: {},
      });
      const unitId = unit.id;

      if (posted) {
        // upsert, not create — bookValue itself is set once via the unit
        // upsert's `create` branch above (never a separate increment), so
        // this only needs to avoid a P2002 on retry; no additive-side-
        // effect guard is needed here (contrast with addCostComponent()'s
        // increment-gated pattern).
        await tx.vehicleCostComponent.upsert({
          where: { tenantId_sourceEventId: { tenantId, sourceEventId: input.eventId } },
          create: {
            id: randomUUID(), tenantId, unitId, componentType: 'INVOICE',
            amount: new Prisma.Decimal(centsToDollarString(acvCents)), description: `Dealer trade-in ACV, trade ${input.tradeNumber}`,
            sourceEventId: input.eventId, sourceEventType: EVENT_TYPES.INBOUND,
            postingExecutionId: result.executionId, journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          },
          update: {},
        });
      }

      const trade = await tx.dealerTrade.upsert({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        create: {
          id: randomUUID(), tenantId, entityId: input.entityId, storeId: input.storeId,
          tradeNumber: input.tradeNumber, direction: 'INBOUND', counterpartyDealer: input.counterpartyDealer,
          unitId, agreedValue: new Prisma.Decimal(centsToDollarString(acvCents)), status: 'OPEN',
          eventId: input.eventId, postingExecutionId: result.executionId,
          journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null, actor, idempotencyKey,
        },
        update: {},
      });

      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'DEALER_TRADE', docId: trade.id, actor,
        action: posted ? 'DEALER_TRADE_INBOUND_POSTED' : 'DEALER_TRADE_INBOUND_POSTING_FAILED',
        after: { tradeNumber: input.tradeNumber, status: result.status },
      });
      return trade;
    }));

    return { idempotent: false, trade: created, postingResult: result };
  }

  // ── Settlement: nets receivable/payable per trade doc ────────────────────
  async settle(tenantId: string, actor: string, input: SettleInput) {
    const idempotencyKey = input.idempotencyKey ?? input.eventId;
    const existingByKey = await this.prisma.dealerTradeSettlement.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existingByKey) return { idempotent: true, settlement: existingByKey };

    const [outboundTrade, inboundTrade] = await Promise.all([
      this.prisma.dealerTrade.findUnique({ where: { tenantId_tradeNumber_direction: { tenantId, tradeNumber: input.tradeNumber, direction: 'OUTBOUND' } } }),
      this.prisma.dealerTrade.findUnique({ where: { tenantId_tradeNumber_direction: { tenantId, tradeNumber: input.tradeNumber, direction: 'INBOUND' } } }),
    ]);
    if (!outboundTrade && !inboundTrade) throw new TradeNotFoundError(input.tradeNumber);
    if (outboundTrade?.status === 'SETTLED' && (!inboundTrade || inboundTrade.status === 'SETTLED')) {
      throw new TradeAlreadySettledError(input.tradeNumber);
    }

    const receivableCents = outboundTrade ? toCents(outboundTrade.agreedValue.toString()) : 0;
    const payableCents = inboundTrade ? toCents(inboundTrade.agreedValue.toString()) : 0;
    const { nettedCents, cashDifferenceCents } = computeSettlement(receivableCents, payableCents);

    const correlationId = input.idempotencyKey ?? input.eventId;
    let result: Awaited<ReturnType<PostingOrchestrator['submitAndRecord']>> | null = null;

    if (nettedCents > 0) {
      const envelope = buildEnvelope({
        eventId: input.eventId,
        tenantId,
        legalEntityId: (outboundTrade ?? inboundTrade)!.entityId,
        eventType: EVENT_TYPES.SETTLED,
        occurredAt: nowIso(),
        businessDate: today(),
        sourceEntityType: 'DEALER_TRADE',
        sourceEntityId: input.tradeNumber,
        correlationId,
        payload: { tradeNumber: input.tradeNumber, nettedAmount: centsToDollarString(nettedCents) },
      });
      result = await this.posting.submitAndRecord(envelope, { legalEntityId: (outboundTrade ?? inboundTrade)!.entityId, sourceTransactionId: input.tradeNumber });
    }

    const posted = nettedCents === 0 || result?.status === 'POSTED';
    const primaryTradeId = (outboundTrade ?? inboundTrade)!.id;

    // Best-effort direct schedule-service relief against this service's
    // assigned receivable/payable schedules (81/82 — see domain/rule-pack-
    // definitions.ts's SCHEDULE_NUMBERS). Degrades honestly to NOT_FOUND
    // (never throws, never fabricates success) when the tenant's
    // DEALER_TRADE_RECEIVABLE/PAYABLE GL account has no scheduleCode wired
    // yet, or no matching open item was ever opened.
    const control = scheduleControlNumber(input.tradeNumber);
    if (posted && outboundTrade) {
      await this.scheduleClient
        .relieveOpenItem(tenantId, SCHEDULE_NUMBERS.DEALER_TRADE_RECEIVABLE, control, centsToDollarString(nettedCents || receivableCents), `${idempotencyKey}-outbound`, `Dealer trade settlement ${input.tradeNumber}`)
        .catch(() => null);
    }
    if (posted && inboundTrade) {
      await this.scheduleClient
        .relieveOpenItem(tenantId, SCHEDULE_NUMBERS.DEALER_TRADE_PAYABLE, control, centsToDollarString(nettedCents || payableCents), `${idempotencyKey}-inbound`, `Dealer trade settlement ${input.tradeNumber}`)
        .catch(() => null);
    }

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      if (outboundTrade) await tx.dealerTrade.update({ where: { id: outboundTrade.id }, data: { status: 'SETTLED' } });
      if (inboundTrade) await tx.dealerTrade.update({ where: { id: inboundTrade.id }, data: { status: 'SETTLED' } });

      const settlement = await tx.dealerTradeSettlement.upsert({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        create: {
          id: randomUUID(), tenantId, tradeId: primaryTradeId,
          nettedAmount: new Prisma.Decimal(centsToDollarString(nettedCents)),
          cashDifferenceAmount: new Prisma.Decimal(centsToDollarString(cashDifferenceCents)),
          cashDifferencePending: cashDifferenceCents > 0,
          status: posted ? 'POSTED' : 'FAILED',
          eventId: input.eventId, postingExecutionId: result?.executionId ?? null,
          journalEntryId: result?.journalEntryId ?? null, journalNumber: result?.journalNumber ?? null,
          failureReason: result?.failureReason ?? null, actor, idempotencyKey,
        },
        update: {},
      });

      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'DEALER_TRADE', docId: primaryTradeId, actor,
        action: posted ? 'DEALER_TRADE_SETTLED' : 'DEALER_TRADE_SETTLEMENT_POSTING_FAILED',
        after: {
          tradeNumber: input.tradeNumber, nettedAmount: centsToDollarString(nettedCents),
          cashDifferenceAmount: centsToDollarString(cashDifferenceCents),
          cashDifferencePendingCE09: cashDifferenceCents > 0,
          cashDifferenceNote: input.cashDifferenceNote ?? null,
        },
      });
      return settlement;
    }));

    return { idempotent: false, settlement: created, postingResult: result };
  }

  async listTrades(tenantId: string, filters: { tradeNumber?: string; status?: string; direction?: string }) {
    return this.prisma.dealerTrade.findMany({
      where: { tenantId, ...(filters.tradeNumber ? { tradeNumber: filters.tradeNumber } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.direction ? { direction: filters.direction } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async getTrade(tenantId: string, tradeNumber: string) {
    const [outbound, inbound, settlement] = await Promise.all([
      this.prisma.dealerTrade.findUnique({ where: { tenantId_tradeNumber_direction: { tenantId, tradeNumber, direction: 'OUTBOUND' } } }),
      this.prisma.dealerTrade.findUnique({ where: { tenantId_tradeNumber_direction: { tenantId, tradeNumber, direction: 'INBOUND' } } }),
      this.prisma.dealerTradeSettlement.findFirst({ where: { tenantId, trade: { tradeNumber } } }),
    ]);
    if (!outbound && !inbound) throw new TradeNotFoundError(tradeNumber);

    // Authoritative "does this tie to the GL" balance — sourced from real
    // schedule-service open items (schedules 81/82), NOT independently
    // recomputed from this service's own dealerTrade rows. Either lookup
    // may come back null (schedule-service unreachable, or this tenant's
    // receivable/payable GL account has no scheduleCode wired yet) — that
    // is surfaced honestly as `null`, never as a fabricated 0 balance.
    const control = scheduleControlNumber(tradeNumber);
    const [receivable, payable] = await Promise.all([
      outbound ? this.scheduleClient.getOpenItemsBalance(tenantId, SCHEDULE_NUMBERS.DEALER_TRADE_RECEIVABLE, control) : Promise.resolve(null),
      inbound ? this.scheduleClient.getOpenItemsBalance(tenantId, SCHEDULE_NUMBERS.DEALER_TRADE_PAYABLE, control) : Promise.resolve(null),
    ]);

    return {
      outbound,
      inbound,
      settlement,
      scheduleTieOut: {
        receivable: receivable ? { scheduleNumber: SCHEDULE_NUMBERS.DEALER_TRADE_RECEIVABLE, controlNumber: control, remainingBalanceCents: receivable.remainingBalanceCents, openItemCount: receivable.openItemCount } : null,
        payable: payable ? { scheduleNumber: SCHEDULE_NUMBERS.DEALER_TRADE_PAYABLE, controlNumber: control, remainingBalanceCents: payable.remainingBalanceCents, openItemCount: payable.openItemCount } : null,
      },
    };
  }
}
