// Shared segment-submission engine used by S084 finalize (auto-post path),
// S085 release, S087 recontract repost, and any other flow that needs to
// turn a SegmentPlan[] (see domain/segments.ts) into real coa-service
// postings + this service's own local bookkeeping (DealPostingRecord rows,
// DealOpenItem rows for CIT/RESERVE/PAYOFF/PRODUCT_REMIT roles, and PUTR
// outbox events for trade-in booking). One place, so every posting path
// goes through IDENTICAL idempotency/error-handling/dead-letter behavior.

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { SegmentPlan } from '../domain/segments';
import { buildEnvelope, SourceEventEnvelope } from '../domain/event-envelope';
import { IPostingEngineClient, SubmitEventResult } from '../infrastructure/posting-engine-client';
import { IPostingRecoveryClient } from '../infrastructure/posting-recovery-client';
import { classifyCoaFailureReason } from '../infrastructure/posting-failure-taxonomy';
import { writePutrOutboxEvent, PUTR_EVENT_TYPES } from '../infrastructure/putr-outbox';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';

export interface PostSegmentsInput {
  tenantId: string;
  dealId: string;
  dealNumber: string;
  recapVersion: number;
  legalEntityId: string;
  storeId: string;
  businessDate: string;
  correlationId: string;
  segments: SegmentPlan[];
  actor: string;
}

export interface SegmentOutcome {
  tag: string;
  eventType: string;
  eventId: string;
  coaStatus: SubmitEventResult['status'];
  journalEntryId?: string | null;
  journalNumber?: string | null;
  postingRecordId: string;
  deadLetterFiled: boolean;
}

export interface PostSegmentsResult {
  outcomes: SegmentOutcome[];
  allPosted: boolean;
}

@injectable()
export class DealPostingOrchestrator {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('IPostingRecoveryClient') private readonly postingRecovery: IPostingRecoveryClient,
  ) {}

  private itemNumberFor(tag: string, dealNumber: string, productCode?: string): { itemType: string; itemNumber: string } | null {
    switch (tag) {
      case 'cit': return { itemType: 'CIT', itemNumber: dealNumber };
      case 'reserve': return { itemType: 'RESERVE', itemNumber: dealNumber };
      case 'trade-payoff': return { itemType: 'PAYOFF', itemNumber: dealNumber };
      case 'product': return { itemType: 'PRODUCT_REMIT', itemNumber: `${dealNumber}:product:${productCode}` };
      default: return null;
    }
  }

  async postSegments(input: PostSegmentsInput): Promise<PostSegmentsResult> {
    const outcomes: SegmentOutcome[] = [];

    for (const segment of input.segments) {
      const eventId = `${input.dealNumber}:v${input.recapVersion}:${segment.eventIdSuffix}`;
      const envelope: SourceEventEnvelope = buildEnvelope({
        eventId,
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        eventType: segment.eventType,
        occurredAt: new Date().toISOString(),
        sourceEntityType: segment.sourceEntityType,
        sourceEntityId: segment.sourceEntityId,
        correlationId: input.correlationId,
        businessDate: input.businessDate,
        payload: segment.payload,
      });

      const result = await this.postingEngine.submitEvent(envelope);

      let deadLetterFiled = false;
      if (result.status === 'REJECTED' || result.status === 'FAILED') {
        try {
          await this.postingRecovery.fileDeadLetter(
            envelope,
            {
              failureCategory: classifyCoaFailureReason(result.failureReason),
              failureCode: `DEAL_SEGMENT_${result.status}`,
              failureStage: 'MAPPING',
              failureMessage: result.failureReason ?? `coa-service returned ${result.status} with no failureReason.`,
              occurredAt: new Date().toISOString(),
            },
            { legalEntityId: input.legalEntityId, storeId: input.storeId, sourceTransactionId: input.dealNumber },
          );
          deadLetterFiled = true;
        } catch (err: any) {
          // posting-recovery-service unreachable — the DealPostingRecord row
          // below still durably records the REJECTED/FAILED outcome; a
          // dead-letter is best-effort enrichment, never the sole record.
          console.error(`[deal-accounting-service] failed to file dead-letter for event ${eventId}: ${err?.message ?? err}`);
        }
      }

      const postingRecordId = randomUUID();
      await this.prisma.$transaction(async (tx: any) => {
        await setTenantContextOnConnection(tx, input.tenantId);
        await tx.dealPostingRecord.create({
          data: {
            id: postingRecordId,
            tenantId: input.tenantId,
            dealId: input.dealId,
            recapVersion: input.recapVersion,
            segmentType: segment.tag === 'product' ? 'PRODUCT' : 'CORE',
            productIndex: segment.productIndex ?? null,
            eventId,
            eventType: segment.eventType,
            correlationId: input.correlationId,
            coaStatus: result.status,
            coaExecutionId: result.executionId ?? null,
            rulePackVersionId: result.rulePackVersionId ?? null,
            ruleId: result.ruleId ?? null,
            journalEntryId: result.journalEntryId ?? null,
            journalNumber: result.journalNumber ?? null,
            failureReason: result.failureReason ?? null,
            amountsJson: { amountCents: segment.amountCents, payload: segment.payload },
            createdBy: input.actor,
          },
        });

        if (result.status === 'POSTED') {
          const item = this.itemNumberFor(segment.tag, input.dealNumber, segment.productCode);
          if (item) {
            await tx.dealOpenItem.upsert({
              where: { tenantId_itemType_itemNumber: { tenantId: input.tenantId, itemType: item.itemType, itemNumber: item.itemNumber } },
              update: {},
              create: {
                id: randomUUID(),
                tenantId: input.tenantId,
                dealId: input.dealId,
                itemType: item.itemType,
                itemNumber: item.itemNumber,
                productIndex: segment.productIndex ?? null,
                originalAmount: (segment.amountCents / 100).toFixed(2),
                appliedAmount: '0.00',
                remainingBalance: (segment.amountCents / 100).toFixed(2),
                status: 'OPEN',
                openedByPostingRecordId: postingRecordId,
              },
            });
          }

          if (segment.tag === 'trade-acv') {
            await writePutrOutboxEvent(
              tx, input.tenantId, PUTR_EVENT_TYPES.TRADE_IN_RECEIVED, input.dealNumber,
              { dealNumber: input.dealNumber, recapVersion: input.recapVersion, ...segment.payload, legalEntityId: input.legalEntityId, storeId: input.storeId },
              input.correlationId,
            );
          }
        }

        await appendAuditReference(tx, {
          tenantId: input.tenantId,
          docType: 'DEAL_POSTING_RECORD',
          docId: postingRecordId,
          action: `SEGMENT_${result.status}`,
          after: { eventId, eventType: segment.eventType, journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null },
          actor: input.actor,
          correlationId: input.correlationId,
        });
      });

      outcomes.push({
        tag: segment.tag, eventType: segment.eventType, eventId,
        coaStatus: result.status, journalEntryId: result.journalEntryId, journalNumber: result.journalNumber,
        postingRecordId, deadLetterFiled,
      });
    }

    return { outcomes, allPosted: outcomes.every((o) => o.coaStatus === 'POSTED') };
  }
}
