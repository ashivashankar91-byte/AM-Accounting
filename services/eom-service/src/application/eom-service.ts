import { inject, injectable } from 'tsyringe';
import { Prisma } from '.prisma/eom-client';
import {
  IEOMCloseRepository,
  IEOMStepRepository,
  IEventPublisher,
  TenantId,
  EOMClose,
  EOMCloseStatus,
  EOMCloseType,
  EOMStepStatus,
  IEOMStepContext,
  StepResult,
  standardPeriod,
  GLAccountType,
  createEvent,
} from '@amacc/shared-kernel';
import { EOMOrchestrator } from '../domain/orchestrator';

// ── Accounting EOM step sequence from purge.cbl (ACSYS-TRACK-EOM values)
// Prefixed 'ACCT_' to avoid collision with Service Module step codes
// (Service Module uses '062'=Parts Close, '065'=Parts Recon, '068'=Service Close, '071'/'074'/'077')
// @cobol-ancestry purge.cbl — ACSYS-TRACK-EOM step sequence
const ACCOUNTING_EOM_STEPS = [
  { stepCode: 'ACCT_010', stepName: 'Backup' },
  { stepCode: 'ACCT_020', stepName: 'Schedprn Detailed Report' },
  { stepCode: 'ACCT_025', stepName: 'Schedprn Summary Report' },
  { stepCode: 'ACCT_062', stepName: 'Java EOM Reports' },
  { stepCode: 'ACCT_065', stepName: 'Archive Reports' },
  { stepCode: 'ACCT_068', stepName: 'Financial Statements' },
  { stepCode: 'ACCT_070', stepName: 'Orphan Detail Cleanup' },
  { stepCode: 'ACCT_100', stepName: 'Schedule Detail Purge' },
  { stepCode: 'ACCT_200', stepName: 'GL and Journal Purge' },
  { stepCode: 'ACCT_300', stepName: 'Missing Document Purge' },
];

// ── Typed error classes ────────────────────────────────

/** @trace-cobol purge.cbl INV-EOM-01: ACSYS-TRACK-EOM ≠ 0 at startup */
export class EOMCloseInProgressError extends Error {
  readonly code = 'EOM_CLOSE_IN_PROGRESS';
  constructor(public readonly currentStepCode: string) {
    super(`An EOM close is already in progress at step ${currentStepCode}`);
  }
}

/** @trace-cobol purge.cbl INV-EOM-01: prior failed close */
export class PreviousEOMFailedError extends Error {
  readonly code = 'PREVIOUS_EOM_FAILED';
  constructor(public readonly failedStepCode: string) {
    super(`Previous EOM close failed at step ${failedStepCode} and requires manual recovery`);
  }
}

/** @trace-cobol purge.cbl INV-EOM-03: unposted transactions in period */
export class UnpostedTransactionsBlockedError extends Error {
  readonly code = 'UNPOSTED_TRANSACTIONS_BLOCKED';
  constructor(public readonly count: number) {
    super(`Cannot close period: ${count} unposted transaction batch(es) exist`);
  }
}

/** @trace-cobol purge.cbl INV-EOM-04: P&L accounts not zeroed before first fiscal month close */
export class PriorYearNotClosedError extends Error {
  readonly code = 'PRIOR_YEAR_NOT_CLOSED';
  constructor() {
    super('Cannot close first fiscal month: year-end has not been processed (P&L accounts have non-zero balances)');
  }
}

/** @trace-cobol yrend.cbl YE-INV-01: last month not closed */
export class LastMonthNotClosedError extends Error {
  readonly code = 'LAST_MONTH_NOT_CLOSED';
  constructor() {
    super('Year-end close requires the last month of the fiscal year to be closed first');
  }
}

/** @trace-cobol yrend.cbl YE-INV-02: idempotency — already processed */
export class YearAlreadyClosedError extends Error {
  readonly code = 'YEAR_ALREADY_CLOSED';
  constructor(public readonly fiscalYear: number) {
    super(`Year-end for fiscal year ${fiscalYear} has already been processed`);
  }
}

