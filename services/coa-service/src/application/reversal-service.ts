import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/coa-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PostingService } from './posting-service';

// ── Errors ───────────────────────────────────────────────────────────────────

/** Reason is mandatory and rendered on both documents (BR218-3) — 422. */
export class ReversalReasonRequiredError extends Error {
  readonly status = 422;
  readonly code = 'REASON_REQUIRED';
  constructor() {
    super('A reversal reason (1-500 chars) is required.');
    this.name = 'ReversalReasonRequiredError';
  }
}

/** The journal to reverse does not exist for this tenant — 404. */
export class ReversalTargetNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'JOURNAL_NOT_FOUND';
  constructor(readonly journalId: string) {
    super(`Journal ${journalId} not found`);
    this.name = 'ReversalTargetNotFoundError';
  }
}

/** BR218-2 — an entry is reversible once; a second attempt is refused — 409. */
export class AlreadyReversedError extends Error {
  readonly status = 409;
  readonly code = 'ALREADY_REVERSED';
  constructor(readonly reversedBy: string, readonly reversalNumber: string | null) {
    super('This journal has already been reversed.');
    this.name = 'AlreadyReversedError';
  }
}

/** Target period is not a same-or-later OPEN period — 422 with the eligible list. */
export class ClosedTargetPeriodError extends Error {
  readonly status = 422;
  readonly code = 'CLOSED_TARGET_PERIOD';
  constructor(readonly targetPeriod: string, readonly eligiblePeriods: string[]) {
    super(`Period ${targetPeriod} is not an eligible (same-or-later OPEN) reversal target.`);
    this.name = 'ClosedTargetPeriodError';
  }
}

// ── DTO / Result ────────────────────────────────────────────────────────────────

export interface ReverseDTO {
  targetPeriod?: string | null; // period code; defaults to the original's period
  reason: string; // BR218-3 mandatory 1-500
}

export interface ReverseActor {
  userId: string;
}

export interface ReverseResult {
  reversalId: string;
  reversalNumber: string;
  reversalPeriod: string;
  originalId: string;
  originalNumber: string;
  reason: string;
  reinstatement: boolean; // BR218-2 — reversing a reversal (warned)
  idempotent: boolean;
}

@injectable()
export class ReversalService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingService') private readonly posting: PostingService,
  ) {}

  /**
   * S218 — reverse a posted JE the accountant's way: post an equal-and-opposite
   * entry (mirrored lines) through the SINGLE posting door with a mandatory reason,
   * linked both ways to the original. History is never mutated. The reversal is a
   * normal posting with reversalOf set (consumers see acct.je.posted with linkage).
   */
  async reverse(tenantId: string, id: string, dto: ReverseDTO, actor: ReverseActor): Promise<ReverseResult> {
    // BR218-3 — reason mandatory (1-500).
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 1 || reason.length > 500) throw new ReversalReasonRequiredError();

    const original = await this.prisma.journalEntry.findFirst({ where: { id, tenantId } });
    if (!original) throw new ReversalTargetNotFoundError(id);

    // BR218-2 — reversible once.
    if (original.reversedBy) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { id: original.reversedBy, tenantId },
        select: { journalNumber: true },
      });
      throw new AlreadyReversedError(original.reversedBy, existing?.journalNumber ?? null);
    }

    // Target = requested period, else the original's period. Must be same-or-later OPEN.
    const targetCode = (dto.targetPeriod ?? '').trim() || original.periodCode;
    const eligible = await this.prisma.fiscalPeriod.findMany({
      where: { tenantId, entityId: original.entityId, status: 'OPEN', code: { gte: original.periodCode } },
      orderBy: { code: 'asc' },
      select: { code: true, startDate: true },
    });
    const eligibleCodes = eligible.map((p) => p.code);

    const target = eligible.find((p) => p.code === targetCode);
    if (!target) {
      throw new ClosedTargetPeriodError(targetCode, eligibleCodes);
    }

    // Mirrored lines (BR218-1) — swap DR<->CR, preserve every other dimension.
    const lines = await this.prisma.journalLine.findMany({
      where: { journalEntryId: original.id, tenantId },
      orderBy: { lineIndex: 'asc' },
    });
    const mirrored = lines.map((l) => ({
      accountId: l.accountId,
      storeId: l.storeId,
      deptCode: l.deptCode ?? null,
      controlNumber: l.controlNumber ?? null,
      applyNumber: l.applyNumber ?? null,
      dr: Number(l.cr), // swap
      cr: Number(l.dr), // swap
      memo: l.memo ?? null,
    }));

    // Post the reversal through the ONE door. Own number, reversalOf linkage,
    // idempotency key reverse:{id} (belt-and-suspenders reverse-once at the ledger).
    const postingDate = target.startDate.toISOString().slice(0, 10);
    const reversal = await this.posting.post({
      tenantId,
      entityId: original.entityId,
      date: postingDate,
      sourceCode: original.sourceCode,
      memo: `Reversal of ${original.journalNumber}: ${reason}`,
      idempotencyKey: `reverse:${original.id}`,
      callerClass: 'MANUAL',
      postedBy: actor.userId,
      reversalOf: original.id,
      reversalReason: reason,
      lines: mirrored,
    });

    // Link the original both ways + flip its status. Separate tx (post() owns its
    // own SERIALIZABLE tx); idempotent replay re-applies the same linkage.
    await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: 'REVERSED', reversedBy: reversal.id },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'JOURNAL_ENTRY',
          docId: original.id,
          action: 'REVERSED',
          before: { status: original.status, reversedBy: null } as any,
          after: { status: 'REVERSED', reversedBy: reversal.id, reversalNumber: reversal.journalNumber, reason } as any,
          actor: actor.userId,
        },
      });
    });

    return {
      reversalId: reversal.id,
      reversalNumber: reversal.journalNumber,
      reversalPeriod: reversal.periodCode,
      originalId: original.id,
      originalNumber: original.journalNumber,
      reason,
      reinstatement: original.reversalOf != null, // BR218-2 — reversing a reversal
      idempotent: reversal.idempotent,
    };
  }
}
