import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import type { PrismaClient } from '.prisma/posting-recovery-client';
import { CH01PostingExecutionPort, CH01ReplayOutcome, PostingFailureEnvelope, SourceEventEnvelope } from '../domain/ch01-adapter';
import { hashPayload } from '../domain/hash';
import { CaseStatus } from '../domain/lifecycle';
import { PostingRecoveryConflictError, PostingRecoveryNotFoundError, PostingRecoveryValidationError } from '../domain/errors';
import { appendAuditReference } from '../infrastructure/audit';

export interface ReplayResult {
  deadLetterId: string;
  attemptNumber: number;
  outcome: CH01ReplayOutcome;
  message: string | null;
  journalReference: string | null;
  status: CaseStatus;
  idempotentPassthrough: boolean;
}

const OUTCOME_TO_ATTEMPT_STATUS: Record<CH01ReplayOutcome, string> = {
  POSTED: 'SUCCEEDED',
  NOOP_ALREADY_POSTED: 'NOOP_ALREADY_POSTED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
};

const OUTCOME_TO_CASE_STATUS: Record<CH01ReplayOutcome, CaseStatus> = {
  POSTED: 'RESOLVED',
  NOOP_ALREADY_POSTED: 'RESOLVED',
  REJECTED: 'UNDER_REVIEW',
  FAILED: 'UNDER_REVIEW',
};

/**
 * S021 completion slice — real replay execution.
 *
 * Concurrency: ownership of "who gets to call CH01 for this case" is
 * acquired via a single atomic, DB-level compare-and-swap UPDATE (status +
 * optimistic version, both in the WHERE clause) — never a process-local
 * mutex or a timing/sleep-based lock, which would be meaningless the moment
 * this service runs more than one replica. Exactly one concurrent caller's
 * UPDATE affects a row; every other caller's WHERE clause matches zero rows
 * and is rejected with a 409 before any CH01 call is made.
 *
 * Duplicate-journal prevention is NOT reinvented here: CH01
 * (PostingEngineService.submitEvent) is itself idempotent on
 * (tenantId, eventId), including under concurrent submission (P2002-race
 * reconciliation) — see services/coa-service's posting-engine-service.ts.
 * This service's own CAS lock exists so operators get a clean single
 * attempt record and a fast 409 instead of two callers racing into CH01
 * (both of which CH01 itself would still resolve safely) — belt AND
 * suspenders, not either/or.
 *
 * Crash/restart recovery (CE-07 integration slice — previously a disclosed,
 * unresolved limitation): if the process crashes between acquiring
 * REPLAY_IN_PROGRESS and the finalize transaction below, the case is left
 * stuck in REPLAY_IN_PROGRESS with no attempt row — financially safe
 * (CH01's idempotency still prevents a duplicate journal on the next
 * replay) but previously required an operator to notice and manually
 * transition the case back to a workable status, with no way to tell a
 * genuinely-stuck case apart from one still in flight. `replayLockAcquiredAt`
 * (set below, cleared on completion) plus ReplayReaperService.reapStaleReplays()
 * now let a stale lock (default: >5 minutes old) be reclaimed automatically —
 * see replay-reaper-service.ts for the full mechanism and its scope
 * boundary (per-tenant, not a cross-tenant background daemon).
 */