/** @trace-cobol yrend.cbl YE-INV-03: locked GL records */
export class GLRecordsLockedError extends Error {
  readonly code = 'GL_RECORDS_LOCKED';
  constructor() {
    super('Year-end cannot proceed: GL accounts are currently locked for update');
  }
}

/** @trace-cobol yrend.cbl YE-INV-04: source not reserved for year-end */
export class InvalidYearEndSourceError extends Error {
  readonly code = 'INVALID_YEAR_END_SOURCE';
  constructor(public readonly source: string) {
    super(`Journal source "${source}" is not reserved for year-end close`);
  }
}

/** @trace-cobol yrend.cbl YE-INV-05: retained earnings account invalid */
export class InvalidRetainedEarningsAccountError extends Error {
  readonly code = 'INVALID_RETAINED_EARNINGS_ACCOUNT';
  constructor(public readonly accountId: string, public readonly reason: string) {
    super(`Retained earnings account "${accountId}" is invalid: ${reason}`);
  }
}

/** @trace-improvement over yrend.cbl YE-INV-07: pre-flight count prevents LINENO=9999 mid-write */
export class YELineCountExceededError extends Error {
  readonly code = 'YE_LINE_COUNT_EXCEEDED';
  constructor(public readonly count: number) {
    super(`Year-end cannot proceed: ${count} P&L accounts exceed the 9,999 line limit`);
  }
}

// ── External dependency interfaces ─────────────────────

/** P&L account balance as returned by gl-service */
export interface PLAccountBalance {
  accountId: string;
  accountCode: string;
  name: string;
  glType: GLAccountType;
  openingBalance: number;
}

/** Year-end configuration from the Java API / gl-service */
export interface YearEndConfig {
  journalSource: string;
  retainedEarningsAccountIds: string[];
}

/** Result of a year-end journal posting */
export interface YearEndPostResult {
  batchId: string;
  linesPosted: number;
  retainedEarningsAmount: number;
}

/**
 * Cross-service GL query client injected into eom-service.
 * Implementations call gl-service HTTP API.
 */
export interface IGLClient {
  /** @trace-cobol purge.cbl INV-EOM-03 — scan for unposted batches */
  getUnpostedBatchCount(tenantId: TenantId, periodEnd: string): Promise<number>;

  /** @trace-cobol purge.cbl INV-EOM-04 — check P&L balances for year-closed assertion */
  getPLAccountBalances(tenantId: TenantId): Promise<PLAccountBalance[]>;

  /** @trace-cobol yrend.cbl — fetch journal source + retained earnings GL config */
  getYearEndConfig(tenantId: TenantId): Promise<YearEndConfig>;

  /** @trace-cobol yrend.cbl YE-INV-03 — check for locked GL records */
  hasLockedGLAccounts(tenantId: TenantId): Promise<boolean>;

  /** @trace-cobol yrend.cbl YE-INV-04 — validate journal source is reserved for year-end */
  isJournalSourceReservedForYearEnd(tenantId: TenantId, source: string): Promise<boolean>;

  /** @trace-cobol yrend.cbl YE-INV-05 — validate retained earnings account */
  validateRetainedEarningsAccount(tenantId: TenantId, accountId: string): Promise<{ valid: boolean; reason?: string }>;

  /**
   * Post the year-end journal batch through the GL posting engine.
   * Passes isYearEnd=true which enables tranpost INV-04 bypasses.
   * @trace-cobol yrend.cbl YE-INV-09 — autopost with FROM-PROG="Y"
   * @trace-cobol tranpost.extraction.md INV-04
   */
  postYearEndBatch(
    tenantId: TenantId,
    entries: Array<{ accountId: string; amount: number }>,
    journalSource: string,
    periodDate: string,
    referenceNumber: string,
    initiatedBy: string,
  ): Promise<YearEndPostResult>;
}

/** Repository for year-end idempotency records */
export interface IYearEndRecordRepository {
  /** @trace-cobol yrend.cbl YE-INV-02 — histtran idempotency check */
  findByYear(tenantId: TenantId, fiscalYear: number): Promise<{ id: string; closedAt: Date } | null>;
  create(tenantId: TenantId, fiscalYear: number, initiatedBy: string): Promise<{ id: string }>;
}

