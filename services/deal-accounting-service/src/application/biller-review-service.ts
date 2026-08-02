// S085 — Biller Review Workbench: the gate between deal.finalized recap
// intake and real coa-service submission. Preview is coa-service's own
// `/posting-engine/events/simulate` endpoint (S024's documented mechanism —
// no second preview mechanism is built here). Hold/release/return is this
// service's own state machine (DealReviewCase), independent of coa-
// service's rule-pack-author SoD (S023) — this is a DIFFERENT SoD boundary:
// the identity releasing must differ from the identity that FINALIZED the
// deal (Deal.finalizedByActor), enforced in application code below.

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { DealRecapPayload } from '../domain/recap';
import { segmentsForRecap } from '../domain/segments';
import { buildEnvelope } from '../domain/event-envelope';
import { IPostingEngineClient } from '../infrastructure/posting-engine-client';
import { ITaxResultClient } from '../infrastructure/tax-result-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealPostingOrchestrator } from './deal-posting-orchestrator';
import { DealNotFoundError, RecapNotFoundError, ReviewCaseNotFoundError, ReviewCaseStateError, BillerSoDViolationError, ReasonRequiredError } from './errors';

export interface PreviewSegment {
  tag: string;
  eventType: string;
  status: string;
  blueprintHash?: string | null;
  lines?: unknown;
  failureReason?: string | null;
}

