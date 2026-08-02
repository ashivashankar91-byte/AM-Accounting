// @wave S026 — Schedule Open-Item Core application service.
// @trace-cobol komdetail.cbl DE-APPLYNO/DE-APPLY-CD generalized into a real
// open-item balance ledger.
import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import {
  deriveStatus,
  applyAmount,
  sweepFifo,
  validateSplitParts,
  ManualApplyInput,
  FifoCandidate,
} from '../domain/open-item';
import {
  OpenItemNotFoundError,
  OpenItemClosedError,
  OverApplicationError,
  ApplicationNotFoundError,
  ApplicationAlreadyReversedError,
  InvalidApplicationAmountError,
  DuplicateApplicationError,
  NoOpenItemsToRelieveError,
  InvalidSplitError,
  CrossAccountTransferNotAllowedError,
  ItemAlreadyWrittenOffError,
  WriteOffThresholdExceededError,
  DownstreamApplicationsExistError,
  DuplicateCeremonyError,
} from '../domain/errors';
import type { IScheduleOpenItemRepository, OpenItemFilters } from '../infrastructure/schedule-open-item-repository';
import type { IGlPostingClient } from '../infrastructure/gl-posting-client';

export const SCHEDULE_OPEN_ITEM_REPO_TOKEN = 'IScheduleOpenItemRepository';
export const GL_POSTING_CLIENT_TOKEN = 'IGlPostingClient';

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
  legalEntityId?: string | null;
  journalNumber?: string | null;
  sourceEventId?: string | null;
  postingExecutionId?: string | null;
  businessDate?: string | null;
  postingDate?: string | null;
  rulePackKey?: string | null;
  rulePackVersion?: string | null;
}

export type PostingOutcome =
  | 'SKIPPED_NOT_SCHEDULED'
  | 'SKIPPED_SCHEDULE_NOT_FOUND'
  | 'ALREADY_PROCESSED'
  | 'NEW_ITEM'
  | 'APPLICATION'
  | 'AUTO_APPLIED'
  | 'ROUTED_TO_UNAPPLIED_CREDIT'
  | 'UNRESOLVED_APPLICATION';