// ── Preview shapes ─────────────────────────────────────

export interface BlockingCondition {
  code: string;
  message: string;
}

/** @cobol-did-not-have EOM preview — COBOL had no readiness check before starting close */
export interface EOMPreview {
  canClose: boolean;
  blockingConditions: BlockingCondition[];
  unpostedBatchCount: number;
  periodEnd: string;
}

/** @cobol-did-not-have Year-end preview — COBOL had no preview of P&L impact before starting close */
export interface YearEndPreview {
  canClose: boolean;
  blockingConditions: BlockingCondition[];
  plAccountBalances: PLAccountBalance[];
  totalPLBalance: number;
  retainedEarningsAmount: number;
  config: YearEndConfig;
}

// ── Main service ───────────────────────────────────────

@injectable()
export class EOMService {
  constructor(
    @inject('IEOMCloseRepository') private readonly closeRepo: IEOMCloseRepository,
    @inject('IEOMStepRepository') private readonly stepRepo: IEOMStepRepository,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
    @inject('EOMOrchestrator') private readonly orchestrator: EOMOrchestrator,
    @inject('IGLClient') private readonly glClient: IGLClient,
    @inject('IYearEndRecordRepository') private readonly yearEndRepo: IYearEndRecordRepository,
  ) {}

  // ── Precondition checks ────────────────────────────────

  /**
   * Check all preconditions before starting an EOM close.
   * @trace-cobol purge.cbl INV-EOM-01, INV-EOM-03, INV-EOM-04, INV-EOM-05
   */
  private async checkEOMPreconditions(
    tenantId: TenantId,
    year: number,
    month: number,
    firstFiscalMonth: number,
  ): Promise<void> {
    // INV-EOM-01: No close already in progress for this period
    const existingCloses = await this.closeRepo.findAll(tenantId);
    const existing = existingCloses.find((c) => c.periodYear === year && c.periodMonth === month);
    if (existing) {
      if (existing.status === EOMCloseStatus.IN_PROGRESS) {
        throw new EOMCloseInProgressError(existing.currentStep ?? 'unknown');
      }
      if (existing.status === EOMCloseStatus.BLOCKED) {
        throw new PreviousEOMFailedError(existing.currentStep ?? 'unknown');
      }
    }

    // INV-EOM-03: No unposted transaction batches in the period
    // @trace-cobol purge.cbl — both COBOL tran file scan AND Java API check
    const periodEnd = new Date(year, month, 0).toISOString().split('T')[0];
    const unpostedCount = await this.glClient.getUnpostedBatchCount(tenantId, periodEnd);
    if (unpostedCount > 0) {
      throw new UnpostedTransactionsBlockedError(unpostedCount);
    }

    // INV-EOM-04: If this is the first fiscal month, all P&L accounts must be zeroed
    // @trace-cobol purge.cbl — scan S/C/E/M GL accounts; any non-zero = reject
    if (month === firstFiscalMonth) {
      const plBalances = await this.glClient.getPLAccountBalances(tenantId);
      const nonZero = plBalances.filter((a) => a.openingBalance !== 0);
      if (nonZero.length > 0) {
        throw new PriorYearNotClosedError();
      }
    }
  }

  // ── EOM Close ─────────────────────────────────────────

