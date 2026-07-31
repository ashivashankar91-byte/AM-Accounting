import { inject, injectable } from 'tsyringe';
import type { PrismaClient } from '.prisma/posting-recovery-client';
import { PostingRecoveryNotFoundError, PostingRecoveryValidationError } from '../domain/errors';
import { maskIdentity, maskPayload } from '../domain/masking';

export interface QueueFilters {
  status?: string;
  failureCategory?: string;
  sourceSystem?: string;
  eventType?: string;
  assignedOwner?: string;
  escalationState?: string;
  failureDateFrom?: string;
  failureDateTo?: string;
  search?: string;
}

export interface QueuePage {
  page: number;
  pageSize: number;
}

export type QueueSortField = 'firstFailureAt' | 'latestFailureAt' | 'attemptCount' | 'status' | 'failureCategory';

export interface QueueSort {
  sortBy: QueueSortField;
  sortDir: 'asc' | 'desc';
}

const SORT_COLUMN: Record<QueueSortField, string> = {
  firstFailureAt: 'firstFailureAt',
  latestFailureAt: 'latestFailureAt',
  attemptCount: 'attemptCount',
  status: 'status',
  failureCategory: 'latestFailureCategory',
};

const MAX_PAGE_SIZE = 200;

@injectable()
export class PostingRecoveryQueryService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async listQueue(tenantId: string, filters: QueueFilters, page: QueuePage, sort: QueueSort) {
    const pageSize = Math.min(Math.max(page.pageSize, 1), MAX_PAGE_SIZE);
    const pageNumber = Math.max(page.page, 1);

    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.failureCategory) where.latestFailureCategory = filters.failureCategory;
    if (filters.sourceSystem) where.sourceSystem = filters.sourceSystem;
    if (filters.eventType) where.sourceEventType = filters.eventType;
    if (filters.assignedOwner) where.assignedOwner = filters.assignedOwner;
    if (filters.escalationState) where.escalationState = filters.escalationState;
    if (filters.failureDateFrom || filters.failureDateTo) {
      where.firstFailureAt = {};
      if (filters.failureDateFrom) where.firstFailureAt.gte = new Date(filters.failureDateFrom);
      if (filters.failureDateTo) where.firstFailureAt.lte = new Date(filters.failureDateTo);
    }
    if (filters.search) {
      where.OR = [
        { sourceTransactionId: { contains: filters.search, mode: 'insensitive' } },
        { sourceEventId: { contains: filters.search, mode: 'insensitive' } },
        { correlationId: { contains: filters.search, mode: 'insensitive' } },
        { latestFailureCode: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const orderBy = { [SORT_COLUMN[sort.sortBy]]: sort.sortDir };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.postingDeadLetter.findMany({
        where,
        orderBy,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.postingDeadLetter.count({ where }),
    ]);

    return {
      items: items.map((row: any) => this.toQueueRow(row)),
      total,
      page: pageNumber,
      pageSize,
    };
  }

  async getSummary(tenantId: string) {
    const [byStatus, byCategory] = await this.prisma.$transaction([
      this.prisma.postingDeadLetter.groupBy({ by: ['status'], where: { tenantId }, orderBy: { status: 'asc' }, _count: { _all: true } }),
      this.prisma.postingDeadLetter.groupBy({ by: ['latestFailureCategory'], where: { tenantId }, orderBy: { latestFailureCategory: 'asc' }, _count: { _all: true } }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((r: any) => [r.status, r._count._all])),
      byFailureCategory: Object.fromEntries(byCategory.map((r: any) => [r.latestFailureCategory, r._count._all])),
    };
  }

  async getCase(tenantId: string, deadLetterId: string, opts: { revealSensitive: boolean }) {
    const row = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId } });
    if (!row) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);

    const failures = await this.prisma.postingDeadLetterFailure.findMany({
      where: { tenantId, deadLetterId },
      orderBy: { occurredAt: 'asc' },
    });

    const missingReplayFields = [
      !row.eventSchemaVersion && 'eventSchemaVersion',
      !row.sourceEntityType && 'sourceEntityType',
      !row.sourceEntityId && 'sourceEntityId',
      !row.businessDate && 'businessDate',
    ].filter((v: unknown): v is string => typeof v === 'string');

    return {
      id: row.id,
      tenantId: row.tenantId,
      legalEntityId: row.legalEntityId,
      storeId: row.storeId,
      status: row.status,
      sourceEventId: row.sourceEventId,
      sourceEventType: row.sourceEventType,
      eventSchemaVersion: row.eventSchemaVersion,
      sourceSystem: row.sourceSystem,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      sourceTransactionId: row.sourceTransactionId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      originalEventTimestamp: row.originalEventTimestamp,
      originalEventPublishedAt: row.originalEventPublishedAt,
      businessDate: row.businessDate,
      /// R1 S021-completion: whether POST .../replay would pass this case's
      /// own eligibility checks right now (status + envelope completeness).
      /// Does NOT re-check permission — the UI already knows the caller's
      /// permission set from route/permission wiring.
      replayEligible: row.status === 'READY_FOR_REPLAY' && missingReplayFields.length === 0,
      missingReplayFields,
      postingIdempotencyKey: maskIdentity(row.postingIdempotencyKey, opts.revealSensitive),
      payload: maskPayload(row.payload as Record<string, unknown>, opts.revealSensitive),
      containsSensitiveData: row.containsSensitiveData,
      firstFailureAt: row.firstFailureAt,
      latestFailureAt: row.latestFailureAt,
      latestFailureCategory: row.latestFailureCategory,
      latestFailureCode: row.latestFailureCode,
      latestFailureMessage: row.latestFailureMessage,
      attemptCount: row.attemptCount,
      lastAttemptAt: row.lastAttemptAt,
      assignedOwner: row.assignedOwner,
      escalationState: row.escalationState,
      journalReference: row.journalReference,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      failures: failures.map((f: any) => ({
        id: f.id,
        failureCategory: f.failureCategory,
        failureCode: f.failureCode,
        failureStage: f.failureStage,
        failureMessage: f.failureMessage,
        fieldErrors: f.fieldErrors,
        ruleContext: f.ruleContext,
        occurredAt: f.occurredAt,
      })),
    };
  }

  async assertCaseExists(tenantId: string, deadLetterId: string): Promise<void> {
    const row = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId }, select: { id: true } });
    if (!row) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);
  }

  async listAttempts(tenantId: string, deadLetterId: string) {
    await this.assertCaseExists(tenantId, deadLetterId);
    const attempts = await this.prisma.postingReplayAttempt.findMany({
      where: { tenantId, deadLetterId },
      orderBy: { attemptNumber: 'asc' },
    });
    return attempts.map((a: any) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      status: a.status,
      requestedBy: a.requestedBy,
      requestedAt: a.requestedAt,
      authorizedBy: a.authorizedBy,
      authorizedAt: a.authorizedAt,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      resultMessage: a.resultMessage,
      resultingJournalReference: a.resultingJournalReference,
    }));
  }

  async listCorrections(tenantId: string, deadLetterId: string) {
    await this.assertCaseExists(tenantId, deadLetterId);
    const revisions = await this.prisma.postingCorrectionRevision.findMany({
      where: { tenantId, deadLetterId },
      orderBy: { revisionNumber: 'asc' },
    });
    return revisions.map((r: any) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      correctionType: r.correctionType,
      description: r.description,
      proposedChanges: r.proposedChanges,
      status: r.status,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  }

  async getLineage(tenantId: string, deadLetterId: string) {
    const row = await this.prisma.postingDeadLetter.findFirst({ where: { id: deadLetterId, tenantId } });
    if (!row) throw new PostingRecoveryNotFoundError(`Posting dead-letter case not found: ${deadLetterId}`);

    const transitions = await this.prisma.postingCaseTransition.findMany({
      where: { tenantId, deadLetterId },
      orderBy: { occurredAt: 'asc' },
    });

    return {
      sourceEventId: row.sourceEventId,
      sourceEventType: row.sourceEventType,
      sourceSystem: row.sourceSystem,
      sourceEntityType: row.sourceEntityType,
      sourceTransactionId: row.sourceTransactionId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      businessDate: row.businessDate,
      originalEventTimestamp: row.originalEventTimestamp,
      journalReference: row.journalReference,
      transitions: transitions.map((t: any) => ({
        id: t.id,
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        reason: t.reason,
        actor: t.actor,
        occurredAt: t.occurredAt,
      })),
    };
  }

  async getAuditTimeline(tenantId: string, deadLetterId: string) {
    await this.assertCaseExists(tenantId, deadLetterId);
    const rows = await this.prisma.postingRecoveryAuditReference.findMany({
      where: { tenantId, deadLetterId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r: any) => ({
      id: r.id,
      eventType: r.eventType,
      actor: r.actor,
      occurredAt: r.createdAt,
      published: r.publishedAt !== null,
    }));
  }

  private toQueueRow(row: any) {
    return {
      id: row.id,
      sourceEventType: row.sourceEventType,
      sourceSystem: row.sourceSystem,
      sourceTransactionId: row.sourceTransactionId,
      status: row.status,
      latestFailureCategory: row.latestFailureCategory,
      latestFailureCode: row.latestFailureCode,
      latestFailureMessage: row.latestFailureMessage,
      firstFailureAt: row.firstFailureAt,
      latestFailureAt: row.latestFailureAt,
      attemptCount: row.attemptCount,
      lastAttemptAt: row.lastAttemptAt,
      assignedOwner: row.assignedOwner,
      escalationState: row.escalationState,
    };
  }
}

export function parseSortField(value: unknown): QueueSortField {
  const allowed: QueueSortField[] = ['firstFailureAt', 'latestFailureAt', 'attemptCount', 'status', 'failureCategory'];
  if (typeof value === 'string' && (allowed as string[]).includes(value)) return value as QueueSortField;
  return 'firstFailureAt';
}

export function parseSortDir(value: unknown): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc';
}

export function parsePagination(query: Record<string, unknown>): QueuePage {
  const page = Number(query['page'] ?? 1);
  const pageSize = Number(query['pageSize'] ?? 25);
  if (!Number.isFinite(page) || page < 1) throw new PostingRecoveryValidationError('INVALID_PAGE', 'page must be a positive integer');
  if (!Number.isFinite(pageSize) || pageSize < 1) throw new PostingRecoveryValidationError('INVALID_PAGE_SIZE', 'pageSize must be a positive integer');
  return { page, pageSize };
}
