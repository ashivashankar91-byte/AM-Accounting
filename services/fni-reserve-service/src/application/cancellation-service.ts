// S093 — Product Cancellations. The original product booking (deal-
// accounting-service's S084 journal) is not this service's concern; this
// service owns the cancellation ceremony itself: refund computation
// (ENTERED provider quote OR configured pro-rata table — NEVER invented),
// the three-leg posting, and — when the cancelled product is chargeback-
// reserve-affecting — the shared S091(c) chargeback-draw trigger.
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/fni-reserve-client';
import {
  computeCancellationLegsFromPercent,
  computeCancellationLegsFromQuoteAmount,
  resolveProRataPercent,
  CancellationDomainError,
  CancellationLegs,
} from '../domain/cancellation';
import { wholeMonthsElapsed } from '../domain/deferral';
import { centsToDollarString } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { ChargebackDrawExecutor } from './chargeback-draw-executor';
import { ConfigService } from './config-service';
import { chargebackControlNumber } from './reserve-service';
import { newEnvelope } from '../infrastructure/posting-client';
import { audit } from '../infrastructure/audit';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';

export class CancellationValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CancellationValidationError';
  }
}
export class DuplicateCancellationError extends Error {
  constructor(dealNumber: string, productCode: string) {
    super(`Product ${productCode} on deal ${dealNumber} has already been cancelled — refusing a duplicate cancellation (not a duplicate refund).`);
    this.name = 'DuplicateCancellationError';
  }
}
export class CancellationNotFoundError extends Error {
  constructor(id: string) {
    super(`Product cancellation not found: ${id}`);
    this.name = 'CancellationNotFoundError';
  }
}

export function cancellationRefundControlNumber(dealNumber: string, productCode: string): string {
  return `${dealNumber}:${productCode}:CANCEL`;
}
export function remitApplyControlNumber(dealNumber: string, productCode: string): string {
  return `${dealNumber}:${productCode}`;
}

export type RefundBasisInput =
  | { kind: 'PROVIDER_QUOTE_PERCENT'; refundPercent: number }
  | { kind: 'PROVIDER_QUOTE_AMOUNT'; quoteTotalAmount: string }
  | { kind: 'CONFIG_PRORATA'; productType: string; providerCode: string; bookingDate: string };

export interface ProcessCancellationInput {
  dealNumber: string;
  productCode: string;
  cancellationSource: 'CUSTOMER' | 'LENDER';
  originalIncomeAmount: string;
  originalRemitAmount: string;
  refundBasis: RefundBasisInput;
  chargebackTriggered?: boolean;
  lenderProgramCode?: string;
  chargebackAmount?: string;
  idempotencyKey: string;
  actor: string;
  correlationId?: string;
  businessDate?: string;
}

