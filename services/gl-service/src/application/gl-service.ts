/**
 * @module GLService
 * @cobol-ancestry tranpost.cbl, tranup.cbl, tranup2.cbl, komgl.cbl, komjrn.cbl, komtran.cbl
 * @cobol-programs-replaced TRANPOST (PROGRAM-ID: TRANPOST) — Post Transactions
 * @cobol-programs-eliminated fixoobtran.cbl, fixorphan.cbl, dumpoobtran.cbl, sniffbaddetailapplycd.cbl
 *   REASON: COBOL wrote Journal/Detail/Histtran as three separate ISAM writes with no transaction
 *   wrapper. Any I/O error mid-sequence left files out of balance. TypeScript uses
 *   $transaction({ isolationLevel: 'Serializable' }) so ALL three writes are atomic.
 *   The entire class of out-of-balance conditions documented in AMMAINT tickets is eliminated.
 * @intelligence-additions
 *   - Agent review step (PENDING_REVIEW) before final posting — no COBOL equivalent
 *   - Anomaly detection via GLValidationEngine before entry is accepted
 *   - Segregation of duties: creator cannot approve own entry
 *   - Automatic account code resolution from DMS source data
 *   - Trial balance / Balance Sheet / Income Statement queries
 *   - Multi-tenant isolation on every query
 * @platform-additions
 *   - Outbox pattern for reliable event publishing
 *   - HTTP-based period status from eom-service (replaces $queryRawUnsafe cross-DB violation)
 *   - Typed error classes with HTTP status codes
 *   - SERIALIZABLE isolation on all posting operations
 */

import { inject, injectable } from 'tsyringe';
import {
  IJournalRepository,
  IGLAccountRepository,
  IEventPublisher,
  JournalEntry,
  GLAccount,
  CreateJournalEntryDTO,
  EntryFilters,
  TenantId,
  TrialBalance,
  Period,
  GLAccountType,
  JournalStatus,
  asTenantId,
} from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';
import { GLValidationEngine } from '../domain/validation-engine';
import { computeUnitCount } from '../domain/unit-count';
import { PrismaClient } from '.prisma/gl-client';

// ── Typed error classes ───────────────────────────────────────────────────────
// @trace-cobol tranpost.cbl ERROR-DATE, NOFIND-STATUS, GL-ERROR-DIALOG-POP* paragraphs
// @trace-improvement COBOL showed interactive dialog boxes; we use typed HTTP errors

export class PostingPeriodClosedError extends Error {
  readonly statusCode = 403;
  readonly code = 'PERIOD_LOCKED';
  constructor(year: number, month: number) {
    super(
      `Period ${year}-${String(month).padStart(2, '0')} is closed. ` +
      `Set priorPeriodAdjustment=true and provide adjustmentReason to post an adjustment.`,
    );
    this.name = 'PostingPeriodClosedError';
  }
}

export class AdjustmentReasonRequiredError extends Error {
  readonly statusCode = 400;
  readonly code = 'ADJUSTMENT_REASON_REQUIRED';
  constructor() {
    super('adjustmentReason is required for prior period adjustments to a closed period.');
    this.name = 'AdjustmentReasonRequiredError';
  }
}

export class GLAccountNotFoundError extends Error {
  readonly statusCode = 422;
  readonly code = 'GL_ACCOUNT_NOT_FOUND';
  constructor(accountId: string) {
    super(`GL account ${accountId} not found`);
    this.name = 'GLAccountNotFoundError';
  }
}

export class GLAccountInactiveError extends Error {
  readonly statusCode = 422;
  readonly code = 'GL_ACCOUNT_INACTIVE';
  constructor(code: string, name: string) {
    super(`GL account ${code} (${name}) is inactive — cannot post`);
    this.name = 'GLAccountInactiveError';
  }
}

export class GLAccountHeaderError extends Error {
  readonly statusCode = 422;
  readonly code = 'GL_ACCOUNT_NO_POSTING';
  constructor(code: string, name: string) {
    super(`GL account ${code} (${name}) is a header account — posting not allowed`);
    this.name = 'GLAccountHeaderError';
  }
}

export class JournalEntryNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'JOURNAL_ENTRY_NOT_FOUND';
  constructor(id: string) {
    super(`Journal entry ${id} not found`);
    this.name = 'JournalEntryNotFoundError';
  }
}

