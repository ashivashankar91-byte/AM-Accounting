// S082 — Floorplan Interest & Curtailments (curtailment half). Curtailment
// schedule is per-lender-terms configuration (SAFE_CONFIGURATION — entered
// by an operator, never invented rate math). A curtailment payment posts a
// principal-relief journal against the SPECIFIC unit's floorplan liability
// item (applyNumberPath), exactly like a partial payoff in match-service.
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import { appendAuditReference } from '../infrastructure/audit';
import { buildEnvelope } from '../domain/envelope';
import { EVENT_TYPES, EVENT_SCHEMA_VERSION } from '../domain/event-types';
import { PostingOrchestrator } from './posting-orchestrator';
import { FloorplanValidationError, FloorplanNotFoundError } from '../domain/errors';

@injectable()
export class CurtailmentService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject(PostingOrchestrator) private readonly postingOrchestrator: PostingOrchestrator,
  ) {}

  async configureSchedule(tenantId: string, input: { lenderCode: string; intervalDays: number; curtailmentPercent: string; effectiveFrom: string; effectiveTo?: string | null }, actor: string) {
    if (!input.lenderCode?.trim()) throw new FloorplanValidationError('lenderCode is required.');
    if (!Number.isInteger(input.intervalDays) || input.intervalDays <= 0) throw new FloorplanValidationError('intervalDays must be a positive integer.');
    const pct = Number(input.curtailmentPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new FloorplanValidationError('curtailmentPercent must be a decimal string between 0 and 100.');
    if (!input.effectiveFrom) throw new FloorplanValidationError('effectiveFrom is required.');

    const created = await this.prisma.floorplanCurtailmentScheduleConfig.create({
      data: {
        id: randomUUID(),
        tenantId,
        lenderCode: input.lenderCode,
        intervalDays: input.intervalDays,
        curtailmentPercent: input.curtailmentPercent,
        effectiveFrom: new Date(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
        createdBy: actor,
      },
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_CURTAILMENT_SCHEDULE_CONFIG',
      entityId: created.id,
      eventType: 'floorplan.curtailment_schedule.configured',
      actor,
      after: created,
    });

    return created;
  }

  async listSchedules(tenantId: string, lenderCode?: string) {
    return this.prisma.floorplanCurtailmentScheduleConfig.findMany({
      where: { tenantId, ...(lenderCode ? { lenderCode } : {}) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async payCurtailment(tenantId: string, input: { itemId: string; amount: string; paidAt: string; idempotencyKey: string }, actor: string) {
    if (!input.itemId?.trim()) throw new FloorplanValidationError('itemId is required.');
    if (!input.amount || Number(input.amount) <= 0) throw new FloorplanValidationError('amount must be a positive decimal string.');
    if (!input.paidAt) throw new FloorplanValidationError('paidAt is required.');
    if (!input.idempotencyKey?.trim()) throw new FloorplanValidationError('idempotencyKey is required.');

    const existing = await this.prisma.floorplanCurtailmentPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const item = await this.prisma.floorplanLiabilityItem.findFirst({ where: { tenantId, id: input.itemId } });
    if (!item) throw new FloorplanNotFoundError(`No liability item ${input.itemId}.`);
    if (Number(input.amount) > Number(item.remainingBalance)) {
      throw new FloorplanValidationError(`Curtailment amount ${input.amount} exceeds remaining balance ${item.remainingBalance} for item ${item.id}.`);
    }

    const envelope = buildEnvelope(tenantId, {
      eventType: EVENT_TYPES.CURTAILMENT_PAYMENT,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      sourceEntityType: 'FLOORPLAN_LIABILITY_ITEM',
      sourceEntityId: item.id,
      correlationId: `curtailment:${item.id}:${input.idempotencyKey}`,
      businessDate: input.paidAt.slice(0, 10),
      deterministicEventId: `curtailment:${tenantId}:${input.idempotencyKey}`,
      payload: { lenderCode: item.lenderCode, applyNumber: item.applyNumber, vin: item.vin, stockNumber: item.stockNumber, amount: input.amount },
    });

    const { submitResult, deadLetterId } = await this.postingOrchestrator.postAndRecover(envelope, {
      postingIdempotencyKey: `${tenantId}:${envelope.eventId}`,
      sourceTransactionId: item.id,
    });

    const status = submitResult.status === 'POSTED' ? 'POSTED' : submitResult.status === 'NO_RULE_MATCH' ? 'REJECTED' : submitResult.status;

    const result = await withSerializableRetry(this.prisma, async (tx: any) => {
      // CE-12 gap-close fix: must be first inside every interactive
      // $transaction callback — see match-service.ts's matchRow() for the
      // full explanation (RLS middleware SET vs. the transaction's own
      // dedicated pooled connection).
      await setTenantContextOnConnection(tx, tenantId);
      const already = await tx.floorplanCurtailmentPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
      if (already) return already;

      const payment = await tx.floorplanCurtailmentPayment.create({
        data: {
          id: randomUUID(),
          tenantId,
          lenderCode: item.lenderCode,
          itemId: item.id,
          vin: item.vin,
          stockNumber: item.stockNumber,
          amount: input.amount,
          paidAt: new Date(input.paidAt),
          idempotencyKey: input.idempotencyKey,
          status,
          postingExecutionId: submitResult.executionId,
          journalEntryId: submitResult.journalEntryId,
          journalNumber: submitResult.journalNumber,
          failureReason: submitResult.failureReason,
          enteredBy: actor,
        },
      });

      if (submitResult.status === 'POSTED') {
        const freshItem = await tx.floorplanLiabilityItem.findUnique({ where: { id: item.id } });
        const newRemaining = Math.max(0, Number(freshItem.remainingBalance) - Number(input.amount));
        await tx.floorplanLiabilityItem.update({
          where: { id: item.id },
          data: { remainingBalance: newRemaining.toFixed(2), status: newRemaining <= 0 ? 'RELIEVED' : 'PARTIALLY_RELIEVED', relievedAt: newRemaining <= 0 ? new Date() : null },
        });
        await tx.floorplanLiabilityApplication.create({
          data: {
            id: randomUUID(),
            tenantId,
            itemId: item.id,
            applicationType: 'CURTAILMENT',
            amount: `-${input.amount}`,
            curtailmentPaymentId: payment.id,
            postingExecutionId: submitResult.executionId,
            journalEntryId: submitResult.journalEntryId,
            journalNumber: submitResult.journalNumber,
          },
        });
      }

      return payment;
    }).catch(async (err: any) => {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.floorplanCurtailmentPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
        if (winner) return winner;
      }
      throw err;
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_CURTAILMENT_PAYMENT',
      entityId: result.id,
      eventType: 'floorplan.curtailment_payment.entered',
      actor,
      after: { itemId: item.id, amount: input.amount, status: result.status, journalNumber: result.journalNumber, deadLetterId },
    });

    return result;
  }

  async listPayments(tenantId: string, filters: { lenderCode?: string } = {}) {
    return this.prisma.floorplanCurtailmentPayment.findMany({ where: { tenantId, ...(filters.lenderCode ? { lenderCode: filters.lenderCode } : {}) }, orderBy: { paidAt: 'desc' } });
  }
}
