import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  formatJournalNumber,
  isValidPeriodCode,
  isValidSourceCode,
} from '../domain/journal-sequence';

// ── Errors ───────────────────────────────────────────────────────────────────

export class SequenceValidationError extends Error {
  readonly status = 422;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SequenceValidationError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface AllocateDTO {
  tenantId: string;
  sourceCode: string;
  entityId: string;
  periodCode: string; // YYYY-MM
}

export interface AllocationResult {
  journalNumber: string;
  seq: number;
  sourceCode: string;
  entityId: string;
  periodCode: string;
}

export interface LogGapDTO {
  tenantId: string;
  sourceCode: string;
  entityId: string;
  periodCode: string;
  seq: number;
  reason: string;
  actor?: string;
}

@injectable()
export class SequenceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  private validate(sourceCode: string, periodCode: string) {
    if (!isValidSourceCode(sourceCode)) {
      throw new SequenceValidationError('INVALID_SOURCE_CODE', 'sourceCode must be 2-6 uppercase alphanumerics');
    }
    if (!isValidPeriodCode(periodCode)) {
      throw new SequenceValidationError('INVALID_PERIOD_CODE', 'periodCode must be YYYY-MM');
    }
  }

  /**
   * BR213-1 — atomic allocation of the next number for (tenant, source, entity, period).
   * Internal primitive consumed by the S013/S214 posting path. Immutable after post (BR213-2)
   * is enforced by the posting story: this only mints and never revises.
   *
   * Atomicity: upsert the counter row if absent, then a single atomic
   * `UPDATE ... SET next_seq = next_seq + 1 RETURNING next_seq` claims a value.
   * Concurrent callers serialize on the row lock and receive distinct sequential numbers.
   * BR213-3 — resets per period naturally: a new periodCode gets its own counter row.
   */
  async allocate(dto: AllocateDTO): Promise<AllocationResult> {
    const sourceCode = typeof dto.sourceCode === 'string' ? dto.sourceCode.trim().toUpperCase() : dto.sourceCode;
    this.validate(sourceCode, dto.periodCode);

    // Ensure the counter row exists (idempotent create; ignore unique-race).
    const existing = await this.prisma.journalSequence.findUnique({
      where: {
        tenantId_sourceCode_entityId_periodCode: {
          tenantId: dto.tenantId,
          sourceCode,
          entityId: dto.entityId,
          periodCode: dto.periodCode,
        },
      },
    });
    if (!existing) {
      try {
        await this.prisma.journalSequence.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: dto.tenantId,
            sourceCode,
            entityId: dto.entityId,
            periodCode: dto.periodCode,
            nextSeq: 1,
          },
        });
      } catch {
        /* concurrent create won the race — the row now exists; proceed to atomic claim */
      }
    }

    // Atomic claim: read-and-increment in one statement so concurrent callers
    // never observe the same value (row-level lock via UPDATE ... RETURNING).
    const rows = await this.prisma.$queryRawUnsafe<{ claimed: number }[]>(
      `UPDATE journal_sequence
         SET next_seq = next_seq + 1, updated_at = now()
       WHERE tenant_id = $1 AND source_code = $2 AND entity_id = $3 AND period_code = $4
       RETURNING (next_seq - 1) AS claimed`,
      dto.tenantId,
      sourceCode,
      dto.entityId,
      dto.periodCode,
    );
    if (!rows || rows.length === 0) {
      throw new SequenceValidationError('SEQUENCE_NOT_FOUND', 'sequence counter row missing after upsert');
    }
    const seq = Number(rows[0].claimed);
    return {
      journalNumber: formatJournalNumber(sourceCode, dto.periodCode, seq),
      seq,
      sourceCode,
      entityId: dto.entityId,
      periodCode: dto.periodCode,
    };
  }

  /**
   * BR213-3 — a failed/aborted post leaves an already-claimed number unused.
   * Record the gap with a reason; the sequence continues (never reused).
   */
  async logGap(dto: LogGapDTO) {
    const sourceCode = typeof dto.sourceCode === 'string' ? dto.sourceCode.trim().toUpperCase() : dto.sourceCode;
    this.validate(sourceCode, dto.periodCode);
    if (!dto.reason || !dto.reason.trim()) {
      throw new SequenceValidationError('MISSING_REASON', 'gap reason is required');
    }
    const expectedNumber = formatJournalNumber(sourceCode, dto.periodCode, dto.seq);
    const row = await this.prisma.sequenceGapLog.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: dto.tenantId,
        sourceCode,
        entityId: dto.entityId,
        periodCode: dto.periodCode,
        expectedNumber,
        expectedSeq: dto.seq,
        reason: dto.reason.trim(),
        actor: dto.actor ?? null,
      },
    });
    await this.audit(dto.tenantId, expectedNumber, dto.actor ?? 'system', 'GAP_LOGGED', null, {
      expectedNumber,
      reason: row.reason,
    });
    return row;
  }

  /** BR213-3 — gap report for a period (perm je.gap_report.view). */
  async gapReport(tenantId: string, filter: { entityId?: string; periodCode?: string }) {
    return this.prisma.sequenceGapLog.findMany({
      where: {
        tenantId,
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.periodCode ? { periodCode: filter.periodCode } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async audit(
    tenantId: string,
    docId: string,
    actor: string,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'journal_sequence',
          docId,
          action,
          before: (before ?? undefined) as any,
          after: (after ?? undefined) as any,
          actor,
        },
      });
    } catch {
      /* AuditPort write is non-fatal */
    }
  }
}