@injectable()
export class ReplayService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('CH01PostingExecutionPort') private readonly ch01: CH01PostingExecutionPort,
  ) {}

  async replay(tenantId: string, deadLetterId: string, actor: string): Promise<ReplayResult> {
    const deadLetter = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId } });
    if (!deadLetter) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);

    if (deadLetter.status !== 'READY_FOR_REPLAY') {
      throw new PostingRecoveryValidationError(
        'NOT_REPLAY_ELIGIBLE',
        `Case is "${deadLetter.status}" — only a case in READY_FOR_REPLAY may be replayed.`,
      );
    }

    const missing: string[] = [];
    if (!deadLetter.eventSchemaVersion) missing.push('eventSchemaVersion');
    if (!deadLetter.sourceEntityType) missing.push('sourceEntityType');
    if (!deadLetter.sourceEntityId) missing.push('sourceEntityId');
    if (!deadLetter.businessDate) missing.push('businessDate');
    if (missing.length > 0) {
      throw new PostingRecoveryValidationError(
        'REPLAY_ENVELOPE_INCOMPLETE',
        `Cannot replay: the original event capture is missing field(s) required by the posting engine: ${missing.join(', ')}. ` +
          `Route this case through a correction before retrying.`,
      );
    }

    const recomputedHash = hashPayload(deadLetter.payload);
    if (recomputedHash !== deadLetter.payloadHash) {
      // Defense in depth only — the DB immutability trigger already makes this
      // unreachable in practice (payload/payloadHash cannot be UPDATEd).
      throw new PostingRecoveryConflictError(
        'PAYLOAD_INTEGRITY_VIOLATION',
        `Stored payload hash does not match a fresh hash of the stored payload for case ${deadLetterId}.`,
      );
    }

    // ── Atomic ownership acquisition (DB-level CAS, not a mutex/timer) ──────
    const lockAcquiredAt = new Date();
    const { count } = await this.prisma.postingDeadLetter.updateMany({
      where: { id: deadLetterId, tenantId, status: 'READY_FOR_REPLAY', version: deadLetter.version },
      data: { status: 'REPLAY_IN_PROGRESS', version: { increment: 1 }, replayLockAcquiredAt: lockAcquiredAt },
    });
    if (count !== 1) {
      throw new PostingRecoveryConflictError(
        'REPLAY_ALREADY_IN_PROGRESS',
        `Case ${deadLetterId} was concurrently claimed for replay by another request, or its state changed. Refresh and retry.`,
      );
    }

    await this.prisma.postingCaseTransition.create({
      data: {
        id: randomUUID(),
        tenantId,
        deadLetterId,
        fromStatus: 'READY_FOR_REPLAY',
        toStatus: 'REPLAY_IN_PROGRESS',
        reason: 'Replay execution started',
        actor,
        occurredAt: new Date(),
      },
    });
    await appendAuditReference(this.prisma as any, {
      tenantId,
      deadLetterId,
      eventType: 'posting_recovery.replay_started',
      actor,
      after: { attemptNumber: deadLetter.attemptCount + 1 },
    });

    const nextAttemptNumber = deadLetter.attemptCount + 1;
    const requestedAt = new Date();
    const startedAt = new Date();

    const envelope = this.toReplayEnvelope(deadLetter);
    const failureDetail = await this.prisma.postingDeadLetterFailure.findFirst({
      where: { tenantId, deadLetterId },
      orderBy: { occurredAt: 'desc' },
    });

    let outcome: CH01ReplayOutcome;
    let message: string | null;
    let journalReference: string | null;
    let idempotentPassthrough = false;
    try {
      const result = await this.ch01.replay({
        event: envelope,
        failure: {
          failureCategory: (failureDetail?.failureCategory ?? deadLetter.latestFailureCategory) as any,
          failureCode: failureDetail?.failureCode ?? deadLetter.latestFailureCode,
          failureStage: (failureDetail?.failureStage ?? 'UNKNOWN') as any,
          failureMessage: failureDetail?.failureMessage ?? deadLetter.latestFailureMessage,
          fieldErrors: (failureDetail?.fieldErrors as any) ?? null,
          ruleContext: (failureDetail?.ruleContext as any) ?? null,
          occurredAt: (failureDetail?.occurredAt ?? deadLetter.latestFailureAt).toISOString(),
        },
      });
      outcome = result.outcome;
      message = result.message ?? null;
      journalReference = result.journalReference ?? null;
      idempotentPassthrough = result.idempotentPassthrough ?? false;
    } catch (err: any) {
      outcome = 'FAILED';
      message = `Unexpected error calling the posting engine: ${err?.message ?? String(err)}`;
      journalReference = null;
    }

    const completedAt = new Date();
    const nextStatus = OUTCOME_TO_CASE_STATUS[outcome];

    await this.prisma.$transaction(async (tx: any) => {
      await tx.postingReplayAttempt.create({
        data: {
          id: randomUUID(),
          tenantId,
          deadLetterId,
          attemptNumber: nextAttemptNumber,
          status: OUTCOME_TO_ATTEMPT_STATUS[outcome],
          requestedBy: actor,
          requestedAt,
          authorizedBy: actor,
          authorizedAt: requestedAt,
          startedAt,
          completedAt,
          resultMessage: message,
          resultingJournalReference: journalReference,
        },
      });
      await tx.postingDeadLetter.update({
        where: { id: deadLetterId },
        data: {
          status: nextStatus,
          attemptCount: { increment: 1 },
          lastAttemptAt: completedAt,
          journalReference: journalReference ?? undefined,
          version: { increment: 1 },
          replayLockAcquiredAt: null,
        },
      });
      await tx.postingCaseTransition.create({
        data: {
          id: randomUUID(),
          tenantId,
          deadLetterId,
          fromStatus: 'REPLAY_IN_PROGRESS',
          toStatus: nextStatus,
          reason: message,
          actor,
          occurredAt: completedAt,
        },
      });
      await appendAuditReference(tx as any, {
        tenantId,
        deadLetterId,
        eventType: 'posting_recovery.replay_completed',
        actor,
        after: { outcome, journalReference, attemptNumber: nextAttemptNumber, idempotentPassthrough },
      });
    });

    return {
      deadLetterId,
      attemptNumber: nextAttemptNumber,
      outcome,
      message,
      journalReference,
      status: nextStatus,
      idempotentPassthrough,
    };
  }

  private toReplayEnvelope(deadLetter: {
    tenantId: string; legalEntityId: string | null; storeId: string | null;
    sourceEventId: string; sourceEventType: string; eventSchemaVersion: string | null;
    sourceSystem: string; sourceEntityType: string | null; sourceEntityId: string | null;
    sourceTransactionId: string | null; correlationId: string; causationId: string | null;
    originalEventTimestamp: Date; originalEventPublishedAt: Date | null; businessDate: Date | null;
    postingIdempotencyKey: string; payload: unknown; payloadHash: string;
  }): PostingFailureEnvelope['event'] & SourceEventEnvelope {
    return {
      eventId: deadLetter.sourceEventId,
      tenantId: deadLetter.tenantId,
      legalEntityId: deadLetter.legalEntityId,
      storeId: deadLetter.storeId,
      eventType: deadLetter.sourceEventType,
      eventSchemaVersion: deadLetter.eventSchemaVersion,
      sourceSystem: deadLetter.sourceSystem,
      sourceEntityType: deadLetter.sourceEntityType,
      sourceEntityId: deadLetter.sourceEntityId,
      sourceTransactionId: deadLetter.sourceTransactionId,
      correlationId: deadLetter.correlationId,
      causationId: deadLetter.causationId,
      occurredAt: deadLetter.originalEventTimestamp.toISOString(),
      publishedAt: deadLetter.originalEventPublishedAt?.toISOString() ?? null,
      businessDate: deadLetter.businessDate ? deadLetter.businessDate.toISOString().slice(0, 10) : null,
      postingIdempotencyKey: deadLetter.postingIdempotencyKey,
      payload: deadLetter.payload as Record<string, unknown>,
      payloadHash: deadLetter.payloadHash,
    };
  }
}
