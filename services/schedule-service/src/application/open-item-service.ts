// @wave S026 — Schedule Open-Item Core application service.
// @trace-cobol komdetail.cbl DE-APPLYNO/DE-APPLY-CD generalized into a real
// open-item balance ledger.
import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import { deriveStatus, applyAmount, ManualApplyInput } from '../domain/open-item';
import {
  OpenItemNotFoundError,
  OpenItemClosedError,
  OverApplicationError,
  ApplicationNotFoundError,
  ApplicationAlreadyReversedError,
  InvalidApplicationAmountError,
  DuplicateApplicationError,
} from '../domain/errors';
import type { IScheduleOpenItemRepository, OpenItemFilters } from '../infrastructure/schedule-open-item-repository';

export const SCHEDULE_OPEN_ITEM_REPO_TOKEN = 'IScheduleOpenItemRepository';

// Matches the actual JOURNAL_ENTRY_POSTED outbox payload gl-service writes
// (gl-service.ts:667-687) — widened from the original wave-3 interface to
// include applyNumber/applyCd, which gl-service has always sent but the
// original Wave-3 consumer never read.
export interface JournalEntryPostedEvent {
  tenantId: string;
  journalEntryId: string;
  glAccountNumber: string;
  scheduleNumber: string | null;
  controlNumber: string;
  amount: string;
  referenceNumber?: string;
  journalSource: string;
  transactionDate: string;
  description?: string;
  applyNumber?: string | null;
  applyCd?: string | null;
}

export type PostingOutcome =
  | 'SKIPPED_NOT_SCHEDULED'
  | 'SKIPPED_SCHEDULE_NOT_FOUND'
  | 'ALREADY_PROCESSED'
  | 'NEW_ITEM'
  | 'APPLICATION'
  | 'UNRESOLVED_APPLICATION';

