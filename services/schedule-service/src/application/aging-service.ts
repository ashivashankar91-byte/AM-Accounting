// @wave S027 — Schedule Aging Engine.
// Builds exclusively from S026's ScheduleOpenItem.remainingBalance — never
// re-derives from raw ScheduleDetail lines — so the aging report reconciles
// to S026 totals by construction. See
// docs/accounting-modernization/S026_S027_IMPLEMENTATION_CONTRACT.md.
import { injectable, inject } from 'tsyringe';
import { Prisma } from '.prisma/schedule-client';
import {
  AgingBucketDef,
  DEFAULT_AGING_BUCKETS,
  classifyBucket,
  ageInDays,
  validateAgingBuckets,
} from '../domain/aging';
import { SCHEDULE_OPEN_ITEM_REPO_TOKEN } from './open-item-service';
import type { AgeableFilters, IScheduleOpenItemRepository } from '../infrastructure/schedule-open-item-repository';
import type { IScheduleAgingConfigRepository } from '../infrastructure/schedule-aging-config-repository';

export const SCHEDULE_AGING_CONFIG_REPO_TOKEN = 'IScheduleAgingConfigRepository';

export interface AgingReportFilters extends AgeableFilters {
  asOfDate?: Date;
}

export interface AgingBucketTotal {
  label: string;
  total: string;
  itemCount: number;
}

export interface AgingReportRow {
  scheduleNumber: string;
  controlNumber: string;
  itemNumber: string;
  glAccountNumber: string | null;
  originalAmount: string;
  remainingBalance: string;
  ageDays: number;
  bucket: string;
  dueDate: string | null;
  status: string;
}

export interface AgingReport {
  asOfDate: string;
  buckets: AgingBucketDef[];
  bucketTotals: AgingBucketTotal[];
  rows: AgingReportRow[];
  grandTotal: string;
  reconciliation: {
    agingTotal: string;
    openItemTotal: string;
    matches: boolean;
  };
}

@injectable()
export class AgingService {
  constructor(
    @inject(SCHEDULE_OPEN_ITEM_REPO_TOKEN) private readonly openItemRepo: IScheduleOpenItemRepository,
    @inject(SCHEDULE_AGING_CONFIG_REPO_TOKEN) private readonly configRepo: IScheduleAgingConfigRepository,
  ) {}

  async getBucketConfig(tenantId: string): Promise<AgingBucketDef[]> {
    const row = await this.configRepo.get(tenantId);
    if (!row) return DEFAULT_AGING_BUCKETS;
    return validateAgingBuckets(row.buckets);
  }

  async setBucketConfig(tenantId: string, buckets: unknown, updatedBy?: string): Promise<AgingBucketDef[]> {
    const validated = validateAgingBuckets(buckets);
    await this.configRepo.upsert(tenantId, validated, updatedBy);
    return validated;
  }

  // @trace-cobol schedprn.cbl age = cutoffDate - transactionDate (Julian
  // date diff). S027: age is computed from dueDate, falling back to
  // transactionDate when dueDate is null — the item's own posting date is
  // the closest available proxy for "when it became due" absent an explicit
  // due date.
  async getAgingReport(tenantId: string, filters: AgingReportFilters = {}): Promise<AgingReport> {
    const asOfDate = filters.asOfDate ?? new Date();
    const buckets = await this.getBucketConfig(tenantId);

    const items = await this.openItemRepo.findAgeable(tenantId, filters);

    const bucketTotalsMap = new Map<string, { total: Prisma.Decimal; count: number }>();
    for (const b of buckets) bucketTotalsMap.set(b.label, { total: new Prisma.Decimal(0), count: 0 });

    const rows: AgingReportRow[] = [];
    let grandTotal = new Prisma.Decimal(0);

    for (const item of items) {
      const referenceDate = item.dueDate ?? item.transactionDate;
      const age = referenceDate ? ageInDays(referenceDate, asOfDate) : 0;
      const bucket = classifyBucket(age, buckets);

      const entry = bucketTotalsMap.get(bucket) ?? { total: new Prisma.Decimal(0), count: 0 };
      entry.total = entry.total.add(item.remainingBalance);
      entry.count += 1;
      bucketTotalsMap.set(bucket, entry);

      grandTotal = grandTotal.add(item.remainingBalance);

      rows.push({
        scheduleNumber: item.scheduleNumber,
        controlNumber: item.controlNumber,
        itemNumber: item.itemNumber,
        glAccountNumber: item.glAccountNumber,
        originalAmount: item.originalAmount.toFixed(2),
        remainingBalance: item.remainingBalance.toFixed(2),
        ageDays: age,
        bucket,
        dueDate: item.dueDate ? item.dueDate.toISOString() : null,
        status: item.status,
      });
    }

    const bucketTotals: AgingBucketTotal[] = buckets.map((b) => {
      const entry = bucketTotalsMap.get(b.label)!;
      return { label: b.label, total: entry.total.toFixed(2), itemCount: entry.count };
    });

    // Independent reconciliation total — a fresh DB aggregate over the same
    // filter, not merely the sum this function just computed in memory.
    const openItemTotal = await this.openItemRepo.sumRemainingBalanceTotal(tenantId, filters);
    const agingTotal = grandTotal.toFixed(2);

    return {
      asOfDate: asOfDate.toISOString(),
      buckets,
      bucketTotals,
      rows,
      grandTotal: agingTotal,
      reconciliation: {
        agingTotal,
        openItemTotal,
        matches: agingTotal === openItemTotal,
      },
    };
  }
}
