// S075 — Demo Reclass & Depreciation.
import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/vehicle-accounting-client';
import { buildEnvelope } from '../domain/event-envelope';
import { reclassUnitValue, computeDemoValueAdjustmentPreview, assertApprovedAmountMatchesPreview } from '../domain/demo';
import { toCents, centsToDollarString } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { HttpPostingEngineClient } from '../infrastructure/posting-engine-client';
import { UnitNotFoundError, VehicleAccountingInputError, AdjustmentNotFoundError, AdjustmentNotPendingError, ConfigNotFoundError } from './errors';
import { auditOutboxEvent } from '../infrastructure/audit';
import { withP2002Retry } from '../infrastructure/db-retry';

export const EVENT_TYPES = {
  DEMO_RECLASSED: 'vehicle.demo-reclassed.v1',
  DEMO_VALUE_ADJUSTED: 'vehicle.demo-value-adjusted.v1',
} as const;

function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

@injectable()
export class DemoService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject('PostingEngineClient') private readonly postingEngineClient: HttpPostingEngineClient,
  ) {}

  // ── Reclass NEW -> DEMO ceremony ─────────────────────────────────────────
  async reclass(tenantId: string, actor: string, input: { stockNumber: string; eventId: string; idempotencyKey?: string; correlationId?: string }) {
    const idempotencyKey = input.idempotencyKey ?? input.eventId;
    const existingByKey = await this.prisma.demoReclass.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existingByKey) return { idempotent: true, reclass: existingByKey };

    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);
    if (unit.status !== 'NEW') throw new VehicleAccountingInputError(`Unit ${input.stockNumber} is "${unit.status}" — only a NEW unit may be reclassed to DEMO.`);

    const unitValueCents = reclassUnitValue(toCents(unit.bookValue.toString()));
    const correlationId = input.correlationId ?? input.eventId;

    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: unit.entityId,
      eventType: EVENT_TYPES.DEMO_RECLASSED,
      occurredAt: nowIso(),
      businessDate: today(),
      sourceEntityType: 'VEHICLE_UNIT',
      sourceEntityId: input.stockNumber,
      correlationId,
      payload: { stockNumber: input.stockNumber, fromStatus: unit.status, toStatus: 'DEMO', unitValue: centsToDollarString(unitValueCents) },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: unit.entityId, storeId: unit.storeId, sourceTransactionId: input.stockNumber });
    const posted = result.status === 'POSTED';

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      if (posted) {
        await tx.vehicleUnit.update({ where: { id: unit.id }, data: { status: 'DEMO', version: { increment: 1 } } });
      }
      // upsert, not create+catch(P2002) — see vehicle-unit-service.ts's
      // stockIn() header comment: a Prisma interactive transaction aborts
      // entirely on any query error, so a nested findUnique-on-conflict
      // inside the same tx would itself fail (verified against a live
      // Postgres instance).
      const reclass = await tx.demoReclass.upsert({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        create: {
          id: randomUUID(), tenantId, unitId: unit.id, eventId: input.eventId,
          fromStatus: unit.status, toStatus: 'DEMO', unitValue: new Prisma.Decimal(centsToDollarString(unitValueCents)),
          status: result.status, postingExecutionId: result.executionId, journalEntryId: result.journalEntryId ?? null,
          journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
          actor, idempotencyKey,
        },
        update: {},
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
        action: posted ? 'DEMO_RECLASSED' : 'DEMO_RECLASS_POSTING_FAILED',
        after: { eventId: input.eventId, status: result.status },
      });
      return reclass;
    }));

    return { idempotent: false, reclass: created, postingResult: result };
  }

  // ── Periodic demo value adjustment: preview ─────────────────────────────
  async previewAdjustment(tenantId: string, actor: string, input: { stockNumber: string }) {
    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);
    if (unit.status !== 'DEMO') throw new VehicleAccountingInputError(`Unit ${input.stockNumber} is "${unit.status}" — only a DEMO unit has a depreciation basis.`);

    const config = await this.prisma.demoDepreciationBasisConfig.findUnique({ where: { tenantId_entityId: { tenantId, entityId: unit.entityId } } });
    if (!config) throw new ConfigNotFoundError(`No demo depreciation basis configured for entity ${unit.entityId}. An authorized user must configure DemoDepreciationBasisConfig before a preview can be computed.`);

    const lastAdjustment = await this.prisma.demoValueAdjustment.findFirst({
      where: { tenantId, unitId: unit.id, status: { in: ['APPROVED', 'POSTED'] } },
      orderBy: { computedAt: 'desc' },
    });
    const since = lastAdjustment?.computedAt ?? unit.createdAt;
    const elapsedDays = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86_400_000));
    const elapsedPeriods = Math.max(1, Math.floor(elapsedDays / config.periodLengthDays) || 1);

    const bookValueCents = toCents(unit.bookValue.toString());
    const proposedCents = computeDemoValueAdjustmentPreview(bookValueCents, config.percentPerPeriodBp, elapsedPeriods);

    const preview = await this.prisma.demoValueAdjustment.create({
      data: {
        id: randomUUID(), tenantId, unitId: unit.id, basisConfigId: config.id,
        proposedAmount: new Prisma.Decimal(centsToDollarString(proposedCents)),
        computedAt: new Date(), computedBy: actor,
        status: 'PENDING_PREVIEW',
        idempotencyKey: `preview-${randomUUID()}`,
      },
    });
    return preview;
  }

  // ── Approve (nothing auto-posts; approve == confirm the exact preview) ──
  async approveAdjustment(tenantId: string, actor: string, input: { adjustmentId: string; approvedAmount: string; eventId: string; idempotencyKey?: string }) {
    const adjustment = await this.prisma.demoValueAdjustment.findFirst({ where: { id: input.adjustmentId, tenantId } });
    if (!adjustment) throw new AdjustmentNotFoundError(input.adjustmentId);
    if (adjustment.status !== 'PENDING_PREVIEW') throw new AdjustmentNotPendingError(input.adjustmentId, adjustment.status);

    const approvedCents = toCents(input.approvedAmount);
    assertApprovedAmountMatchesPreview(toCents(adjustment.proposedAmount.toString()), { approvedAmountCents: approvedCents });

    const unit = await this.prisma.vehicleUnit.findUnique({ where: { id: adjustment.unitId } });
    if (!unit) throw new UnitNotFoundError(adjustment.unitId);

    // Claim-then-act concurrency guard: an atomic compare-and-swap
    // (status must STILL be PENDING_PREVIEW at the DB level, not just at
    // the read above) reserves this adjustment for THIS call before the
    // external, side-effecting coa-service posting call below — a second,
    // truly concurrent approveAdjustment() call for the same adjustmentId
    // loses the race here (updateMany count 0) and throws cleanly WITHOUT
    // ever submitting a second, duplicate posting event. Doing the
    // compare-and-swap only AFTER the posting call (the more obvious
    // ordering) would let both racers each submit their own distinct
    // eventId to coa-service and get their own real journal entries
    // posted before either discovers the DB-level conflict — an orphan
    // journal entry this service would then have no record of. 'APPROVED'
    // is used as the claimed-but-not-yet-posted marker (it is already a
    // valid status in this model's lifecycle, not a new one invented for
    // this guard).
    const claim = await this.prisma.demoValueAdjustment.updateMany({
      where: { id: adjustment.id, tenantId, status: 'PENDING_PREVIEW' },
      data: { status: 'APPROVED', approvedAmount: new Prisma.Decimal(centsToDollarString(approvedCents)), approvedBy: actor, approvedAt: new Date() },
    });
    if (claim.count === 0) throw new AdjustmentNotPendingError(input.adjustmentId, 'PENDING_PREVIEW (lost a concurrent claim)');

    const correlationId = input.idempotencyKey ?? input.eventId;
    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: unit.entityId,
      eventType: EVENT_TYPES.DEMO_VALUE_ADJUSTED,
      occurredAt: nowIso(),
      businessDate: today(),
      sourceEntityType: 'VEHICLE_UNIT',
      sourceEntityId: unit.stockNumber,
      correlationId,
      payload: { stockNumber: unit.stockNumber, adjustmentAmount: centsToDollarString(approvedCents) },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: unit.entityId, storeId: unit.storeId, sourceTransactionId: unit.stockNumber });
    const posted = result.status === 'POSTED';

    const updated = await this.prisma.$transaction(async (tx) => {
      if (posted) {
        await tx.vehicleUnit.update({ where: { id: unit.id }, data: { bookValue: { decrement: new Prisma.Decimal(centsToDollarString(approvedCents)) } } });
      }
      const u = await tx.demoValueAdjustment.update({
        where: { id: adjustment.id },
        data: {
          // Stays 'APPROVED' (the claim above) when the posting itself
          // did not succeed — still claimed/owned by this call, not back
          // to PENDING_PREVIEW, so a second concurrent call can never
          // re-claim and re-submit a failed attempt either.
          status: posted ? 'POSTED' : 'APPROVED',
          eventId: input.eventId,
          postingExecutionId: result.executionId, journalEntryId: result.journalEntryId ?? null,
          journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
        },
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
        action: posted ? 'DEMO_VALUE_ADJUSTMENT_POSTED' : 'DEMO_VALUE_ADJUSTMENT_POSTING_FAILED',
        after: { adjustmentId: adjustment.id, approvedAmount: centsToDollarString(approvedCents), status: result.status },
      });
      return u;
    });

    return { adjustment: updated, postingResult: result };
  }

  async rejectAdjustment(tenantId: string, actor: string, input: { adjustmentId: string; reason: string }) {
    const adjustment = await this.prisma.demoValueAdjustment.findFirst({ where: { id: input.adjustmentId, tenantId } });
    if (!adjustment) throw new AdjustmentNotFoundError(input.adjustmentId);
    if (adjustment.status !== 'PENDING_PREVIEW') throw new AdjustmentNotPendingError(input.adjustmentId, adjustment.status);
    if (!input.reason?.trim()) throw new VehicleAccountingInputError('reason is required to reject an adjustment preview.');

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.demoValueAdjustment.update({
        where: { id: adjustment.id },
        data: { status: 'REJECTED', rejectedReason: input.reason, approvedBy: actor, approvedAt: new Date() },
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: adjustment.unitId, actor,
        action: 'DEMO_VALUE_ADJUSTMENT_REJECTED', after: { adjustmentId: adjustment.id, reason: input.reason },
      });
      return u;
    });
  }

  // ── S218 symmetric reversal ──────────────────────────────────────────────
  async reverseAdjustment(tenantId: string, actor: string, input: { adjustmentId: string; reason: string }) {
    const adjustment = await this.prisma.demoValueAdjustment.findFirst({ where: { id: input.adjustmentId, tenantId } });
    if (!adjustment) throw new AdjustmentNotFoundError(input.adjustmentId);
    if (adjustment.status !== 'POSTED' || !adjustment.journalEntryId) {
      throw new VehicleAccountingInputError(`Adjustment "${input.adjustmentId}" is not POSTED — nothing to reverse.`);
    }
    if (!input.reason?.trim() || input.reason.length > 500) {
      throw new VehicleAccountingInputError('reason is required (1-500 chars) to reverse a posted adjustment.');
    }

    const reversal = await this.postingEngineClient.reverseJournal(tenantId, adjustment.journalEntryId, input.reason);

    return this.prisma.$transaction(async (tx) => {
      await tx.vehicleUnit.update({ where: { id: adjustment.unitId }, data: { bookValue: { increment: adjustment.approvedAmount ?? new Prisma.Decimal(0) } } });
      const u = await tx.demoValueAdjustment.update({
        where: { id: adjustment.id },
        data: { status: 'REVERSED', reversalJournalEntryId: String(reversal.id ?? ''), reversedAt: new Date(), reversedBy: actor, reversalReason: input.reason },
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: adjustment.unitId, actor,
        action: 'DEMO_VALUE_ADJUSTMENT_REVERSED', after: { adjustmentId: adjustment.id, reversalJournalEntryId: reversal.id },
      });
      return u;
    });
  }

  async listAdjustments(tenantId: string, filters: { stockNumber?: string; status?: string }) {
    let unitId: string | undefined;
    if (filters.stockNumber) {
      const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: filters.stockNumber } } });
      unitId = unit?.id;
      if (!unitId) return [];
    }
    return this.prisma.demoValueAdjustment.findMany({
      where: { tenantId, ...(unitId ? { unitId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