@injectable()
export class OpenItemService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(SCHEDULE_OPEN_ITEM_REPO_TOKEN) private readonly openItemRepo: IScheduleOpenItemRepository,
    @inject(GL_POSTING_CLIENT_TOKEN) private readonly glPostingClient: IGlPostingClient,
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
      // gl-service's outbox payload carries the RAW signed netAmount (debit
      // - credit — see gl-schedule-outbox-live.test.ts's own assertion that
      // a pure-credit control-account line is negative). The open-item
      // ledger (originalAmount/remainingBalance/applyAmount below), by
      // contrast, has always used a positive-magnitude convention — every
      // pre-existing fixture in open-item-service.test.ts posts and applies
      // positive amounts, and deriveStatus/applyAmount's over-application
      // bounds are only correct for a non-negative originalAmount. Real
      // end-to-end certification against a liability (credit-normal)
      // control account is what first exercised this gap: a raw negative
      // netAmount reaching applyAmount would move the balance the WRONG
      // direction and always dead-end in OVER_APPLICATION. Normalize to the
      // ledger's own magnitude convention here, at the one boundary where
      // gl-service's signed convention meets it — ScheduleDetail (the
      // legacy-parity audit trail) still stores the raw signed `amount`.
      const ledgerAmount = amount.abs();
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

      // @trace-fable §7/§3-S028 D-CE08-01 APPROVED: applyCd === '#' marks a
      // posted line as an application (never a new open item). When
      // applyNumber is also present it targets one specific item
      // (isSpecificApplication); when applyNumber is absent it is an
      // auto/on-account application to be relieved oldest-first (FIFO)
      // across the schedule+control's open items, per the approved option.
      const isSpecificApplication = Boolean(event.applyCd === '#' && event.applyNumber);
      const isAutoApplication = Boolean(event.applyCd === '#' && !event.applyNumber);

      if (!isSpecificApplication && !isAutoApplication) {
        const itemNumber = (event.referenceNumber ?? '').trim() || event.journalEntryId;
        const created = await tx.scheduleOpenItem.create({
          data: {
            tenantId,
            scheduleNumber: event.scheduleNumber!,
            controlNumber: event.controlNumber,
            itemNumber,
            glAccountNumber: event.glAccountNumber,
            journalSource: event.journalSource,
            originalAmount: ledgerAmount,
            appliedAmount: new Prisma.Decimal(0),
            remainingBalance: ledgerAmount,
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
        await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', created.id, 'CREATED', null, { originalAmount: ledgerAmount.toFixed(2) }, 'JOURNAL_ENTRY_POSTED', sourceCorrelationId);
        return 'NEW_ITEM';
      }

      // A posting-bridge application's `amount` is the raw dr-cr signed
      // value of the RELIEF leg, which is always the natural OPPOSITE GL
      // side of the origination leg (e.g. a liability opened by a CREDIT,
      // originalAmount negative, is relieved by a DEBIT, amount positive).
      // applyAmount()/sweepFifo() below expect the OPPOSITE convention — a
      // "relieving magnitude" that carries the SAME sign as originalAmount
      // (proven by the manual-apply/auto-sweep-via-operator-endpoint call
      // sites, the only ones previously exercised) — so negate it here, at
      // this one call boundary, rather than changing the shared domain
      // functions and silently flipping the sign those already-correct
      // callers depend on.
      const relievingAmount = amount.neg();

      if (isAutoApplication) {
        return this._sweepAutoApplication(tx, tenantId, event, relievingAmount, sourceCorrelationId);
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
        newRemaining = applyAmount(target.originalAmount, target.remainingBalance, relievingAmount);
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
          amount: relievingAmount,
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

      // @trace-fable D-CE08-08 APPROVED (block-until-downstream-reversed,
      // the conservative default that cannot itself alter financial
      // results): refuse to reverse this application while a later,
      // unreversed application exists on the same open item — reverse those
      // first so the item's balance history stays chronologically sound.
      const laterUnreversed = await tx.scheduleApplication.findFirst({
        where: {
          tenantId,
          openItemId: original.openItemId,
          reversedAt: null,
          reversalOfId: null,
          appliedAt: { gt: original.appliedAt },
          id: { not: applicationId },
        },
      });
      if (laterUnreversed) throw new DownstreamApplicationsExistError(original.openItemId);

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
  // S028 — auto/on-account application sweep (FIFO). Invoked either from a
  // posted line (applyCd='#', no applyNumber) or on demand via the manual
  // auto-apply endpoint for an operator-initiated on-account receipt.
  // -------------------------------------------------------------------------
  private async _sweepAutoApplication(
    tx: any,
    tenantId: string,
    event: Pick<JournalEntryPostedEvent, 'scheduleNumber' | 'controlNumber' | 'journalEntryId'>,
    amount: Prisma.Decimal,
    sourceCorrelationId: string,
  ): Promise<PostingOutcome> {
    const candidates: any[] = await tx.scheduleOpenItem.findMany({
      where: {
        tenantId,
        scheduleNumber: event.scheduleNumber!,
        controlNumber: event.controlNumber,
        status: { not: 'CLOSED' },
      },
    });

    const { allocations, unappliedAmount } = sweepFifo(candidates as FifoCandidate[], amount);

    for (const alloc of allocations) {
      const item = candidates.find((c) => c.id === alloc.itemId);
      await tx.scheduleApplication.create({
        data: {
          tenantId,
          openItemId: alloc.itemId,
          scheduleNumber: event.scheduleNumber!,
          controlNumber: event.controlNumber,
          amount: alloc.applyAmount,
          journalEntryId: event.journalEntryId,
          sourceCorrelationId: `${sourceCorrelationId}-fifo-${alloc.itemId}`,
          isManual: false,
        },
      });
      await tx.scheduleOpenItem.update({
        where: { id: alloc.itemId },
        data: {
          appliedAmount: item.originalAmount.sub(alloc.newRemaining),
          remainingBalance: alloc.newRemaining,
          status: alloc.newStatus,
          closedAt: alloc.newStatus === 'CLOSED' ? new Date() : null,
        },
      });
      await this._audit(
        tx, tenantId, 'SCHEDULE_OPEN_ITEM', alloc.itemId, 'AUTO_APPLIED',
        { remainingBalance: item.remainingBalance.toFixed(2) },
        { remainingBalance: alloc.newRemaining.toFixed(2), status: alloc.newStatus },
        'JOURNAL_ENTRY_POSTED', sourceCorrelationId,
      );
    }

    if (unappliedAmount.gt(0)) {
      // §3-S028: route the unrelieved remainder to the S023/CE-09 hand-off
      // rather than fabricating a new open item or silently dropping cash.
      await tx.scheduleUnappliedReceipt.create({
        data: {
          tenantId,
          scheduleNumber: event.scheduleNumber!,
          controlNumber: event.controlNumber,
          amount: unappliedAmount,
          journalEntryId: event.journalEntryId,
          sourceCorrelationId,
        },
      });
      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: 'SCHEDULE_UNAPPLIED_RECEIPT',
          payload: {
            scheduleNumber: event.scheduleNumber,
            controlNumber: event.controlNumber,
            amount: unappliedAmount.toFixed(2),
            journalEntryId: event.journalEntryId,
          },
          correlationId: sourceCorrelationId,
        },
      });
      return allocations.length > 0 ? 'AUTO_APPLIED' : 'ROUTED_TO_UNAPPLIED_CREDIT';
    }

    return 'AUTO_APPLIED';
  }

  /**
   * Manual (operator-initiated) on-account application — same FIFO sweep as
   * the posting-event path, but invoked on demand (e.g. an operator manually
   * marking a receipt as "apply on account" from the UI rather than waiting
   * for gl-service to replay the posting event).
   */
  async applyAutoFifo(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
    amount: string,
    idempotencyKey: string,
    actor: string,
  ): Promise<{ outcome: PostingOutcome }> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const existing = await tx.scheduleApplication.findFirst({
        where: { tenantId, sourceCorrelationId: { startsWith: idempotencyKey } },
      });
      if (existing) return { outcome: 'ALREADY_PROCESSED' as PostingOutcome };
      const existingReceipt = await tx.scheduleUnappliedReceipt.findFirst({
        where: { tenantId, sourceCorrelationId: idempotencyKey },
      });
      if (existingReceipt) return { outcome: 'ALREADY_PROCESSED' as PostingOutcome };

      let decimalAmount: Prisma.Decimal;
      try {
        decimalAmount = new Prisma.Decimal(amount);
      } catch {
        throw new InvalidApplicationAmountError(`Invalid amount: ${amount}`);
      }
      if (decimalAmount.lte(0)) {
        throw new InvalidApplicationAmountError('Auto-apply amount must be positive.');
      }

      const candidates: any[] = await tx.scheduleOpenItem.findMany({
        where: { tenantId, scheduleNumber, controlNumber, status: { not: 'CLOSED' } },
      });
      if (candidates.length === 0) throw new NoOpenItemsToRelieveError(scheduleNumber, controlNumber);

      const outcome = await this._sweepAutoApplication(
        tx, tenantId,
        { scheduleNumber, controlNumber, journalEntryId: `MANUAL-AUTO-${randomUUID()}` },
        decimalAmount, idempotencyKey,
      );
      await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', `${scheduleNumber}-${controlNumber}`, 'MANUAL_AUTO_APPLY', null, { amount: decimalAmount.toFixed(2), outcome }, actor, idempotencyKey);
      return { outcome };
    });
  }

  // -------------------------------------------------------------------------
  // S029 — Split: divides one open item's remaining balance into 2+ parts,
  // each a new open item carrying `parentItemId` lineage back to the
  // original, which is closed (status CLOSED, remainingBalance 0) as part of
  // the same transaction. Conservation of the sum is enforced by
  // validateSplitParts before any write happens.
  // -------------------------------------------------------------------------
  async splitOpenItem(
    tenantId: string,
    openItemId: string,
    parts: string[],
    idempotencyKey: string,
    actor: string,
    reason: string,
  ): Promise<any> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const existing = await tx.scheduleCeremony.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) {
        if (existing.ceremonyType !== 'SPLIT' || existing.openItemId !== openItemId) {
          throw new DuplicateCeremonyError(idempotencyKey);
        }
        return existing.result;
      }

      const item = await tx.scheduleOpenItem.findFirst({ where: { id: openItemId, tenantId } });
      if (!item) throw new OpenItemNotFoundError(openItemId);
      if (item.status === 'CLOSED') throw new OpenItemClosedError(openItemId);
      if (item.status === 'WRITTEN_OFF') throw new ItemAlreadyWrittenOffError(openItemId);

      let partAmounts: Prisma.Decimal[];
      try {
        partAmounts = parts.map((p) => new Prisma.Decimal(p));
      } catch {
        throw new InvalidSplitError('all parts must be valid decimal amounts');
      }
      try {
        validateSplitParts(item.remainingBalance, partAmounts);
      } catch (err) {
        throw new InvalidSplitError((err as Error).message);
      }

      const created: any[] = [];
      for (let i = 0; i < partAmounts.length; i++) {
        const child = await tx.scheduleOpenItem.create({
          data: {
            tenantId,
            scheduleNumber: item.scheduleNumber,
            controlNumber: item.controlNumber,
            itemNumber: `${item.itemNumber}-S${i + 1}`,
            glAccountNumber: item.glAccountNumber,
            journalSource: item.journalSource,
            originalAmount: partAmounts[i],
            appliedAmount: new Prisma.Decimal(0),
            remainingBalance: partAmounts[i],
            status: 'OPEN',
            transactionDate: item.transactionDate,
            dueDate: item.dueDate,
            description: item.description,
            journalEntryId: item.journalEntryId,
            scheduleDetailId: item.scheduleDetailId,
            sourceCorrelationId: `${idempotencyKey}-part-${i + 1}`,
            parentItemId: item.id,
          },
        });
        created.push(child);
      }

      await tx.scheduleOpenItem.update({
        where: { id: item.id },
        data: { appliedAmount: item.originalAmount, remainingBalance: new Prisma.Decimal(0), status: 'CLOSED', closedAt: new Date() },
      });

      const result = { parentItemId: item.id, childItemIds: created.map((c) => c.id) };

      await tx.scheduleCeremony.create({
        data: { tenantId, ceremonyType: 'SPLIT', openItemId, idempotencyKey, reason, actor, result },
      });
      await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', item.id, 'SPLIT', { remainingBalance: item.remainingBalance.toFixed(2) }, result, actor, idempotencyKey);

      return result;
    });
  }

  // -------------------------------------------------------------------------
  // S029 — Transfer: moves an item's balance to a different controlNumber/
  // itemNumber WITHIN the same schedule (D-CE08-04 APPROVED: cross-account
  // transfer is rejected — that requires a journal entry, not this
  // ceremony). Implemented as close-original + create-new-with-lineage,
  // mirroring split's conservation pattern (single item, single part).
  // -------------------------------------------------------------------------
  async transferOpenItem(
    tenantId: string,
    openItemId: string,
    toScheduleNumber: string,
    toControlNumber: string,
    toItemNumber: string,
    idempotencyKey: string,
    actor: string,
    reason: string,
  ): Promise<any> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const existing = await tx.scheduleCeremony.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) {
        if (existing.ceremonyType !== 'TRANSFER' || existing.openItemId !== openItemId) {
          throw new DuplicateCeremonyError(idempotencyKey);
        }
        return existing.result;
      }

      const item = await tx.scheduleOpenItem.findFirst({ where: { id: openItemId, tenantId } });
      if (!item) throw new OpenItemNotFoundError(openItemId);
      if (item.status === 'CLOSED') throw new OpenItemClosedError(openItemId);
      if (item.status === 'WRITTEN_OFF') throw new ItemAlreadyWrittenOffError(openItemId);

      if (toScheduleNumber !== item.scheduleNumber) {
        throw new CrossAccountTransferNotAllowedError(item.scheduleNumber, toScheduleNumber);
      }

      const moved = await tx.scheduleOpenItem.create({
        data: {
          tenantId,
          scheduleNumber: item.scheduleNumber,
          controlNumber: toControlNumber,
          itemNumber: toItemNumber,
          glAccountNumber: item.glAccountNumber,
          journalSource: item.journalSource,
          originalAmount: item.remainingBalance,
          appliedAmount: new Prisma.Decimal(0),
          remainingBalance: item.remainingBalance,
          status: 'OPEN',
          transactionDate: item.transactionDate,
          dueDate: item.dueDate,
          description: item.description,
          journalEntryId: item.journalEntryId,
          scheduleDetailId: item.scheduleDetailId,
          sourceCorrelationId: `${idempotencyKey}-transferred`,
          parentItemId: item.id,
        },
      });

      await tx.scheduleOpenItem.update({
        where: { id: item.id },
        data: { appliedAmount: item.originalAmount, remainingBalance: new Prisma.Decimal(0), status: 'CLOSED', closedAt: new Date() },
      });

      const result = { fromItemId: item.id, toItemId: moved.id, toControlNumber, toItemNumber };

      await tx.scheduleCeremony.create({
        data: { tenantId, ceremonyType: 'TRANSFER', openItemId, idempotencyKey, reason, actor, result },
      });
      await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', item.id, 'TRANSFERRED', { controlNumber: item.controlNumber, itemNumber: item.itemNumber }, result, actor, idempotencyKey);

      return result;
    });
  }

  // -------------------------------------------------------------------------
  // S029 — Write-off: closes an item as WRITTEN_OFF and posts a real journal
  // entry through gl-service (never a subledger-only deletion), per Fable
  // §3-S029/§4. The caller must supply the offsetting GL account explicitly
  // — the Fable package does not name a specific bad-debt/allowance account,
  // so one is never invented here (rule 7).
  // -------------------------------------------------------------------------
  async writeOffOpenItem(
    tenantId: string,
    openItemId: string,
    offsetAccountCode: string,
    idempotencyKey: string,
    actor: string,
    reason: string,
  ): Promise<any> {
    return withSerializableRetry(this.prisma, async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);

      const existing = await tx.scheduleCeremony.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) {
        if (existing.ceremonyType !== 'WRITEOFF' || existing.openItemId !== openItemId) {
          throw new DuplicateCeremonyError(idempotencyKey);
        }
        return existing.result;
      }

      const item = await tx.scheduleOpenItem.findFirst({ where: { id: openItemId, tenantId } });
      if (!item) throw new OpenItemNotFoundError(openItemId);
      if (item.status === 'CLOSED') throw new OpenItemClosedError(openItemId);
      if (item.status === 'WRITTEN_OFF') throw new ItemAlreadyWrittenOffError(openItemId);

      // D-CE08-02 APPROVED_IN_PRINCIPLE — SAFE_CONFIGURATION threshold.
      const config = await tx.scheduleWriteOffConfig.findFirst({ where: { tenantId } });
      if (config?.thresholdAmount != null && item.remainingBalance.gt(config.thresholdAmount)) {
        throw new WriteOffThresholdExceededError(item.remainingBalance.toFixed(2), config.thresholdAmount.toFixed(2));
      }

      // Post the write-off through the GL engine (CE-07's approved
      // JOURNAL_ENTRY_POSTED-producing path) — debit the offset account the
      // caller supplied, credit the schedule's own GL account — rather than
      // mutating the ledger directly from schedule-service.
      const journalEntryId = await this.glPostingClient.postWriteOff(tenantId, {
        scheduleNumber: item.scheduleNumber,
        controlNumber: item.controlNumber,
        glAccountNumber: item.glAccountNumber,
        offsetAccountCode,
        amount: item.remainingBalance.toFixed(2),
        description: `Schedule write-off: ${reason}`,
        idempotencyKey,
      });

      await tx.scheduleOpenItem.update({
        where: { id: item.id },
        data: {
          appliedAmount: item.originalAmount,
          remainingBalance: new Prisma.Decimal(0),
          status: 'WRITTEN_OFF',
          closedAt: new Date(),
          writeOffReason: reason,
          writeOffJournalEntryId: journalEntryId,
        },
      });

      const result = { openItemId: item.id, journalEntryId, writtenOffAmount: item.remainingBalance.toFixed(2) };

      await tx.scheduleCeremony.create({
        data: { tenantId, ceremonyType: 'WRITEOFF', openItemId, idempotencyKey, reason, actor, journalEntryId, result },
      });
      await this._audit(tx, tenantId, 'SCHEDULE_OPEN_ITEM', item.id, 'WRITTEN_OFF', { remainingBalance: item.remainingBalance.toFixed(2) }, result, actor, idempotencyKey);

      return result;
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