@injectable()
export class OpenItemService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(SCHEDULE_OPEN_ITEM_REPO_TOKEN) private readonly openItemRepo: IScheduleOpenItemRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Posting-event integration (S026 req #1, #2, #3, #6)
  // -------------------------------------------------------------------------
  // @trace-cobol komdetail.cbl 30000-INSERT — extends the existing
  // ScheduleEventHandlers.handleJournalEntryPosted write with open-item
  // lifecycle tracking, in the SAME atomic transaction as the ScheduleDetail
  // write (S026 req #6: atomic operations for competing applications).
  async processPostingEvent(
    tenantId: string,
    event: JournalEntryPostedEvent,
    sourceCorrelationId: string,
  ): Promise<PostingOutcome> {
    if (!event.scheduleNumber) return 'SKIPPED_NOT_SCHEDULED';

    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      // Idempotency: a prior attempt for this exact posted line already ran
      // to completion (this whole function is one transaction, so partial
      // application is impossible — either everything below committed, or
      // nothing did).
      const existingDetail = await tx.scheduleDetail.findFirst({
        where: { tenantId, sourceCorrelationId },
      });
      if (existingDetail) return 'ALREADY_PROCESSED';

      const schedule = await tx.schedule.findUnique({
        where: { tenantId_scheduleNumber: { tenantId, scheduleNumber: event.scheduleNumber! } },
      });
      if (!schedule) return 'SKIPPED_SCHEDULE_NOT_FOUND';

      const amount = new Prisma.Decimal(event.amount);
      const transactionDate = new Date(event.transactionDate);

      const detail = await tx.scheduleDetail.create({
        data: {
          tenantId,
          scheduleNumber: event.scheduleNumber!,
          controlNumber: event.controlNumber,
          amount,
          referenceNumber: event.referenceNumber,
          journalSource: event.journalSource,
          transactionDate,
          glAccountNumber: event.glAccountNumber,
          description: event.description,
          isBalanceForward: false,
          journalEntryId: event.journalEntryId,
          applyNumber: event.applyCd === '#' ? (event.applyNumber ?? null) : null,
          applyCd: event.applyCd ?? null,
          sourceCorrelationId,
        },
      });

      const isApplication = Boolean(event.applyNumber && event.applyCd === '#');

      if (!isApplication) {
        const itemNumber = (event.referenceNumber ?? '').trim() || event.journalEntryId;
        const created = await tx.scheduleOpenItem.create({
          data: {
            tenantId,
            scheduleNumber: event.scheduleNumber!,
            controlNumber: event.controlNumber,
            itemNumber,
            glAccountNumber: event.glAccountNumber,
            journalSource: event.journalSource,
            originalAmount: amount,
            appliedAmount: new Prisma.Decimal(0),
            remainingBalance: amount,
            status: 'OPEN',
            transactionDate,
            description: event.description,
            journalEntryId: event.journalEntryId,
            scheduleDetailId: detail.id,
            sourceCorrelationId,
          },
        });
        // docId is the real ScheduleOpenItem.id — matches the docId scheme
        // every other audit event for this doc_type uses (the 'APPLIED'
        // write below, and every REVERSED/MANUAL_APPLY write), so an open
        // item's full audit history can be queried by its one real id
        // rather than a composite string only 'CREATED' used.
        await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', created.id, 'CREATED', null, { originalAmount: event.amount }, 'JOURNAL_ENTRY_POSTED', sourceCorrelationId);
        return 'NEW_ITEM';
      }

      // Application: target item's itemNumber must equal this line's applyNumber.
      const candidates: any[] = await tx.scheduleOpenItem.findMany({
        where: {
          tenantId,
          scheduleNumber: event.scheduleNumber!,
          controlNumber: event.controlNumber,
          itemNumber: event.applyNumber!,
          status: { not: 'CLOSED' },
        },
      });

      if (candidates.length !== 1) {
        // Zero matches (no such open item, or already closed) or an
        // ambiguous multi-match — log and preserve the ScheduleDetail line
        // for legacy report fidelity, but do not fabricate an application.
        // Formal escalation of unresolved apply-to references is S028 scope.
        console.warn(
          `[schedule-service] S026: unresolved apply-to reference — schedule=${event.scheduleNumber} control=${event.controlNumber} applyNumber=${event.applyNumber} matches=${candidates.length} (tenant ${tenantId}).`,
        );
        return 'UNRESOLVED_APPLICATION';
      }

      const target = candidates[0];
      let newRemaining: Prisma.Decimal;
      try {
        newRemaining = applyAmount(target.originalAmount, target.remainingBalance, amount);
      } catch {
        console.warn(
          `[schedule-service] S026: posted application would over-apply open item ${target.id} — schedule=${event.scheduleNumber} control=${event.controlNumber} applyNumber=${event.applyNumber} amount=${event.amount} remaining=${target.remainingBalance} (tenant ${tenantId}). Not applied; ScheduleDetail line retained, discrepancy will surface at next tie-out.`,
        );
        return 'UNRESOLVED_APPLICATION';
      }

      const status = deriveStatus(target.originalAmount, newRemaining);

      await tx.scheduleApplication.create({
        data: {
          tenantId,
          openItemId: target.id,
          scheduleNumber: event.scheduleNumber!,
          controlNumber: event.controlNumber,
          amount,
          journalEntryId: event.journalEntryId,
          sourceCorrelationId,
          isManual: false,
        },
      });

      await tx.scheduleOpenItem.update({
        where: { id: target.id },
        data: {
          appliedAmount: target.originalAmount.sub(newRemaining),
          remainingBalance: newRemaining,
          status,
          closedAt: status === 'CLOSED' ? new Date() : null,
        },
      });

      await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', target.id, 'APPLIED', { remainingBalance: target.remainingBalance.toFixed(2) }, { remainingBalance: newRemaining.toFixed(2), status }, 'JOURNAL_ENTRY_POSTED', sourceCorrelationId);

      return 'APPLICATION';
    });
  }

  // -------------------------------------------------------------------------
  // Manual application (operator UI) — S026 req: partial/full application,
  // over-application/duplicate/closed-item protection.
  // -------------------------------------------------------------------------
  async applyManual(
    tenantId: string,
    openItemId: string,
    dto: ManualApplyInput,
  ): Promise<any> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const item = await tx.scheduleOpenItem.findFirst({ where: { id: openItemId, tenantId } });
      if (!item) throw new OpenItemNotFoundError(openItemId);

      const existing = await tx.scheduleApplication.findFirst({
        where: { tenantId, sourceCorrelationId: dto.idempotencyKey },
      });
      if (existing) {
        if (existing.openItemId !== openItemId || !existing.amount.equals(new Prisma.Decimal(dto.amount))) {
          throw new DuplicateApplicationError(dto.idempotencyKey);
        }
        return existing; // idempotent replay — no-op
      }

      if (item.status === 'CLOSED') throw new OpenItemClosedError(openItemId);

      let amount: Prisma.Decimal;
      try {
        amount = new Prisma.Decimal(dto.amount);
      } catch {
        throw new InvalidApplicationAmountError(`Invalid amount: ${dto.amount}`);
      }
      if (amount.equals(0)) {
        throw new InvalidApplicationAmountError('Application amount must be non-zero.');
      }

      let newRemaining: Prisma.Decimal;
      try {
        newRemaining = applyAmount(item.originalAmount, item.remainingBalance, amount);
      } catch {
        throw new OverApplicationError(openItemId, amount.toFixed(2), item.remainingBalance.toFixed(2));
      }

      const status = deriveStatus(item.originalAmount, newRemaining);

      const application = await tx.scheduleApplication.create({
        data: {
          tenantId,
          openItemId,
          scheduleNumber: item.scheduleNumber,
          controlNumber: item.controlNumber,
          amount,
          journalEntryId: `MANUAL-${randomUUID()}`,
          sourceCorrelationId: dto.idempotencyKey,
          isManual: true,
          appliedBy: dto.appliedBy,
          note: dto.note,
        },
      });

      await tx.scheduleOpenItem.update({
        where: { id: openItemId },
        data: {
          appliedAmount: item.originalAmount.sub(newRemaining),
          remainingBalance: newRemaining,
          status,
          closedAt: status === 'CLOSED' ? new Date() : null,
        },
      });

      await this._audit(
        tx, tenantId, 'SCHEDULE_OPEN_ITEM', openItemId, 'MANUAL_APPLY',
        { remainingBalance: item.remainingBalance.toFixed(2) },
        { remainingBalance: newRemaining.toFixed(2), status, amount: amount.toFixed(2) },
        dto.appliedBy ?? 'system', dto.idempotencyKey,
      );

      return application;
    });
  }

  // -------------------------------------------------------------------------
  // Reversal — append-only (S026 req: reversal/correction per repo rules).
  // -------------------------------------------------------------------------
  async reverseApplication(tenantId: string, applicationId: string, actor: string, note?: string): Promise<any> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const original = await tx.scheduleApplication.findFirst({ where: { id: applicationId, tenantId } });
      if (!original) throw new ApplicationNotFoundError(applicationId);
      if (original.reversedAt) throw new ApplicationAlreadyReversedError(applicationId);

      const item = await tx.scheduleOpenItem.findFirst({ where: { id: original.openItemId, tenantId } });
      if (!item) throw new OpenItemNotFoundError(original.openItemId);

      const reversalAmount = original.amount.neg();
      const newRemaining = item.remainingBalance.sub(reversalAmount);
      const status = deriveStatus(item.originalAmount, newRemaining);

      const reversal = await tx.scheduleApplication.create({
        data: {
          tenantId,
          openItemId: item.id,
          scheduleNumber: item.scheduleNumber,
          controlNumber: item.controlNumber,
          amount: reversalAmount,
          journalEntryId: `REVERSAL-${randomUUID()}`,
          sourceCorrelationId: `reversal-${applicationId}`,
          isManual: true,
          appliedBy: actor,
          note: note ?? `Reversal of application ${applicationId}`,
          reversalOfId: applicationId,
        },
      });

      await tx.scheduleApplication.update({
        where: { id: applicationId },
        data: { reversedAt: new Date() },
      });

      await tx.scheduleOpenItem.update({
        where: { id: item.id },
        data: {
          appliedAmount: item.originalAmount.sub(newRemaining),
          remainingBalance: newRemaining,
          status,
          closedAt: status === 'CLOSED' ? new Date() : null,
        },
      });

      await this._audit(
        tx, tenantId, 'SCHEDULE_APPLICATION', applicationId, 'REVERSED',
        { reversedAt: null }, { reversedAt: new Date().toISOString(), reversalId: reversal.id },
        actor, undefined,
      );

      return reversal;
    });
  }

  // -------------------------------------------------------------------------
  // Read-side
  // -------------------------------------------------------------------------
  async listOpenItems(tenantId: string, scheduleNumber: string, filters?: OpenItemFilters) {
    return this.openItemRepo.findBySchedule(tenantId, scheduleNumber, filters);
  }

  async getOpenItem(tenantId: string, id: string) {
    const item = await this.openItemRepo.findById(tenantId, id);
    if (!item) throw new OpenItemNotFoundError(id);
    return item;
  }

  private async _audit(
    tx: any, tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor: string, correlationId?: string,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        tenantId, docType, docId, action,
        before: (before ?? undefined) as any,
        after: (after ?? undefined) as any,
        actor: actor ?? 'system',
        correlationId: correlationId ?? null,
      },
    });
  }
}