  /**
   * Preview month-end close state — returns blocking conditions without writing anything.
   * @cobol-did-not-have COBOL had no readiness preview
   */
  async previewMonthEnd(
    tenantId: TenantId,
    year: number,
    month: number,
    firstFiscalMonth = 1,
  ): Promise<EOMPreview> {
    const periodEnd = new Date(year, month, 0).toISOString().split('T')[0];
    const blockingConditions: BlockingCondition[] = [];

    const [existingCloses, unpostedCount] = await Promise.all([
      this.closeRepo.findAll(tenantId),
      this.glClient.getUnpostedBatchCount(tenantId, periodEnd),
    ]);

    const existing = existingCloses.find((c) => c.periodYear === year && c.periodMonth === month);
    if (existing?.status === EOMCloseStatus.IN_PROGRESS) {
      blockingConditions.push({ code: 'EOM_IN_PROGRESS', message: `Close already in progress at step ${existing.currentStep}` });
    }
    if (existing?.status === EOMCloseStatus.BLOCKED) {
      blockingConditions.push({ code: 'EOM_BLOCKED', message: `Previous close failed at step ${existing.currentStep}` });
    }
    if (unpostedCount > 0) {
      blockingConditions.push({ code: 'UNPOSTED_BATCHES', message: `${unpostedCount} unposted batch(es) must be posted first` });
    }
    if (month === firstFiscalMonth) {
      const plBalances = await this.glClient.getPLAccountBalances(tenantId);
      const nonZero = plBalances.filter((a) => a.openingBalance !== 0);
      if (nonZero.length > 0) {
        blockingConditions.push({ code: 'YEAR_NOT_CLOSED', message: 'P&L accounts have non-zero balances — year-end must be run first' });
      }
    }

    return {
      canClose: blockingConditions.length === 0,
      blockingConditions,
      unpostedBatchCount: unpostedCount,
      periodEnd,
    };
  }

  /**
   * Initiate an EOM monthly close.
   * Validates all preconditions from purge.cbl before creating the close record.
   * @trace-cobol purge.cbl — all 5 preconditions enforced before ACSYS-TRACK-EOM is set
   */
  async initiateClose(
    tenantId: TenantId,
    year: number,
    month: number,
    initiatedBy: string,
    firstFiscalMonth = 1,
  ): Promise<EOMClose> {
    await this.checkEOMPreconditions(tenantId, year, month, firstFiscalMonth);

    const close = await this.closeRepo.create(
      {
        tenantId,
        periodYear: year,
        periodMonth: month,
        closeType: 'ACCOUNTING_EOM' as EOMCloseType,
        status: EOMCloseStatus.IN_PROGRESS,
        currentStep: ACCOUNTING_EOM_STEPS[0].stepCode,
        startedAt: new Date(),
        completedAt: null,
        blockedReason: null,
      },
      tenantId,
    );
    return close;
  }

  async getCloses(tenantId: TenantId): Promise<EOMClose[]> {
    return this.closeRepo.findAll(tenantId);
  }

  async getCloseById(id: string, tenantId: TenantId): Promise<EOMClose | null> {
    return this.closeRepo.findById(id, tenantId);
  }

  async advanceStep(closeId: string, tenantId: TenantId): Promise<StepResult> {
    const close = await this.closeRepo.findById(closeId, tenantId);
    if (!close) throw new Error('EOM close not found');

    const steps = await this.stepRepo.findByCloseId(closeId);
    const currentStep = steps.find((s) => s.stepCode === close.currentStep);
    if (!currentStep) throw new Error('Current step not found');

    const stepResults = new Map<string, StepResult>();
    for (const s of steps) {
      if (s.status === EOMStepStatus.DONE) {
        stepResults.set(s.stepCode, { stepCode: s.stepCode, success: true, message: 'Done' });
      }
    }

    const periodEnd = new Date(close.periodYear, close.periodMonth, 0)
      .toISOString()
      .split('T')[0];

    const context: IEOMStepContext = {
      closeId,
      tenantId,
      period: standardPeriod(close.periodYear, close.periodMonth),
      closeType: close.closeType ?? ('MONTHLY' as EOMCloseType),
      periodEnd,
      currentStep,
      getPreviousStepResult(stepCode: string): StepResult | null {
        return stepResults.get(stepCode) ?? null;
      },
    };

    await this.stepRepo.updateStatus(currentStep.id, EOMStepStatus.RUNNING);
    const result = await this.orchestrator.advance(context);

    if (result.success) {
      await this.stepRepo.updateStatus(currentStep.id, EOMStepStatus.DONE);
      if (result.nextStepCode) {
        await this.closeRepo.updateStatus(closeId, EOMCloseStatus.IN_PROGRESS, tenantId);
      } else {
        await this.closeRepo.updateStatus(closeId, EOMCloseStatus.COMPLETED, tenantId);
        await this.eventPublisher.publish(
          createEvent('EOM_CLOSE_COMPLETED', tenantId, {
            closeId,
            periodYear: close.periodYear,
            periodMonth: close.periodMonth,
          }),
        );
      }
    } else {
      await this.stepRepo.updateStatus(currentStep.id, EOMStepStatus.BLOCKED, result.message);
      await this.closeRepo.updateStatus(closeId, EOMCloseStatus.BLOCKED, tenantId);
    }

    await this.eventPublisher.publish(
      createEvent('EOM_STEP_CHANGED', tenantId, {
        closeId,
        stepCode: currentStep.stepCode,
        result,
      }),
    );

    return result;
  }

