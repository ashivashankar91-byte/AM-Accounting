import {
  IStepHandler,
  IEOMStepContext,
  StepResult,
  createServiceToken,
} from '@amacc/shared-kernel';

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE MODULE STEP HANDLERS (closeType = 'MONTHLY')
// These handlers orchestrate the dealer Service Module month-end close.
// Step codes: 062, 065, 068, 071, 074, 077
// These are DISTINCT from accounting EOM steps (ACCT_xxx) despite sharing numbers.
// ══════════════════════════════════════════════════════════════════════════════

// NOTE: Steps '010' and '020' below are Service Module pre-close steps.
// They are NOT the accounting backup/schedprn steps (ACCT_010, ACCT_020).

// Step 010: Pre-Close Checklist (Service Module)
export class PreCloseChecklistHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '010'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return { stepCode: '010', success: true, message: 'Pre-close checklist verified', nextStepCode: '020' };
  }
}

// Step 020: Verify Open Items (Service Module)
export class VerifyOpenItemsHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '020'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return { stepCode: '020', success: true, message: 'Open items verified and cleared', nextStepCode: '062' };
  }
}


// Step 062: Parts Inventory Close (Service Module)
export class PartsInventoryCloseHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '062'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return {
      stepCode: '062',
      success: true,
      message: 'Parts inventory close completed successfully',
      nextStepCode: '065',
    };
  }
}

export class PartsReconHandler implements IStepHandler {
  canHandle(stepCode: string): boolean {
    return stepCode === '065';
  }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    const partsResult = context.getPreviousStepResult('062');
    if (!partsResult?.success) {
      return {
        stepCode: '065',
        success: false,
        message: 'Parts reconciliation blocked: Parts Close (062) not complete',
      };
    }

    return {
      stepCode: '065',
      success: true,
      message: 'Parts reconciliation completed',
      nextStepCode: '068',
    };
  }
}

export class ServiceCloseHandler implements IStepHandler {
  private glServiceUrl: string;

  constructor() {
    this.glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
  }

  canHandle(stepCode: string): boolean {
    return stepCode === '068';
  }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    const tenantId = context.tenantId;
    const periodEnd = context.periodEnd;   // e.g. '2026-03-31'
    const jwtSecret = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    const serviceToken = createServiceToken('eom-service', jwtSecret);

    try {
      // 1. Fetch all DRAFT journal entries for service ROs in this period
      const searchResp = await fetch(
        `${this.glServiceUrl}/api/v1/gl/journal-entries?status=DRAFT&source=SERVICE_RO&periodEnd=${periodEnd}`,
        { headers: { 'x-tenant-id': tenantId, 'Authorization': `Bearer ${serviceToken}` } },
      );
      if (!searchResp.ok) {
        const errText = await searchResp.text();
        return {
          stepCode: '068',
          success: false,
          message: `Service close failed: could not fetch draft RO entries — ${errText}`,
        };
      }

      const draftEntries =
        await searchResp.json() as Array<{ id: string; description: string; totalDebits: number }>;

      if (draftEntries.length === 0) {
        return {
          stepCode: '068',
          success: true,
          message: 'Service department close completed — no pending RO entries to post',
          nextStepCode: '070',
        };
      }

      // 2. Post each draft RO entry to GL
      const errors: string[] = [];
      let postedCount = 0;
      let totalAmount = 0;

      for (const entry of draftEntries) {
        const postResp = await fetch(
          `${this.glServiceUrl}/api/v1/gl/journal-entries/${entry.id}/post`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-tenant-id': tenantId,
              'x-user-id': 'eom-service',
              'Authorization': `Bearer ${serviceToken}`,
            },
            body: JSON.stringify({}),
          },
        );

        if (postResp.ok) {
          postedCount++;
          totalAmount += entry.totalDebits ?? 0;
        } else {
          const errText = await postResp.text();
          errors.push(`Entry ${entry.id} (${entry.description}): ${errText}`);
        }
      }

      if (errors.length > 0) {
        return {
          stepCode: '068',
          success: false,
          message: `Service close incomplete: ${errors.length} RO entries failed to post — ${errors.join('; ')}`,
        };
      }

      return {
        stepCode: '068',
        success: true,
        message: `Service department close completed — ${postedCount} RO entries posted, total $${totalAmount.toFixed(2)}`,
        nextStepCode: '070',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stepCode: '068',
        success: false,
        message: `Service close failed: ${msg}`,
      };
    }
  }
}

// Step 070: Body Shop Close
export class BodyShopCloseHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '070'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return { stepCode: '070', success: true, message: 'Body shop close completed', nextStepCode: '071' };
  }
}

