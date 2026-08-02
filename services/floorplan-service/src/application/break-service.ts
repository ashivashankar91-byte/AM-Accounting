// S080 — the break worklist disposition ceremony. Every disposition is a
// mutating endpoint requiring a reason, fully audited (FloorplanBreakDisposition
// is an append-only trail). Only WRITE_OFF_VARIANCE results in a posting
// (the other actions are informational/record-keeping — see the doc
// comment on DISPOSITION_ACTIONS below for the rationale on each).
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import { appendAuditReference } from '../infrastructure/audit';
import { buildEnvelope } from '../domain/envelope';
import { EVENT_TYPES, EVENT_SCHEMA_VERSION } from '../domain/event-types';
import { PostingOrchestrator } from './posting-orchestrator';
import {
  FloorplanNotFoundError,
  FloorplanValidationError,
  BreakAlreadyDispositionedError,
} from '../domain/errors';

export const DISPOSITION_ACTIONS = [
  // Lender's figure stands as correct; the local record is noted resolved.
  // Does NOT post — correcting our own liability item to match the
  // lender's figure requires a new, lender-confirmed staged row (a fresh
  // S079 import), never a synthetic entry fabricated from a disposition
  // note. Documented limitation, not silently engineered around.
  'ACCEPT_LENDER_FIGURE',
  // Our figure stands as correct; the lender's break is noted resolved
  // (e.g. after out-of-band lender confirmation). Does not post.
  'ACCEPT_OUR_FIGURE',
  // The variance is written off — this is the one action that posts a real
  // journal (expense recognition + principal-relief adjustment against the
  // unit's liability item).
  'WRITE_OFF_VARIANCE',
  // Escalated for manual investigation outside this worklist. Does not post.
  'ESCALATE',
  // Reviewed, no correction warranted this cycle. Does not post.
  'NO_ACTION_DOCUMENTED',
] as const;
export type DispositionAction = (typeof DISPOSITION_ACTIONS)[number];

export interface DispositionInput {
  action: DispositionAction;
  reason: string;
  idempotencyKey: string;
  /** Required only for WRITE_OFF_VARIANCE — the fixed department code the
   * write-off expense line posts against (SAFE_CONFIGURATION; the pending-
   * mapping default rule pack doesn't require this since its accountNumber
   * is the exempt ACCOUNT_MAPPING_VALUES_PENDING sentinel, but a resolved
   * P&L account will reject without one). */
  deptCode?: string;
}

