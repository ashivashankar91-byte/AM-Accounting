/**
 * @module finance-charge-job
 * @cobol-origin finchg.cbl — FINANCE-CHARGE-CALC paragraph
 * @trace-cobol
 *   COBOL: READ schedule details WHERE applyCd = ' ' AND amount > 0
 *          COMPUTE FC-AMT = HI-AMT * FC-RATE / 100
 *          POST GL journal entry: DR FINANCE-CHARGE-REC-ACCT / CR FINANCE-CHARGE-REV-ACCT
 *          SET HI-APPLY-CD = 'F' to mark as finance-charged
 *
 * @trace-improvement
 *   COBOL ran as a daily/monthly batch job on the file server.
 *   TypeScript: HTTP-callable job that can be triggered by a cron or admin endpoint.
 *   Service boundaries: reads schedules from schedule-service, submits to CE-07 posting engine.
 *   No direct Prisma — apar-service does not own GL or schedule data.
 *   CE-09 integration: direct GL writes replaced with governed posting engine path.
 */

// @cert-only: rule-pack fixture for certification is in tests/fixtures/finance-charge-rule-pack.json

import { Decimal } from '@prisma/client/runtime/library';

export interface FinanceChargeConfig {
  /** Annual percentage rate, e.g. 18.0 for 18% APR */
  annualRatePercent: number;
  /** Minimum balance subject to finance charge, e.g. 0.01 */
  minimumBalance: number;
  /** Journal source code for the GL entry, e.g. "FC" */
  journalSource: string;
  /** Grace period in days — balances aged ≤ this number are exempt */
  gracePeriodDays: number;
  /** Legal entity scope for this run — required for CE-07 posting engine */
  legalEntityId?: string | null;
}

export interface FinanceChargeResult {
  tenantId: string;
  runDate: string;
  schedulesProcessed: number;
  controlNumbersCharged: number;
  totalFinanceCharge: number;
  journalEntryId: string | null;
  postingExecutionId?: string | null;
  eventId?: string | null;
  errors: string[];
}

/**
 * Calculate and post finance charges for all overdue schedule detail balances.
 *
 * @cobol-origin finchg.cbl FINANCE-CHARGE-CALC + POST-FC-JOURNAL paragraphs
 */
export class FinanceChargeJob {
  private scheduleServiceUrl: string;
  private postingEngineUrl: string;  // coa-service endpoint

  constructor(
    scheduleServiceUrl?: string,
    postingEngineUrl?: string,
  ) {
    this.scheduleServiceUrl = scheduleServiceUrl ?? process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3020';
    this.postingEngineUrl = postingEngineUrl ?? process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3030';
  }