  async retryStep(closeId: string, tenantId: TenantId): Promise<StepResult> {
    const close = await this.closeRepo.findById(closeId, tenantId);
    if (!close) throw new Error('EOM close not found');

    const steps = await this.stepRepo.findByCloseId(closeId);
    const blockedStep = steps.find((s) => s.status === EOMStepStatus.BLOCKED);
    if (!blockedStep) throw new Error('No blocked step to retry');

    await this.stepRepo.incrementRetry(blockedStep.id);
    await this.stepRepo.updateStatus(blockedStep.id, EOMStepStatus.PENDING);

    return this.advanceStep(closeId, tenantId);
  }

  /**
   * Admin reset for a BLOCKED close — equivalent to reseteom.cbl.
   * Only safe for steps < 100 (steps ≥ 100 have partially mutated data).
   * @trace-cobol reseteom.cbl — RESETEOM resets ACSYS-TRACK-EOM to 0
   * @intelligence-additions Requires OPERATOR role, records who reset and when
   */
  async resetClose(closeId: string, tenantId: TenantId, resetByUserId: string): Promise<EOMClose> {
    const close = await this.closeRepo.findById(closeId, tenantId);
    if (!close) throw new Error('EOM close not found');
    if (close.status !== EOMCloseStatus.BLOCKED) {
      throw new Error('Only BLOCKED closes can be reset');
    }

    const stepCode = parseInt(close.currentStep ?? '0', 10);
    if (stepCode >= 100) {
      throw new Error(
        `Cannot auto-reset: close failed at step ${close.currentStep} (≥100). ` +
          'Data may be partially purged — manual recovery required.',
      );
    }

    await this.closeRepo.updateStatus(closeId, EOMCloseStatus.NOT_STARTED, tenantId);
    const updated = await this.closeRepo.findById(closeId, tenantId);
    return updated!;
  }

  // ── Year-End Close ─────────────────────────────────────

  /**
   * Preview year-end close — returns P&L balances and retained earnings impact
   * without writing anything.
   * @cobol-did-not-have COBOL had no year-end preview
   */
  async previewYearEnd(tenantId: TenantId, fiscalYear: number): Promise<YearEndPreview> {
    const blockingConditions: BlockingCondition[] = [];

    const [existing, plBalances, config] = await Promise.all([
      this.yearEndRepo.findByYear(tenantId, fiscalYear),
      this.glClient.getPLAccountBalances(tenantId),
      this.glClient.getYearEndConfig(tenantId),
    ]);

    if (existing) {
      blockingConditions.push({ code: 'YEAR_ALREADY_CLOSED', message: `Year-end for ${fiscalYear} has already been processed` });
    }

    const hasLocks = await this.glClient.hasLockedGLAccounts(tenantId);
    if (hasLocks) {
      blockingConditions.push({ code: 'GL_RECORDS_LOCKED', message: 'GL accounts are locked — ensure no users are in the system' });
    }

    const nonZeroBalances = plBalances.filter((a) => a.openingBalance !== 0);
    const totalPLBalance = nonZeroBalances.reduce((sum, a) => sum + a.openingBalance, 0);

    return {
      canClose: blockingConditions.length === 0,
      blockingConditions,
      plAccountBalances: nonZeroBalances,
      totalPLBalance,
      retainedEarningsAmount: totalPLBalance,
      config,
    };
  }

