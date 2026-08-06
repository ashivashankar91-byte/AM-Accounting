// S074 — Vehicle Unit Ledger & Stock-In.
import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/vehicle-accounting-client';
import { buildEnvelope, postingIdempotencyKey } from '../domain/event-envelope';
import { validateStockIn, StockInRequest, followUpComponents, StockInValidationError } from '../domain/stock-in';
import { centsToDollarString, requirePositiveCents, toCents } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { ScheduleServiceClient } from '../infrastructure/schedule-client';
import { SCHEDULE_NUMBERS } from '../domain/rule-pack-definitions';
import { DuplicateStockNumberError, UnitNotFoundError, VehicleAccountingInputError } from './errors';
import { auditOutboxEvent } from '../infrastructure/audit';
import { withP2002Retry } from '../infrastructure/db-retry';

/** schedule-service's ScheduleDetail.controlNumber is VarChar(10) — mirrors
 * coa-service's own truncation (posting-service.ts's scheduleControlNumber)
 * exactly, so a query by this truncated key finds the same row the bridge
 * event created. */
function scheduleControlNumber(stockNumber: string): string {
  return stockNumber.slice(0, 10);
}

export const EVENT_TYPES = {
  STOCKED: 'vehicle.stocked.v1',
  COST_COMPONENT_ADDED: 'vehicle.cost-component-added.v1',
  RECON_COST_ADDED: 'vehicle.recon-cost-added.v1',
} as const;

export interface StockInInput extends StockInRequest {
  eventId: string;
  correlationId?: string;
  occurredAt?: string;
  businessDate?: string;
}

export interface AddCostComponentInput {
  stockNumber: string;
  componentType: 'TRANSPORT' | 'PACK' | 'EQUIPMENT';
  amount: string;
  packRole?: 'PACK_INCOME' | 'HOLDBACK_CLEARING';
  eventId: string;
  correlationId?: string;
  occurredAt?: string;
  businessDate?: string;
}

export interface AddReconCostInput {
  stockNumber: string;
  /** CE-11 RO reference. PENDING_UPSTREAM_TECHNICAL_RECONCILIATION: the
   * real CE-11 "I-type close event" field carrying this is not yet defined
   * upstream (epic dependency register) — this service accepts a caller-
   * supplied roNumber today and will adopt the real CE-11 field name once
   * that contract is ratified, without changing this event's shape. */
  roNumber: string;
  amount: string;
  eventId: string;
  correlationId?: string;
  occurredAt?: string;
  businessDate?: string;
}

