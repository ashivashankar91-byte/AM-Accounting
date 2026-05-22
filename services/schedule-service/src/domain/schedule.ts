// @trace-cobol sched.rec, schedup.cbl, schedmgr.cbl
// Domain types for the Schedule sub-system

import { Prisma } from '.prisma/schedule-client';

// ---------------------------------------------------------------------------
// Schedule types (SD-TYPE in COBOL)
// Type 1: source+refno+date keyed — up to 5 GL accounts
// Type 2: contno+date keyed — 1 GL account; date=00000000 for balance-forward
// Type 3: contno+date keyed — up to 5 GL accounts; supports AR aging
// Type 4: same as type 2 (age-credit variant)
// Type 5: contno+applyno+applycd keyed — 1 GL account
// ---------------------------------------------------------------------------
export type ScheduleType = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// EOM purge codes (SD-EOM-PURGE in COBOL)
// @trace-cobol schedup.cbl C56357 — valid purge code per type table
// ---------------------------------------------------------------------------
export type EomPurgeType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// EOM purge codes allowed per schedule type
// @trace-cobol schedup.cbl EVALUATE SD-TYPE ALSO SD-EOM-PURGE
export const VALID_PURGE_CODES_BY_TYPE: Record<ScheduleType, EomPurgeType[]> = {
  1: [1],
  2: [2],
  3: [1, 3, 6, 7],
  4: [4],
  5: [5],
};

// ---------------------------------------------------------------------------
// Type change compatibility matrix
// @trace-cobol schedmgr.cbl 3000-EVALUATE
// Only these from→to pairs are allowed without programmer intervention
// ---------------------------------------------------------------------------
const COMPATIBLE_TYPE_CHANGES = new Set<string>([
  '1→1', '2→2', '2→4', '3→3', '4→2', '4→4', '5→5',
]);

export function isCompatibleTypeChange(from: ScheduleType, to: ScheduleType): boolean {
  return COMPATIBLE_TYPE_CHANGES.has(`${from}→${to}`);
}

// ---------------------------------------------------------------------------
// Report sort sequences (SD-RPT-SEQ in COBOL)
// @trace-cobol schedprn.cbl — C=control#, N=name, A=age
// ---------------------------------------------------------------------------
export type ReportSequence = 'C' | 'N' | 'A';

// ---------------------------------------------------------------------------
// Control name display flags (SD-CONT-NAMES in COBOL)
// @trace-cobol schedprn.cbl 1000-COLLECT-SCHEDULE-TYPES
// ---------------------------------------------------------------------------
export type ControlNameDisplay = 'Y' | '2' | 'D' | 'V' | 'S' | ' ';

// ---------------------------------------------------------------------------
// Domain DTOs
// ---------------------------------------------------------------------------

export interface CreateScheduleDto {
  scheduleNumber: string;  // 2-char, e.g. "01"
  title: string;
  reportSequence?: ReportSequence;
  scheduleType: ScheduleType;
  glAccountNumbers: string[];   // 1–5 items; types 2/4/5 allow only 1
  eomPurgeType: EomPurgeType;
  controlNameDisplay?: ControlNameDisplay;
}

export interface UpdateScheduleDto {
  title?: string;
  reportSequence?: ReportSequence;
  scheduleType?: ScheduleType;
  glAccountNumbers?: string[];
  eomPurgeType?: EomPurgeType;
  controlNameDisplay?: ControlNameDisplay;
}

export interface CreateScheduleDetailDto {
  scheduleNumber: string;
  controlNumber: string;
  amount: Prisma.Decimal | string | number;
  referenceNumber?: string;
  journalSource?: string;
  transactionDate?: Date;
  glAccountNumber?: string;
  description?: string;
  isBalanceForward?: boolean;
  balanceCurrent?: Prisma.Decimal | string;
  balanceOver30?: Prisma.Decimal | string;
  balanceOver60?: Prisma.Decimal | string;
  balanceOver90?: Prisma.Decimal | string;
  applyNumber?: string;
  applyCd?: string;
  journalEntryId?: string;
}

export interface UpdateScheduleDetailDto {
  amount?: Prisma.Decimal | string;
  referenceNumber?: string;
  journalSource?: string;
  transactionDate?: Date;
  description?: string;
  balanceCurrent?: Prisma.Decimal | string;
  balanceOver30?: Prisma.Decimal | string;
  balanceOver60?: Prisma.Decimal | string;
  balanceOver90?: Prisma.Decimal | string;
  // @trace-cobol komdetail.cbl APPLY-NUMBER / APPLY-CD fields
  applyNumber?: string | null;
  applyCd?: string | null;
}

export interface DetailFilters {
  controlNumber?: string;
  glAccountNumber?: string;
  fromDate?: Date;
  toDate?: Date;
  includeBalanceForward?: boolean;
}

export interface PurgeRequest {
  tenantId: string;
  closeDate: Date;
  eomCloseId: string;
}

/** Per-schedule breakdown used by previewPurge */
export interface PurgePreviewSchedule {
  scheduleNumber: string;
  scheduleTitle: string;
  purgeType: EomPurgeType;
  /** Records that will be deleted */
  recordsToDelete: number;
  /** Balance-forward records that will be CREATED to replace deleted records (type 1 only) */
  balanceForwardsToCreate: number;
  /** Net change in record count after purge */
  netRecordChange: number;
}

export interface PurgeSummary {
  tenantId: string;
  closeDate: Date;
  eomCloseId: string;
  schedulesPurged: number;
  detailsProcessed: number;
  detailsDeleted: number;
  balanceForwardsCreated: number;
  /** Present only in preview (dry-run) responses */
  preview?: PurgePreviewSchedule[];
}

export interface ScheduleReportRequest {
  tenantId: string;
  userId: string;
  scheduleNumber?: string;         // undefined = all schedules
  format: 'DETAIL' | 'SUMMARY';
  includeZeroBalance: boolean;
  cutoffDate: Date;
  sortSequence?: ReportSequence;
  includeApplySubtotals?: boolean; // type 5 only
}

export interface ScheduleReportLine {
  scheduleNumber: string;
  controlNumber: string;
  controlName: string | null;
  date: Date | null;
  source: string | null;
  referenceNumber: string | null;
  description: string | null;
  // Up to 5 amount columns — one per GL on the schedule
  amounts: Prisma.Decimal[];
  ageDays: number | null;
  applyNumber: string | null;
  applyCd: string | null;
  isBalanceForward: boolean;
  agingBuckets: {
    current: Prisma.Decimal;
    over30: Prisma.Decimal;
    over60: Prisma.Decimal;
    over90: Prisma.Decimal;
  } | null;
}

export interface ScheduleReportControlTotal {
  controlNumber: string;
  controlName: string | null;
  glTotals: Prisma.Decimal[];
  overallTotal: Prisma.Decimal;
  transactionCount: number;
  ageDays: number | null;
}

export interface ScheduleReportSection {
  scheduleNumber: string;
  scheduleTitle: string;
  scheduleType: ScheduleType;
  glAccountNumbers: string[];
  lines: ScheduleReportLine[];
  controlTotals: ScheduleReportControlTotal[];
  grandTotal: Prisma.Decimal;
  isOutOfBalance: boolean;
  latestTransactionDate: Date | null;
  hasDateWarning: boolean;
}

export interface ScheduleReport {
  generatedAt: Date;
  cutoffDate: Date;
  format: 'DETAIL' | 'SUMMARY';
  sections: ScheduleReportSection[];
}