  /**
   * Run finance charge calculation for the given tenant.
   *
   * @param tenantId        Tenant to process
   * @param asOfDate        Reference date for age calculation (default: today)
   * @param config          Finance charge parameters
   * @param serviceToken    JWT service-to-service token
   * @param dryRun          If true, calculate but do not post GL journal or update detail records
   */
  async run(
    tenantId: string,
    asOfDate: Date,
    config: FinanceChargeConfig,
    serviceToken: string,
    dryRun = false,
  ): Promise<FinanceChargeResult> {
    const errors: string[] = [];
    const runDate = asOfDate.toISOString();
    const headers = {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'Authorization': `Bearer ${serviceToken}`,
    };

    // Step 1: Fetch all schedules for this tenant
    const schedulesResp = await fetch(`${this.scheduleServiceUrl}/api/v1/schedules`, { headers });
    if (!schedulesResp.ok) {
      return {
        tenantId, runDate, schedulesProcessed: 0, controlNumbersCharged: 0,
        totalFinanceCharge: 0, journalEntryId: null,
        errors: [`Failed to fetch schedules: HTTP ${schedulesResp.status}`],
      };
    }
    const schedules: Array<{ scheduleNumber: string }> = await schedulesResp.json() as any;

    // Step 2: For each schedule, fetch eligible detail records
    // @cobol-origin finchg.cbl: eligible = applyCd = ' ' (uncharged), amount > 0, age > gracePeriod
    const chargesByControlNumber = new Map<string, { totalAmount: Decimal; scheduleNumber: string }>();

    let schedulesProcessed = 0;

    for (const schedule of schedules) {
      const detailsResp = await fetch(
        `${this.scheduleServiceUrl}/api/v1/schedules/${schedule.scheduleNumber}/details?includeBalanceForward=false`,
        { headers },
      );
      if (!detailsResp.ok) {
        errors.push(`Could not fetch details for schedule ${schedule.scheduleNumber}: HTTP ${detailsResp.status}`);
        continue;
      }
      const details: Array<{
        id: string;
        controlNumber: string;
        amount: string;
        applyCd: string | null;
        transactionDate: string | null;
        isBalanceForward: boolean;
      }> = await detailsResp.json() as any;

      for (const detail of details) {
        // Filter: only uncharged (applyCd blank/null), positive amount, over grace period
        if (detail.applyCd && detail.applyCd.trim() !== '') continue;
        const amount = new Decimal(detail.amount);
        if (amount.lessThanOrEqualTo(new Decimal(config.minimumBalance))) continue;
        if (detail.transactionDate) {
          const ageDays = Math.floor(
            (asOfDate.getTime() - new Date(detail.transactionDate).getTime()) / 86_400_000,
          );
          if (ageDays <= config.gracePeriodDays) continue;
        }

        // Accumulate by controlNumber for journal entry aggregation
        const existing = chargesByControlNumber.get(detail.controlNumber);
        if (existing) {
          existing.totalAmount = existing.totalAmount.plus(amount);
        } else {
          chargesByControlNumber.set(detail.controlNumber, {
            totalAmount: amount,
            scheduleNumber: schedule.scheduleNumber,
          });
        }
      }

      schedulesProcessed++;
    }

    if (chargesByControlNumber.size === 0) {
      return {
        tenantId, runDate, schedulesProcessed, controlNumbersCharged: 0,
        totalFinanceCharge: 0, journalEntryId: null, errors,
      };
    }

    // Step 3: Calculate finance charges
    // @cobol-origin finchg.cbl: FC-AMT = BALANCE * (ANNUAL-RATE / 1200)  (monthly rate)
    const monthlyRate = new Decimal(config.annualRatePercent).dividedBy(1200);
    const journalLines: Array<{ controlNumber: string; chargeAmount: string; memo: string }> = [];
    let totalFinanceCharge = new Decimal(0);

    for (const [controlNumber, data] of chargesByControlNumber) {
      const fcAmount = data.totalAmount.times(monthlyRate).toDecimalPlaces(2);
      if (fcAmount.lessThan(new Decimal('0.01'))) continue; // below minimum charge

      totalFinanceCharge = totalFinanceCharge.plus(fcAmount);
      journalLines.push({
        controlNumber,
        chargeAmount: fcAmount.toFixed(2),
        memo: `Finance charge — control ${controlNumber}`,
      });
    }

    if (journalLines.length === 0 || dryRun) {
      return {
        tenantId, runDate, schedulesProcessed,
        controlNumbersCharged: chargesByControlNumber.size,
        totalFinanceCharge: totalFinanceCharge.toNumber(), journalEntryId: null, errors,
      };
    }

    // Step 4: Submit FINANCE_CHARGE_CALCULATED event to the CE-07 governed posting engine.
    // @cobol-origin finchg.cbl POST-FC-JOURNAL paragraph
    // Account resolution is now owned by the posting engine rule pack — zero direct GL writes.
    const legalEntityId = config.legalEntityId ?? null;
    const eventId = `fc-${tenantId}-${legalEntityId ?? 'nole'}-${asOfDate.toISOString().substring(0, 10)}-${config.journalSource}`;
    const financeChargeEvent = {
      eventId,
      eventType: 'FINANCE_CHARGE_CALCULATED',
      eventSchemaVersion: '1',
      sourceSystem: 'apar-service',
      sourceEntityType: 'FinanceChargeRun',
      sourceEntityId: `${tenantId}-${asOfDate.toISOString().substring(0, 10)}`,
      tenantId,
      legalEntityId,
      correlationId: `fc-run-${tenantId}-${asOfDate.toISOString().substring(0, 10)}`,
      occurredAt: new Date().toISOString(),
      businessDate: asOfDate.toISOString().substring(0, 10),
      payload: {
        tenantId,
        legalEntityId,
        runDate: asOfDate.toISOString().substring(0, 10),
        totalFinanceCharge: totalFinanceCharge.toFixed(2),
        controlNumbers: [...chargesByControlNumber.keys()],
        ratePercent: config.annualRatePercent,
        gracePeriodDays: config.gracePeriodDays,
        journalSource: config.journalSource,
        lines: journalLines,
      },
    };

    const postingResp = await fetch(`${this.postingEngineUrl}/api/v1/coa/posting-engine/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, Authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify(financeChargeEvent),
    });

    if (!postingResp.ok) {
      const errBody = await postingResp.json().catch(() => ({})) as any;
      // Missing rule-pack mapping (400/422/NO_RULE_MATCH): zero GL mutation — return error, no journal created.
      errors.push(`Posting engine rejected FINANCE_CHARGE_CALCULATED: HTTP ${postingResp.status} ${JSON.stringify(errBody)}`);
      return {
        tenantId, runDate, schedulesProcessed,
        controlNumbersCharged: chargesByControlNumber.size,
        totalFinanceCharge: totalFinanceCharge.toNumber(), journalEntryId: null,
        postingExecutionId: errBody?.executionId ?? null,
        eventId,
        errors,
      };
    }

    const postingResult = await postingResp.json() as { status?: string; journalEntryId?: string | null; executionId?: string | null };
    if (postingResult.status === 'REJECTED' || postingResult.status === 'NO_RULE_MATCH' || postingResult.status === 'FAILED') {
      errors.push(`Posting engine returned ${postingResult.status} for FINANCE_CHARGE_CALCULATED — no GL mutation`);
      return {
        tenantId, runDate, schedulesProcessed,
        controlNumbersCharged: chargesByControlNumber.size,
        totalFinanceCharge: totalFinanceCharge.toNumber(), journalEntryId: null,
        postingExecutionId: (postingResult as any).executionId ?? null,
        eventId,
        errors,
      };
    }

    return {
      tenantId, runDate, schedulesProcessed,
      controlNumbersCharged: chargesByControlNumber.size,
      totalFinanceCharge: totalFinanceCharge.toNumber(),
      journalEntryId: postingResult.journalEntryId ?? null,
      postingExecutionId: (postingResult as any).executionId ?? null,
      eventId,
      errors,
    };
  }
}