@injectable()
export class BreakService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject(PostingOrchestrator) private readonly postingOrchestrator: PostingOrchestrator,
  ) {}

  async listBreaks(tenantId: string, filters: { status?: string; breakType?: string } = {}) {
    return this.prisma.floorplanBreak.findMany({
      where: { tenantId, ...(filters.status ? { status: filters.status } : {}), ...(filters.breakType ? { breakType: filters.breakType } : {}) },
      orderBy: { detectedAt: 'desc' },
    });
  }

  async getBreak(tenantId: string, breakId: string) {
    const brk = await this.prisma.floorplanBreak.findFirst({ where: { tenantId, id: breakId }, include: { dispositions: { orderBy: { occurredAt: 'asc' } } } });
    if (!brk) throw new FloorplanNotFoundError(`No break ${breakId}.`);
    return brk;
  }

  async dispositionBreak(tenantId: string, breakId: string, input: DispositionInput, actor: string) {
    if (!DISPOSITION_ACTIONS.includes(input.action)) throw new FloorplanValidationError(`Invalid disposition action: ${input.action}`);
    if (!input.reason?.trim()) throw new FloorplanValidationError('A reason is required to disposition a break.');
    if (!input.idempotencyKey?.trim()) throw new FloorplanValidationError('idempotencyKey is required.');

    const existingByKey = await this.prisma.floorplanBreakDisposition.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existingByKey) return existingByKey;

    const brk = await this.getBreak(tenantId, breakId);
    if (brk.status === 'DISPOSITIONED') throw new BreakAlreadyDispositionedError(breakId);

    let resultingMatchId: string | null = null;
    let postingOutcome: { status: string; journalNumber: string | null; failureReason: string | null; deadLetterId?: string } | null = null;

    if (input.action === 'WRITE_OFF_VARIANCE') {
      if (brk.breakType !== 'AMOUNT_VARIANCE' || !brk.itemId || !brk.varianceAmount) {
        throw new FloorplanValidationError('WRITE_OFF_VARIANCE is only valid for an AMOUNT_VARIANCE break linked to a liability item.');
      }
      const item = await this.prisma.floorplanLiabilityItem.findUnique({ where: { id: brk.itemId } });
      const envelope = buildEnvelope(tenantId, {
        eventType: EVENT_TYPES.BREAK_WRITEOFF,
        eventSchemaVersion: EVENT_SCHEMA_VERSION,
        sourceEntityType: 'FLOORPLAN_BREAK',
        sourceEntityId: breakId,
        correlationId: breakId,
        businessDate: new Date().toISOString().slice(0, 10),
        deterministicEventId: `${breakId}:writeoff`,
        payload: {
          lenderCode: item.lenderCode,
          applyNumber: item.applyNumber,
          vin: item.vin,
          stockNumber: item.stockNumber,
          amount: brk.varianceAmount.toString(),
          breakId,
        },
      });

      const { submitResult, deadLetterId } = await this.postingOrchestrator.postAndRecover(envelope, {
        postingIdempotencyKey: `${tenantId}:${envelope.eventId}`,
        sourceTransactionId: breakId,
      });

      const outcomeStatus = submitResult.status === 'NO_RULE_MATCH' ? 'REJECTED' : submitResult.status;
      postingOutcome = { status: outcomeStatus, journalNumber: submitResult.journalNumber, failureReason: submitResult.failureReason, deadLetterId };

      if (submitResult.status === 'POSTED') {
        const newRemaining = Math.max(0, Number(item.remainingBalance) - Number(brk.varianceAmount));
        await this.prisma.floorplanLiabilityItem.update({
          where: { id: item.id },
          data: { remainingBalance: newRemaining.toFixed(2), status: newRemaining <= 0 ? 'RELIEVED' : 'PARTIALLY_RELIEVED', relievedAt: newRemaining <= 0 ? new Date() : null },
        });
        const application = await this.prisma.floorplanLiabilityApplication.create({
          data: {
            id: randomUUID(),
            tenantId,
            itemId: item.id,
            applicationType: 'CURTAILMENT',
            amount: `-${brk.varianceAmount}`,
            postingExecutionId: submitResult.executionId,
            journalEntryId: submitResult.journalEntryId,
            journalNumber: submitResult.journalNumber,
          },
        });
        resultingMatchId = application.id;
      }
    }

    const result = await withSerializableRetry(this.prisma, async (tx: any) => {
      // CE-12 gap-close fix: must be first inside every interactive
      // $transaction callback — see match-service.ts's matchRow() for the
      // full explanation (RLS middleware SET vs. the transaction's own
      // dedicated pooled connection).
      await setTenantContextOnConnection(tx, tenantId);
      const disposition = await tx.floorplanBreakDisposition.create({
        data: {
          id: randomUUID(),
          tenantId,
          breakId,
          action: input.action,
          reason: input.reason,
          resultingMatchId,
          actor,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.floorplanBreak.update({ where: { id: breakId }, data: { status: 'DISPOSITIONED' } });
      return disposition;
    }).catch(async (err: any) => {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.floorplanBreakDisposition.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
        if (winner) return winner;
      }
      throw err;
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_BREAK',
      entityId: breakId,
      eventType: 'floorplan.break.dispositioned',
      actor,
      before: { status: brk.status },
      after: { action: input.action, reason: input.reason, postingOutcome },
    });

    return result;
  }
}