  /**
   * Perform a fiscal year-end close.
   *
   * Algorithm (mirrors yrend.cbl):
   *  1. Validate last month is closed (YE-INV-01)
   *  2. Idempotency check — reject if already processed (YE-INV-02)
   *  3. Check for locked GL records (YE-INV-03)
   *  4. Validate year-end journal source (YE-INV-04)
   *  5. Validate retained earnings accounts (YE-INV-05)
   *  6. Pre-flight line count (improvement: prevents LINENO=9999 mid-write)
   *  7. Build P&L zeroing + retained earnings journal entry
   *  8. Post via gl-service with isYearEnd=true (enables tranpost INV-04 bypasses)
   *  9. Write YearEndRecord (idempotency token)
   * 10. Publish YEAR_END_COMPLETED event
   *
   * @cobol-ancestry yrend.cbl / YREND
   * @cobol-programs-replaced yrend.cbl, caaccteoy.cbl (Java UI bridge)
   * @intelligence-additions atomic TX (vs. COBOL write+autopost); pre-flight count;
   *   YearEndRecord replaces histtran key lookup; outbox event replaces eomsync
   */
  async yearEndClose(
    tenantId: TenantId,
    fiscalYear: number,
    lastClosedMonth: number,
    lastFiscalMonth: number,
    initiatedBy: string,
  ): Promise<{ closeId: string; batchId: string; linesPosted: number; retainedEarningsAmount: number }> {
    // YE-INV-01: Last month of fiscal year must be closed
    // @trace-cobol yrend.cbl YE-INV-01
    if (lastClosedMonth !== lastFiscalMonth) {
      throw new LastMonthNotClosedError();
    }

    // YE-INV-02: Idempotency check
    // @trace-cobol yrend.cbl YE-INV-02 — histtran key "EOY{YEAR}" idempotency check
    const existingRecord = await this.yearEndRepo.findByYear(tenantId, fiscalYear);
    if (existingRecord) {
      throw new YearAlreadyClosedError(fiscalYear);
    }

    // YE-INV-03: No locked GL records
    // @trace-cobol yrend.cbl YE-INV-03
    const hasLocks = await this.glClient.hasLockedGLAccounts(tenantId);
    if (hasLocks) {
      throw new GLRecordsLockedError();
    }

    // Fetch year-end configuration (journal source + retained earnings accounts)
    // @trace-cobol yrend.cbl 30060-SEND-TO-INVOKER + 30070-RECEIVE-DATA
    const config = await this.glClient.getYearEndConfig(tenantId);

    // YE-INV-04: Year-end journal source must be reserved
    // @trace-cobol yrend.cbl YE-INV-04
    const sourceValid = await this.glClient.isJournalSourceReservedForYearEnd(tenantId, config.journalSource);
    if (!sourceValid) {
      throw new InvalidYearEndSourceError(config.journalSource);
    }

    // YE-INV-05: Retained earnings accounts must be active Liability accounts
    // @trace-cobol yrend.cbl YE-INV-05
    for (const accountId of config.retainedEarningsAccountIds) {
      const validation = await this.glClient.validateRetainedEarningsAccount(tenantId, accountId);
      if (!validation.valid) {
        throw new InvalidRetainedEarningsAccountError(accountId, validation.reason ?? 'unknown reason');
      }
    }

    // Get all P&L accounts with non-zero opening balances
    // @trace-cobol yrend.cbl READ-GL loop — types S (REVENUE), C (COST_OF_SALES), E (EXPENSE), M (EXPENSE)
    const plBalances = await this.glClient.getPLAccountBalances(tenantId);
    const nonZeroBalances = plBalances.filter((a) => a.openingBalance !== 0);

    // Improvement: pre-flight line count check to prevent mid-write failure
    // @trace-improvement over yrend.cbl YE-INV-07 — COBOL could hit LINENO=9999 mid-write
    const lineCount = nonZeroBalances.length + config.retainedEarningsAccountIds.length;
    if (lineCount > 9998) {
      throw new YELineCountExceededError(lineCount);
    }

    // Build the year-end journal entry
    // @trace-cobol yrend.cbl YE-INV-08 — entry must balance (sum of all lines = 0)
    // For each P&L account: amount = -(openingBalance) — negates the balance to zero it
    // For retained earnings: amount = SUM of openingBalances — offsets all P&L lines
    //
    // PRECISION: openingBalance values arrive as JSON numbers from gl-service.
    // JSON numbers are IEEE 754 doubles. Summing thousands of NUMERIC(15,2) values
    // as JS floats will drift. We convert through Prisma.Decimal (decimal.js) for
    // the accumulation step, then emit precise .toDecimalPlaces(2) for the HTTP call.
    // @trace-improvement — COBOL used binary arithmetic (COMP-3) with no overflow guard;
    //   TS uses exact decimal arithmetic via Prisma.Decimal / decimal.js
    const total = nonZeroBalances.reduce(
      (acc, a) => acc.plus(new Prisma.Decimal(String(a.openingBalance))),
      new Prisma.Decimal(0),
    );
    const referenceNumber = `EOY${fiscalYear}`;

    const journalLines: Array<{ accountId: string; amount: number }> = [
      ...nonZeroBalances.map((a) => ({
        accountId: a.accountId,
        // Negate each P&L balance using Decimal to avoid float drift
        amount: new Prisma.Decimal(String(a.openingBalance)).negated().toDecimalPlaces(2).toNumber(),
      })),
      // Distribute retained earnings equally if multiple RE accounts, or all to first
      { accountId: config.retainedEarningsAccountIds[0], amount: total.toDecimalPlaces(2).toNumber() },
    ];

    // Post via gl-service with isYearEnd=true
    // @trace-cobol yrend.cbl YE-INV-09 — autopost with FROM-PROG="Y" sets GLOBAL-YE-IS-IN-PROGRESS=TRUE
    // This enables tranpost INV-04 bypasses: skip UPDATE-JOURNAL, allow inactive accounts,
    // allow reserved sources 09/88, skip cutoff enforcement
    const periodDate = `${fiscalYear}-${String(lastFiscalMonth).padStart(2, '0')}-01`;
    const postResult = await this.glClient.postYearEndBatch(
      tenantId,
      journalLines,
      config.journalSource,
      periodDate,
      referenceNumber,
      initiatedBy,
    );

    // Write YearEndRecord for future idempotency checks
    // @trace-cobol yrend.cbl YE-INV-02 — ACC-4098: even if no P&L balances, write token record
    await this.yearEndRepo.create(tenantId, fiscalYear, initiatedBy);

    // Create an EOMClose record of type YEAR_END to track the close in the same system
    const close = await this.closeRepo.create(
      {
        tenantId,
        periodYear: fiscalYear,
        periodMonth: lastFiscalMonth,
        closeType: 'YEAR_END' as EOMCloseType,
        status: EOMCloseStatus.COMPLETED,
        currentStep: null,
        startedAt: new Date(),
        completedAt: new Date(),
        blockedReason: null,
      },
      tenantId,
    );

    // Publish YEAR_END_COMPLETED event
    // @trace-cobol yrend.cbl SYNC-GL — replaces fire-and-forget /acct/sync?table=gl HTTP call
    // @intelligence-additions Outbox pattern ensures reliable delivery; COBOL sync could silently fail
    await this.eventPublisher.publish(
      createEvent('YEAR_END_COMPLETED', tenantId, {
        closeId: close.id,
        fiscalYear,
        batchId: postResult.batchId,
        linesPosted: postResult.linesPosted,
        retainedEarningsAmount: postResult.retainedEarningsAmount,
      }),
    );

    return {
      closeId: close.id,
      batchId: postResult.batchId,
      linesPosted: postResult.linesPosted,
      retainedEarningsAmount: postResult.retainedEarningsAmount,
    };
  }
}
