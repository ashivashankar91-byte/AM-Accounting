// AMACC dashboard rebuild — Command Center exception aggregation.
//
// Value doctrine (build brief): "This is a work queue, not a report" and
// every tile must pass the dollars/action/comparator/exception tests. This
// module assembles real `ExceptionItem[]` rows (see metrics/types.ts) from
// existing, already-real backend endpoints — no mock data, per the brief's
// explicit "a tile backed by a mock is worse than no tile" rule:
//
//  - Schedule variance: schedule-service tie-outs (schedule_gl_tie_outs),
//    status=DISCREPANCY rows — sub-ledger vs. GL control-account mismatch.
//  - Floorplan trust position: gl-service floor-plan units where the unit
//    is sold (vehicle_status=SOLD) but still on an open floorplan payable
//    (payoff_date is null) — a covenant/legal event, never suppressed.
//  - Unposted journal entries: gl-service journal entries in DRAFT status.
//
// Every surface must call this module rather than reimplementing any of
// these exception queries locally (acceptance criterion: "No metric is
// computed in more than one place").

import { scheduleApi, glApi } from '../api/client';
import type { ExceptionItem } from './types';
import { daysBetween } from './formulas';

// Every loader below fetches synchronously right before building its
// ExceptionItem, so "now" at fetch time is the honest as-of timestamp for
// that tile — there is no separate backend-computed freshness signal on
// any of these 3 endpoints today (see AUDIT.md A4). Freshness is always
// derived, never hardcoded to "LIVE".
function freshnessFor(asOf: Date): ExceptionItem['dataFreshness'] {
  const ageMinutes = (Date.now() - asOf.getTime()) / 60_000;
  if (ageMinutes < 1) return 'LIVE';
  if (ageMinutes < 15) return 'RECENT';
  return 'STALE';
}

function toException(item: Omit<ExceptionItem, 'asOf' | 'dataFreshness'>, fetchedAt: Date): ExceptionItem {
  return { ...item, asOf: fetchedAt.toISOString(), dataFreshness: freshnessFor(fetchedAt) };
}

/** Schedule sub-ledger vs. GL control-account variance — always an exception when non-zero. */
export async function loadScheduleVarianceExceptions(): Promise<ExceptionItem[]> {
  const fetchedAt = new Date();
  const rows = await scheduleApi.getTieOuts('latest=true');
  const discrepancies = (rows ?? []).filter((r: any) => r.status === 'DISCREPANCY');
  if (discrepancies.length === 0) return [];

  const totalVariance = discrepancies.reduce((sum: number, r: any) => sum + Math.abs(Number(r.variance ?? 0)), 0);
  const oldestAgeDays = discrepancies.reduce((max: number, r: any) => {
    const age = daysBetween(new Date(r.asOfDate), new Date());
    return Math.max(max, age);
  }, 0);

  return [
    toException({
      severity: totalVariance > 0 ? 'CRITICAL' : 'INFO',
      category: 'SCHEDULE_VARIANCE',
      count: discrepancies.length,
      exposureAmount: totalVariance,
      oldestAgeDays,
      owner: 'Controller',
      reason: `${discrepancies.length} schedule/GL control-account tie-out${discrepancies.length === 1 ? '' : 's'} out of balance — sub-ledger detail does not equal the GL control balance.`,
      resolutionHint: 'Review each schedule detail against its GL control account and post a correcting entry or adjust the open-item application.',
      drillThroughUrl: '/accounting/schedules/open-items?tab=tieout',
    }, fetchedAt),
  ];
}