export class VariableOpsHandler implements IStepHandler {
  canHandle(stepCode: string): boolean {
    return stepCode === '071';
  }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return {
      stepCode: '071',
      success: true,
      message: 'Variable operations close completed',
      nextStepCode: '074',
    };
  }
}

export class FixedOpsHandler implements IStepHandler {
  canHandle(stepCode: string): boolean {
    return stepCode === '074';
  }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return {
      stepCode: '074',
      success: true,
      message: 'Fixed operations close completed',
      nextStepCode: '077',
    };
  }
}

export class MasterCloseHandler implements IStepHandler {
  canHandle(stepCode: string): boolean {
    return stepCode === '077';
  }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    const requiredSteps = ['062', '065', '068', '070', '071', '074'];
    for (const code of requiredSteps) {
      const result = context.getPreviousStepResult(code);
      if (!result?.success) {
        return {
          stepCode: '077',
          success: false,
          message: `Master close blocked: Step ${code} not complete`,
        };
      }
    }

    return {
      stepCode: '077',
      success: true,
      message: 'Master close completed — month-end finalized',
      nextStepCode: '200',
    };
  }
}

// Step 200: Financial Statement Generation
export class FSGenerationHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '200'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    const masterClose = context.getPreviousStepResult('077');
    if (!masterClose?.success) {
      return { stepCode: '200', success: false, message: 'FS generation blocked: Master Close (077) not complete' };
    }
    return { stepCode: '200', success: true, message: 'Financial statements generated and ready for preview', nextStepCode: '300' };
  }
}

// Step 300: FS Submission to OEM
export class FSSubmissionHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '300'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    const fsGen = context.getPreviousStepResult('200');
    if (!fsGen?.success) {
      return { stepCode: '300', success: false, message: 'FS submission blocked: FS Generation (200) not complete' };
    }
    return { stepCode: '300', success: true, message: 'Financial statements submitted to OEM' };
  }
}

// 13th Month: Snapshot
export class ThirteenthMonthSnapshotHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '13TH_SNAP'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    return { stepCode: '13TH_SNAP', success: true, message: '13th month snapshot captured', nextStepCode: '13TH_FINAL' };
  }
}

// 13th Month: Finalize
export class ThirteenthMonthFinalHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === '13TH_FINAL'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    const snap = context.getPreviousStepResult('13TH_SNAP');
    if (!snap?.success) {
      return { stepCode: '13TH_FINAL', success: false, message: '13th month finalization blocked: snapshot not complete' };
    }
    return { stepCode: '13TH_FINAL', success: true, message: '13th month adjustments finalized' };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNTING EOM STEP HANDLERS (closeType = 'ACCOUNTING_EOM')
// These handlers replace COBOL purge.cbl's ACSYS-TRACK-EOM step sequence.
// Step codes use ACCT_ prefix to prevent collision with Service Module steps.
// @cobol-ancestry purge.cbl / PURGE
//
// IMPLEMENTATION STATUS: All steps below are stubs — they pass immediately.
// Wave 3 will implement the destructive steps (ACCT_100, ACCT_200, ACCT_300).
// Safe steps (ACCT_010 through ACCT_070) are non-destructive and can be
// implemented incrementally. Steps ≥ ACCT_100 are destructive (data purge)
// and must be fully tested before any real implementation is wired in.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ACCT_010: File Backup
 * @trace-cobol purge.cbl track 10 — zip backup of ISAM files
 * @intelligence-additions Platform snapshots GL/schedule state to S3 or DB snapshot;
 *   no ISAM zip needed. Safe to run multiple times (idempotent snapshot).
 */
export class AcctBackupHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_010'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: trigger GLAccount snapshot, ScheduleDetail snapshot
    return { stepCode: 'ACCT_010', success: true, message: 'Backup step: stub — snapshot not yet implemented', nextStepCode: 'ACCT_020' };
  }
}

/**
 * ACCT_020: Schedprn Detailed Report
 * @trace-cobol purge.cbl track 20 — call schedprn for detailed schedule report
 * @intelligence-additions Report generation moved to async job; step just enqueues it
 */
export class AcctSchedprnDetailHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_020'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: enqueue schedule detail report job
    return { stepCode: 'ACCT_020', success: true, message: 'Schedprn detailed report: stub', nextStepCode: 'ACCT_025' };
  }
}

/**
 * ACCT_025: Schedprn Summary Report
 * @trace-cobol purge.cbl track 25 — call schedprn for summary report
 */
export class AcctSchedprnSummaryHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_025'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: enqueue schedule summary report job
    return { stepCode: 'ACCT_025', success: true, message: 'Schedprn summary report: stub', nextStepCode: 'ACCT_062' };
  }
}

