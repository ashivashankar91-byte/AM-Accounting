import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import type { PrismaClient } from '.prisma/posting-recovery-client';
import { PostingFailureEnvelope } from '../domain/ch01-adapter';
import { DeadLetterIntakeService } from './dead-letter-intake-service';
import { assertValidTransition, CaseStatus, isCaseStatus, isReplayAttemptStatus } from '../domain/lifecycle';
import { PostingRecoveryNotFoundError, PostingRecoveryValidationError } from '../domain/errors';
import { appendAuditReference } from '../infrastructure/audit';

/**
 * Test-only / internal fixture mechanism (per S021 scope): lets automated
 * tests and the browser journey create representative failed events,
 * replay-attempt history, correction history, and lifecycle transitions
 * WITHOUT any production replay implementation. Real replay execution
 * (posting to GL) is never invoked here — see domain/ch01-adapter.ts.
 * Routes exposing this are only registered outside production (see index.ts).
 */
@injectable()
export class FixtureService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(DeadLetterIntakeService) private readonly intake: DeadLetterIntakeService,
  ) {}

  async intakeFixture(envelope: PostingFailureEnvelope, actor: string) {
    return this.intake.intake(envelope, actor);
  }

  async addReplayAttemptFixture(
    tenantId: string,
    deadLetterId: string,
    input: { status: string; requestedBy: string; requestedAt: string; resultMessage?: string; resultingJournalReference?: string },
  ) {
    if (!isReplayAttemptStatus(input.status)) {
      throw new PostingRecoveryValidationError('INVALID_REPLAY_ATTEMPT_STATUS', `Unknown replay attempt status: ${input.status}`);
    }
    const deadLetter = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId } });
    if (!deadLetter) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);

    return this.prisma.$transaction(async (tx: any) => {
      const nextAttemptNumber = deadLetter.attemptCount + 1;
      const attempt = await tx.postingReplayAttempt.create({
        data: {
          id: randomUUID(),
          tenantId,
          deadLetterId,
          attemptNumber: nextAttemptNumber,
          status: input.status,
          requestedBy: input.requestedBy,
          requestedAt: new Date(input.requestedAt),
          completedAt: ['SUCCEEDED', 'FAILED', 'NOOP_ALREADY_POSTED', 'REJECTED', 'TIMED_OUT'].includes(input.status) ? new Date() : null,
          resultMessage: input.resultMessage ?? null,
          resultingJournalReference: input.resultingJournalReference ?? null,
        },
      });
      await tx.postingDeadLetter.update({
        where: { id: deadLetterId },
        data: { attemptCount: nextAttemptNumber, lastAttemptAt: new Date(input.requestedAt) },
      });
      return attempt;
    });
  }

  async addCorrectionFixture(
    tenantId: string,
    deadLetterId: string,
    input: { correctionType: string; description: string; proposedChanges?: Record<string, unknown>; createdBy: string; status?: string },
  ) {
    const deadLetter = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId }, select: { id: true } });
    if (!deadLetter) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);

    const count = await this.prisma.postingCorrectionRevision.count({ where: { tenantId, deadLetterId } });
    return this.prisma.postingCorrectionRevision.create({
      data: {
        id: randomUUID(),
        tenantId,
        deadLetterId,
        revisionNumber: count + 1,
        correctionType: input.correctionType,
        description: input.description,
        proposedChanges: (input.proposedChanges ?? null) as any,
        status: input.status ?? 'PROPOSED',
        createdBy: input.createdBy,
      },
    });
  }

  async transitionFixture(tenantId: string, deadLetterId: string, toStatus: string, actor: string, reason?: string) {
    if (!isCaseStatus(toStatus)) {
      throw new PostingRecoveryValidationError('INVALID_CASE_STATUS', `Unknown case status: ${toStatus}`);
    }
    const deadLetter = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId } });
    if (!deadLetter) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);

    assertValidTransition(deadLetter.status as CaseStatus, toStatus);

    return this.prisma.$transaction(async (tx: any) => {
      const { count } = await tx.postingDeadLetter.updateMany({
        where: { id: deadLetterId, tenantId, version: deadLetter.version },
        data: { status: toStatus, version: { increment: 1 } },
      });
      if (count !== 1) {
        throw new PostingRecoveryValidationError('VERSION_CONFLICT', 'Case was updated concurrently');
      }
      await tx.postingCaseTransition.create({
        data: {
          id: randomUUID(),
          tenantId,
          deadLetterId,
          fromStatus: deadLetter.status,
          toStatus,
          reason: reason ?? null,
          actor,
          occurredAt: new Date(),
        },
      });
      await appendAuditReference(tx as any, {
        tenantId,
        deadLetterId,
        eventType: 'posting_recovery.case_transitioned',
        actor,
        before: { status: deadLetter.status },
        after: { status: toStatus },
      });
      return tx.postingDeadLetter.findUniqueOrThrow({ where: { id: deadLetterId } });
    });
  }
}
