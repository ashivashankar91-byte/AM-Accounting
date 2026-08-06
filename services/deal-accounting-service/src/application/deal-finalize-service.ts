// S084 (Deal JE Generator) + S085 intake (files the review case). This
// service NEVER calls coa-service directly for a fresh finalize UNLESS the
// tenant is configured auto-post (SAFE_CONFIGURATION, default OFF — see
// DealTenantConfig.autoPostEnabled) — the default path always stops at
// PENDING_REVIEW and waits for BillerReviewService.release().
//
// Idempotency: `${tenantId}:${dealNumber}:${recapVersion}` (Deal.tenantId+
// dealNumber unique, DealRecap.tenantId+dealId+recapVersion unique) — a
// second finalize call with the SAME recapVersion and BYTE-IDENTICAL
// payload is a no-op returning the existing recap/case; a different payload
// under the same version is refused (never silently overwritten, DealRecap
// rows are immutable).

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { DealRecapPayload } from '../domain/recap';
import { validateRecapStructural } from '../domain/recap-validation';
import { computeStructureHash } from '../domain/structure-hash';
import { segmentsForRecap } from '../domain/segments';
import { hashPayload } from '../domain/hash';
import { ITaxResultClient } from '../infrastructure/tax-result-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealPostingOrchestrator } from './deal-posting-orchestrator';
import { IdempotentReplayConflictError } from './errors';

export interface FinalizeDealInput {
  tenantId: string;
  payload: DealRecapPayload;
  actor: string; // the desking identity finalizing this deal — S085 SoD reference
}

export interface FinalizeDealResult {
  dealId: string;
  dealNumber: string;
  recapVersion: number;
  structureHash: string;
  reviewCaseId: string;
  reviewStatus: string;
  autoPosted: boolean;
  idempotentReplay: boolean;
}

