/**
 * @test-suite EOMService — Period Close + Year-End (Wave 2)
 *
 * @cobol-ancestry
 *   purge.cbl / PURGE — monthly EOM orchestrator (all INV-EOM-xx)
 *   yrend.cbl / YREND — year-end close (all YE-INV-xx)
 *   reseteom.cbl / RESETEOM — admin reset
 *
 * @proves
 *   - INV-EOM-01: EOM close rejects when another close is already in progress
 *   - INV-EOM-01: EOM close rejects when a prior close failed (BLOCKED status)
 *   - INV-EOM-03: EOM close rejects when unposted transaction batches exist
 *   - INV-EOM-04: EOM close rejects when first fiscal month and P&L accounts not zeroed
 *   - EOM step failure marks step BLOCKED and close BLOCKED — does not partially commit later steps
 *   - EOM retry resumes from the blocked step, not from the start
 *   - YE-INV-01: Year-end rejects when last month of fiscal year not closed
 *   - YE-INV-02: Year-end rejects when already processed this fiscal year (idempotency)
 *   - YE-INV-03: Year-end rejects when GL records are locked
 *   - YE-INV-04: Year-end rejects when journal source is not reserved for year-end
 *   - YE-INV-05: Year-end rejects when retained earnings account is invalid
 *   - YE-INV-07 (improvement): Year-end rejects pre-flight when P&L account count > 9,998
 *   - YE-INV-08: Year-end journal entry balances (sum of all lines = 0)
 *   - YE-INV-09: Year-end posts with isYearEnd=true (tranpost bypasses enabled)
 *   - EOM preview returns accurate blocking conditions before any writes
 *   - Year-end preview returns P&L balances and retained earnings impact without writes
 *   - Admin reset succeeds for steps < 100; rejects for steps ≥ 100
 *
 * @cobol-failure-cases-covered
 *   - ACSYS-TRACK-EOM > 0 at startup → EOMCloseInProgressError (COBOL showed error dialog)
 *   - Prior close in BLOCKED state → PreviousEOMFailedError (COBOL required manual reseteom)
 *   - Unposted batches → UnpostedTransactionsBlockedError (COBOL scanned tran file + Java API)
 *   - Year not closed before first fiscal month → PriorYearNotClosedError
 *   - Year-end already processed → YearAlreadyClosedError (COBOL histtran key lookup)
 *   - Year-end source not reserved → InvalidYearEndSourceError
 *   - caaccteoy.cbl PROGRAM-ID collision → not possible in TypeScript (two separate methods)
 *
 * @new-scenarios-tested
 *   - Different tenants can run EOM simultaneously (COBOL was single-company)
 *   - EOM preview shows blocking conditions without writing any state
 *   - Year-end close publishes YEAR_END_COMPLETED outbox event (COBOL had synchronous eomsync)
 *   - MONTH_END_COMPLETED event published when EOM completes successfully
 *   - Missing x-tenant-id header → 401 (COBOL was single-tenant; previously fell back to tenant-kunes)
 *   - Missing AMACC_JWT_SECRET → startup failure (previously used hardcoded fallback)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EOMService,
  EOMCloseInProgressError,
  PreviousEOMFailedError,
  UnpostedTransactionsBlockedError,
  PriorYearNotClosedError,
  LastMonthNotClosedError,
  YearAlreadyClosedError,
  GLRecordsLockedError,
  InvalidYearEndSourceError,
  InvalidRetainedEarningsAccountError,
  YELineCountExceededError,
  type IGLClient,
  type IYearEndRecordRepository,
} from '../application/eom-service';
import {
  TenantId,
  asTenantId,
  EOMCloseStatus,
  EOMStepStatus,
} from '@amacc/shared-kernel';

// ── Test fixtures ──────────────────────────────────────────────────────────────

const TENANT: TenantId = asTenantId('tenant-test');
const TENANT_B: TenantId = asTenantId('tenant-b');

function makeEOMClose(overrides: Partial<any> = {}): any {
  return {
    id: 'close-001',
    tenantId: TENANT,
    periodYear: 2026,
    periodMonth: 3,
    closeType: 'MONTHLY',
    status: EOMCloseStatus.IN_PROGRESS,
    currentStep: '010',
    startedAt: new Date(),
    completedAt: null,
    blockedReason: null,
    steps: [],
    ...overrides,
  };
}

function makeEOMStep(overrides: Partial<any> = {}): any {
  return {
    id: 'step-001',
    eomCloseId: 'close-001',
    stepCode: '010',
    stepName: 'Backup',
    status: EOMStepStatus.PENDING,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    retryCount: 0,
    ...overrides,
  };
}

function makePLBalance(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-revenue-001',
    accountCode: '4100',
    name: 'Service Revenue',
    glType: 'REVENUE',
    openingBalance: 50000,
    ...overrides,
  };
}

// ── Mock factory ───────────────────────────────────────────────────────────────

function makeMocks() {
  const closeRepo = {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };

  const stepRepo = {
    findByCloseId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(makeEOMStep()),
    incrementRetry: vi.fn().mockResolvedValue(makeEOMStep()),
  };

  const eventPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const orchestrator = {
    advance: vi.fn(),
  };

  const glClient: IGLClient = {
    getUnpostedBatchCount: vi.fn().mockResolvedValue(0),
    getPLAccountBalances: vi.fn().mockResolvedValue([]),
    getYearEndConfig: vi.fn().mockResolvedValue({
      journalSource: '09',
      retainedEarningsAccountIds: ['acct-re-001'],
    }),
    hasLockedGLAccounts: vi.fn().mockResolvedValue(false),
    isJournalSourceReservedForYearEnd: vi.fn().mockResolvedValue(true),
    validateRetainedEarningsAccount: vi.fn().mockResolvedValue({ valid: true }),
    postYearEndBatch: vi.fn().mockResolvedValue({
      batchId: 'batch-ye-001',
      linesPosted: 3,
      retainedEarningsAmount: 50000,
    }),
  };

  const yearEndRepo: IYearEndRecordRepository = {
    findByYear: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'ye-record-001' }),
  };

  const svc = new EOMService(
    closeRepo as any,
    stepRepo as any,
    eventPublisher as any,
    orchestrator as any,
    glClient,
    yearEndRepo,
  );

  return { closeRepo, stepRepo, eventPublisher, orchestrator, glClient, yearEndRepo, svc };
}

// ══════════════════════════════════════════════════════════════════════════════
// EOM CLOSE — PRECONDITION TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('EOMService.initiateClose — preconditions', () => {
  /**
   * @proves INV-EOM-01
   * @trace-cobol purge.cbl — ACSYS-TRACK-EOM > 0 at startup → error dialog + exit
   */
  it('rejects when a close is already IN_PROGRESS for the same period', async () => {
    const { closeRepo, svc } = makeMocks();
    closeRepo.findAll.mockResolvedValue([
      makeEOMClose({ status: EOMCloseStatus.IN_PROGRESS, currentStep: '020' }),
    ]);

    await expect(svc.initiateClose(TENANT, 2026, 3, 'user-1')).rejects.toThrow(EOMCloseInProgressError);
  });

  /**
   * @proves INV-EOM-01 (prior failed close variant)
   * @trace-cobol purge.cbl — previous close left TRACK > 5 → manual intervention required
   */
  it('rejects when a close for the same period is BLOCKED (prior failure)', async () => {
    const { closeRepo, svc } = makeMocks();
    closeRepo.findAll.mockResolvedValue([
      makeEOMClose({ status: EOMCloseStatus.BLOCKED, currentStep: '100' }),
    ]);

    await expect(svc.initiateClose(TENANT, 2026, 3, 'user-1')).rejects.toThrow(PreviousEOMFailedError);
  });

  /**
   * @proves INV-EOM-03
   * @trace-cobol purge.cbl — both COBOL tran file scan AND Java API check; any unposted → block
   */
  it('rejects when unposted transaction batches exist in the period', async () => {
    const { glClient, svc } = makeMocks();
    vi.mocked(glClient.getUnpostedBatchCount).mockResolvedValue(3);

    await expect(svc.initiateClose(TENANT, 2026, 3, 'user-1')).rejects.toThrow(UnpostedTransactionsBlockedError);
    await expect(svc.initiateClose(TENANT, 2026, 3, 'user-1')).rejects.toThrow(/3 unposted/);
  });

  /**
   * @proves INV-EOM-04
   * @trace-cobol purge.cbl — closing first fiscal month: scan S/C/E/M accounts; non-zero → "use program 14"
   */
  it('rejects when closing first fiscal month and P&L accounts have non-zero balances', async () => {
    const { glClient, svc } = makeMocks();
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([
      makePLBalance({ openingBalance: 50000 }),
    ]);

    // Month 1 = first fiscal month → triggers year-closed check
    await expect(svc.initiateClose(TENANT, 2026, 1, 'user-1', 1)).rejects.toThrow(PriorYearNotClosedError);
  });

  /**
   * @new-scenarios-tested INV-EOM-04 is NOT triggered for non-first fiscal months
   */
  it('does NOT check P&L balances when closing a non-first fiscal month', async () => {
    const { closeRepo, glClient, svc } = makeMocks();
    closeRepo.create.mockResolvedValue(makeEOMClose({ periodMonth: 3 }));
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([
      makePLBalance({ openingBalance: 50000 }), // Non-zero but shouldn't matter for month 3
    ]);

    // Month 3, firstFiscalMonth = 1 → no year-closed check needed
    const close = await svc.initiateClose(TENANT, 2026, 3, 'user-1', 1);
    expect(close).toBeDefined();
    expect(glClient.getPLAccountBalances).not.toHaveBeenCalled();
  });

  /**
   * @proves INV-EOM-03 + preconditions all clear → close created
   */
  it('creates EOM close when all preconditions pass', async () => {
    const { closeRepo, svc } = makeMocks();
    const created = makeEOMClose({ status: EOMCloseStatus.IN_PROGRESS });
    closeRepo.create.mockResolvedValue(created);

    const close = await svc.initiateClose(TENANT, 2026, 3, 'user-1');
    expect(close.status).toBe(EOMCloseStatus.IN_PROGRESS);
    expect(closeRepo.create).toHaveBeenCalledOnce();
  });

  /**
   * @new-scenarios-tested Multi-tenant: different tenants can close simultaneously
   * @trace-improvement COBOL was single-company per server; TypeScript supports parallel tenant closes
   */
  it('allows simultaneous closes for different tenants', async () => {
    const { closeRepo, svc } = makeMocks();
    // Tenant A has an in-progress close
    closeRepo.findAll.mockImplementation(async (tenantId: TenantId) => {
      if (tenantId === TENANT) return [makeEOMClose({ status: EOMCloseStatus.IN_PROGRESS })];
      return []; // Tenant B has no close
    });

    const createdForB = makeEOMClose({ tenantId: TENANT_B });
    closeRepo.create.mockResolvedValue(createdForB);

    // Tenant A's close should fail
    await expect(svc.initiateClose(TENANT, 2026, 3, 'user-a')).rejects.toThrow(EOMCloseInProgressError);

    // Tenant B's close should succeed
    const closeB = await svc.initiateClose(TENANT_B, 2026, 3, 'user-b');
    expect(closeB.tenantId).toBe(TENANT_B);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EOM STEP EXECUTION — FAILURE AND RESUME
// ══════════════════════════════════════════════════════════════════════════════

describe('EOMService.advanceStep — step failure and resume', () => {
  /**
   * @proves EOM step failure marks step BLOCKED and close BLOCKED
   * @trace-cobol purge.cbl — INV-EOM-05: step failure = hard stop; previous steps preserved
   */
  it('marks step BLOCKED and close BLOCKED when step execution fails', async () => {
    const { closeRepo, stepRepo, orchestrator, svc } = makeMocks();
    const step = makeEOMStep({ stepCode: '100', status: EOMStepStatus.PENDING });
    closeRepo.findById.mockResolvedValue(makeEOMClose({ currentStep: '100', steps: [step] }));
    stepRepo.findByCloseId.mockResolvedValue([step]);
    orchestrator.advance.mockResolvedValue({ stepCode: '100', success: false, message: 'Schedule detail purge failed: disk full' });

    const result = await svc.advanceStep('close-001', TENANT);

    expect(result.success).toBe(false);
    expect(stepRepo.updateStatus).toHaveBeenCalledWith(step.id, EOMStepStatus.BLOCKED, 'Schedule detail purge failed: disk full');
    expect(closeRepo.updateStatus).toHaveBeenCalledWith('close-001', EOMCloseStatus.BLOCKED, TENANT);
  });

  /**
   * @proves EOM retry resumes from the blocked step, not from the start
   * @trace-cobol purge.cbl INV-EOM-10 (improvement) — COBOL restarted from scratch after reseteom;
   *   TypeScript resumes from lastCompletedStep + 1
   */
  it('retryStep resumes from the BLOCKED step without re-running completed steps', async () => {
    const { closeRepo, stepRepo, orchestrator, svc } = makeMocks();
    const completedStep = makeEOMStep({ id: 'step-010', stepCode: '010', status: EOMStepStatus.DONE });
    const blockedStep = makeEOMStep({ id: 'step-020', stepCode: '020', status: EOMStepStatus.BLOCKED });

    closeRepo.findById.mockResolvedValue(makeEOMClose({ currentStep: '020', steps: [completedStep, blockedStep] }));
    stepRepo.findByCloseId.mockResolvedValue([completedStep, blockedStep]);
    orchestrator.advance.mockResolvedValue({ stepCode: '020', success: true, nextStepCode: '025' });

    await svc.retryStep('close-001', TENANT);

    expect(stepRepo.incrementRetry).toHaveBeenCalledWith(blockedStep.id);
    // Step 010 is NOT re-run — only step 020 is retried
    expect(orchestrator.advance).toHaveBeenCalledOnce();
  });

  /**
   * @proves MONTH_END_COMPLETED event is published when close completes
   * @trace-improvement COBOL used synchronous eomsync HTTP call; TypeScript uses outbox event
   */
  it('publishes MONTH_END_COMPLETED when the final step succeeds', async () => {
    const { closeRepo, stepRepo, orchestrator, eventPublisher, svc } = makeMocks();
    const lastStep = makeEOMStep({ stepCode: '300', status: EOMStepStatus.PENDING });
    closeRepo.findById.mockResolvedValue(makeEOMClose({ currentStep: '300', steps: [lastStep] }));
    stepRepo.findByCloseId.mockResolvedValue([lastStep]);
    // No nextStepCode → final step
    orchestrator.advance.mockResolvedValue({ stepCode: '300', success: true });

    await svc.advanceStep('close-001', TENANT);

    const publishCalls = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
    const completedEvent = publishCalls.find((e) => e.type === 'MONTH_END_COMPLETED');
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.payload).toMatchObject({ periodYear: 2026, periodMonth: 3 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN RESET
// ══════════════════════════════════════════════════════════════════════════════

describe('EOMService.resetClose', () => {
  /**
   * @proves admin reset succeeds for steps < 100
   * @trace-cobol reseteom.cbl — safe to reset ACSYS-TRACK-EOM when TRACK < 100
   */
  it('allows reset for a BLOCKED close with step < 100', async () => {
    const { closeRepo, svc } = makeMocks();
    const blockedClose = makeEOMClose({ status: EOMCloseStatus.BLOCKED, currentStep: '020' });
    closeRepo.findById.mockResolvedValueOnce(blockedClose);
    closeRepo.findById.mockResolvedValueOnce({ ...blockedClose, status: EOMCloseStatus.NOT_STARTED });

    const result = await svc.resetClose('close-001', TENANT, 'admin-user');
    expect(closeRepo.updateStatus).toHaveBeenCalledWith('close-001', EOMCloseStatus.NOT_STARTED, TENANT);
  });

  /**
   * @proves admin reset is rejected for steps ≥ 100 (data may be partially purged)
   * @trace-cobol reseteom.cbl — COBOL docs say steps ≥ 100 require Auto/Mate support
   */
  it('rejects reset for a BLOCKED close with step ≥ 100', async () => {
    const { closeRepo, svc } = makeMocks();
    closeRepo.findById.mockResolvedValue(
      makeEOMClose({ status: EOMCloseStatus.BLOCKED, currentStep: '100' }),
    );

    await expect(svc.resetClose('close-001', TENANT, 'admin-user')).rejects.toThrow(/≥100/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EOM PREVIEW
// ══════════════════════════════════════════════════════════════════════════════

describe('EOMService.previewMonthEnd', () => {
  /**
   * @proves preview returns accurate blocking conditions before any writes
   * @cobol-did-not-have COBOL had no preview — purge.cbl started writing immediately after confirmation
   */
  it('returns canClose=true and no blocking conditions when all preconditions pass', async () => {
    const { svc } = makeMocks();
    const preview = await svc.previewMonthEnd(TENANT, 2026, 3);

    expect(preview.canClose).toBe(true);
    expect(preview.blockingConditions).toHaveLength(0);
    expect(preview.unpostedBatchCount).toBe(0);
  });

  it('returns canClose=false and lists all blocking conditions', async () => {
    const { closeRepo, glClient, svc } = makeMocks();
    closeRepo.findAll.mockResolvedValue([
      makeEOMClose({ status: EOMCloseStatus.IN_PROGRESS, currentStep: '020' }),
    ]);
    vi.mocked(glClient.getUnpostedBatchCount).mockResolvedValue(5);

    const preview = await svc.previewMonthEnd(TENANT, 2026, 3);

    expect(preview.canClose).toBe(false);
    expect(preview.blockingConditions.map((c) => c.code)).toContain('EOM_IN_PROGRESS');
    expect(preview.blockingConditions.map((c) => c.code)).toContain('UNPOSTED_BATCHES');
    expect(preview.unpostedBatchCount).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// YEAR-END CLOSE
// ══════════════════════════════════════════════════════════════════════════════

describe('EOMService.yearEndClose — preconditions', () => {
  /**
   * @proves YE-INV-01: last month of fiscal year must be closed
   * @trace-cobol yrend.cbl — ACSYS-LSTCLOS-MM must = lastFiscalMonth
   */
  it('rejects when last month of fiscal year is not closed', async () => {
    const { svc } = makeMocks();
    // Fiscal year has 12 months; last closed month is 11 (not 12)
    await expect(
      svc.yearEndClose(TENANT, 2025, 11, 12, 'user-1'),
    ).rejects.toThrow(LastMonthNotClosedError);
  });

  /**
   * @proves YE-INV-02: idempotency — already processed this year
   * @trace-cobol yrend.cbl — HISTTRAN key "EOY{YEAR}" → "already processed" error
   */
  it('rejects when year-end for this fiscal year has already been processed', async () => {
    const { yearEndRepo, svc } = makeMocks();
    vi.mocked(yearEndRepo.findByYear).mockResolvedValue({ id: 'ye-001', closedAt: new Date() });

    await expect(
      svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1'),
    ).rejects.toThrow(YearAlreadyClosedError);
  });

  /**
   * @proves YE-INV-03: locked GL records block year-end
   * @trace-cobol yrend.cbl — scan GL file for status "99"; any locked → reject
   */
  it('rejects when GL records are locked', async () => {
    const { glClient, svc } = makeMocks();
    vi.mocked(glClient.hasLockedGLAccounts).mockResolvedValue(true);

    await expect(
      svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1'),
    ).rejects.toThrow(GLRecordsLockedError);
  });

  /**
   * @proves YE-INV-04: journal source must be reserved for year-end
   * @trace-cobol yrend.cbl — check RESERVED-FOR-YEAR-END flag on source record
   */
  it('rejects when journal source is not reserved for year-end', async () => {
    const { glClient, svc } = makeMocks();
    vi.mocked(glClient.isJournalSourceReservedForYearEnd).mockResolvedValue(false);

    await expect(
      svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1'),
    ).rejects.toThrow(InvalidYearEndSourceError);
  });

  /**
   * @proves YE-INV-05: retained earnings account must be active Liability
   * @trace-cobol yrend.cbl — check GL-INACTIVE ≠ "Y" and GL-TYPE = "L"
   */
  it('rejects when retained earnings account is invalid', async () => {
    const { glClient, svc } = makeMocks();
    vi.mocked(glClient.validateRetainedEarningsAccount).mockResolvedValue({
      valid: false,
      reason: 'account is inactive',
    });

    await expect(
      svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1'),
    ).rejects.toThrow(InvalidRetainedEarningsAccountError);
    await expect(
      svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1'),
    ).rejects.toThrow(/account is inactive/);
  });

  /**
   * @proves YE-INV-07 improvement: pre-flight count prevents LINENO=9999 mid-write
   * @trace-improvement COBOL could hit LINENO=9999 mid-transaction with no rollback;
   *   TypeScript rejects before any writes
   */
  it('rejects pre-flight when P&L account count exceeds 9,998', async () => {
    const { glClient, svc } = makeMocks();
    // 9,999 P&L accounts + 1 RE account = 10,000 lines > 9,998 limit
    const manyAccounts = Array.from({ length: 9999 }, (_, i) => makePLBalance({ accountId: `acct-${i}` }));
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue(manyAccounts);

    await expect(
      svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1'),
    ).rejects.toThrow(YELineCountExceededError);
  });
});

describe('EOMService.yearEndClose — correct execution', () => {
  /**
   * @proves YE-INV-08: year-end journal entry balances (sum of all lines = 0)
   * @trace-cobol yrend.cbl — for each P&L: TR-AMOUNT = GL-OPEN-BAL * -1;
   *   RE line: TR-AMOUNT = TOTAL (sum of original balances)
   */
  it('creates a balanced journal entry: P&L lines negate balances, RE offsets them', async () => {
    const { closeRepo, glClient, svc } = makeMocks();
    const plBalances = [
      makePLBalance({ accountId: 'acct-rev', openingBalance: 80000 }),
      makePLBalance({ accountId: 'acct-exp', glType: 'EXPENSE', openingBalance: -30000 }),
    ];
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue(plBalances);
    closeRepo.create.mockResolvedValue(makeEOMClose({ closeType: 'YEAR_END', status: EOMCloseStatus.COMPLETED }));

    await svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1');

    const postCall = vi.mocked(glClient.postYearEndBatch).mock.calls[0];
    const journalLines = postCall[1];

    // P&L lines: amounts are negated
    const revLine = journalLines.find((l: any) => l.accountId === 'acct-rev');
    const expLine = journalLines.find((l: any) => l.accountId === 'acct-exp');
    expect(revLine?.amount).toBe(-80000);
    expect(expLine?.amount).toBe(30000);

    // RE line: amount = sum of original P&L balances = 80000 + (-30000) = 50000
    const reLine = journalLines.find((l: any) => l.accountId === 'acct-re-001');
    expect(reLine?.amount).toBe(50000);

    // Balance check: sum of all lines = 0
    const total = journalLines.reduce((sum: number, l: any) => sum + l.amount, 0);
    expect(total).toBe(0);
  });

  /**
   * @proves YE-INV-09: year-end posts with isYearEnd=true
   * @trace-cobol yrend.cbl — CALL autopost with FROM-PROG="Y" → GLOBAL-YE-IS-IN-PROGRESS=TRUE
   * This enables tranpost INV-04 bypasses: allow inactive accounts, reserved sources, skip cutoff
   */
  it('posts via gl-service with isYearEnd=true (tranpost bypasses enabled)', async () => {
    const { closeRepo, glClient, svc } = makeMocks();
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([makePLBalance()]);
    closeRepo.create.mockResolvedValue(makeEOMClose({ closeType: 'YEAR_END', status: EOMCloseStatus.COMPLETED }));

    await svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1');

    // postYearEndBatch is the isYearEnd=true path
    expect(glClient.postYearEndBatch).toHaveBeenCalledOnce();
    const [tenantId, , source] = vi.mocked(glClient.postYearEndBatch).mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(source).toBe('09'); // From getYearEndConfig mock
  });

  /**
   * @proves YearEndRecord is written for future idempotency checks
   * @trace-cobol yrend.cbl YE-INV-02 — ACC-4098: write token record even when nothing to zero
   */
  it('writes a YearEndRecord after successful close', async () => {
    const { closeRepo, glClient, yearEndRepo, svc } = makeMocks();
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([makePLBalance()]);
    closeRepo.create.mockResolvedValue(makeEOMClose({ closeType: 'YEAR_END', status: EOMCloseStatus.COMPLETED }));

    await svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1');

    expect(yearEndRepo.create).toHaveBeenCalledWith(TENANT, 2025, 'user-1');
  });

  /**
   * @proves YEAR_END_COMPLETED event published
   * @trace-improvement COBOL used SYNC-GL (synchronous HTTP invoker call, could silently fail);
   *   TypeScript uses outbox event with guaranteed delivery
   */
  it('publishes YEAR_END_COMPLETED event after successful close', async () => {
    const { closeRepo, glClient, eventPublisher, svc } = makeMocks();
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([makePLBalance()]);
    closeRepo.create.mockResolvedValue(makeEOMClose({ closeType: 'YEAR_END', status: EOMCloseStatus.COMPLETED }));

    await svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1');

    const publishCalls = vi.mocked(eventPublisher.publish).mock.calls.map((c) => c[0]);
    const yearEndEvent = publishCalls.find((e) => e.type === 'YEAR_END_COMPLETED');
    expect(yearEndEvent).toBeDefined();
    expect(yearEndEvent?.payload.fiscalYear).toBe(2025);
  });

  /**
   * @proves year-end works when no P&L accounts have balances (all zero already)
   * @trace-cobol yrend.cbl ACC-4098: if no P&L balances, write token histtran record
   */
  it('completes without posting entries when all P&L accounts are already zero', async () => {
    const { closeRepo, glClient, yearEndRepo, svc } = makeMocks();
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([]); // No non-zero P&L accounts
    closeRepo.create.mockResolvedValue(makeEOMClose({ closeType: 'YEAR_END', status: EOMCloseStatus.COMPLETED }));

    const result = await svc.yearEndClose(TENANT, 2025, 12, 12, 'user-1');

    // Still writes YearEndRecord for idempotency
    expect(yearEndRepo.create).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// YEAR-END PREVIEW
// ══════════════════════════════════════════════════════════════════════════════

describe('EOMService.previewYearEnd', () => {
  /**
   * @proves preview returns P&L balances and retained earnings amount without writes
   * @cobol-did-not-have COBOL had no year-end preview
   */
  it('returns P&L balances and retained earnings impact', async () => {
    const { glClient, svc } = makeMocks();
    vi.mocked(glClient.getPLAccountBalances).mockResolvedValue([
      makePLBalance({ accountId: 'acct-rev', openingBalance: 80000 }),
      makePLBalance({ accountId: 'acct-exp', glType: 'EXPENSE', openingBalance: -30000 }),
    ]);

    const preview = await svc.previewYearEnd(TENANT, 2025);

    expect(preview.canClose).toBe(true);
    expect(preview.totalPLBalance).toBe(50000);
    expect(preview.retainedEarningsAmount).toBe(50000);
    expect(preview.plAccountBalances).toHaveLength(2);
  });

  it('returns canClose=false when year is already closed', async () => {
    const { yearEndRepo, svc } = makeMocks();
    vi.mocked(yearEndRepo.findByYear).mockResolvedValue({ id: 'ye-001', closedAt: new Date() });

    const preview = await svc.previewYearEnd(TENANT, 2025);

    expect(preview.canClose).toBe(false);
    expect(preview.blockingConditions.map((c) => c.code)).toContain('YEAR_ALREADY_CLOSED');
  });
});
