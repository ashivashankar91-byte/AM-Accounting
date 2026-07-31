import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import type { PrismaClient } from '.prisma/posting-recovery-client';
import { PostingFailureEnvelope } from '../domain/ch01-adapter';
import { isPostingFailureCategory } from '../domain/taxonomy';
import { hashPayload } from '../domain/hash';
import { payloadContainsSensitiveData } from '../domain/masking';
import { PostingRecoveryConflictError, PostingRecoveryValidationError } from '../domain/errors';
import { appendAuditReference } from '../infrastructure/audit';

export interface IntakeResult {
  deadLetterId: string;
  created: boolean; // false when this was an idempotent no-op (duplicate delivery)
}

/**
 * Idempotent dead-letter intake from a CH01-style failure envelope.
 *
 * Idempotency identity is (tenantId, sourceEventId):
 *   - not seen before                        -> create case + first failure + transition + audit.
 *   - seen before, identical payload hash     -> no-op, returns the existing case (created:false).
 *   - seen before, different payload hash     -> IDEMPOTENCY_CONFLICT (never silently overwrites).
 */
@injectable()
export class DeadLetterIntakeService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async intake(envelope: PostingFailureEnvelope, actor: string): Promise<IntakeResult> {
    const { event, failure } = envelope;

    if (!event.tenantId?.trim()) {
      throw new PostingRecoveryValidationError('EVENT_CONTRACT_INVALID', 'event.tenantId is required');
    }
    if (!event.eventId?.trim()) {
      throw new PostingRecoveryValidationError('EVENT_CONTRACT_INVALID', 'event.eventId is required');
    }
    if (!event.correlationId?.trim()) {
      throw new PostingRecoveryValidationError('EVENT_CONTRACT_INVALID', 'event.correlationId is required');
    }
    if (!event.postingIdempotencyKey?.trim()) {
      throw new PostingRecoveryValidationError('EVENT_CONTRACT_INVALID', 'event.postingIdempotencyKey is required');
    }
    if (!isPostingFailureCategory(failure.failureCategory)) {
      throw new PostingRecoveryValidationError('EVENT_CONTRACT_INVALID', `Unknown failure category: ${failure.failureCategory}`);
    }
    const computedHash = hashPayload(event.payload);
    if (event.payloadHash !== computedHash) {
      throw new PostingRecoveryValidationError(
        'EVENT_CONTRACT_INVALID',
        `payloadHash does not match the computed hash of payload (expected ${computedHash})`,
      );
    }

    const tenantId = event.tenantId;
    const existing = await this.prisma.postingDeadLetter.findUnique({
      where: { tenantId_sourceEventId: { tenantId, sourceEventId: event.eventId } },
    });

    if (existing) {
      if (existing.payloadHash === event.payloadHash) {
        return { deadLetterId: existing.id, created: false };
      }
      throw new PostingRecoveryConflictError(
        'IDEMPOTENCY_CONFLICT',
        `A different payload was already recorded for source event ${event.eventId} (tenant ${tenantId})`,
      );
    }

    const deadLetterId = randomUUID();
    const occurredAt = new Date(event.occurredAt);
    const failureOccurredAt = new Date(failure.occurredAt);

    try {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.postingDeadLetter.create({
          data: {
            id: deadLetterId,
            tenantId,
            legalEntityId: event.legalEntityId ?? null,
            storeId: event.storeId ?? null,
            sourceEventId: event.eventId,
            sourceEventType: event.eventType,
            eventSchemaVersion: event.eventSchemaVersion ?? null,
            sourceSystem: event.sourceSystem,
            sourceEntityType: event.sourceEntityType ?? null,
            sourceEntityId: event.sourceEntityId ?? null,
            sourceTransactionId: event.sourceTransactionId ?? null,
            correlationId: event.correlationId,
            causationId: event.causationId ?? null,
            originalEventTimestamp: occurredAt,
            originalEventPublishedAt: event.publishedAt ? new Date(event.publishedAt) : null,
            businessDate: event.businessDate ? new Date(event.businessDate) : null,
            postingIdempotencyKey: event.postingIdempotencyKey,
            payload: event.payload as any,
            payloadHash: event.payloadHash,
            containsSensitiveData: payloadContainsSensitiveData(event.payload),
            status: 'QUARANTINED',
            firstFailureAt: failureOccurredAt,
            latestFailureAt: failureOccurredAt,
            latestFailureCategory: failure.failureCategory,
            latestFailureCode: failure.failureCode,
            latestFailureMessage: failure.failureMessage,
            attemptCount: 0,
            version: 1,
          },
        });

        await tx.postingDeadLetterFailure.create({
          data: {
            id: randomUUID(),
            tenantId,
            deadLetterId,
            failureCategory: failure.failureCategory,
            failureCode: failure.failureCode,
            failureStage: failure.failureStage,
            failureMessage: failure.failureMessage,
            fieldErrors: (failure.fieldErrors ?? null) as any,
            ruleContext: (failure.ruleContext ?? null) as any,
            occurredAt: failureOccurredAt,
          },
        });

        await tx.postingCaseTransition.create({
          data: {
            id: randomUUID(),
            tenantId,
            deadLetterId,
            fromStatus: null,
            toStatus: 'QUARANTINED',
            reason: 'Dead-letter intake',
            actor,
            occurredAt: failureOccurredAt,
          },
        });

        await appendAuditReference(tx as any, {
          tenantId,
          deadLetterId,
          eventType: 'posting_recovery.dead_letter_created',
          actor,
          after: {
            sourceEventId: event.eventId,
            correlationId: event.correlationId,
            payloadHash: event.payloadHash,
            failureCategory: failure.failureCategory,
            failureCode: failure.failureCode,
          },
        });
      });
    } catch (err: any) {
      // Race: two concurrent deliveries of the same event both miss the
      // pre-check findUnique. The (tenantId, sourceEventId) unique
      // constraint is the real, DB-level duplicate-intake guard; this
      // catches that race and resolves it the same way a sequential
      // duplicate delivery would.
      if (err?.code === 'P2002') {
        const raced = await this.prisma.postingDeadLetter.findUniqueOrThrow({
          where: { tenantId_sourceEventId: { tenantId, sourceEventId: event.eventId } },
        });
        if (raced.payloadHash === event.payloadHash) {
          return { deadLetterId: raced.id, created: false };
        }
        throw new PostingRecoveryConflictError(
          'IDEMPOTENCY_CONFLICT',
          `A different payload was already recorded for source event ${event.eventId} (tenant ${tenantId})`,
        );
      }
      throw err;
    }

    return { deadLetterId, created: true };
  }
}
