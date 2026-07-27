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
  /** Defaults to 'system' for internal callers (e.g. the posting path) that
   * don't have a request-scoped actor to thread through. */
  actor?: string;
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
   * Atomicity: a single `INSERT ... ON CONFLICT (...) DO UPDATE SET next_seq =
   * next_seq + 1 ... RETURNING` claims a value whether or not the counter row
   * already exists — one atomic statement, not a separate find+create+update.
   * Concurrent callers serialize on Postgres's own conflict-resolution locking
   * and receive distinct sequential numbers.
   * BR213-3 — resets per period naturally: a new periodCode gets its own counter row.
   *
   * Real defect fixed (found via the live-DB concurrency test, not a mock):
   * the previous implementation did `findUnique` -> `create` (racy; on a
   * cold row, N concurrent callers all observed no row and raced to insert)
   * -> a separate `UPDATE ... RETURNING`. The `create()` unique-constraint
   * violation for the 19 losing callers was caught by an empty `catch {}`,
   * but catching the JS exception does not un-abort the underlying Postgres
   * transaction: once one statement inside a transaction errors, Postgres
   * aborts the whole transaction until an explicit ROLLBACK (or ROLLBACK TO
   * SAVEPOINT), so every losing caller's subsequent `UPDATE ... RETURNING`
   * failed with `25P02 current transaction is aborted`. A single atomic
   * `INSERT ... ON CONFLICT DO UPDATE` removes the race entirely: there is
   * no separate statement that can fail and abort the transaction, so every
   * concurrent caller — whether racing to create the row or updating an
   * existing one — always completes successfully.
   */
  async allocate(dto: AllocateDTO): Promise<AllocationResult> {
    const sourceCode = typeof dto.sourceCode === 'string' ? dto.sourceCode.trim().toUpperCase() : dto.sourceCode;
    this.validate(sourceCode, dto.periodCode);
    const actor = dto.actor ?? 'system';

    // S007 BR7-1/BR7-4 — the counter mutation and its audit event are one
    // atomic transaction. Previously this method had NO audit call at all
    // (a genuine write-path coverage gap flagged during the S007 write-path
    // census: /journal-sequences/allocate is a real, permission-gated HTTP
    // endpoint that mutates DB state with zero audit trail when called
    // directly, not only as an internal step of an already-audited post).
    return this.prisma.$transaction(async (tx) => {
      // Atomic upsert-and-claim in one statement: on first insert, next_seq
      // starts at 2 and RETURNING (next_seq - 1) hands out 1; on conflict,
      // next_seq is incremented and RETURNING (next_seq - 1) hands out the
      // pre-increment value — identical claim semantics to the prior design,
      // just without a separate statement that can abort the transaction.
      const rows = await tx.$queryRawUnsafe<{ claimed: number }[]>(
        `INSERT INTO journal_sequence (id, tenant_id, source_code, entity_id, period_code, next_seq, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 2, now(), now())
         ON CONFLICT (tenant_id, source_code, entity_id, period_code)
         DO UPDATE SET next_seq = journal_sequence.next_seq + 1, updated_at = now()
         RETURNING (next_seq - 1) AS claimed`,
        crypto.randomUUID(),
        dto.tenantId,
        sourceCode,
        dto.entityId,
        dto.periodCode,
      );
      if (!rows || rows.length === 0) {
        throw new SequenceValidationError('SEQUENCE_NOT_FOUND', 'sequence counter row missing after upsert');
      }
      const seq = Number(rows[0].claimed);
      const result: AllocationResult = {
        journalNumber: formatJournalNumber(sourceCode, dto.periodCode, seq),
        seq,
        sourceCode,
        entityId: dto.entityId,
        periodCode: dto.periodCode,
      };
      await this.audit(dto.tenantId, result.journalNumber, actor, 'ALLOCATED', null, result, tx);
      return result;
    });
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
    // S007 BR7-1/BR7-4 — gap-log write + audit event are one atomic
    // transaction; an audit-write failure rolls back the gap log.
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.sequenceGapLog.create({
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
        reason: r.reason,
      }, tx);
      return r;
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
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ) {
    await tx.auditOutboxEvent.create({
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
  }
}