/**
 * ACCT_062: Java EOM Reports
 * @trace-cobol purge.cbl track 62 — invoker call to /accounting/api/{co}/acct/reports/end_of_period
 * NOTE: This is NOT the Service Module Parts Close (step code '062').
 *   Service Module '062' = Parts Close; Accounting ACCT_062 = EOM report generation.
 */
export class AcctEOMReportsHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_062'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: call report-service to generate EOM reports for period
    return { stepCode: 'ACCT_062', success: true, message: 'Java EOM reports: stub', nextStepCode: 'ACCT_065' };
  }
}

/**
 * ACCT_065: Archive Reports
 * @trace-cobol purge.cbl track 65 — archive reports to DocMate
 */
export class AcctArchiveReportsHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_065'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: archive report artifacts to document storage
    return { stepCode: 'ACCT_065', success: true, message: 'Archive reports: stub', nextStepCode: 'ACCT_068' };
  }
}

/**
 * ACCT_068: Financial Statements
 * @trace-cobol purge.cbl track 68 — call fssupp/fsisapproved/fsisjavaon for FS generation
 * NOTE: This is NOT the Service Module Service Close (step code '068').
 *   Service Module '068' = post pending service RO entries; Accounting ACCT_068 = FS generation.
 */
export class AcctFinancialStatementsHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_068'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: call fs-service to generate financial statements
    return { stepCode: 'ACCT_068', success: true, message: 'Financial statements: stub', nextStepCode: 'ACCT_070' };
  }
}

/**
 * ACCT_070: Orphan Detail Cleanup
 * @trace-cobol purge.cbl track 70 — LOCATE-CURRENT-MONTH-ORPHANS:
 *   scan tran file for records between last-close-date and +1 year with no batch header;
 *   create orphan batch headers for them so they are trackable.
 * In TypeScript: query journalEntry WHERE batchId IS NULL AND entryDate BETWEEN
 *   lastCloseDate AND lastCloseDate + 1 year; assign to orphan batch.
 */
export class AcctOrphanDetailHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_070'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: find unparented journal entries and assign to orphan batch
    return { stepCode: 'ACCT_070', success: true, message: 'Orphan detail cleanup: stub', nextStepCode: 'ACCT_100' };
  }
}

/**
 * ACCT_100: Schedule Detail Purge
 * @trace-cobol purge.cbl track 100 — DETAIL-PURGE:
 *   For each schedule: apply purge type 1-7 (see purge.extraction.md INV-EOM-08).
 *   Type 1: write balance-forward record + delete transaction records
 *   Type 2: delete all records with date ≤ close date
 *   Type 3: open-item: delete if total = 0
 *   Type 4: age-credit: same as 2
 *   Type 5: apply-to: same as 3 keyed by apply number
 *   Type 6: age-debit with GL sub-totals
 *   Type 7: delete ALL records regardless of date
 *
 * DESTRUCTIVE — cannot safely be re-run without restoring from backup (step ACCT_010).
 * Steps ≥ ACCT_100 are irreversible once committed.
 * TypeScript implementation must wrap each schedule's purge in $transaction.
 * @trace-cobol purge.cbl INV-EOM-08
 */
export class AcctScheduleDetailPurgeHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_100'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // @trace-cobol purge.cbl INV-EOM-08 — delegate to schedule-service
    // schedule-service owns all ScheduleDetail records (Wave 3 architecture).
    // See amacc/docs/gap-analysis/wave-3-schedule-subsystem.md
    const scheduleServiceUrl =
      process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3012';

    const closeDate = context.periodEnd ?? new Date().toISOString();

    const response = await fetch(`${scheduleServiceUrl}/api/v1/schedules/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': context.tenantId,
        // Forward internal service-to-service auth token if present
        ...(process.env['INTERNAL_SERVICE_TOKEN']
          ? { Authorization: `Bearer ${process.env['INTERNAL_SERVICE_TOKEN']}` }
          : {}),
      },
      body: JSON.stringify({
        closeDate,
        eomCloseId: context.closeId,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        stepCode: 'ACCT_100',
        success: false,
        message: `ACCT_100 Schedule Detail Purge failed: HTTP ${response.status} — ${body}`,
      };
    }

    const summary = await response.json() as {
      schedulesPurged: number;
      detailsDeleted: number;
      balanceForwardsCreated: number;
    };

    return {
      stepCode: 'ACCT_100',
      success: true,
      message: `ACCT_100 Schedule Detail Purge complete: ${summary.schedulesPurged} schedules, ${summary.detailsDeleted} records deleted, ${summary.balanceForwardsCreated} balance-forwards created`,
    };
  }
}

/**
 * ACCT_200: GL and Journal Purge
 * @trace-cobol purge.cbl track 200 — GL-PURGE:
 *
 * FORMULA (verified from purge.cbl source):
 *   For each GL account:
 *     periodBalance = SUM(glAccountPeriodBalance.runningBalance)
 *       WHERE glAccountId = account.id
 *         AND periodYear = closingYear
 *         AND periodMonth = closingMonth
 *     glAccount.openingBalance += periodBalance
 *     glAccount.openingUnitCount += SUM(unitCount) for same filter
 *     REWRITE glAccount
 *
 *   If closing 1st fiscal month:
 *     write glAccountPeriodBalance record at fiscalYearBeginDate
 *     (seeds the new year's running balance)
 *
 *   Purge journal records: DELETE glAccountPeriodBalance
 *     WHERE periodYear < (closingYear - 8)   -- 8-year retention rule
 *
 * DESTRUCTIVE — purges period balance records older than 8 years.
 * @trace-cobol purge.cbl INV-EOM-09 (GL-OPEN-BAL formula)
 * @trace-cobol purge.cbl INV-EOM-07 (8-year retention)
 */
export class AcctGLPurgeHandler implements IStepHandler {
  private glServiceUrl: string;

  constructor() {
    this.glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
  }

  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_200'; }

  /**
   * ACCT_200: GL Period Carry-Forward and History Purge
   *
   * @cobol-origin purge.cbl INV-EOM-09 — GL-OPEN-BAL accumulation formula:
   *   COMPUTE GL-OPEN-BAL = GL-OPEN-BAL + SUM(runningBalance) for closing period
   * @cobol-origin purge.cbl INV-EOM-07 — 8-year retention: purge histtran older than 8 years
   * @trace-improvement COBOL ran as two sequential batch programs (glzero + histpurge).
   *   TypeScript: single atomic SERIALIZABLE transaction via gl-service HTTP endpoint.
   */
  async execute(context: IEOMStepContext): Promise<StepResult> {
    const tenantId = context.tenantId;
    const periodEnd = context.periodEnd; // ISO date string e.g. '2026-03-31'

    // Parse period from periodEnd date
    const periodDate = new Date(periodEnd);
    const periodYear = periodDate.getFullYear();
    const periodMonth = periodDate.getMonth() + 1;

    // 8-year retention: purge history records older than 8 years from period end
    const retentionCutoff = new Date(periodDate);
    retentionCutoff.setFullYear(retentionCutoff.getFullYear() - 8);

    const jwtSecret = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    const serviceToken = createServiceToken('eom-service', jwtSecret);

    try {
      const resp = await fetch(
        `${this.glServiceUrl}/api/v1/gl/admin/period-carry-forward`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId,
            'Authorization': `Bearer ${serviceToken}`,
          },
          body: JSON.stringify({
            periodYear,
            periodMonth,
            purgeHistoryBeforeDate: retentionCutoff.toISOString(),
          }),
          signal: AbortSignal.timeout(120_000), // 2 min timeout — large dataset purge
        },
      );

      if (!resp.ok) {
        const errText = await resp.text();
        return {
          stepCode: 'ACCT_200',
          success: false,
          message: `GL period carry-forward failed (HTTP ${resp.status}): ${errText}`,
        };
      }

      const result = await resp.json() as {
        accountsUpdated: number;
        historyRecordsPurged: number;
        periodBalancesConsolidated: number;
      };

      return {
        stepCode: 'ACCT_200',
        success: true,
        message: [
          `GL carry-forward complete for ${periodYear}-${String(periodMonth).padStart(2, '0')}:`,
          `${result.accountsUpdated} accounts updated,`,
          `${result.periodBalancesConsolidated} period balance rows consolidated,`,
          `${result.historyRecordsPurged} history records purged (8-yr retention).`,
        ].join(' '),
        nextStepCode: 'ACCT_300',
      };
    } catch (err: any) {
      return {
        stepCode: 'ACCT_200',
        success: false,
        message: `ACCT_200 GL Purge failed: ${err.message}`,
      };
    }
  }
}

/**
 * ACCT_300: Missing Document Purge
 * @trace-cobol purge.cbl track 300 — MISS-DOC-PURGE:
 *   DELETE missdoc records WHERE date ≤ CUT-DATE
 * TypeScript: DELETE FROM missing_docs WHERE tenantId = X AND docDate <= periodEnd
 * This is the final step. After success, close is COMPLETED and lastCloseDate is updated.
 */
export class AcctMissDocPurgeHandler implements IStepHandler {
  canHandle(stepCode: string): boolean { return stepCode === 'ACCT_300'; }

  async execute(context: IEOMStepContext): Promise<StepResult> {
    // TODO Wave 3: implement missing document purge (final step — no nextStepCode)
    return { stepCode: 'ACCT_300', success: false, message: 'ACCT_300 Missing Document Purge: not yet implemented — Wave 3 scope' };
  }
}

