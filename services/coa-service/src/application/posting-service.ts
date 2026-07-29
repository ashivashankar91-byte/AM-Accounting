import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import { FiscalCalendarService } from './fiscal-service';
import { SequenceService } from './sequence-service';
import { AnalysisCodeService } from './analysis-code-service';
import { withSerializableRetry } from '../lib/serializable-retry';
import {
  evaluate,
  toCents,
  centsToDollars,
  balanceDelta,
  PostingContext,
  PostingHeaderInput,
  PostingLineInput,
  ResolvedAccount,
  Violation,
  SourceClass,
} from '../domain/journal-posting';
import { validateLineTags, AnalysisTagViolation } from '../domain/analysis-code';

// ── Errors ───────────────────────────────────────────────────────────────────

/** Bad request shape (missing required fields) — 400. */
export class PostingInputError extends Error {
  readonly status = 400;
  readonly code = 'POSTING_INPUT_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'PostingInputError';
  }
}

/** One or more BR013 business rules violated — 422, no partial write. */
export class PostingViolationError extends Error {
  readonly status = 422;
  readonly code = 'POSTING_REJECTED';
  constructor(readonly violations: Violation[]) {
    super('Journal rejected: ' + violations.map((v) => `${v.rule}${v.lineIndex !== undefined ? `[${v.lineIndex}]` : ''}`).join(', '));
    this.name = 'PostingViolationError';
  }
}

/**
 * S011 — BR011-1/BR011-2/BR011-4: one or more lines carry an invalid tag
 * (unknown/inactive type or value, duplicate type on a line, or over the
 * cap). Rejected the same way as a BR013 violation — 422, no partial write,
 * evaluated and enforced BEFORE the journal number is allocated so a tag
 * rejection never produces a sequence gap.
 */
