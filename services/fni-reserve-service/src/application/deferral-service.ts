// S094 — Dealer-Obligor Deferral Mode. The ORIGINAL deferred-liability
// booking happens in deal-accounting-service's S084 journal (its rule pack
// conditions on this service's GET /deferral-mode contract — see
// ConfigService#resolveDeferralMode — to decide whether to book a product's
// income immediately (AGENT, S092 default) or defer it (OBLIGOR)). This
// service's job: expose that config contract, accept the registration call
// once deal-accounting-service has booked a deferred item (so this
// service's OWN records can run recognition against it), and own the
// entire preview-approve recognition-run pipeline.
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/fni-reserve-client';
import { computeRecognition, isSupportedEarningPattern, DeferralDomainError } from '../domain/deferral';
import { toCents, centsToDollarString } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { ConfigService } from './config-service';
import { newEnvelope } from '../infrastructure/posting-client';
import { audit } from '../infrastructure/audit';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import type { IScheduleOpenItemClient } from '../infrastructure/schedule-open-item-client';
import { SCHEDULE_OPEN_ITEM_CLIENT_TOKEN } from './remit-service';

export class DeferralValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DeferralValidationError';
  }
}
export class BookingNotFoundError extends Error {
  constructor(id: string) {
    super(`Deferral booking not found: ${id}`);
    this.name = 'BookingNotFoundError';
  }
}
export class BatchNotFoundError extends Error {
  constructor(id: string) {
    super(`Recognition run batch not found: ${id}`);
    this.name = 'BatchNotFoundError';
  }
}
export class BatchNotPreviewError extends Error {
  constructor(id: string, status: string) {
    super(`Recognition run batch ${id} is "${status}" — only a PREVIEW batch may be approved.`);
    this.name = 'BatchNotPreviewError';
  }
}

export function deferralApplyControlNumber(dealNumber: string, productCode: string): string {
  return `${dealNumber}:${productCode}`;
}

/** CE-12 gap-closure — schedule-service schedule 96's controlNumber/
 * itemNumber key. Distinct from deferralApplyControlNumber() above (which
 * uses a `:` separator and backs this service's own internal DB grouping/
 * audit lineage only): schedule-service's ScheduleDetail.controlNumber is
 * VarChar(10) and coa-service silently truncates any longer value to its
 * first 10 characters (see coa-service's posting-service.ts), so BOTH the
 * origination posting (deferral-booking-origination) and the relief posting
 * (deferral-recognition) resolve this SAME function against the SAME
 * (dealNumber, productCode) pair, guaranteeing identical post-truncation
 * matching on both sides. Callers should keep dealNumber+productCode short
 * enough that the combination is unique within its first 10 characters. */
export function deferralScheduleControlNumber(dealNumber: string, productCode: string): string {
  return `${dealNumber}-${productCode}`;
}

export interface RegisterDeferralBookingInput {
  dealNumber: string;
  productCode: string;
  productType: string;
  originalAmount: string;
  bookingDate: string;
  idempotencyKey: string;
  actor: string;
}