@injectable()
export class DealFinalizeService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('ITaxResultClient') private readonly taxResults: ITaxResultClient,
    @inject(DealPostingOrchestrator) private readonly orchestrator: DealPostingOrchestrator,
  ) {}

  async finalize(input: FinalizeDealInput): Promise<FinalizeDealResult> {
    const { tenantId, payload, actor } = input;

    // 1. Structural + D-CE12-02 validation — BEFORE any coa-service call
    // and before any DB write. Throws RecapValidationError or
    // TradeInSplitMissingError; both are 4xx, handled by the http layer.
    validateRecapStructural(payload);

    // 2. Tax result — S124 fetched-by-reference, never estimated. Missing
    // or unusable ⇒ blocked (throws), before any coa-service call.
    let taxAmountCents: number | null = null;
    if (payload.taxResultId) {
      const { toCents } = await import('../domain/money');
      const result = await this.taxResults.fetchUsableResult(tenantId, payload.taxResultId);
      taxAmountCents = toCents(result.totalTax);
    }

    const structureHash = computeStructureHash(payload);

    const deal = await this.prisma.deal.upsert({
      where: { tenantId_dealNumber: { tenantId, dealNumber: payload.dealNumber } },
      update: {},
      create: {
        id: randomUUID(),
        tenantId,
        dealNumber: payload.dealNumber,
        dealType: payload.dealType,
        vin: payload.vin ?? null,
        stockNumber: payload.stockNumber,
        legalEntityId: payload.legalEntityId,
        storeId: payload.storeId,
        status: 'DESKED',
        currentRecapVersion: 0,
      },
    });

    // Idempotent-replay check for this exact recapVersion.
    const existingRecap = await this.prisma.dealRecap.findUnique({
      where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal.id, recapVersion: payload.recapVersion } },
    });
    if (existingRecap) {
      if (hashPayload(existingRecap.payload) !== hashPayload(payload)) {
        throw new IdempotentReplayConflictError(
          `Deal "${payload.dealNumber}" recap v${payload.recapVersion} was already finalized with a different payload — recaps are immutable. File a new recapVersion instead.`,
        );
      }
      const existingCase = await this.prisma.dealReviewCase.findUnique({
        where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal.id, recapVersion: payload.recapVersion } },
      });
      return {
        dealId: deal.id, dealNumber: deal.dealNumber, recapVersion: payload.recapVersion, structureHash,
        reviewCaseId: existingCase!.id, reviewStatus: existingCase!.status, autoPosted: existingCase!.autoPosted,
        idempotentReplay: true,
      };
    }

    if (payload.recapVersion !== deal.currentRecapVersion + 1) {
      throw new IdempotentReplayConflictError(
        `Deal "${payload.dealNumber}" is at recap version ${deal.currentRecapVersion} — the next finalize must supply recapVersion ${deal.currentRecapVersion + 1}, got ${payload.recapVersion}.`,
      );
    }

    const config = await this.prisma.dealTenantConfig.findUnique({ where: { tenantId } });
    const autoPostEnabled = config?.autoPostEnabled ?? false; // SAFE_CONFIGURATION default: review-required

    const reviewCaseId = randomUUID();

    await this.prisma.$transaction(async (tx: any) => {
      // R0 Final Batch C RLS fix (packages/shared-kernel/src/tenancy/rls-
      // middleware.ts) — an interactive $transaction gets its own dedicated
      // connection; the outer $use middleware's SET never lands on it.
      await setTenantContextOnConnection(tx, tenantId);
      await tx.dealRecap.create({
        data: {
          id: randomUUID(),
          tenantId,
          dealId: deal.id,
          recapVersion: payload.recapVersion,
          dealType: payload.dealType,
          payload: payload as any,
          structureHash,
          taxResultId: payload.taxResultId ?? null,
          taxAmount: taxAmountCents != null ? (taxAmountCents / 100).toFixed(2) : null,
          hasTradeIn: payload.hasTradeIn,
          tradeAllowanceAmount: payload.tradeAllowanceAmount ?? null,
          tradeAcvAmount: payload.tradeAcvAmount ?? null,
          commissionBasisSnapshot: (payload.commissionBasisSnapshot ?? null) as any,
          rebateReceivableAmount: payload.rebateReceivableAmount ?? null,
          createdBy: actor,
        },
      });

      await tx.deal.update({
        where: { id: deal.id },
        data: { currentRecapVersion: payload.recapVersion, status: 'FINALIZED', finalizedByActor: actor },
      });

      await tx.dealReviewCase.create({
        data: {
          id: reviewCaseId,
          tenantId,
          dealId: deal.id,
          recapVersion: payload.recapVersion,
          status: 'PENDING_REVIEW',
          autoPosted: false,
        },
      });

      await appendAuditReference(tx, {
        tenantId, docType: 'DEAL', docId: deal.id, action: 'FINALIZED',
        after: { dealNumber: payload.dealNumber, recapVersion: payload.recapVersion, structureHash, dealType: payload.dealType },
        actor,
      });
    });

    if (!autoPostEnabled) {
      return {
        dealId: deal.id, dealNumber: deal.dealNumber, recapVersion: payload.recapVersion, structureHash,
        reviewCaseId, reviewStatus: 'PENDING_REVIEW', autoPosted: false, idempotentReplay: false,
      };
    }

    // Auto-post path (tenant opted in): post immediately, then mark the
    // review case RELEASED/autoPosted so the S085 workbench's queue and
    // lineage stay consistent regardless of which path a deal took.
    const segments = segmentsForRecap(payload, taxAmountCents);
    await this.orchestrator.postSegments({
      tenantId, dealId: deal.id, dealNumber: payload.dealNumber, recapVersion: payload.recapVersion,
      legalEntityId: payload.legalEntityId, storeId: payload.storeId, businessDate: payload.businessDate,
      correlationId: `finalize:${payload.dealNumber}:v${payload.recapVersion}`, segments, actor: 'system:auto-post',
    });

    await this.prisma.$transaction(async (tx: any) => {
      // R0 Final Batch C RLS fix (packages/shared-kernel/src/tenancy/rls-
      // middleware.ts) — an interactive $transaction gets its own dedicated
      // connection; the outer $use middleware's SET never lands on it.
      await setTenantContextOnConnection(tx, tenantId);
      await tx.dealReviewCase.update({
        where: { id: reviewCaseId },
        data: { status: 'RELEASED', autoPosted: true, releasedBy: 'system:auto-post', releasedAt: new Date() },
      });
      await tx.deal.update({ where: { id: deal.id }, data: { status: 'POSTED' } });
      await appendAuditReference(tx, {
        tenantId, docType: 'DEAL_REVIEW_CASE', docId: reviewCaseId, action: 'AUTO_POSTED',
        after: { dealNumber: payload.dealNumber, recapVersion: payload.recapVersion },
        actor: 'system:auto-post',
      });
    });

    return {
      dealId: deal.id, dealNumber: deal.dealNumber, recapVersion: payload.recapVersion, structureHash,
      reviewCaseId, reviewStatus: 'RELEASED', autoPosted: true, idempotentReplay: false,
    };
  }
}