function nowIso() {
  return new Date().toISOString();
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

@injectable()
export class VehicleUnitService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject(ScheduleServiceClient) private readonly scheduleClient: ScheduleServiceClient,
  ) {}

  // ── S074: stock-in ─────────────────────────────────────────────────────
  async stockIn(tenantId: string, actor: string, input: StockInInput) {
    if (!input.eventId?.trim()) throw new VehicleAccountingInputError('eventId is required.');

    const existing = await this.prisma.vehicleStockInEvent.findUnique({
      where: { tenantId_eventId: { tenantId, eventId: input.eventId } },
    });
    if (existing) {
      const unit = await this.prisma.vehicleUnit.findUnique({ where: { id: existing.unitId } });
      return { idempotent: true, unit, stockInEvent: existing };
    }

    const validated = validateStockIn(input);

    const already = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (already) throw new DuplicateStockNumberError(input.stockNumber);

    const correlationId = input.correlationId ?? input.eventId;
    const occurredAt = input.occurredAt ?? nowIso();
    const businessDate = input.businessDate ?? today();

    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: input.entityId,
      eventType: EVENT_TYPES.STOCKED,
      occurredAt,
      businessDate,
      sourceEntityType: 'VEHICLE_UNIT',
      sourceEntityId: input.stockNumber,
      correlationId,
      payload: {
        stockNumber: input.stockNumber,
        vin: input.vin,
        entityId: input.entityId,
        storeId: input.storeId,
        status: input.status,
        acquisitionType: input.acquisitionType,
        invoiceCost: centsToDollarString(validated.invoiceCostCents),
      },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: input.entityId, storeId: input.storeId, sourceTransactionId: input.stockNumber });

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      // Concurrency guard (see addCostComponent()'s identical-purpose
      // guard for the full rationale, verified live): if a genuinely
      // concurrent duplicate submission already committed this exact
      // eventId's stockInEvent, this attempt is the pure idempotent
      // loser — every field the unit upsert's `create` branch would set
      // is already correctly set by the winner (Prisma upsert only
      // applies `create` data on an actual insert), so a plain re-read
      // is all that's needed; no audit row is duplicated.
      const alreadyApplied = await tx.vehicleStockInEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId: input.eventId } } });
      if (alreadyApplied) {
        const existingUnit = await tx.vehicleUnit.findUnique({ where: { id: alreadyApplied.unitId } });
        return { unit: existingUnit, stockInEvent: alreadyApplied };
      }

      const posted = result.status === 'POSTED';
      // upsert (not create+catch(P2002)) — a Prisma interactive transaction
      // aborts the WHOLE transaction on any query error (Postgres error
      // 25P02, "current transaction is aborted"), so a subsequent tx.*
      // query in the same catch block (e.g. a reconciliation findUnique)
      // would itself fail. upsert never throws on the race (an INSERT ...
      // ON CONFLICT DO UPDATE at the SQL level) and `update: {}` makes a
      // losing concurrent caller a true no-op read of the winner's row —
      // verified against a live Postgres instance (see this service's
      // final summary for the concurrent-race live-db test that caught
      // the original create+catch bug).
      const unit = await tx.vehicleUnit.upsert({
        where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } },
        create: {
          id: randomUUID(),
          tenantId,
          entityId: input.entityId,
          storeId: input.storeId,
          vin: input.vin,
          stockNumber: input.stockNumber,
          status: input.status,
          acquisitionType: input.acquisitionType,
          bookValue: posted ? new Prisma.Decimal(centsToDollarString(validated.invoiceCostCents)) : new Prisma.Decimal(0),
        },
        update: {},
      });
      const unitId = unit.id;

      if (posted) {
        // upsert keyed by (tenantId, sourceEventId), not create — same
        // withP2002Retry reasoning as the vehicleUnit upsert above: a
        // retried attempt of this whole transaction (after another
        // concurrent attempt's unit-upsert conflict resolved) must not
        // itself collide on the cost-component row the winning attempt
        // already committed.
        await tx.vehicleCostComponent.upsert({
          where: { tenantId_sourceEventId: { tenantId, sourceEventId: input.eventId } },
          create: {
            id: randomUUID(),
            tenantId,
            unitId,
            componentType: 'INVOICE',
            amount: new Prisma.Decimal(centsToDollarString(validated.invoiceCostCents)),
            sourceEventId: input.eventId,
            sourceEventType: EVENT_TYPES.STOCKED,
            postingExecutionId: result.executionId,
            journalEntryId: result.journalEntryId ?? null,
            journalNumber: result.journalNumber ?? null,
          },
          update: {},
        });
      }

      const stockInEvent = await tx.vehicleStockInEvent.upsert({
        where: { tenantId_eventId: { tenantId, eventId: input.eventId } },
        create: {
          id: randomUUID(),
          tenantId,
          unitId,
          eventId: input.eventId,
          correlationId,
          status: result.status,
          postingExecutionId: result.executionId,
          journalEntryId: result.journalEntryId ?? null,
          journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null,
          requestPayload: envelope.payload as any,
        },
        update: {},
      });

      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unitId, actor,
        action: posted ? 'STOCKED_IN' : 'STOCK_IN_POSTING_FAILED',
        after: { eventId: input.eventId, status: result.status, journalNumber: result.journalNumber ?? null },
      });

      // Re-read so the returned unit reflects the bookValue set above
      // (upsert's own return value is fine too, but a fresh read keeps this
      // resilient if future writes are added between the upsert and here).
      const finalUnit = await tx.vehicleUnit.findUnique({ where: { id: unitId } });
      return { unit: finalUnit, stockInEvent };
    }));

    // Fire-and-record follow-up components (transport/pack/equipment) —
    // each individually balanced, only submitted when nonzero (see
    // domain/stock-in.ts header comment). Sequential, not parallel: each
    // is its own idempotent postingIdempotencyKey and this keeps ordering
    // deterministic for callers inspecting cost-buildup lineage.
    const followUps = followUpComponents(validated);
    const followUpResults = [] as Array<Awaited<ReturnType<VehicleUnitService['addCostComponent']>>>;
    for (const fu of followUps) {
      const followUpEventId = `${input.eventId}-${fu.componentType.toLowerCase()}`;
      // eslint-disable-next-line no-await-in-loop
      const r = await this.addCostComponent(tenantId, actor, {
        stockNumber: input.stockNumber,
        componentType: fu.componentType,
        amount: fu.amount,
        packRole: fu.packRole,
        eventId: followUpEventId,
        correlationId,
        occurredAt,
        businessDate,
      });
      followUpResults.push(r);
    }

    return { idempotent: false, unit: created.unit, stockInEvent: created.stockInEvent, postingResult: result, followUps: followUpResults };
  }

  // ── S074: post-stock-in cost component (transport/pack/equipment) ──────
  async addCostComponent(tenantId: string, actor: string, input: AddCostComponentInput) {
    if (!input.eventId?.trim()) throw new VehicleAccountingInputError('eventId is required.');
    const existing = await this.prisma.vehicleCostComponentEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId: input.eventId } } });
    if (existing) return { idempotent: true, event: existing };

    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);

    const amountCents = requirePositiveCents('amount', input.amount);
    if (input.componentType === 'PACK' && !input.packRole) {
      throw new VehicleAccountingInputError('packRole is required for a PACK cost component.');
    }

    const correlationId = input.correlationId ?? input.eventId;
    const occurredAt = input.occurredAt ?? nowIso();
    const businessDate = input.businessDate ?? today();

    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: unit.entityId,
      eventType: EVENT_TYPES.COST_COMPONENT_ADDED,
      occurredAt,
      businessDate,
      sourceEntityType: 'VEHICLE_UNIT',
      sourceEntityId: input.stockNumber,
      correlationId,
      payload: {
        stockNumber: input.stockNumber,
        componentType: input.componentType,
        amount: centsToDollarString(amountCents),
        ...(input.packRole ? { packRole: input.packRole } : {}),
      },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: unit.entityId, storeId: unit.storeId, sourceTransactionId: input.stockNumber });
    const posted = result.status === 'POSTED';

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      // Concurrency guard: check-then-act, gated on this SAME transaction
      // attempt's existence check — a bookValue increment is additive, so
      // (unlike the upsert's own `create` vs `update:{}` branching, which
      // Prisma already applies exactly once) it must be applied AT MOST
      // ONCE across every retry of a racing duplicate submission. If a
      // concurrent attempt already committed this exact eventId's event
      // row by the time this attempt runs (whether this is attempt 1 racing
      // a winner, or a withP2002Retry-driven retry after this same
      // eventId's OTHER concurrent attempt won), this attempt must treat
      // itself as the pure idempotent loser and skip every side effect —
      // never re-apply the increment. Found via a live-db concurrent-race
      // test (see this service's final summary).
      const alreadyApplied = await tx.vehicleCostComponentEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId: input.eventId } } });
      if (alreadyApplied) return alreadyApplied;

      if (posted) {
        await tx.vehicleCostComponent.create({
          data: {
            id: randomUUID(),
            tenantId,
            unitId: unit.id,
            componentType: input.componentType,
            amount: new Prisma.Decimal(centsToDollarString(amountCents)),
            sourceEventId: input.eventId,
            sourceEventType: EVENT_TYPES.COST_COMPONENT_ADDED,
            postingExecutionId: result.executionId,
            journalEntryId: result.journalEntryId ?? null,
            journalNumber: result.journalNumber ?? null,
          },
        });
        await tx.vehicleUnit.update({ where: { id: unit.id }, data: { bookValue: { increment: new Prisma.Decimal(centsToDollarString(amountCents)) } } });
      }

      const event = await tx.vehicleCostComponentEvent.create({
        data: {
          id: randomUUID(), tenantId, unitId: unit.id, eventId: input.eventId,
          componentType: input.componentType, amount: new Prisma.Decimal(centsToDollarString(amountCents)),
          packRole: input.packRole ?? null, status: result.status,
          postingExecutionId: result.executionId, journalEntryId: result.journalEntryId ?? null,
          journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
        },
      });

      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
        action: posted ? 'COST_COMPONENT_ADDED' : 'COST_COMPONENT_POSTING_FAILED',
        after: { eventId: input.eventId, componentType: input.componentType, status: result.status },
      });

      return event;
    }));

    return { idempotent: false, event: created, postingResult: result };
  }

  // ── S074: reconditioning cost add (CE-11 boundary, PENDING_UPSTREAM) ────
  async addReconCost(tenantId: string, actor: string, input: AddReconCostInput) {
    if (!input.eventId?.trim()) throw new VehicleAccountingInputError('eventId is required.');
    const existing = await this.prisma.vehicleReconCostEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId: input.eventId } } });
    if (existing) return { idempotent: true, event: existing };

    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);
    if (!input.roNumber?.trim()) throw new VehicleAccountingInputError('roNumber is required.');

    const amountCents = requirePositiveCents('amount', input.amount);
    const correlationId = input.correlationId ?? input.eventId;
    const occurredAt = input.occurredAt ?? nowIso();
    const businessDate = input.businessDate ?? today();

    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: unit.entityId,
      eventType: EVENT_TYPES.RECON_COST_ADDED,
      occurredAt,
      businessDate,
      sourceEntityType: 'VEHICLE_UNIT',
      sourceEntityId: input.stockNumber,
      correlationId,
      payload: { stockNumber: input.stockNumber, roNumber: input.roNumber, amount: centsToDollarString(amountCents) },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: unit.entityId, storeId: unit.storeId, sourceTransactionId: input.roNumber });
    const posted = result.status === 'POSTED';

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      // See addCostComponent()'s identical guard for the full rationale
      // (concurrency-safe additive bookValue change, verified live).
      const alreadyApplied = await tx.vehicleReconCostEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId: input.eventId } } });
      if (alreadyApplied) return alreadyApplied;

      if (posted) {
        await tx.vehicleCostComponent.create({
          data: {
            id: randomUUID(), tenantId, unitId: unit.id, componentType: 'RECONDITIONING',
            amount: new Prisma.Decimal(centsToDollarString(amountCents)), description: `RO ${input.roNumber}`,
            sourceEventId: input.eventId, sourceEventType: EVENT_TYPES.RECON_COST_ADDED,
            postingExecutionId: result.executionId, journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          },
        });
        await tx.vehicleUnit.update({ where: { id: unit.id }, data: { bookValue: { increment: new Prisma.Decimal(centsToDollarString(amountCents)) } } });
      }

      const event = await tx.vehicleReconCostEvent.create({
        data: {
          id: randomUUID(), tenantId, unitId: unit.id, eventId: input.eventId, roNumber: input.roNumber,
          amount: new Prisma.Decimal(centsToDollarString(amountCents)), status: result.status,
          postingExecutionId: result.executionId, journalEntryId: result.journalEntryId ?? null,
          journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
        },
      });

      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
        action: posted ? 'RECON_COST_ADDED' : 'RECON_COST_POSTING_FAILED',
        after: { eventId: input.eventId, roNumber: input.roNumber, status: result.status },
      });

      return event;
    }));

    return { idempotent: false, event: created, postingResult: result };
  }

  // ── Inquiry (S074: "unit ledger inquiry = cost buildup lineage") ────────
  async listUnits(tenantId: string, filters: { entityId?: string; storeId?: string; status?: string; stockNumber?: string; vin?: string }) {
    return this.prisma.vehicleUnit.findMany({
      where: {
        tenantId,
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.stockNumber ? { stockNumber: filters.stockNumber } : {}),
        ...(filters.vin ? { vin: filters.vin } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async getUnit(tenantId: string, idOrStockNumber: string) {
    const unit =
      (await this.prisma.vehicleUnit.findFirst({ where: { tenantId, id: idOrStockNumber } })) ??
      (await this.prisma.vehicleUnit.findFirst({ where: { tenantId, stockNumber: idOrStockNumber } }));
    if (!unit) throw new UnitNotFoundError(idOrStockNumber);

    const [costComponents, stockInEvents, reconEvents, componentEvents] = await Promise.all([
      this.prisma.vehicleCostComponent.findMany({ where: { tenantId, unitId: unit.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.vehicleStockInEvent.findMany({ where: { tenantId, unitId: unit.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.vehicleReconCostEvent.findMany({ where: { tenantId, unitId: unit.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.vehicleCostComponentEvent.findMany({ where: { tenantId, unitId: unit.id }, orderBy: { createdAt: 'asc' } }),
    ]);

    const componentSumCents = costComponents.reduce((acc, c) => acc + toCents(c.amount.toString()), 0);
    const bookValueCents = toCents(unit.bookValue.toString());

    // Authoritative "does this tie to the GL" balance — sourced from real
    // schedule-service open items (schedule 80), NOT independently
    // recomputed from this service's own vehicleUnit row. `componentSumCents`
    // above remains this service's own cost-basis/lineage DETAIL (cost
    // buildup), a distinct concept from schedule truth. `null` (not a
    // fabricated 0) when schedule-service is unreachable or this tenant's
    // VEHICLE_INVENTORY GL account has no scheduleCode wired yet.
    const scheduleBalance = await this.scheduleClient.getOpenItemsBalance(
      tenantId,
      SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY,
      scheduleControlNumber(unit.stockNumber),
    );

    return {
      unit,
      costComponents,
      stockInEvents,
      reconEvents,
      componentEvents,
      tieOut: {
        bookValueCents,
        componentSumCents,
        tiesOut: bookValueCents === componentSumCents,
        schedule: scheduleBalance
          ? {
              scheduleNumber: SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY,
              controlNumber: scheduleControlNumber(unit.stockNumber),
              remainingBalanceCents: scheduleBalance.remainingBalanceCents,
              openItemCount: scheduleBalance.openItemCount,
              tiesOutToSchedule: bookValueCents === scheduleBalance.remainingBalanceCents,
            }
          : null,
      },
    };
  }
}