/** Units sold/delivered while still on an open floorplan payable — a covenant and legal event. */
export async function loadFloorplanTrustExceptions(): Promise<ExceptionItem[]> {
  const fetchedAt = new Date();
  const res = await glApi.listFloorPlanUnits('status=ACTIVE');
  const units = (res?.units ?? []) as Array<{
    vin: string;
    current_balance: number;
    vehicle_status?: string;
    payoff_date?: string | null;
    floor_date?: string;
  }>;
  const outOfTrust = units.filter((u) => u.vehicle_status === 'SOLD' && !u.payoff_date);
  if (outOfTrust.length === 0) return [];

  const totalExposure = outOfTrust.reduce((sum, u) => sum + u.current_balance, 0);
  // `floor_date` (when the unit went on the floorplan line) is the only real
  // date this endpoint carries — there is no dedicated "sold date" field in
  // the current data model, so age here is genuinely "days on floorplan",
  // not "days since sale". Labelled honestly rather than implying more
  // precision than the underlying data supports.
  const oldestAgeDays = outOfTrust.reduce((max, u) => {
    const age = u.floor_date ? daysBetween(new Date(u.floor_date), new Date()) : 0;
    return Math.max(max, age);
  }, 0);

  return [
    toException({
      severity: 'CRITICAL',
      category: 'FLOORPLAN_TRUST',
      count: outOfTrust.length,
      exposureAmount: totalExposure,
      oldestAgeDays,
      owner: 'Controller',
      reason: `${outOfTrust.length} unit${outOfTrust.length === 1 ? '' : 's'} sold and still on an open floorplan payable — out of trust with the lender. This is a covenant and legal event.`,
      resolutionHint: 'Pay off the floorplan line for each sold unit immediately; confirm curtailment schedule compliance with the lender.',
      // FloorPlanFinancing now honors ?filter=out-of-trust to pre-filter
      // the track-tab list to exactly these units (vehicle_status=SOLD and
      // no payoff_date) — the drill-through lands the controller directly
      // on the exposure, not the full ACTIVE list.
      drillThroughUrl: '/recon?tab=floor-plan&filter=out-of-trust',
    }, fetchedAt),
  ];
}

/** Unposted (DRAFT) journal entries — delays revenue/expense recognition. */
export async function loadUnpostedJournalEntryExceptions(): Promise<ExceptionItem[]> {
  const fetchedAt = new Date();
  const entries = await glApi.getEntries('status=DRAFT');
  const drafts = entries ?? [];
  if (drafts.length === 0) return [];

  const totalAmount = drafts.reduce((sum: number, e: any) => {
    const lineTotal = (e.lines ?? []).reduce((ls: number, l: any) => ls + Number(l.debit ?? 0), 0);
    return sum + lineTotal;
  }, 0);
  const oldestAgeDays = drafts.reduce((max: number, e: any) => {
    // The GL journal-entries API does not return a createdAt timestamp;
    // entryDate is the accounting-relevant date and the closest available
    // proxy for "how long has this draft been outstanding".
    const age = daysBetween(new Date(e.entryDate), new Date());
    return Number.isFinite(age) ? Math.max(max, age) : max;
  }, 0);

  return [
    toException({
      severity: drafts.length > 5 ? 'CRITICAL' : 'WARNING',
      category: 'UNPOSTED_JOURNAL_ENTRIES',
      count: drafts.length,
      exposureAmount: totalAmount,
      oldestAgeDays,
      owner: 'Controller',
      reason: `${drafts.length} journal entr${drafts.length === 1 ? 'y' : 'ies'} in DRAFT status — revenue and expense recognition delayed until posted.`,
      resolutionHint: 'Review and post each draft entry, or route to the assigned approver.',
      drillThroughUrl: '/accounting/gl?status=DRAFT',
    }, fetchedAt),
  ];
}

/** Loads every Command Center exception in parallel. A failure loading one
 * category never blanks the others (Promise.allSettled) — but a failure is
 * surfaced, never silently swallowed into an empty/zero result, per the
 * brief's "do not silently swallow a failed aggregate" rule. */
export interface ExceptionQueueResult {
  exceptions: ExceptionItem[];
  failedCategories: string[];
}

export async function loadCommandCenterExceptions(): Promise<ExceptionQueueResult> {
  const loaders: Array<{ category: string; load: () => Promise<ExceptionItem[]> }> = [
    { category: 'SCHEDULE_VARIANCE', load: loadScheduleVarianceExceptions },
    { category: 'FLOORPLAN_TRUST', load: loadFloorplanTrustExceptions },
    { category: 'UNPOSTED_JOURNAL_ENTRIES', load: loadUnpostedJournalEntryExceptions },
  ];

  const results = await Promise.allSettled(loaders.map((l) => l.load()));
  const exceptions: ExceptionItem[] = [];
  const failedCategories: string[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      exceptions.push(...result.value);
    } else {
      failedCategories.push(loaders[i].category);
    }
  });

  const severityOrder: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  exceptions.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return { exceptions, failedCategories };
}