export class AnalysisTagViolationError extends Error {
  readonly status = 422;
  readonly code = 'ANALYSIS_TAG_REJECTED';
  constructor(readonly violations: AnalysisTagViolation[]) {
    super(
      'Journal rejected: ' +
        violations.map((v) => `${v.rule}${v.lineIndex !== undefined ? `[${v.lineIndex}]` : ''}`).join(', '),
    );
    this.name = 'AnalysisTagViolationError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface PostJournalDTO {
  tenantId: string;
  entityId: string;
  date: string; // YYYY-MM-DD
  sourceCode: string;
  memo?: string | null;
  idempotencyKey: string;
  callerClass?: SourceClass; // default MANUAL
  postedBy?: string;
  draftId?: string | null; // S216 back-ref
  // S008 — per-journal adjusting-entry attribute. Only meaningful (and only
  // permitted through by the DB trigger) when the draft carries a matching
  // AdjustingEntryAttestation row written by DraftService at
  // fiscal.je.mark_adjusting-check time.
  isAdjusting?: boolean;
  adjustingReason?: string | null;
  adjustingCorrectionRef?: string | null;
  // S218 reversal linkage (set by the reverse path):
  reversalOf?: string | null;
  reversalReason?: string | null;
  lines: PostingLineInput[];
}

export interface PostResult {
  id: string;
  journalNumber: string;
  periodCode: string;
  totalDebits: number;
  totalCredits: number;
  status: string;
  idempotent: boolean;
}

@injectable()
export class PostingService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('FiscalCalendarService') private readonly fiscal: FiscalCalendarService,
    @inject('SequenceService') private readonly sequence: SequenceService,
    @inject('AnalysisCodeService') private readonly analysisCodes: AnalysisCodeService,
  ) {}

  /**
   * BR013 — the single point of ledger truth. Resolve reference data (no business
   * throws), run the shared evaluator (domain/journal-posting.evaluate — the same
   * engine S215 validate calls), and only on a clean pass persist atomically.
   */
  async post(dto: PostJournalDTO): Promise<PostResult> {
    if (!dto.tenantId) throw new PostingInputError('tenantId is required');
    if (!dto.entityId) throw new PostingInputError('entityId is required');
    if (!dto.date) throw new PostingInputError('date is required');
    if (!dto.sourceCode) throw new PostingInputError('sourceCode is required');
    if (!dto.idempotencyKey) throw new PostingInputError('idempotencyKey is required');

    const callerClass: SourceClass = dto.callerClass ?? 'MANUAL';

    // BR013-6 — idempotency short-circuit: same key returns the original posting.
    const prior = await this.prisma.journalEntry.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
    });
    if (prior) {
      return {
        id: prior.id,
        journalNumber: prior.journalNumber,
        periodCode: prior.periodCode,
        totalDebits: Number(prior.totalDebits),
        totalCredits: Number(prior.totalCredits),
        status: prior.status,
        idempotent: true,
      };
    }

    // ── Resolve reference data (no business exceptions; nulls -> evaluator) ────
    const ctx = await this.resolveContext(dto, callerClass);
    const header: PostingHeaderInput = {
      entityId: dto.entityId,
      date: dto.date,
      sourceCode: dto.sourceCode,
      memo: dto.memo ?? null,
      idempotencyKey: dto.idempotencyKey,
      isAdjusting: dto.isAdjusting ?? false,
    };

    // ── Single rule source (shared with S215) ─────────────────────────────────
    const result = evaluate(header, dto.lines ?? [], ctx);
    if (!result.pass) {
      throw new PostingViolationError(result.violations); // 422, NO partial write
    }

    // ── S011 BR011-1/BR011-2/BR011-4 — tags are validated but NEVER passed to
    // evaluate() above: this is the structural proof of BR011-3 ("tags never
    // affect posting math, balancing, or the S013 gate"). Checked before the
    // journal number is allocated so a tag rejection never produces a gap.
    const anyTags = (dto.lines ?? []).some((l) => (l.analysisTags?.length ?? 0) > 0);
    if (anyTags) {
      const tagCtx = await this.analysisCodes.loadValidationContext(dto.tenantId);
      const tagViolations: AnalysisTagViolation[] = [];
      (dto.lines ?? []).forEach((line, i) => {
        tagViolations.push(...validateLineTags(line.analysisTags ?? undefined, tagCtx, i));
      });
      if (tagViolations.length > 0) {
        throw new AnalysisTagViolationError(tagViolations); // 422, NO partial write
      }
    }

    const period = ctx.period!; // guaranteed present + OPEN by a clean evaluation

    // BR013-8 — mint the journal number (atomic; may gap on rollback, which S213 logs).
    const alloc = await this.sequence.allocate({
      tenantId: dto.tenantId,
      sourceCode: dto.sourceCode,
      entityId: dto.entityId,
      periodCode: period.code,
      actor: dto.postedBy ?? 'system',
    });

    try {
      const created = await withSerializableRetry(this.prisma, async (tx: any) => {
        const entryId = crypto.randomUUID();
        const postedBy = dto.postedBy ?? 'system';

        await tx.journalEntry.create({
          data: {
            id: entryId,
            tenantId: dto.tenantId,
            entityId: dto.entityId,
            journalNumber: alloc.journalNumber,
            sourceCode: dto.sourceCode,
            periodId: period.id,
            periodCode: period.code,
            entryDate: new Date(dto.date),
            memo: dto.memo ?? null,
            status: 'POSTED',
            idempotencyKey: dto.idempotencyKey,
            totalDebits: centsToDollars(result.totalDebitsCents),
            totalCredits: centsToDollars(result.totalCreditsCents),
            reversalOf: dto.reversalOf ?? null,
            reversalReason: dto.reversalReason ?? null,
            draftId: dto.draftId ?? null,
            postedBy,
            isAdjusting: dto.isAdjusting ?? false,
            adjustingReason: dto.adjustingReason ?? null,
            adjustingCorrectionRef: dto.adjustingCorrectionRef ?? null,
          },
        });

        // Lines + per-account aggregation for balance updates.
        const perAccount = new Map<string, { drC: number; crC: number }>();
        for (let i = 0; i < dto.lines.length; i++) {
          const line = dto.lines[i];
          const acct = ctx.accounts.get(line.accountId)!;
          const drC = toCents(line.dr);
          const crC = toCents(line.cr);
          const lineId = crypto.randomUUID();
          await tx.journalLine.create({
            data: {
              id: lineId,
              journalEntryId: entryId,
              tenantId: dto.tenantId,
              lineIndex: i,
              accountId: line.accountId,
              accountNumber: acct.accountNumber,
              storeId: line.storeId,
              deptCode: line.deptCode ?? null,
              controlNumber: line.controlNumber ?? null,
              applyNumber: line.applyNumber ?? null,
              dr: centsToDollars(drC),
              cr: centsToDollars(crC),
              memo: line.memo ?? null,
            },
          });
          // S011 BR011-2 — persist tags atomically with the line they belong
          // to (same transaction); already validated above (fail-closed,
          // before allocation) so this insert cannot fail on a bad tag.
          if (line.analysisTags && line.analysisTags.length > 0) {
            await tx.journalLineAnalysisTag.createMany({
              data: line.analysisTags.map((tag) => ({
                id: crypto.randomUUID(),
                tenantId: dto.tenantId,
                journalLineId: lineId,
                typeId: tag.typeId,
                valueId: tag.valueId,
              })),
            });
          }
          const agg = perAccount.get(line.accountId) ?? { drC: 0, crC: 0 };
          agg.drC += drC;
          agg.crC += crC;
          perAccount.set(line.accountId, agg);
        }

        // Update account balances + append snapshots (append-only).
        for (const [accountId, agg] of perAccount) {
          const acct = ctx.accounts.get(accountId)!;
          const delta = balanceDelta(acct.normalBalance, agg.drC, agg.crC);
          const updated = await tx.glAccount.update({
            where: { id: accountId },
            data: {
              balance: { increment: delta },
              hasPostings: true,
              version: { increment: 1 },
            },
          });
          await tx.balanceSnapshot.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: dto.tenantId,
              entityId: dto.entityId,
              accountId,
              journalEntryId: entryId,
              journalNumber: alloc.journalNumber,
              periodCode: period.code,
              dr: centsToDollars(agg.drC),
              cr: centsToDollars(agg.crC),
              delta,
              balanceAfter: Number(updated.balance),
              postedAt: new Date(),
            },
          });
        }

        // Mark the period as having postings (locks fiscal structure per BR208-4).
        await tx.fiscalPeriod.update({ where: { id: period.id }, data: { hasPostings: true } });

        // Outbox event (acct.je.posted) — written INSIDE the tx so a rollback drops it.
        const payload = {
          eventId: crypto.randomUUID(),
          tenantId: dto.tenantId,
          entityId: dto.entityId,
          journalNumber: alloc.journalNumber,
          sourceCode: dto.sourceCode,
          periodCode: period.code,
          reversalOf: dto.reversalOf ?? null,
          lines: dto.lines.map((l) => ({
            account: ctx.accounts.get(l.accountId)!.accountNumber,
            store: l.storeId,
            dept: l.deptCode ?? null,
            dr: centsToDollars(toCents(l.dr)),
            cr: centsToDollars(toCents(l.cr)),
          })),
          postedBy,
          ts: new Date().toISOString(),
          schemaV: 1,
        };
        await tx.coaOutboxEvent.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: dto.tenantId,
            eventType: 'acct.je.posted',
            aggregateId: entryId,
            payload: payload as any,
          },
        });

        // AuditPort stub (S007) — before/after images in the shared audit_outbox.
        await tx.auditOutboxEvent.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: dto.tenantId,
            docType: 'JOURNAL_ENTRY',
            docId: entryId,
            action: dto.reversalOf ? 'REVERSAL_POSTED' : 'POSTED',
            before: null as any,
            after: payload as any,
            actor: postedBy,
          },
        });

        return { entryId, payload };
      });

      // Best-effort broker publish (outbox is the source of truth).
      try {
        await this.events.publish({
          type: 'acct.je.posted',
          tenantId: dto.tenantId,
          payload: created.payload,
          occurredAt: new Date().toISOString(),
          correlationId: created.entryId,
        } as any);
      } catch {
        /* outbox row already durable */
      }

      return {
        id: created.entryId,
        journalNumber: alloc.journalNumber,
        periodCode: period.code,
        totalDebits: centsToDollars(result.totalDebitsCents),
        totalCredits: centsToDollars(result.totalCreditsCents),
        status: 'POSTED',
        idempotent: false,
      };
    } catch (err: any) {
      // Concurrent duplicate idempotencyKey lost the race — return the winner.
      if (err?.code === 'P2002' && String(err?.meta?.target ?? '').includes('idempotency')) {
        const winner = await this.prisma.journalEntry.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
        });
        if (winner) {
          return {
            id: winner.id,
            journalNumber: winner.journalNumber,
            periodCode: winner.periodCode,
            totalDebits: Number(winner.totalDebits),
            totalCredits: Number(winner.totalCredits),
            status: winner.status,
            idempotent: true,
          };
        }
      }
      // The minted number is now a gap — log it (BR213-3) and surface the failure.
      try {
        await this.sequence.logGap({
          tenantId: dto.tenantId,
          sourceCode: dto.sourceCode,
          entityId: dto.entityId,
          periodCode: period.code,
          seq: alloc.seq,
          reason: `posting failed after allocation: ${err?.message ?? 'unknown'}`,
          actor: dto.postedBy,
        });
      } catch {
        /* gap logging is best-effort */
      }
      throw err;
    }
  }

  /**
   * Load reference data for the evaluator. Never throws business errors — a
   * missing period/source/account resolves to null/absent so the SINGLE evaluator
   * produces the diagnostic (keeps validate/post parity, BR215-2). Also used by
   * the S215 validation path so both share one resolution + one evaluator.
   */
  async resolveContext(
    dto: { tenantId: string; entityId: string; date: string; sourceCode: string; lines?: PostingLineInput[] },
    callerClass: SourceClass,
  ): Promise<PostingContext> {
    // Period (BR013-2 / BR208-5). resolve() throws when the date maps to nothing.
    let period = null as PostingContext['period'];
    try {
      const p = await this.fiscal.resolve(dto.tenantId, dto.entityId, dto.date);
      period = { id: p.id, code: p.code, status: p.status, adjustmentsOnly: p.adjustmentsOnly };
    } catch {
      period = null;
    }

    // Source (BR013-3).
    const src = await this.prisma.journalSource.findUnique({
      where: { tenantId_code: { tenantId: dto.tenantId, code: dto.sourceCode } },
    });
    const source = src ? { code: src.code, sourceClass: src.sourceClass, status: src.status } : null;

    // Accounts (BR013-4). One query for the whole entity slice we touch.
    const accounts = new Map<string, ResolvedAccount>();
    const ids = Array.from(new Set((dto.lines ?? []).map((l) => l.accountId).filter(Boolean)));
    if (ids.length > 0) {
      const rows = await this.prisma.glAccount.findMany({
        where: { tenantId: dto.tenantId, entityId: dto.entityId, id: { in: ids } },
      });
      for (const r of rows) {
        accounts.set(r.id, {
          id: r.id,
          accountNumber: r.accountNumber,
          type: r.type,
          normalBalance: r.normalBalance,
          postable: r.postable,
          status: r.status,
        });
      }
    }

    return { callerClass, period, source, accounts };
  }
}