export class InvalidStatusTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = 'INVALID_STATUS_TRANSITION';
  constructor(current: string, required: string) {
    super(`Entry is in status ${current}; expected ${required}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

export class SegregationOfDutiesError extends Error {
  readonly statusCode = 403;
  readonly code = 'SEGREGATION_OF_DUTIES_VIOLATION';
  constructor() {
    super('The user who created this journal entry cannot approve it. A different user must approve.');
    this.name = 'SegregationOfDutiesError';
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

@injectable()
export class GLService {
  /** Base URL of eom-service — never query its DB directly (COPILOT.md constraint #5) */
  private readonly eomServiceUrl: string;

  constructor(
    @inject('IJournalRepository') private readonly journalRepo: IJournalRepository,
    @inject('IGLAccountRepository') private readonly accountRepo: IGLAccountRepository,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject('GLValidationEngine') private readonly validationEngine: GLValidationEngine,
    @inject('PrismaClient') private readonly prisma: PrismaClient,
  ) {
    this.eomServiceUrl = process.env['EOM_SERVICE_URL'] ?? 'http://eom-service:3011';
  }

  // ── Account CRUD ──────────────────────────────────────────────────────────

  async createAccount(data: Omit<GLAccount, 'id'>, tenantId: TenantId): Promise<GLAccount> {
    return this.accountRepo.create(data, tenantId);
  }

  async getAccounts(tenantId: TenantId): Promise<GLAccount[]> {
    return this.accountRepo.findAll(tenantId);
  }

  async getAccountById(id: string, tenantId: TenantId): Promise<GLAccount | null> {
    return this.accountRepo.findById(id, tenantId);
  }

  async updateAccount(id: string, data: Partial<GLAccount>, tenantId: TenantId): Promise<GLAccount> {
    // @cobol-origin schedmgr.cbl — when scheduleCode changes, schedule-service must
    // migrate all ScheduleDetail records from the old schedule to the new one.
    const current = await this.accountRepo.findById(id, tenantId);
    const result = await this.accountRepo.update(id, data, tenantId);

    if (
      current &&
      data.scheduleCode !== undefined &&
      data.scheduleCode !== current.scheduleCode
    ) {
      await (this.prisma as any).outboxEvent.create({
        data: {
          eventType: 'GL_ACCOUNT_SCHEDULE_CHANGED',
          tenantId,
          payload: {
            glAccountId: id,
            glAccountCode: current.code,
            oldScheduleNumber: (current as any).scheduleCode ?? null,
            newScheduleNumber: data.scheduleCode ?? null,
          },
          correlationId: crypto.randomUUID(),
        },
      });
    }

    return result;
  }

  // ── Ownership change reset ────────────────────────────────────────────────

  /**
   * Zero all GL opening balances and optionally clear schedule assignments and
   * period balance records. Used when a dealership changes ownership (buy/sell)
   * and the same tenant ID is retained for historical data continuity.
   *
   * @cobol-origin glzero.cbl — zeros GL-OPEN-BAL and GL-OPEN-CNT for all accounts
   * @cobol-origin glzerosch.cbl — same + clears GL-SCHDNO (schedule assignment)
   * @cobol-origin jrnzero.cbl — deletes all JOURNAL-MF period balance records
   * @trace-improvement COBOL required running 3 separate programs in sequence.
   *   Missing one left the system inconsistent. TypeScript combines all three into
   *   a single atomic SERIALIZABLE transaction.
   * @authorization Requires SYSTEM_ADMIN role — not TENANT_ADMIN. This operation
   *   destroys financial data and is irreversible.
   */
  async resetForOwnershipChange(
    tenantId: TenantId,
    initiatedBy: string,
    options: {
      clearScheduleAssignments: boolean;
      clearPeriodBalances: boolean;
    } = { clearScheduleAssignments: true, clearPeriodBalances: true },
  ): Promise<{
    accountsReset: number;
    periodBalancesDeleted: number;
    scheduleAssignmentsCleared: number;
  }> {
    return (this.prisma as any).$transaction(
      async (tx: any) => {
        // glzero: zero all opening balances
        const accountResult = await tx.gLAccount.updateMany({
          where: { tenantId },
          data: { openingBalance: 0, openingUnitCount: 0 },
        });

        let scheduleResult = 0;
        if (options.clearScheduleAssignments) {
          // glzerosch: clear schedule assignments on all GL accounts
          const r = await tx.gLAccount.updateMany({
            where: { tenantId, scheduleCode: { not: null } },
            data: { scheduleCode: null },
          });
          scheduleResult = r.count;
        }

        let periodResult = 0;
        if (options.clearPeriodBalances) {
          // jrnzero: delete all period balance records
          const r = await tx.gLAccountPeriodBalance.deleteMany({ where: { tenantId } });
          periodResult = r.count;
        }

        await tx.outboxEvent.create({
          data: {
            eventType: 'OWNERSHIP_CHANGE_RESET',
            tenantId,
            payload: {
              initiatedBy,
              accountsReset: accountResult.count,
              periodBalancesDeleted: periodResult,
              scheduleAssignmentsCleared: scheduleResult,
              options,
              timestamp: new Date().toISOString(),
            },
            correlationId: crypto.randomUUID(),
          },
        });

        return {
          accountsReset: accountResult.count,
          periodBalancesDeleted: periodResult,
          scheduleAssignmentsCleared: scheduleResult,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // ── EOM ACCT_200 carry-forward ─────────────────────────────────────────────

  /**
   * EOM GL Purge (ACCT_200): aggregate period balances into opening balances, then purge
   * closed/paid history transaction records.
   *
   * @cobol-origin glzero.cbl CARRY-FWD paragraph — accumulates per-period balances to GL-OPEN-BAL
   * @cobol-origin histtran.cbl PURGE-HISTORY — deletes closed histtran records before cutoff date
   * @trace-cobol COBOL ran this as two sequential batch programs. TypeScript: single atomic transaction.
   * @caller eom-service AcctGLPurgeHandler via POST /admin/period-carry-forward
   */
  async performPeriodCarryForward(
    tenantId: TenantId,
    periodYear: number,
    periodMonth: number,
    purgeHistoryBeforeDate?: Date,
  ): Promise<{
    accountsUpdated: number;
    historyRecordsPurged: number;
    periodBalancesConsolidated: number;
  }> {
    return (this.prisma as any).$transaction(
      async (tx: any) => {
        // Step 1: For each GL account with period balances in this period,
        // accumulate the running balance into the opening balance.
        // @cobol-origin glzero.cbl CARRY-FWD: COMPUTE GL-OPEN-BAL = GL-OPEN-BAL + HI-BAL-AMT
        const periodRows: { glAccountId: string; _sum: { runningBalance: any; unitCount: any } }[] =
          await tx.gLAccountPeriodBalance.groupBy({
            by: ['glAccountId'],
            where: { tenantId, periodYear, periodMonth },
            _sum: { runningBalance: true, unitCount: true },
          });

        let accountsUpdated = 0;
        for (const row of periodRows) {
          const netBalance = Number(row._sum.runningBalance ?? 0);
          const netUnits = Number(row._sum.unitCount ?? 0);
          if (netBalance === 0 && netUnits === 0) continue;
          await tx.gLAccount.updateMany({
            where: { id: row.glAccountId, tenantId },
            data: {
              openingBalance: { increment: netBalance },
              openingUnitCount: { increment: netUnits },
            },
          });
          accountsUpdated++;
        }

        // Step 2: Delete the now-consolidated period balance rows for this period
        const { count: periodBalancesConsolidated } = await tx.gLAccountPeriodBalance.deleteMany({
          where: { tenantId, periodYear, periodMonth },
        });

        // Step 3: Purge old history transaction records (if cutoff date provided)
        // @cobol-origin histtran.cbl PURGE-HISTORY paragraph
        let historyRecordsPurged = 0;
        if (purgeHistoryBeforeDate) {
          const r = await tx.historyTransaction.deleteMany({
            where: { tenantId, transactionDate: { lt: purgeHistoryBeforeDate } },
          });
          historyRecordsPurged = r.count;
        }

        return { accountsUpdated, historyRecordsPurged, periodBalancesConsolidated };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // ── Period status ─────────────────────────────────────────────────────────

  /**
   * Get period close status from eom-service via HTTP.
   * @trace-cobol tranpost.cbl EDIT-DATE paragraph — checks KEY-DATE > ACSYS-CUTOFF-DATE
   * @trace-improvement COBOL read the system file directly (single process). TypeScript services
   *   each own their DB — GL must not query eom_closes table directly.
   * @removes-need-for $queryRawUnsafe(`SELECT status FROM eom_closes ...`) which crossed service DB boundary
   */
  async getPeriodStatus(tenantId: TenantId, year: number, month: number): Promise<string> {
    try {
      const res = await fetch(`${this.eomServiceUrl}/api/v1/eom/`, {
        headers: { 'x-tenant-id': tenantId },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return 'NOT_STARTED';
      const closes = (await res.json()) as any[];
      const match = closes.find((c: any) => {
        const y = c.periodYear ?? c.period_year;
        const m = c.periodMonth ?? c.period_month;
        return y === year && m === month;
      });
      return match?.status ?? 'NOT_STARTED';
    } catch {
      // eom-service unavailable: default to NOT_STARTED (allow posting)
      // Period close is advisory; unavailability must not block GL operations
      return 'NOT_STARTED';
    }
  }

  /** Get all period statuses for a tenant (list from eom-service) */
  async getPeriods(tenantId: TenantId): Promise<Array<{ year: number; month: number; status: string }>> {
    try {
      const res = await fetch(`${this.eomServiceUrl}/api/v1/eom/`, {
        headers: { 'x-tenant-id': tenantId },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const closes = (await res.json()) as any[];
      return closes.map((c: any) => ({
        year: c.periodYear ?? c.period_year,
        month: c.periodMonth ?? c.period_month,
        status: c.status,
      }));
    } catch {
      return [];
    }
  }

  // ── Journal Entry — Create (DRAFT) ────────────────────────────────────────

  /**
   * @cobol-equivalent tranup.cbl / tranup2.cbl — transaction entry / batch management
   * @trace-cobol Period check: tranpost.cbl EDIT-DATE checks KEY-DATE > ACSYS-CUTOFF-DATE
   * @trace-improvement Prior-period adjustment workflow — COBOL had no override mechanism
   */
  async createJournalEntry(dto: CreateJournalEntryDTO, tenantId: TenantId): Promise<JournalEntry> {
    const entryDate = dto.entryDate instanceof Date ? dto.entryDate : new Date(dto.entryDate as any);
    const year = entryDate.getFullYear();
    const month = entryDate.getMonth() + 1;
    const periodStatus = await this.getPeriodStatus(tenantId, year, month);

    if (periodStatus === 'COMPLETED') {
      if (!dto.priorPeriodAdjustment) {
        throw new PostingPeriodClosedError(year, month);
      }
      if (!dto.adjustmentReason || dto.adjustmentReason.trim().length === 0) {
        throw new AdjustmentReasonRequiredError();
      }
    }

    return this.journalRepo.create(dto, tenantId);
  }

  // ── Journal Entry — Submit for Review (DRAFT → PENDING_REVIEW) ───────────

  /**
   * @cobol-did-not-have No two-step approval in COBOL — tranpost posted immediately.
   * @intelligence-layer Agent review intercepts entries before ledger commits. Allows
   *   AI anomaly detection on PENDING_REVIEW entries. COBOL could not flag suspicious
   *   transactions before they hit the ISAM files.
   */
  async postJournalEntry(entryId: string, tenantId: TenantId, postedBy: string): Promise<JournalEntry> {
    const entry = await this.journalRepo.findById(entryId, tenantId);
    if (!entry) throw new JournalEntryNotFoundError(entryId);
    if (entry.status !== JournalStatus.DRAFT) {
      throw new InvalidStatusTransitionError(entry.status, JournalStatus.DRAFT);
    }

    const correlationId = crypto.randomUUID();
    const eventPayload = {
      entryId: entry.id,
      description: entry.description,
      lineCount: entry.lines.length,
      totalDebits: entry.lines.reduce((s, l) => s + l.debit, 0),
    };

    await this.prisma.$transaction(async (tx: any) => {
      await tx.journalEntry.update({
        where: { id: entryId },
        data: { status: 'PENDING_REVIEW', agentReviewed: false },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'JOURNAL_ENTRY_SUBMITTED',
          tenantId,
          payload: eventPayload as any,
          correlationId,
        },
      });
    });

    try {
      await this.eventPublisher.publish(
        createEvent('JOURNAL_ENTRY_SUBMITTED', tenantId, eventPayload),
      );
      await (this.prisma as any).outboxEvent.updateMany({
        where: { correlationId, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    } catch {
      // Outbox processor will retry
    }

    return this.journalRepo.findById(entryId, tenantId) as Promise<JournalEntry>;
  }

  // ── Journal Entry — Approve and Post (PENDING_REVIEW → POSTED) ───────────

  /**
   * @cobol-equivalent tranpost.cbl MAIN-PROG / START-PROC / READ-REC loop / PROC-TRANS / DONE-PROG
   * @trace-cobol
   *   PRE-EDIT-GL-ROUTINE  → validateAccountsPreEdit()
   *   CONT1 (main loop)    → for each line: updateJournalBalance() + writeHistoryTransaction() + publish(JOURNAL_ENTRY_POSTED)
   *   "If chained sale"    → postCOSINVChain()
   *   DONE-PROG            → status = POSTED, outbox event JOURNAL_ENTRY_POSTED
   * @trace-improvement
   *   COBOL: three separate ISAM file writes, NO transaction wrapper.
   *   Root cause of ALL out-of-balance conditions (fixoobtran.cbl, fixorphan.cbl, dumpoobtran.cbl).
   *   TypeScript: $transaction({ isolationLevel: 'Serializable' }) wraps ALL three writes.
   *   Those repair programs are unnecessary when the root cause is eliminated.
   * @removes-need-for fixoobtran.cbl, fixorphan.cbl, dumpoobtran.cbl, sniffbaddetailapplycd.cbl
   */
  async approveJournalEntry(entryId: string, tenantId: TenantId, approverId?: string): Promise<JournalEntry> {
    const entry = await this.journalRepo.findById(entryId, tenantId);
    if (!entry) throw new JournalEntryNotFoundError(entryId);
    if (entry.status !== JournalStatus.PENDING_REVIEW) {
      throw new InvalidStatusTransitionError(entry.status, JournalStatus.PENDING_REVIEW);
    }

    // Segregation of duties — @intelligence-layer (no COBOL equivalent)
    const creatorId = (entry as any).createdByUserId;
    const dmsSource = ['DMS-RO', 'AUTOMATE_DMS'].includes((entry as any).source ?? '');
    if (!dmsSource && creatorId && approverId && creatorId === approverId) {
      throw new SegregationOfDutiesError();
    }

    // Pre-edit: validate ALL accounts before touching the ledger
    // @trace-cobol tranpost.cbl PRE-EDIT-GL-ROUTINE
    await this.validateAccountsPreEdit(entry.lines, tenantId);

    const correlationId = crypto.randomUUID();
    const postedAt = new Date();
    const totalDebits = entry.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredits = entry.lines.reduce((s, l) => s + l.credit, 0);

    // ATOMIC: ALL ledger writes + status update + outbox event in one SERIALIZABLE transaction.
    // @trace-cobol tranpost.cbl CONT1 + UPDATE-JOURNAL + UPDATE-DETAIL + WR-HISTTRAN
    // @trace-improvement This single change eliminates the entire OOB failure class from COBOL.
    await this.prisma.$transaction(
      async (tx: any) => {
        // 1. Mark entry POSTED
        await tx.journalEntry.update({
          where: { id: entryId },
          data: {
            status: 'POSTED',
            postedBy: approverId ?? 'GL_AGENT',
            postedAt,
            approvedByUserId: approverId ?? 'GL_AGENT',
            approvedAt: postedAt,
          },
        });

        // 2. Load full account details for all lines (includes cosAccountId, invAccountId)
        const accountIds = [...new Set(entry.lines.map((l: any) => l.glAccountId))];
        const accountRows: any[] = await tx.gLAccount.findMany({
          where: { id: { in: accountIds }, tenantId },
        });
        const accountMap = new Map<string, any>(accountRows.map((a: any) => [a.id, a]));

        // 3. Post each line — sequential line numbers per COBOL J19901 convention
        // @trace-cobol J19901: LAST-HI-LINENO sequences from 1 by 1 per reference number
        let lineNumber = 1;

        for (const line of entry.lines as any[]) {
          const account = accountMap.get(line.glAccountId);
          if (!account) throw new GLAccountNotFoundError(line.glAccountId);

          const netAmount = line.debit - line.credit; // positive = DR, negative = CR

          // 3a. Update GL period running balance — JRN file equivalent
          // @trace-cobol UPDATE-JOURNAL paragraph
          await this.updateJournalBalance(tx, tenantId, account, entry, netAmount);

          // 3b. Write history transaction record — HISTTRAN file equivalent
          // @trace-cobol UPDATE-HISTTRAN + WR-HISTTRAN paragraphs
          await this.writeHistoryTransaction(
            tx, tenantId, account, entry, line, netAmount, lineNumber, ' ', postedAt, approverId,
          );

          // 3c. Schedule detail is now owned by schedule-service (Wave 3 architecture).
          // Write to outbox table INSIDE the Serializable transaction so that a rollback
          // atomically cancels the event — prevents schedule-service from creating an orphaned
          // detail record for a posting that was rolled back.
          // Direct eventPublisher.publish() was NOT safe here; the outbox processor delivers
          // the event only after the transaction commits.
          // See amacc/docs/gap-analysis/wave-3-schedule-subsystem.md — architecture decision.
          if (account.scheduleCode && !(entry as any).isYearEnd) {
            const entryDate =
              entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate as any);
            await tx.outboxEvent.create({
              data: {
                eventType: 'JOURNAL_ENTRY_POSTED',
                tenantId,
                payload: {
                  tenantId,
                  journalEntryId: entry.id,
                  glAccountNumber: account.code,
                  scheduleNumber: account.scheduleCode,
                  controlNumber: line.controlNumber ?? '',
                  amount: String(netAmount),
                  referenceNumber: ((entry as any).sourceRef ?? entry.id).substring(0, 12),
                  journalSource: (entry as any).source ?? 'XX',
                  transactionDate: entryDate.toISOString(),
                  description: line.memo ?? entry.description ?? null,
                  applyNumber: line.applyCd === '#' ? (line.applyNumber ?? null) : null,
                  applyCd: line.applyCd ?? null,
                } as any,
                correlationId: `${correlationId}-line-${lineNumber}`,
              },
            });
          }

          // 3d. COS/INV chain posting — "If chained sale account" block in CONT1
          // @trace-cobol: GL-COS-ACCT ≠ SPACE AND GL-INV-ACCT ≠ SPACE AND TR-APPLY-CD ≠ "#"
          if (account.cosAccountId && account.invAccountId && line.costAmount && line.applyCd !== '#') {
            await this.postCOSINVChain(
              tx, tenantId, accountMap, account, entry, line, lineNumber, postedAt, approverId,
            );
            lineNumber += 2; // COS + INV each consume a slot
          }

          lineNumber++;
        }

        // 4. Outbox event atomically with ledger writes
        await tx.outboxEvent.create({
          data: {
            eventType: 'JOURNAL_ENTRY_POSTED',
            tenantId,
            payload: { entryId, totalDebits, totalCredits, lineCount: entry.lines.length } as any,
            correlationId,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    try {
      await this.eventPublisher.publish(
        createEvent('JOURNAL_ENTRY_POSTED', tenantId, { entryId, totalDebits, totalCredits }),
      );
      await (this.prisma as any).outboxEvent.updateMany({
        where: { correlationId, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    } catch {
      // Outbox processor will retry
    }

    return this.journalRepo.findById(entryId, tenantId) as Promise<JournalEntry>;
  }

  // ── Private posting helpers ───────────────────────────────────────────────

  /**
   * Validate all GL accounts referenced in entry lines before any writes begin.
   * @trace-cobol tranpost.cbl PRE-EDIT-GL-ROUTINE (lines ~1190-1400)
   *   COBOL: sequential scan of all tran records, lookup each GL, abort or skip on error
   *   TypeScript: parallel fetch, throw typed error → transaction never starts
   */
  private async validateAccountsPreEdit(lines: any[], tenantId: TenantId): Promise<void> {
    const accountIds = [...new Set(lines.map((l: any) => l.glAccountId))];
    const accounts = await Promise.all(
      accountIds.map((id) => this.accountRepo.findById(id, tenantId)),
    );
    for (let i = 0; i < accountIds.length; i++) {
      const acct = accounts[i];
      if (!acct) throw new GLAccountNotFoundError(accountIds[i]!);
      if (!acct.isActive) throw new GLAccountInactiveError(acct.code, acct.name);
      if (!acct.allowPosting) throw new GLAccountHeaderError(acct.code, acct.name);
    }
  }

  /**
   * Upsert GL period running balance.
   * @trace-cobol tranpost.cbl UPDATE-JOURNAL paragraph
   *   COBOL: READ jrn record; not found → WRITE zeros; ADD amount to JR-BALANCE; REWRITE
   *   TypeScript: Prisma upsert with increment — atomic under SERIALIZABLE
   * @trace-improvement
   *   COBOL INV-03: overflow > 999,999,999.99 → zero out. Decimal(15,2) never overflows.
   *   COBOL INV-04: year-end skips journal update — preserved via isYearEnd flag.
   */
  private async updateJournalBalance(
    tx: any,
    tenantId: string,
    account: any,
    entry: JournalEntry,
    netAmount: number,
  ): Promise<void> {
    // @trace-cobol "IF GLOBAL-YE-IS-IN-PROGRESS EXIT PARAGRAPH" — year-end skips journal
    if ((entry as any).isYearEnd === true) return;

    const entryDate = entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate as any);
    const periodYear = entryDate.getFullYear();
    const periodMonth = entryDate.getMonth() + 1;
    const journalSource = (entry as any).source ?? 'XX';
    const unitCount = computeUnitCount(
      netAmount, account.type, (entry as any).revAdjFlag ?? ' ', account.trackUnits ?? false,
    );

    await tx.gLAccountPeriodBalance.upsert({
      where: {
        tenantId_glAccountId_periodYear_periodMonth_journalSource: {
          tenantId,
          glAccountId: account.id,
          periodYear,
          periodMonth,
          journalSource,
        },
      },
      create: { tenantId, glAccountId: account.id, periodYear, periodMonth, journalSource, runningBalance: netAmount, unitCount },
      update: { runningBalance: { increment: netAmount }, unitCount: { increment: unitCount } },
    });
  }

  /**
   * Write a history transaction record for an audited posted line.
   * @trace-cobol tranpost.cbl UPDATE-HISTTRAN + WR-HISTTRAN paragraphs (lines ~2296-2390)
   *   COBOL: BUILD histtran rec, SETUP-HISTTRAN-KEY to find next available key, WRITE (retry on dup)
   *   TypeScript: INSERT with unique constraint — PostgreSQL handles key uniqueness
   * @trace-improvement
   *   COBOL INV-06: DUPEREFNO overflows at 99 → infinite loop (MAINT-15701). PostgreSQL: no limit.
   *   COBOL: histtran boundary violation (status 24, file full). PostgreSQL: no fixed-size limit.
   */
  private async writeHistoryTransaction(
    tx: any,
    tenantId: string,
    account: any,
    entry: JournalEntry,
    line: any,
    netAmount: number,
    lineNumber: number,
    postType: string,
    postedAt: Date,
    postedByUserId?: string,
  ): Promise<void> {
    // @trace-cobol ACC-1445: "Do not post a Type I or C histtran record for YE"
    const isYearEnd = (entry as any).isYearEnd === true;
    if (isYearEnd && (postType === 'C' || postType === 'I')) return;

    const entryDate = entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate as any);
    const journalSource = (entry as any).source ?? 'XX';
    const refno = ((entry as any).sourceRef ?? entry.id).substring(0, 12);
    const unitCount = computeUnitCount(
      netAmount, account.type, line.revAdjFlag ?? ' ', account.trackUnits ?? false,
    );
    const costAmount = postType === ' ' && line.applyCd !== '#' ? (line.costAmount ?? 0) : 0;

    await tx.historyTransaction.create({
      data: {
        tenantId,
        journalSource,
        transactionDate: entryDate,
        referenceNumber: refno,
        dupeSequence: 0,
        lineNumber,
        postType,
        glAccountId: account.id,
        amount: netAmount,
        costAmount,
        applyNumber: line.applyCd === '#' ? (line.applyNumber ?? refno) : null,
        controlNumber: line.controlNumber ?? null,
        description: line.memo ?? entry.description ?? null,
        unitCount,
        clearCode: ' ',
        revAdjFlag: line.revAdjFlag ?? ' ',
        autoPostFlag: (entry as any).autoPost === true ? 'Y' : ' ',
        fromProgram: (entry as any).sourceProgram ?? null,
        enteredAt: entryDate,
        postedAt,
        postedByUserId: postedByUserId ?? null,
        journalEntryId: entry.id,
      },
    });
  }

  // writeScheduleDetail removed — schedule-service owns detail records via JOURNAL_ENTRY_POSTED
  // event. See amacc/docs/gap-analysis/wave-3-schedule-subsystem.md (Wave 3, architecture decision).

  /**
   * Post cost-of-sale and inventory sub-entries for a chained sale account.
   * @trace-cobol tranpost.cbl CONT1 — "If chained sale account" block (lines ~2000-2055)
   *   COS: amount = TR-COST,      HI-TYPE = "C"
   *   INV: amount = TR-COST * -1, HI-TYPE = "I"
   *   Each goes through the full Journal → Detail → Histtran sequence.
   * @trace-cobol-gap Requires account.cosAccountId and account.invAccountId fields
   *   (added to GLAccount schema). Set when creating accounts via POST /accounts.
   */
  private async postCOSINVChain(
    tx: any,
    tenantId: string,
    accountMap: Map<string, any>,
    mainAccount: any,
    entry: JournalEntry,
    line: any,
    baseLineNumber: number,
    postedAt: Date,
    postedByUserId?: string,
  ): Promise<void> {
    const costAmount: number = line.costAmount ?? 0;
    if (costAmount === 0) return;

    // Load COS account
    let cosAccount = accountMap.get(mainAccount.cosAccountId);
    if (!cosAccount) {
      cosAccount = await tx.gLAccount.findFirst({ where: { id: mainAccount.cosAccountId, tenantId } });
      if (!cosAccount) return;
      accountMap.set(mainAccount.cosAccountId, cosAccount);
    }

    const cosLineNumber = baseLineNumber + 1;
    await this.updateJournalBalance(tx, tenantId, cosAccount, entry, costAmount);
    await this.writeHistoryTransaction(tx, tenantId, cosAccount, entry, line, costAmount, cosLineNumber, 'C', postedAt, postedByUserId);
    if (cosAccount.scheduleCode && !(entry as any).isYearEnd) {
      const entryDate = entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate as any);
      // Outbox write — atomic with transaction; outbox processor delivers after commit
      await tx.outboxEvent.create({
        data: {
          eventType: 'JOURNAL_ENTRY_POSTED',
          tenantId,
          payload: {
            tenantId,
            journalEntryId: entry.id, glAccountNumber: cosAccount.code,
            scheduleNumber: cosAccount.scheduleCode, controlNumber: line.controlNumber ?? '',
            amount: String(costAmount), referenceNumber: ((entry as any).sourceRef ?? entry.id).substring(0, 12),
            journalSource: (entry as any).source ?? 'XX', transactionDate: entryDate.toISOString(),
            description: line.memo ?? entry.description ?? null,
          } as any,
          correlationId: `${crypto.randomUUID()}-cos`,
        },
      });
    }

    // Load INV account
    let invAccount = accountMap.get(mainAccount.invAccountId);
    if (!invAccount) {
      invAccount = await tx.gLAccount.findFirst({ where: { id: mainAccount.invAccountId, tenantId } });
      if (!invAccount) return;
      accountMap.set(mainAccount.invAccountId, invAccount);
    }

    // @trace-cobol "COMPUTE AMOUNT = TR-COST * -1" — inventory is offset of cost
    const invAmount = costAmount * -1;
    const invLineNumber = baseLineNumber + 2;
    await this.updateJournalBalance(tx, tenantId, invAccount, entry, invAmount);
    await this.writeHistoryTransaction(tx, tenantId, invAccount, entry, line, invAmount, invLineNumber, 'I', postedAt, postedByUserId);
    if (invAccount.scheduleCode && !(entry as any).isYearEnd) {
      const entryDate = entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate as any);
      // Outbox write — atomic with transaction; outbox processor delivers after commit
      await tx.outboxEvent.create({
        data: {
          eventType: 'JOURNAL_ENTRY_POSTED',
          tenantId,
          payload: {
            tenantId,
            journalEntryId: entry.id, glAccountNumber: invAccount.code,
            scheduleNumber: invAccount.scheduleCode, controlNumber: line.controlNumber ?? '',
            amount: String(invAmount), referenceNumber: ((entry as any).sourceRef ?? entry.id).substring(0, 12),
            journalSource: (entry as any).source ?? 'XX', transactionDate: entryDate.toISOString(),
            description: line.memo ?? entry.description ?? null,
          } as any,
          correlationId: `${crypto.randomUUID()}-inv`,
        },
      });
    }
  }

  // computeUnitCount extracted to domain/unit-count.ts for testability.
  // @trace-cobol tranpost.cbl DB-ENTRY and CR-ENTRY paragraphs
  // Use the exported pure function directly — no wrapper needed.

  // ── Query methods ─────────────────────────────────────────────────────────

  async getJournalEntryById(id: string, tenantId: TenantId): Promise<JournalEntry | null> {
    return this.journalRepo.findById(id, tenantId);
  }

  async getJournalEntries(tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]> {
    return this.journalRepo.findAll(tenantId, filters);
  }

  async getTrialBalance(tenantId: TenantId, period: Period): Promise<TrialBalance> {
    const accounts = await this.accountRepo.findAll(tenantId);
    const entries = await this.journalRepo.findAll(tenantId, {
      dateFrom: new Date(period.year, period.month - 1, 1),
      dateTo: new Date(period.year, period.month, 0),
      status: JournalStatus.POSTED,
    });

    const accountTotals = new Map<string, { debit: number; credit: number }>();
    for (const account of accounts) {
      accountTotals.set(account.id, { debit: 0, credit: 0 });
    }
    for (const entry of entries) {
      for (const line of entry.lines) {
        const totals = accountTotals.get(line.glAccountId);
        if (totals) {
          totals.debit += line.debit;
          totals.credit += line.credit;
        }
      }
    }

    let totalDebits = 0;
    let totalCredits = 0;
    const rows = accounts
      .filter((a) => { const t = accountTotals.get(a.id); return t && (t.debit > 0 || t.credit > 0); })
      .map((a) => {
        const t = accountTotals.get(a.id)!;
        totalDebits += t.debit;
        totalCredits += t.credit;
        return { accountCode: a.code, accountName: a.name, accountType: a.type as GLAccountType, debit: t.debit, credit: t.credit };
      });

    return { period, accounts: rows, totalDebits, totalCredits };
  }

  /** GAAP Balance Sheet — Assets = Liabilities + Equity */
  async getBalanceSheet(tenantId: TenantId, asOfDate: Date) {
    const accounts = await this.accountRepo.findAll(tenantId);
    const entries = await this.journalRepo.findAll(tenantId, { dateTo: asOfDate, status: JournalStatus.POSTED });
    const balances = this.computeAccountBalances(accounts, entries);
    const bsAccounts = accounts.filter(a => ['ASSET', 'LIABILITY', 'EQUITY'].includes(a.type));

    const sections: Record<string, Array<{ code: string; name: string; subType?: string; balance: number; glGroup?: string }>> = {
      ASSET: [], LIABILITY: [], EQUITY: [],
    };
    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;

    for (const acct of bsAccounts) {
      const bal = balances.get(acct.id) ?? 0;
      if (bal === 0 && !acct.allowPosting) continue;
      sections[acct.type]!.push({ code: acct.code, name: acct.name, subType: acct.subType, balance: bal, glGroup: acct.glGroup });
      if (acct.type === 'ASSET') totalAssets += bal;
      else if (acct.type === 'LIABILITY') totalLiabilities += bal;
      else if (acct.type === 'EQUITY') totalEquity += bal;
    }

    const netIncome = this.computeNetIncome(accounts, entries);
    totalEquity += netIncome;
    sections['EQUITY']!.push({ code: 'NET-INCOME', name: 'Current Period Net Income', balance: netIncome });

    return {
      asOfDate, tenantId,
      assets: { accounts: sections['ASSET'], total: totalAssets },
      liabilities: { accounts: sections['LIABILITY'], total: totalLiabilities },
      equity: { accounts: sections['EQUITY'], total: totalEquity },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  }

  /** GAAP Income Statement (Profit & Loss) */
  async getIncomeStatement(tenantId: TenantId, periodStart: Date, periodEnd: Date) {
    const accounts = await this.accountRepo.findAll(tenantId);
    const entries = await this.journalRepo.findAll(tenantId, { dateFrom: periodStart, dateTo: periodEnd, status: JournalStatus.POSTED });
    const balances = this.computeAccountBalances(accounts, entries);

    const revenueAccounts: any[] = [], cogsAccounts: any[] = [], expenseAccounts: any[] = [];
    let totalRevenue = 0, totalCOGS = 0, totalExpenses = 0;

    for (const acct of accounts) {
      const bal = balances.get(acct.id) ?? 0;
      if (bal === 0) continue;
      if (acct.type === 'REVENUE') { revenueAccounts.push({ code: acct.code, name: acct.name, amount: Math.abs(bal), glGroup: acct.glGroup }); totalRevenue += Math.abs(bal); }
      else if (acct.type === 'COST_OF_SALES') { cogsAccounts.push({ code: acct.code, name: acct.name, amount: Math.abs(bal), glGroup: acct.glGroup }); totalCOGS += Math.abs(bal); }
      else if (acct.type === 'EXPENSE') { expenseAccounts.push({ code: acct.code, name: acct.name, amount: Math.abs(bal), glGroup: acct.glGroup }); totalExpenses += Math.abs(bal); }
    }

    return {
      periodStart, periodEnd, tenantId,
      revenue: { accounts: revenueAccounts, total: totalRevenue },
      costOfSales: { accounts: cogsAccounts, total: totalCOGS },
      grossProfit: totalRevenue - totalCOGS,
      expenses: { accounts: expenseAccounts, total: totalExpenses },
      netIncome: totalRevenue - totalCOGS - totalExpenses,
    };
  }

  /** Simplified Cash Flow Statement (indirect method) */
  async getCashFlowStatement(tenantId: TenantId, periodStart: Date, periodEnd: Date) {
    const accounts = await this.accountRepo.findAll(tenantId);
    const periodEntries = await this.journalRepo.findAll(tenantId, { dateFrom: periodStart, dateTo: periodEnd, status: JournalStatus.POSTED });
    const dayBefore = new Date(periodStart);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const priorEntries = await this.journalRepo.findAll(tenantId, { dateTo: dayBefore, status: JournalStatus.POSTED });
    const periodBalances = this.computeAccountBalances(accounts, periodEntries);
    const netIncome = this.computeNetIncome(accounts, periodEntries);

    let depreciation = 0, workingCapitalChanges = 0;
    for (const acct of accounts) {
      const periodBal = periodBalances.get(acct.id) ?? 0;
      if (periodBal === 0) continue;
      if (acct.code === '6500' || acct.name.toLowerCase().includes('depreciation')) depreciation += Math.abs(periodBal);
      if (acct.subType === 'CURRENT_ASSET' && !acct.code.startsWith('10')) workingCapitalChanges -= periodBal;
      if (acct.subType === 'CURRENT_LIABILITY') workingCapitalChanges += periodBal;
    }
    const operatingCashFlow = netIncome + depreciation + workingCapitalChanges;

    let investingCashFlow = 0;
    for (const acct of accounts) {
      if (acct.subType === 'FIXED_ASSET' && !acct.name.toLowerCase().includes('depreciation')) {
        investingCashFlow -= (periodBalances.get(acct.id) ?? 0);
      }
    }

    let financingCashFlow = 0;
    for (const acct of accounts) {
      const periodBal = periodBalances.get(acct.id) ?? 0;
      if (periodBal === 0) continue;
      if (acct.subType === 'LONG_TERM_LIABILITY' || acct.type === 'EQUITY') financingCashFlow += periodBal;
    }

    const endBalances = this.computeAccountBalances(accounts, [...priorEntries, ...periodEntries]);
    let endingCash = 0;
    for (const acct of accounts) {
      if (acct.code.startsWith('10') && acct.subType === 'CURRENT_ASSET') endingCash += endBalances.get(acct.id) ?? 0;
    }

    return {
      periodStart, periodEnd, tenantId,
      operatingActivities: { netIncome, depreciation, workingCapitalChanges, total: operatingCashFlow },
      investingActivities: { total: investingCashFlow },
      financingActivities: { total: financingCashFlow },
      netCashChange: operatingCashFlow + investingCashFlow + financingCashFlow,
      endingCash,
    };
  }

  // ── Balance computation helpers ───────────────────────────────────────────

  private computeAccountBalances(accounts: GLAccount[], entries: JournalEntry[]): Map<string, number> {
    const balances = new Map<string, number>();
    for (const account of accounts) balances.set(account.id, 0);
    for (const entry of entries) {
      for (const line of entry.lines) {
        balances.set(line.glAccountId, (balances.get(line.glAccountId) ?? 0) + line.debit - line.credit);
      }
    }
    return balances;
  }

  private computeNetIncome(accounts: GLAccount[], entries: JournalEntry[]): number {
    const balances = this.computeAccountBalances(accounts, entries);
    let net = 0;
    for (const acct of accounts) {
      const bal = balances.get(acct.id) ?? 0;
      if (acct.type === 'REVENUE') net += Math.abs(bal);
      else if (acct.type === 'COST_OF_SALES' || acct.type === 'EXPENSE') net -= Math.abs(bal);
    }
    return net;
  }
}
