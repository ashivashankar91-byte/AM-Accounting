// @wave S027 completion — exception rule engine. Fable §3-S027 documents
// "exception flagging (stale, over-limit, negative, unmatched) as
// configurable rules; exception queue surfacing" as "[EVIDENCE exists]", but
// no such engine exists anywhere in the certified S026/S027 code in this
// worktree (verified: no ScheduleException model, no rule evaluator prior to
// CE-08) — this file is the actual implementation, derived directly from the
// four rule names given in the source text (never invented rule types).
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import { ageDaysFrom } from '../domain/open-item';
import { ExceptionNotFoundError, ExceptionAlreadyDispositionedError } from '../domain/errors';

export const EXCEPTION_RULE_TYPES = [
  'STALE',
  'CREDIT_BALANCE_ON_DEBIT_ACCOUNT',
  'MISSING_REFERENCE',
  'OVER_CONTROL_LIMIT',
] as const;
export type ExceptionRuleType = (typeof EXCEPTION_RULE_TYPES)[number];

export interface ExceptionRuleConfigDTO {
  staleDays: number;
  controlLimitAmount: string | null;
  normalBalance: 'DEBIT' | 'CREDIT';
}

export interface ExceptionListFilters {
  scheduleNumber?: string;
  status?: string;
}

@injectable()
export class ExceptionService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async getRuleConfig(tenantId: string): Promise<ExceptionRuleConfigDTO> {
    const row = await (this.prisma as any).scheduleExceptionRuleConfig.findFirst({ where: { tenantId } });
    if (!row) return { staleDays: 90, controlLimitAmount: null, normalBalance: 'DEBIT' };
    return {
      staleDays: row.staleDays,
      controlLimitAmount: row.controlLimitAmount ? row.controlLimitAmount.toFixed(2) : null,
      normalBalance: row.normalBalance,
    };
  }

  async setRuleConfig(tenantId: string, dto: ExceptionRuleConfigDTO, updatedBy?: string): Promise<ExceptionRuleConfigDTO> {
    await (this.prisma as any).scheduleExceptionRuleConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        staleDays: dto.staleDays,
        controlLimitAmount: dto.controlLimitAmount ? new Prisma.Decimal(dto.controlLimitAmount) : null,
        normalBalance: dto.normalBalance,
        updatedBy,
      },
      update: {
        staleDays: dto.staleDays,
        controlLimitAmount: dto.controlLimitAmount ? new Prisma.Decimal(dto.controlLimitAmount) : null,
        normalBalance: dto.normalBalance,
        updatedBy,
      },
    });
    return this.getRuleConfig(tenantId);
  }

  /**
   * Evaluates all four rule types against every non-CLOSED open item for a
   * tenant (optionally scoped to a schedule), opening a ScheduleException
   * row for each newly-detected breach and leaving already-open exceptions
   * of the same (item, rule) untouched (re-evaluation is idempotent, never
   * silently clears a still-outstanding exception).
   */
  async runEvaluation(tenantId: string, scheduleNumber: string | undefined, actor: string): Promise<{ runId: string; opened: number; evaluated: number }> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const config = await this.getRuleConfig(tenantId);
    const asOfDate = new Date();

    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const items: any[] = await tx.scheduleOpenItem.findMany({
        where: {
          tenantId,
          status: { not: 'CLOSED' },
          ...(scheduleNumber && { scheduleNumber }),
        },
      });

      let opened = 0;
      for (const item of items) {
        const breaches: { ruleType: ExceptionRuleType; detail: string }[] = [];

        // Rule 1: STALE — remains open past staleDays from its reference date.
        const referenceDate = item.dueDate ?? item.transactionDate;
        const ageDays = ageDaysFrom(referenceDate, asOfDate);
        if (ageDays > config.staleDays) {
          breaches.push({ ruleType: 'STALE', detail: `Open ${ageDays} days (threshold ${config.staleDays}).` });
        }

        // Rule 2: CREDIT_BALANCE_ON_DEBIT_ACCOUNT (and its mirror) — the
        // item's remaining balance sign disagrees with the configured
        // normal balance for the schedule.
        const isCredit = item.remainingBalance.lt(0);
        const expectCredit = config.normalBalance === 'CREDIT';
        if (isCredit !== expectCredit && !item.remainingBalance.equals(0)) {
          breaches.push({
            ruleType: 'CREDIT_BALANCE_ON_DEBIT_ACCOUNT',
            detail: `Remaining balance ${item.remainingBalance.toFixed(2)} has unexpected sign for a ${config.normalBalance}-normal schedule.`,
          });
        }

        // Rule 3: MISSING_REFERENCE — no usable reference/item identity beyond
        // the internal journalEntryId fallback (see NEW_ITEM creation in
        // OpenItemService — itemNumber falls back to journalEntryId exactly
        // when referenceNumber was blank).
        if (item.itemNumber === item.journalEntryId) {
          breaches.push({ ruleType: 'MISSING_REFERENCE', detail: 'Item has no posted reference number; itemNumber fell back to the journal entry id.' });
        }

        // Rule 4: OVER_CONTROL_LIMIT — "where defined" (config.controlLimitAmount).
        if (config.controlLimitAmount) {
          const limit = new Prisma.Decimal(config.controlLimitAmount);
          const total = await tx.scheduleOpenItem.aggregate({
            where: { tenantId, scheduleNumber: item.scheduleNumber, controlNumber: item.controlNumber, status: { not: 'CLOSED' } },
            _sum: { remainingBalance: true },
          });
          const controlTotal = (total._sum.remainingBalance ?? new Prisma.Decimal(0)) as Prisma.Decimal;
          if (controlTotal.gt(limit)) {
            breaches.push({ ruleType: 'OVER_CONTROL_LIMIT', detail: `Control ${item.controlNumber} total ${controlTotal.toFixed(2)} exceeds limit ${limit.toFixed(2)}.` });
          }
        }

        for (const breach of breaches) {
          const existing = await tx.scheduleException.findFirst({
            where: { tenantId, openItemId: item.id, ruleType: breach.ruleType, status: 'OPEN' },
          });
          if (existing) continue; // already open — do not duplicate
          await tx.scheduleException.create({
            data: {
              tenantId,
              openItemId: item.id,
              scheduleNumber: item.scheduleNumber,
              controlNumber: item.controlNumber,
              ruleType: breach.ruleType,
              detail: breach.detail,
              runId,
            },
          });
          opened += 1;
        }
      }

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'SCHEDULE_EXCEPTION_RUN', docId: runId, action: 'RUN', before: null, after: { evaluated: items.length, opened }, actor },
      });

      return { runId, opened, evaluated: items.length };
    });
  }

  async listExceptions(tenantId: string, filters: ExceptionListFilters = {}) {
    return (this.prisma as any).scheduleException.findMany({
      where: {
        tenantId,
        ...(filters.scheduleNumber && { scheduleNumber: filters.scheduleNumber }),
        status: filters.status ?? 'OPEN',
      },
      orderBy: [{ detectedAt: 'asc' }],
    });
  }

  async dispositionException(tenantId: string, exceptionId: string, note: string, actor: string): Promise<any> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const row = await tx.scheduleException.findFirst({ where: { id: exceptionId, tenantId } });
      if (!row) throw new ExceptionNotFoundError(exceptionId);
      if (row.status === 'DISPOSITIONED') throw new ExceptionAlreadyDispositionedError(exceptionId);

      const updated = await tx.scheduleException.update({
        where: { id: exceptionId },
        data: { status: 'DISPOSITIONED', dispositionNote: note, dispositionedBy: actor, dispositionedAt: new Date() },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'SCHEDULE_EXCEPTION', docId: exceptionId, action: 'DISPOSITIONED', before: { status: 'OPEN' }, after: { status: 'DISPOSITIONED', note }, actor },
      });
      return updated;
    });
  }
}