@injectable()
export class DeferralService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject(ConfigService) private readonly config: ConfigService,
    @inject(SCHEDULE_OPEN_ITEM_CLIENT_TOKEN) private readonly scheduleClient: IScheduleOpenItemClient,
  ) {}

  /**
   * S094 cross-service contract, half 2/2 (the GET is half 1/2, in
   * ConfigService#resolveDeferralMode). Called by deal-accounting-service
   * immediately after it books a deferred item in its S084 journal, so this
   * service's recognition-run pipeline has a durable, immutable record of
   * WHAT was deferred, WHEN, and under WHICH mode-config snapshot — a later
   * DeferralModeConfig change can never retroactively alter this booking's
   * classification, because the snapshot is taken exactly once, here, at
   * registration time (which the caller performs at booking time).
   */
  async registerBooking(tenantId: string, input: RegisterDeferralBookingInput) {
    const existing = await this.prisma.deferralBooking.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const originalAmountCents = toCents(input.originalAmount);
    if (!Number.isFinite(originalAmountCents) || originalAmountCents <= 0) {
      throw new DeferralValidationError('INVALID_AMOUNT', 'originalAmount must be a positive decimal amount.');
    }

    const bookingDate = new Date(input.bookingDate);
    const resolvedMode = await this.config.resolveDeferralMode(tenantId, input.productType, bookingDate);
    if (resolvedMode.mode !== 'OBLIGOR') {
      throw new DeferralValidationError('NOT_OBLIGOR_MODE', `productType ${input.productType} was not in OBLIGOR mode as of ${input.bookingDate} — nothing to register (agent-mode products recognize immediately via S092, never deferred).`);
    }
    if (!resolvedMode.earningPatternType || !isSupportedEarningPattern(resolvedMode.earningPatternType)) {
      throw new DeferralValidationError('UNSUPPORTED_PATTERN', `Resolved earning pattern "${resolvedMode.earningPatternType}" is not supported.`);
    }

    const controlNumber = deferralApplyControlNumber(input.dealNumber, input.productCode);

    // CE-12 gap-closure — S094/schedule 96: originate the deferred-income
    // liability item HERE, at registration time (this service's own new
    // item — see ce12.fni-reserve.deferral-booking-origination). Posted
    // BEFORE persisting the row so the row can carry the real posting
    // outcome (never fabricated success); a rejected posting still records
    // the booking (so recognition-run computation still sees it) but marks
    // originationStatus POSTING_FAILED, matching every other posting-
    // carrying record's pattern in this service (e.g. ReserveRemittance).
    const scheduleControlNumber = deferralScheduleControlNumber(input.dealNumber, input.productCode);
    const envelope = newEnvelope({
      tenantId,
      eventType: 'fni.deferral-booking-origination.v1',
      sourceEntityType: 'DEFERRAL_BOOKING',
      sourceEntityId: scheduleControlNumber,
      sourceTransactionId: input.dealNumber,
      correlationId: input.idempotencyKey,
      businessDate: input.bookingDate.slice(0, 10),
      payload: {
        dealNumber: input.dealNumber,
        productCode: input.productCode,
        originalAmount: input.originalAmount,
        scheduleControlNumber,
      },
    });
    const outcome = await this.posting.submit(envelope);

    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.deferralBooking.create({
        data: {
          tenantId,
          dealNumber: input.dealNumber,
          productCode: input.productCode,
          productType: input.productType,
          originalAmount: input.originalAmount,
          bookingDate,
          deferralModeConfigId: resolvedMode.configId,
          earningPatternType: resolvedMode.earningPatternType,
          earningPatternMonths: resolvedMode.earningPatternMonths,
          controlNumber,
          originationPostingExecutionId: outcome.submitResult.executionId ?? null,
          originationStatus: outcome.failed ? 'POSTING_FAILED' : 'POSTED',
          status: 'OPEN',
          idempotencyKey: input.idempotencyKey,
          createdBy: input.actor,
        },
      });
      await audit(tx, tenantId, 'DEFERRAL_BOOKING', row.id, 'REGISTERED', input.actor, null, { ...row, originationPostingStatus: outcome.submitResult.status });
      return row;
    });
    return created;
  }

  async getBooking(tenantId: string, id: string) {
    const row = await this.prisma.deferralBooking.findFirst({ where: { id, tenantId } });
    if (!row) throw new BookingNotFoundError(id);
    return row;
  }

  async listBookings(tenantId: string, status?: string) {
    return this.prisma.deferralBooking.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { bookingDate: 'asc' } });
  }

  /**
   * S094 — compute a PREVIEW recognition-run batch. Nothing posts here —
   * preview-approve, same behavioral contract as S075's preview-approve
   * pattern (implemented independently).
   */
  async computeRecognitionRunPreview(tenantId: string, asOfDate: string, actor: string) {
    const asOf = new Date(asOfDate);
    const openBookings = await this.prisma.deferralBooking.findMany({ where: { tenantId, status: 'OPEN' } });

    const lineComputations: Array<{ booking: any; earnedThisRunCents: number; periodStart: Date; periodEnd: Date; cumulativeBeforeCents: number }> = [];
    for (const booking of openBookings as any[]) {
      if (!isSupportedEarningPattern(booking.earningPatternType) || !booking.earningPatternMonths) continue;
      const originalAmountCents = toCents(booking.originalAmount.toString());
      const alreadyRecognizedCents = toCents(booking.recognizedAmount.toString());
      let computation;
      try {
        computation = computeRecognition(originalAmountCents, booking.earningPatternMonths, booking.bookingDate, asOf, alreadyRecognizedCents);
      } catch (err) {
        if (err instanceof DeferralDomainError) continue; // malformed config row — skip, never guess
        throw err;
      }
      if (computation.earnedThisRunCents <= 0) continue;
      lineComputations.push({
        booking,
        earnedThisRunCents: computation.earnedThisRunCents,
        periodStart: booking.bookingDate,
        periodEnd: asOf,
        cumulativeBeforeCents: alreadyRecognizedCents,
      });
    }

    const computedTotalCents = lineComputations.reduce((s, l) => s + l.earnedThisRunCents, 0);

    const batch = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const b = await tx.recognitionRunBatch.create({
        data: { tenantId, asOfDate: asOf, status: 'PREVIEW', computedTotal: centsToDollarString(computedTotalCents), createdBy: actor },
      });
      for (const l of lineComputations) {
        await tx.recognitionRunLine.create({
          data: {
            tenantId,
            batchId: b.id,
            deferralBookingId: l.booking.id,
            periodStart: l.periodStart,
            periodEnd: l.periodEnd,
            cumulativeRecognizedBefore: centsToDollarString(l.cumulativeBeforeCents),
            earnedAmount: centsToDollarString(l.earnedThisRunCents),
            status: 'PENDING',
          },
        });
      }
      await audit(tx, tenantId, 'RECOGNITION_RUN_BATCH', b.id, 'PREVIEW_COMPUTED', actor, null, { computedTotal: b.computedTotal.toString(), lineCount: lineComputations.length });
      return b;
    });

    return this.getBatch(tenantId, batch.id);
  }

  async getBatch(tenantId: string, id: string) {
    const row = await this.prisma.recognitionRunBatch.findFirst({ where: { id, tenantId }, include: { lines: { include: { deferralBooking: true } } } });
    if (!row) throw new BatchNotFoundError(id);
    return row;
  }

  async listBatches(tenantId: string, status?: string) {
    return this.prisma.recognitionRunBatch.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * S094 — explicit accountant approval, THEN posts. The posted amount is
   * always EXACTLY what was computed at preview time (recognitionRunLine
   * rows are immutable once created by computeRecognitionRunPreview — this
   * method never re-runs computeRecognition), per the AC: "the recognition
   * run's posted amount = exactly what was in the approved preview, never
   * re-computed at posting time."
   */
  async approveAndPost(tenantId: string, batchId: string, actor: string) {
    const batch = await this.getBatch(tenantId, batchId);
    if (batch.status !== 'PREVIEW') throw new BatchNotPreviewError(batchId, batch.status);

    await this.prisma.recognitionRunBatch.update({
      where: { id: batchId },
      data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() },
    });
    await audit(this.prisma as any, tenantId, 'RECOGNITION_RUN_BATCH', batchId, 'APPROVED', actor, { status: 'PREVIEW' }, { status: 'APPROVED', computedTotal: batch.computedTotal.toString() });

    for (const line of (batch as any).lines) {
      const booking = line.deferralBooking;
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.deferral-recognition.v1',
        sourceEntityType: 'RECOGNITION_RUN_LINE',
        sourceEntityId: booking.controlNumber,
        sourceTransactionId: booking.dealNumber,
        correlationId: line.id,
        causationId: batchId,
        businessDate: batch.asOfDate.toISOString().slice(0, 10),
        payload: {
          dealNumber: booking.dealNumber,
          productCode: booking.productCode,
          earnedAmount: line.earnedAmount.toString(),
          applyControlNumber: booking.controlNumber,
          // The schedule-96 relief key — MUST equal what
          // deferral-booking-origination opened the item under (same
          // dealNumber/productCode pair through the same deterministic
          // helper) — see deferralScheduleControlNumber's doc comment.
          scheduleControlNumber: deferralScheduleControlNumber(booking.dealNumber, booking.productCode),
        },
      });
      const outcome = await this.posting.submit(envelope);

      await this.prisma.$transaction(async (tx: any) => {
        await setTenantContextOnConnection(tx, tenantId);
        await tx.recognitionRunLine.update({
          where: { id: line.id },
          data: { postingExecutionId: outcome.submitResult.executionId ?? null, status: outcome.failed ? 'FAILED' : 'POSTED' },
        });
        if (!outcome.failed) {
          const newRecognized = toCents(booking.recognizedAmount.toString()) + toCents(line.earnedAmount.toString());
          const originalAmountCents = toCents(booking.originalAmount.toString());
          await tx.deferralBooking.update({
            where: { id: booking.id },
            data: {
              recognizedAmount: centsToDollarString(newRecognized),
              status: newRecognized >= originalAmountCents ? 'FULLY_RECOGNIZED' : 'OPEN',
            },
          });
        }
      });
    }

    await this.prisma.recognitionRunBatch.update({ where: { id: batchId }, data: { status: 'POSTED', postedAt: new Date() } });
    await audit(this.prisma as any, tenantId, 'RECOGNITION_RUN_BATCH', batchId, 'POSTED', actor, { status: 'APPROVED' }, { status: 'POSTED' });

    return this.getBatch(tenantId, batchId);
  }

  /**
   * S094 AC: "deferred liability = Σ unearned" — this service's own local
   * lineage (totalDeferred/totalRecognized/totalUnearned, preserved for
   * backward compatibility and audit lineage) PLUS the schedule-service
   * schedule-96 authoritative figure (CE-12 gap-closure: schedule-service's
   * real open items are now the source of truth for the GL-facing balance,
   * not this service's own bookkeeping — see FniScheduleMapping role
   * 'DEFERRED_INCOME_LIABILITY'). `scheduleTieOut` is null only when no
   * mapping has been configured for this tenant yet (never fabricated).
   */
  async tieOutDeferralLiability(tenantId: string) {
    const bookings = await this.prisma.deferralBooking.findMany({ where: { tenantId } });
    let totalDeferredCents = 0;
    let totalRecognizedCents = 0;
    for (const b of bookings as any[]) {
      totalDeferredCents += toCents(b.originalAmount.toString());
      totalRecognizedCents += toCents(b.recognizedAmount.toString());
    }

    const mapping = await this.config.getScheduleMapping(tenantId, 'DEFERRED_INCOME_LIABILITY');
    let scheduleTieOut: { scheduleNumber: string; openItemCount: number; totalRemainingBalance: string; source: 'SCHEDULE_SERVICE' } | null = null;
    if (mapping) {
      const items = await this.scheduleClient.listOpenItems(tenantId, mapping.scheduleNumber);
      const remainingCents = items.reduce((sum, i) => sum + toCents(i.remainingBalance), 0);
      scheduleTieOut = {
        scheduleNumber: mapping.scheduleNumber,
        openItemCount: items.length,
        totalRemainingBalance: centsToDollarString(remainingCents),
        source: 'SCHEDULE_SERVICE',
      };
    }

    return {
      totalDeferred: centsToDollarString(totalDeferredCents),
      totalRecognized: centsToDollarString(totalRecognizedCents),
      totalUnearned: centsToDollarString(totalDeferredCents - totalRecognizedCents),
      scheduleTieOut,
    };
  }
}