@injectable()
export class BillerReviewService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('ITaxResultClient') private readonly taxResults: ITaxResultClient,
    @inject(DealPostingOrchestrator) private readonly orchestrator: DealPostingOrchestrator,
  ) {}

  private async loadCase(tenantId: string, dealNumber: string, recapVersion: number) {
    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
    if (!deal) throw new DealNotFoundError(dealNumber);
    const recap = await this.prisma.dealRecap.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal.id, recapVersion } } });
    if (!recap) throw new RecapNotFoundError(dealNumber, recapVersion);
    const reviewCase = await this.prisma.dealReviewCase.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal.id, recapVersion } } });
    if (!reviewCase) throw new ReviewCaseNotFoundError(dealNumber, recapVersion);
    return { deal, recap, reviewCase };
  }

  /** S085's "recap-vs-journal preview" — dry-run through coa-service's own simulate(), no side effects, no posting. */
  async preview(tenantId: string, dealNumber: string, recapVersion: number): Promise<{ segments: PreviewSegment[]; combinedBlueprintHash: string }> {
    const { deal, recap } = await this.loadCase(tenantId, dealNumber, recapVersion);
    const payload = recap.payload as unknown as DealRecapPayload;

    let taxAmountCents: number | null = null;
    if (payload.taxResultId) {
      const { toCents } = await import('../domain/money');
      const result = await this.taxResults.fetchUsableResult(tenantId, payload.taxResultId);
      taxAmountCents = toCents(result.totalTax);
    }

    const segments = segmentsForRecap(payload, taxAmountCents);
    const previewed: PreviewSegment[] = [];
    for (const segment of segments) {
      const eventId = `${dealNumber}:v${recapVersion}:${segment.eventIdSuffix}`;
      const envelope = buildEnvelope({
        eventId, tenantId, legalEntityId: deal.legalEntityId, eventType: segment.eventType, occurredAt: new Date().toISOString(),
        sourceEntityType: segment.sourceEntityType, sourceEntityId: segment.sourceEntityId,
        correlationId: `preview:${dealNumber}:v${recapVersion}`, businessDate: payload.businessDate, payload: segment.payload,
      });
      const result = await this.postingEngine.simulate(envelope);
      previewed.push({ tag: segment.tag, eventType: segment.eventType, status: result.status, blueprintHash: result.blueprintHash, lines: result.lines, failureReason: result.failureReason });
    }

    const { createHash } = await import('crypto');
    const combinedBlueprintHash = createHash('sha256').update(JSON.stringify(previewed.map((p) => p.blueprintHash ?? p.status))).digest('hex');

    await this.prisma.dealReviewCase.update({
      where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal.id, recapVersion } },
      data: { previewBlueprintHash: combinedBlueprintHash },
    });

    return { segments: previewed, combinedBlueprintHash };
  }

  async hold(tenantId: string, dealNumber: string, recapVersion: number, reason: string, actor: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new ReasonRequiredError('hold a deal review case');
    const { deal, reviewCase } = await this.loadCase(tenantId, dealNumber, recapVersion);
    if (reviewCase.status !== 'PENDING_REVIEW' && reviewCase.status !== 'HELD') {
      throw new ReviewCaseStateError(`Cannot hold a review case in status "${reviewCase.status}".`);
    }
    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const u = await tx.dealReviewCase.update({
        where: { id: reviewCase.id },
        data: { status: 'HELD', heldReason: trimmed, heldBy: actor, heldAt: new Date() },
      });
      await appendAuditReference(tx, { tenantId, docType: 'DEAL_REVIEW_CASE', docId: reviewCase.id, action: 'HELD', before: { status: reviewCase.status }, after: { status: 'HELD', reason: trimmed }, actor });
      return u;
    });
    return updated;
  }

  async returnToDesking(tenantId: string, dealNumber: string, recapVersion: number, reason: string, actor: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new ReasonRequiredError('return a deal review case to desking');
    const { deal, reviewCase } = await this.loadCase(tenantId, dealNumber, recapVersion);
    if (reviewCase.status === 'RELEASED') {
      throw new ReviewCaseStateError('Cannot return a review case that has already been released and posted.');
    }
    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const u = await tx.dealReviewCase.update({
        where: { id: reviewCase.id },
        data: { status: 'RETURNED', returnedReason: trimmed, returnedBy: actor, returnedAt: new Date() },
      });
      await tx.deal.update({ where: { id: deal.id }, data: { status: 'DESKED' } });
      await appendAuditReference(tx, { tenantId, docType: 'DEAL_REVIEW_CASE', docId: reviewCase.id, action: 'RETURNED', before: { status: reviewCase.status }, after: { status: 'RETURNED', reason: trimmed }, actor });
      return u;
    });
    return updated;
  }

  /** Release: SoD-checked, posts EXACTLY the previewed segment set via coa-service's real submitEvent path. */
  async release(tenantId: string, dealNumber: string, recapVersion: number, actor: string) {
    const { deal, recap, reviewCase } = await this.loadCase(tenantId, dealNumber, recapVersion);

    if (reviewCase.status !== 'PENDING_REVIEW' && reviewCase.status !== 'HELD') {
      throw new ReviewCaseStateError(`Cannot release a review case in status "${reviewCase.status}".`);
    }
    // S085 SoD boundary — independent of coa-service's rule-pack-author SoD.
    if (deal.finalizedByActor && deal.finalizedByActor === actor) {
      throw new BillerSoDViolationError(actor);
    }

    const payload = recap.payload as unknown as DealRecapPayload;
    let taxAmountCents: number | null = null;
    if (payload.taxResultId) {
      const { toCents } = await import('../domain/money');
      const result = await this.taxResults.fetchUsableResult(tenantId, payload.taxResultId);
      taxAmountCents = toCents(result.totalTax);
    }
    const segments = segmentsForRecap(payload, taxAmountCents);

    const postResult = await this.orchestrator.postSegments({
      tenantId, dealId: deal.id, dealNumber, recapVersion,
      legalEntityId: payload.legalEntityId, storeId: payload.storeId, businessDate: payload.businessDate,
      correlationId: `release:${dealNumber}:v${recapVersion}`, segments, actor,
    });

    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const u = await tx.dealReviewCase.update({
        where: { id: reviewCase.id },
        data: { status: 'RELEASED', releasedBy: actor, releasedAt: new Date() },
      });
      await tx.deal.update({ where: { id: deal.id }, data: { status: postResult.allPosted ? 'POSTED' : 'FINALIZED' } });
      await appendAuditReference(tx, {
        tenantId, docType: 'DEAL_REVIEW_CASE', docId: reviewCase.id, action: 'RELEASED',
        before: { status: reviewCase.status },
        after: { status: 'RELEASED', allPosted: postResult.allPosted, segments: postResult.outcomes.map((o) => ({ tag: o.tag, coaStatus: o.coaStatus, journalNumber: o.journalNumber })) },
        actor,
      });
      return u;
    });

    return { reviewCase: updated, postResult };
  }

  /** Gap-closure — join fix: previously returned bare DealReviewCase rows
   * (dealId only), forcing the Biller Workbench frontend to separately call
   * GET /deals and cross-reference by id client-side (see the "Known
   * platform gap" doc comments in apps/web/src/api/ce12-deal-client.ts and
   * BillerWorkbench.tsx). Now returns dealNumber/dealType/vin/stockNumber/
   * legalEntityId/storeId directly on each row — a real server-side join,
   * not a computed/estimated value. */
  async getQueue(tenantId: string, status?: string) {
    const cases = await this.prisma.dealReviewCase.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    if (cases.length === 0) return [];
    const dealIds = Array.from(new Set(cases.map((c: any) => c.dealId)));
    const deals = await this.prisma.deal.findMany({ where: { tenantId, id: { in: dealIds } } });
    const dealsById = new Map(deals.map((d: any) => [d.id, d]));
    return cases.map((c: any) => {
      const deal = dealsById.get(c.dealId);
      return {
        ...c,
        dealNumber: deal?.dealNumber ?? null,
        dealType: deal?.dealType ?? null,
        vin: deal?.vin ?? null,
        stockNumber: deal?.stockNumber ?? null,
        legalEntityId: deal?.legalEntityId ?? null,
        storeId: deal?.storeId ?? null,
      };
    });
  }
}