@injectable()
export class CancellationService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
    @inject(ChargebackDrawExecutor) private readonly drawExecutor: ChargebackDrawExecutor,
    @inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private async _resolveLegs(tenantId: string, input: ProcessCancellationInput): Promise<CancellationLegs> {
    const basis = input.refundBasis;
    try {
      if (basis.kind === 'PROVIDER_QUOTE_PERCENT') {
        return computeCancellationLegsFromPercent(input.originalIncomeAmount, input.originalRemitAmount, basis.refundPercent);
      }
      if (basis.kind === 'PROVIDER_QUOTE_AMOUNT') {
        return computeCancellationLegsFromQuoteAmount(input.originalIncomeAmount, input.originalRemitAmount, basis.quoteTotalAmount);
      }
      // CONFIG_PRORATA
      const config = await this.config.resolveProviderProgramConfig(tenantId, basis.providerCode, basis.productType, new Date(input.businessDate ?? new Date().toISOString()));
      if (!config) {
        throw new CancellationDomainError('NO_REFUND_BASIS', `No ProviderProgramConfig configured for provider=${basis.providerCode} productType=${basis.productType} — cannot compute a refund without an entered quote or a configured pro-rata table.`);
      }
      const bookingDate = new Date(basis.bookingDate);
      const asOfDate = new Date(input.businessDate ?? new Date().toISOString());
      const monthsElapsed = wholeMonthsElapsed(bookingDate, asOfDate, config.termMonths);
      const refundPercent = resolveProRataPercent(config.proRataTable as any, monthsElapsed);
      return computeCancellationLegsFromPercent(input.originalIncomeAmount, input.originalRemitAmount, refundPercent);
    } catch (err) {
      if (err instanceof CancellationDomainError) {
        throw new CancellationValidationError(err.code, err.message);
      }
      throw err;
    }
  }

  /**
   * Dry-run preview for POST /cancellations — same request shape, computes
   * and returns the three-leg breakdown (income-reversal/remit-adjustment/
   * refund-payable) WITHOUT posting or persisting anything. Delegates to
   * the SAME _resolveLegs() processCancellation() below calls before its
   * first write — the identical computation, so preview and reality can
   * never drift (proved by tests/unit/preview-parity.test.ts). Does NOT
   * perform the double-cancellation existence check (that check exists to
   * protect a real mutation, not a read-only simulation) and does NOT
   * preview the optional chargeback-draw leg (see
   * ReserveService#previewChargebackNotice for that computation).
   */
  async previewCancellation(tenantId: string, input: ProcessCancellationInput) {
    const legs = await this._resolveLegs(tenantId, input);
    return {
      preview: true as const,
      quoteTotal: centsToDollarString(legs.quoteTotalCents),
      incomeReversalAmount: centsToDollarString(legs.incomeReversalCents),
      remitAdjustmentAmount: centsToDollarString(legs.remitAdjustmentCents),
      refundPayableAmount: centsToDollarString(legs.refundPayableCents),
    };
  }

  async processCancellation(tenantId: string, input: ProcessCancellationInput) {
    const existingByIdempotency = await this.prisma.productCancellation.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existingByIdempotency) return existingByIdempotency;

    // Double-cancellation refusal — check for ANY existing non-reversed
    // cancellation of this deal+product BEFORE processing a new one.
    const activeExisting = await this.prisma.productCancellation.findFirst({
      where: { tenantId, dealNumber: input.dealNumber, productCode: input.productCode, status: { not: 'REVERSED' } },
    });
    if (activeExisting) {
      throw new DuplicateCancellationError(input.dealNumber, input.productCode);
    }

    const legs = await this._resolveLegs(tenantId, input);

    const correlationId = input.correlationId ?? input.idempotencyKey;
    const businessDate = (input.businessDate ?? new Date().toISOString()).slice(0, 10);
    const applyControlNumber = remitApplyControlNumber(input.dealNumber, input.productCode);
    const refundControlNumber = cancellationRefundControlNumber(input.dealNumber, input.productCode);

    // Reserve the (tenantId, dealNumber, productCode) slot FIRST, before any
    // posting side-effect — closes the race window the pre-check findFirst
    // above cannot (two concurrent requests could both pass that read
    // before either commits). The @@unique([tenantId, dealNumber,
    // productCode]) DB constraint is the real backstop; P2002 here means a
    // concurrent request won the race, and is reported as the same
    // DuplicateCancellationError a sequential double-cancel would get —
    // never as a duplicate refund (nothing has posted yet at this point).
    let reserved: any;
    try {
      reserved = await this.prisma.productCancellation.create({
        data: {
          tenantId,
          dealNumber: input.dealNumber,
          productCode: input.productCode,
          cancellationSource: input.cancellationSource,
          refundBasis: input.refundBasis.kind === 'CONFIG_PRORATA' ? 'CONFIG_PRORATA' : 'PROVIDER_QUOTE',
          quoteTotal: centsToDollarString(legs.quoteTotalCents),
          incomeReversalAmount: centsToDollarString(legs.incomeReversalCents),
          remitAdjustmentAmount: centsToDollarString(legs.remitAdjustmentCents),
          refundPayableAmount: centsToDollarString(legs.refundPayableCents),
          refundPayableLinkageStatus: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
          chargebackTriggered: Boolean(input.chargebackTriggered),
          status: 'PROCESSING',
          idempotencyKey: input.idempotencyKey,
          createdBy: input.actor,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new DuplicateCancellationError(input.dealNumber, input.productCode);
      }
      throw err;
    }
    await audit(this.prisma as any, tenantId, 'PRODUCT_CANCELLATION', reserved.id, 'RESERVED', input.actor, null, { quoteTotal: reserved.quoteTotal.toString() }, input.correlationId);

    let incomeReversalStatus: string | null = null;
    if (legs.incomeReversalCents > 0) {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.cancellation-income-reversal.v1',
        sourceEntityType: 'PRODUCT_CANCELLATION',
        sourceEntityId: applyControlNumber,
        sourceTransactionId: input.dealNumber,
        correlationId,
        businessDate,
        payload: { dealNumber: input.dealNumber, productCode: input.productCode, incomeReversalAmount: centsToDollarString(legs.incomeReversalCents) },
      });
      incomeReversalStatus = (await this.posting.submit(envelope)).submitResult.status;
    }

    let remitAdjustmentStatus: string | null = null;
    if (legs.remitAdjustmentCents > 0) {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.cancellation-remit-adjustment.v1',
        sourceEntityType: 'PRODUCT_CANCELLATION',
        sourceEntityId: applyControlNumber,
        sourceTransactionId: input.dealNumber,
        correlationId,
        businessDate,
        payload: { dealNumber: input.dealNumber, productCode: input.productCode, remitAdjustmentAmount: centsToDollarString(legs.remitAdjustmentCents), applyControlNumber },
      });
      remitAdjustmentStatus = (await this.posting.submit(envelope)).submitResult.status;
    }

    let refundPayableStatus: string | null = null;
    if (legs.refundPayableCents > 0) {
      const envelope = newEnvelope({
        tenantId,
        eventType: 'fni.cancellation-refund-payable.v1',
        sourceEntityType: 'PRODUCT_CANCELLATION',
        sourceEntityId: refundControlNumber,
        sourceTransactionId: input.dealNumber,
        correlationId,
        businessDate,
        payload: { dealNumber: input.dealNumber, productCode: input.productCode, refundPayableAmount: centsToDollarString(legs.refundPayableCents), controlNumber: refundControlNumber },
      });
      refundPayableStatus = (await this.posting.submit(envelope)).submitResult.status;
    }

    let chargebackDrawId: string | null = null;
    if (input.chargebackTriggered) {
      if (!input.lenderProgramCode || !input.chargebackAmount) {
        throw new CancellationValidationError('CHARGEBACK_INPUT_MISSING', 'chargebackTriggered requires lenderProgramCode and an entered chargebackAmount.');
      }
      const controlNumber = chargebackControlNumber(input.lenderProgramCode, input.dealNumber);
      const draw = await this.drawExecutor.execute(tenantId, {
        dealNumber: input.dealNumber,
        lenderProgramCode: input.lenderProgramCode,
        controlNumber,
        chargebackAmount: input.chargebackAmount,
        sourceType: 'CANCELLATION',
        sourceCancellationId: null, // set after cancellation row is created, below
        idempotencyKey: `${input.idempotencyKey}-chargeback`,
        actor: input.actor,
        correlationId,
        businessDate,
      });
      chargebackDrawId = draw.drawId;
    }

    const anyFailed = [incomeReversalStatus, remitAdjustmentStatus, refundPayableStatus].some((s) => s === 'REJECTED' || s === 'FAILED');

    const finalized = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.productCancellation.update({
        where: { id: reserved.id },
        data: { chargebackDrawId, status: anyFailed ? 'POSTING_FAILED' : 'PROCESSED' },
      });
      await audit(tx, tenantId, 'PRODUCT_CANCELLATION', row.id, 'PROCESSED', input.actor, { status: 'PROCESSING' }, {
        quoteTotal: row.quoteTotal.toString(),
        incomeReversalAmount: row.incomeReversalAmount.toString(),
        remitAdjustmentAmount: row.remitAdjustmentAmount.toString(),
        refundPayableAmount: row.refundPayableAmount.toString(),
        chargebackTriggered: row.chargebackTriggered,
        chargebackDrawId,
        status: row.status,
        postingStatus: { incomeReversalStatus, remitAdjustmentStatus, refundPayableStatus },
      }, input.correlationId);
      return row;
    });

    return finalized;
  }

  async getCancellation(tenantId: string, id: string) {
    const row = await this.prisma.productCancellation.findFirst({ where: { id, tenantId } });
    if (!row) throw new CancellationNotFoundError(id);
    return row;
  }

  /** Full lineage back to the original deal/product booking — queryable by dealNumber. */
  async getLineage(tenantId: string, dealNumber: string, productCode?: string) {
    return this.prisma.productCancellation.findMany({
      where: { tenantId, dealNumber, ...(productCode ? { productCode } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listCancellations(tenantId: string, dealNumber?: string) {
    return this.prisma.productCancellation.findMany({ where: { tenantId, ...(dealNumber ? { dealNumber } : {}) }, orderBy: { createdAt: 'desc' } });
  }
}
