// @trace-cobol schedup.cbl (schedule CRUD + GL orchestration),
//              schedmgr.cbl (GL linkage management),
//              schedprn.cbl (report generation)
// Application service — orchestrates all schedule operations

import { injectable, inject } from 'tsyringe';
import { Prisma } from '.prisma/schedule-client';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  CreateScheduleDetailDto,
  UpdateScheduleDetailDto,
  DetailFilters,
  PurgeRequest,
  PurgeSummary,
  ScheduleReportRequest,
  ScheduleReport,
  ScheduleType,
  EomPurgeType,
  VALID_PURGE_CODES_BY_TYPE,
  isCompatibleTypeChange,
  ScheduleReportSection,
  ScheduleReportLine,
  ScheduleReportControlTotal,
} from '../domain/schedule';
import {
  ScheduleNotFoundError,
  ScheduleDetailNotFoundError,
  ScheduleValidationError,
  IncompatibleTypeChangeError,
  InvalidPurgeCodeError,
  DuplicateGlAccountError,
  MultipleAccountsNotAllowedError,
  NoAccountsError,
  ScheduleAccessDeniedError,
  PendingEventsError,
} from '../domain/errors';
import { ageDays, sumAgingBuckets } from '../domain/schedule-utils';
import type { IScheduleRepository } from '../infrastructure/schedule-repository';
import type { IScheduleDetailRepository } from '../infrastructure/schedule-detail-repository';
import type { ISchedulePermissionRepository } from '../infrastructure/schedule-permission-repository';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

export const SCHEDULE_REPO_TOKEN = 'IScheduleRepository';
export const SCHEDULE_DETAIL_REPO_TOKEN = 'IScheduleDetailRepository';
export const SCHEDULE_PERMISSION_REPO_TOKEN = 'ISchedulePermissionRepository';
export const EVENT_PUBLISHER_TOKEN = 'IEventPublisher';

@injectable()
export class ScheduleApplicationService {
  constructor(
    @inject(SCHEDULE_REPO_TOKEN) private readonly scheduleRepo: IScheduleRepository,
    @inject(SCHEDULE_DETAIL_REPO_TOKEN) private readonly detailRepo: IScheduleDetailRepository,
    @inject(SCHEDULE_PERMISSION_REPO_TOKEN)
    private readonly permissionRepo: ISchedulePermissionRepository,
    @inject(EVENT_PUBLISHER_TOKEN) private readonly eventPublisher: IEventPublisher,
  ) {}

  // -------------------------------------------------------------------------
  // Schedule CRUD
  // @trace-cobol schedup.cbl WRITE-REC / DEL-REC
  // -------------------------------------------------------------------------

  async listSchedules(tenantId: string) {
    return this.scheduleRepo.findAll(tenantId);
  }

  async getSchedule(tenantId: string, scheduleNumber: string) {
    const schedule = await this.scheduleRepo.findById(tenantId, scheduleNumber);
    if (!schedule) throw new ScheduleNotFoundError(scheduleNumber);
    return schedule;
  }

  async createSchedule(tenantId: string, dto: CreateScheduleDto) {
    this.validateScheduleFields(dto.scheduleType as ScheduleType, dto.eomPurgeType as EomPurgeType, dto.glAccountNumbers, dto.title);
    return this.scheduleRepo.create(tenantId, dto);
  }

  async updateSchedule(tenantId: string, scheduleNumber: string, dto: UpdateScheduleDto) {
    const existing = await this.scheduleRepo.findById(tenantId, scheduleNumber);
    if (!existing) throw new ScheduleNotFoundError(scheduleNumber);

    const newType = (dto.scheduleType ?? existing.scheduleType) as ScheduleType;
    const newPurge = (dto.eomPurgeType ?? existing.eomPurgeType) as EomPurgeType;
    const newGls = dto.glAccountNumbers ?? (existing.glAccountNumbers as string[]);
    const newTitle = dto.title ?? existing.title;

    this.validateScheduleFields(newType, newPurge, newGls, newTitle);

    // @trace-cobol schedup.cbl DID-SCHED-TYPE-CHANGE
    // If type changed, check compatibility
    if (dto.scheduleType && dto.scheduleType !== existing.scheduleType) {
      const fromType = existing.scheduleType as ScheduleType;
      if (!isCompatibleTypeChange(fromType, newType)) {
        throw new IncompatibleTypeChangeError(fromType, newType);
      }
      // Convert existing detail records to new type
      // (For Wave 3 initial build: only self-to-self conversions are allowed,
      //  so this path is always a no-op for compatible changes)
    }

    // @trace-cobol schedup.cbl REVIEW-RESET-GL-SCHDNO / REVIEW-SET-GL-SCHDNO
    // If GL accounts changed, publish event for gl-service to update GL records
    const oldGls = existing.glAccountNumbers as string[];
    const removedGls = oldGls.filter((g) => !newGls.includes(g));
    const addedGls = newGls.filter((g) => !oldGls.includes(g));

    const updated = await this.scheduleRepo.update(tenantId, scheduleNumber, dto);

    if (removedGls.length > 0 || addedGls.length > 0) {
      await this.eventPublisher.publish(createEvent('SCHEDULE_GL_ACCOUNTS_CHANGED', tenantId, {
        scheduleNumber,
        removedGlAccountNumbers: removedGls,
        addedGlAccountNumbers: addedGls,
        scheduleType: newType,
      }));
    }

    return updated;
  }

  async deleteSchedule(tenantId: string, scheduleNumber: string) {
    const existing = await this.scheduleRepo.findById(tenantId, scheduleNumber);
    if (!existing) throw new ScheduleNotFoundError(scheduleNumber);

    // @trace-cobol schedup.cbl DEL-REC → schedmgr DS → delete all details
    await this.detailRepo.deleteBySchedule(tenantId, scheduleNumber);

    await this.scheduleRepo.delete(tenantId, scheduleNumber);

    // Notify gl-service to clear GL-SCHDNO on all linked accounts
    const gls = existing.glAccountNumbers as string[];
    if (gls.length > 0) {
      await this.eventPublisher.publish(createEvent('SCHEDULE_DELETED', tenantId, {
        scheduleNumber,
        glAccountNumbers: gls,
      }));
    }
  }

  // -------------------------------------------------------------------------
  // Schedule Detail CRUD
  // @trace-cobol komdetail.cbl DELETE / INSERT / REPLACE operations
  // -------------------------------------------------------------------------

  async listDetails(tenantId: string, scheduleNumber: string, filters?: DetailFilters) {
    await this.ensureScheduleExists(tenantId, scheduleNumber);
    return this.detailRepo.findBySchedule(tenantId, scheduleNumber, filters);
  }

  async getDetailSummary(tenantId: string, scheduleNumber: string) {
    await this.ensureScheduleExists(tenantId, scheduleNumber);
    return this.detailRepo.summarizeByControlNumber(tenantId, scheduleNumber);
  }

  async createDetail(tenantId: string, scheduleNumber: string, dto: CreateScheduleDetailDto) {
    await this.ensureScheduleExists(tenantId, scheduleNumber);
    return this.detailRepo.create(tenantId, { ...dto, scheduleNumber });
  }

  async deleteDetail(tenantId: string, scheduleNumber: string, detailId: string) {
    await this.ensureScheduleExists(tenantId, scheduleNumber);
    const detail = await this.detailRepo.findById(tenantId, detailId);
    if (!detail || detail.scheduleNumber !== scheduleNumber) {
      throw new ScheduleDetailNotFoundError(detailId);
    }
    await this.detailRepo.delete(tenantId, detailId);
  }

  // @trace-cobol komdetail.cbl REPLACE-DETAIL paragraph
  // @cobol-origin schedup.cbl EDT-DETAIL validation block — 6 field-level guards
  async updateDetail(
    tenantId: string,
    scheduleNumber: string,
    detailId: string,
    dto: UpdateScheduleDetailDto,
  ) {
    // V-1: Schedule must exist
    const schedule = await this.ensureScheduleExists(tenantId, scheduleNumber);

    // V-2: Detail must exist and belong to the named schedule
    const detail = await this.detailRepo.findById(tenantId, detailId);
    if (!detail || (detail as any).scheduleNumber !== scheduleNumber) {
      throw new ScheduleDetailNotFoundError(detailId);
    }

    // V-3: Amount is immutable on journal-originated entries
    // @trace-cobol komdetail.cbl JE-AMT-LOCK — if HI-JE-ID is set, amount cannot be changed
    if (dto.amount !== undefined && (detail as any).journalEntryId) {
      throw new ScheduleValidationError(
        'Amount cannot be changed on a detail record that originated from a journal entry posting.',
      );
    }

    // V-4: journalSource must be a valid 2-character source code
    if (dto.journalSource !== undefined && dto.journalSource !== null) {
      await this.validateJournalSource(tenantId, dto.journalSource);
    }

    // V-5: transactionDate must not be in the future
    if (dto.transactionDate !== undefined) {
      const now = new Date();
      if (dto.transactionDate > now) {
        throw new ScheduleValidationError(
          `Transaction date ${dto.transactionDate.toISOString()} cannot be in the future.`,
        );
      }
    }

    // V-6: Balance aging fields can only be edited on balance-forward records
    const hasAging =
      dto.balanceCurrent !== undefined ||
      dto.balanceOver30 !== undefined ||
      dto.balanceOver60 !== undefined ||
      dto.balanceOver90 !== undefined;
    if (hasAging && !(detail as any).isBalanceForward) {
      throw new ScheduleValidationError(
        'Balance aging fields (current/30/60/90) can only be updated on balance-forward records.',
      );
    }

    return this.detailRepo.update(tenantId, detailId, dto);
  }

  // @trace-cobol komdetail.cbl APPLY-NUMBER field update — sets apply/payment linkage
  // @cobol-improvement COBOL required a full record rewrite to change applyNumber.
  //   TypeScript: atomic PATCH on a single field.
  async updateDetailApplyNumber(
    tenantId: string,
    scheduleNumber: string,
    detailId: string,
    applyNumber: string | null,
    applyCd: string | null,
  ) {
    await this.ensureScheduleExists(tenantId, scheduleNumber);
    const detail = await this.detailRepo.findById(tenantId, detailId);
    if (!detail || (detail as any).scheduleNumber !== scheduleNumber) {
      throw new ScheduleDetailNotFoundError(detailId);
    }
    return this.detailRepo.update(tenantId, detailId, { applyNumber, applyCd });
  }

  /**
   * Validate a journal source code against the GL service.
   * @trace-cobol schedup.cbl SRC-CD-VALID — source code cross-check with SRCSYS-FILE
   */
  private async validateJournalSource(tenantId: string, sourceCode: string): Promise<void> {
    if (!sourceCode || !/^[A-Z0-9]{1,2}$/.test(sourceCode.toUpperCase())) {
      throw new ScheduleValidationError(
        `Invalid journal source code "${sourceCode}". Must be 1–2 uppercase alphanumeric characters.`,
      );
    }
    const glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
    try {
      const res = await fetch(
        `${glServiceUrl}/api/v1/gl/admin/journal-sources/${encodeURIComponent(sourceCode.toUpperCase())}`,
        { headers: { 'x-tenant-id': tenantId } },
      );
      if (res.status === 404) {
        throw new ScheduleValidationError(
          `Journal source code "${sourceCode}" is not registered in the GL system.`,
        );
      }
      if (!res.ok) {
        // GL service unreachable or error — fail open to avoid blocking edits on service issues
        // Log and continue; this is consistent with COBOL's approach of non-blocking source check
        console.warn(
          `[schedule-service] GL journal-source validation returned ${res.status} for source="${sourceCode}". Continuing.`,
        );
      }
    } catch (err: any) {
      if (err instanceof ScheduleValidationError) throw err;
      // Network failure — fail open (same as COBOL single-tenant where source table was local)
      console.warn(`[schedule-service] GL source validation network error: ${err.message}. Continuing.`);
    }
  }

  // -------------------------------------------------------------------------
  // EOM Purge
  // @trace-cobol purge.cbl step 100, purge.extraction.md INV-EOM-08
  // Called by eom-service ACCT_100 step handler
  // -------------------------------------------------------------------------

  async purgeAll(req: PurgeRequest): Promise<PurgeSummary> {
    const { tenantId, closeDate, eomCloseId } = req;

    const schedules = await this.scheduleRepo.findAll(tenantId);

    let schedulesPurged = 0;
    let detailsProcessed = 0;
    let detailsDeleted = 0;
    let balanceForwardsCreated = 0;

    for (const schedule of schedules) {
      const purgeType = schedule.eomPurgeType as EomPurgeType;
      const schedNo = schedule.scheduleNumber;

      const result = await this.purgeSchedule(tenantId, schedNo, purgeType, closeDate);

      schedulesPurged += 1;
      detailsProcessed += result.processed;
      detailsDeleted += result.deleted;
      balanceForwardsCreated += result.balanceForwardsCreated;
    }

    const summary: PurgeSummary = {
      tenantId,
      closeDate,
      eomCloseId,
      schedulesPurged,
      detailsProcessed,
      detailsDeleted,
      balanceForwardsCreated,
    };

    // Publish event for eom-service to advance ACCT_100
    await this.eventPublisher.publish(createEvent('SCHEDULE_PURGED', tenantId, {
      closeDate: closeDate.toISOString(),
      eomCloseId,
      schedulesPurged,
      detailsProcessed,
    }));

    return summary;
  }

  // @trace-cobol purge.cbl — dry-run preview before dealer approves ACCT_100
  // Returns per-schedule breakdown: records to delete, balance-forwards to create, net change.
  // Type 1 is special: it CREATES records while also deleting — the net change is
  //   (balanceForwardsToCreate - recordsToDelete), which may be positive for schedules
  //   with many GL columns but few control numbers.
  async previewPurge(tenantId: string, closeDate: Date): Promise<PurgeSummary> {
    const schedules = await this.scheduleRepo.findAll(tenantId);

    let totalToDelete = 0;
    let totalToCreate = 0;
    const scheduleBreakdown: import('../domain/schedule').PurgePreviewSchedule[] = [];

    for (const schedule of schedules) {
      const purgeType = schedule.eomPurgeType as EomPurgeType;
      const schedNo = schedule.scheduleNumber;
      let recordsToDelete = 0;
      let balanceForwardsToCreate = 0;

      if (purgeType === 1) {
        // Type 1: count non-BF records to delete, then count unique (controlNumber, glAccountNumber)
        // combinations to determine how many BF records will be created
        const details = await this.detailRepo.findBySchedule(tenantId, schedNo, {
          toDate: closeDate,
          includeBalanceForward: false,
        });
        recordsToDelete = details.length;
        // Count distinct (controlNumber, glAccountNumber) keys — each becomes one BF record
        const keys = new Set(details.map((d) => `${d.controlNumber}\x00${d.glAccountNumber ?? '__NULL__'}`));
        balanceForwardsToCreate = keys.size;
      } else {
        recordsToDelete = await this.detailRepo.countPurgeable(
          tenantId, schedNo, purgeType, closeDate,
        );
      }

      totalToDelete += recordsToDelete;
      totalToCreate += balanceForwardsToCreate;

      scheduleBreakdown.push({
        scheduleNumber: schedNo,
        scheduleTitle: schedule.title,
        purgeType,
        recordsToDelete,
        balanceForwardsToCreate,
        netRecordChange: balanceForwardsToCreate - recordsToDelete,
      });
    }

    return {
      tenantId,
      closeDate,
      eomCloseId: 'preview',
      schedulesPurged: schedules.length,
      detailsProcessed: totalToDelete,
      detailsDeleted: totalToDelete,
      balanceForwardsCreated: totalToCreate,
      preview: scheduleBreakdown,
    };
  }

  // -------------------------------------------------------------------------
  // Purge dispatch by type
  // @trace-cobol purge.extraction.md INV-EOM-08 — 7 purge algorithms
  // -------------------------------------------------------------------------

  private async purgeSchedule(
    tenantId: string,
    scheduleNumber: string,
    purgeType: EomPurgeType,
    closeDate: Date,
  ): Promise<{ processed: number; deleted: number; balanceForwardsCreated: number }> {
    switch (purgeType) {
      case 1:
        return this.purgeType1BalanceForward(tenantId, scheduleNumber, closeDate);
      case 2:
        return this.purgeType2DatePurge(tenantId, scheduleNumber, closeDate);
      case 3:
        return this.purgeType3ZeroBalance(tenantId, scheduleNumber);
      case 4:
        return this.purgeType4AgeCredit(tenantId, scheduleNumber, closeDate);
      case 5:
        return this.purgeType5ApplyToZero(tenantId, scheduleNumber);
      case 6:
        return this.purgeType6AgeDebit(tenantId, scheduleNumber, closeDate);
      case 7:
        return this.purgeType7DeleteAll(tenantId, scheduleNumber);
      default:
        return { processed: 0, deleted: 0, balanceForwardsCreated: 0 };
    }
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 1
  // @trace-cobol sched.fd SD-GL-ACCT(1..5) — each GL position is a separate column.
  // Write one balance-forward record per (controlNumber, glAccountNumber) combination.
  // A Type 1 schedule with 3 GL accounts must produce 3 separate balance-forward
  // records for each control number — one per GL column — so that the per-column
  // balances are preserved. Collapsing to a single amount per controlNumber would
  // discard the GL-column breakdown that the report (schedprn) needs.
  private async purgeType1BalanceForward(
    tenantId: string,
    scheduleNumber: string,
    closeDate: Date,
  ) {
    const details = await this.detailRepo.findBySchedule(tenantId, scheduleNumber, {
      toDate: closeDate,
      includeBalanceForward: false,
    });

    if (details.length === 0) return { processed: 0, deleted: 0, balanceForwardsCreated: 0 };

    // Group by (controlNumber, glAccountNumber) — preserves per-GL-column balances.
    // COBOL key: DE-SCHDNO + DE-CONTNO + DE-TYPE/GL + DE-SEQNO=9999 (balance-forward sentinel)
    const byKey = new Map<string, { controlNumber: string; glAccountNumber: string | null; total: Prisma.Decimal }>();
    for (const d of details) {
      // glAccountNumber may be null for legacy records — treat null as its own bucket
      const glKey = d.glAccountNumber ?? '__NULL__';
      const key = `${d.controlNumber}\x00${glKey}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.total = existing.total.add(d.amount);
      } else {
        byKey.set(key, {
          controlNumber: d.controlNumber,
          glAccountNumber: d.glAccountNumber ?? null,
          total: new Prisma.Decimal(d.amount),
        });
      }
    }

    let created = 0;
    // Write one balance-forward record per (controlNumber, GL account) combination
    for (const { controlNumber, glAccountNumber, total } of byKey.values()) {
      await this.detailRepo.create(tenantId, {
        scheduleNumber,
        controlNumber,
        glAccountNumber: glAccountNumber ?? undefined,
        amount: total,
        isBalanceForward: true,
        balanceCurrent: total,
        balanceOver30: new Prisma.Decimal(0),
        balanceOver60: new Prisma.Decimal(0),
        balanceOver90: new Prisma.Decimal(0),
        transactionDate: closeDate,
      });
      created++;
    }

    // Delete original (non-balance-forward) records dated on/before closeDate.
    // The balance-forward records we just wrote have isBalanceForward=true and will not be touched.
    const deleted = await this.detailRepo.deleteByScheduleBeforeDate(
      tenantId,
      scheduleNumber,
      closeDate,
      false, // includeBalanceForward=false → preserve the records we just created
    );

    return { processed: details.length, deleted, balanceForwardsCreated: created };
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 2
  // Delete all records with transactionDate <= closeDate
  private async purgeType2DatePurge(tenantId: string, scheduleNumber: string, closeDate: Date) {
    const details = await this.detailRepo.findBySchedule(tenantId, scheduleNumber, {
      toDate: closeDate,
    });
    const deleted = await this.detailRepo.deleteByScheduleBeforeDate(
      tenantId,
      scheduleNumber,
      closeDate,
      true,
    );
    return { processed: details.length, deleted, balanceForwardsCreated: 0 };
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 3
  // Delete all records for a controlNumber WHERE SUM(amount) = 0
  private async purgeType3ZeroBalance(tenantId: string, scheduleNumber: string) {
    const summaries = await this.detailRepo.summarizeByControlNumber(tenantId, scheduleNumber);
    let deleted = 0;
    let processed = 0;
    for (const s of summaries) {
      processed += s.transactionCount;
      if (new Prisma.Decimal(s.totalAmount).equals(new Prisma.Decimal(0))) {
        const d = await this.detailRepo.deleteByControlNumber(
          tenantId,
          scheduleNumber,
          s.controlNumber,
        );
        deleted += d;
      }
    }
    return { processed, deleted, balanceForwardsCreated: 0 };
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 4 — age-credit (same as type 2)
  private async purgeType4AgeCredit(tenantId: string, scheduleNumber: string, closeDate: Date) {
    return this.purgeType2DatePurge(tenantId, scheduleNumber, closeDate);
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 5
  // Delete all records for an applyNumber WHERE SUM(amount) = 0
  private async purgeType5ApplyToZero(tenantId: string, scheduleNumber: string) {
    const summaries = await this.detailRepo.summarizeByApplyNumber(tenantId, scheduleNumber);
    let deleted = 0;
    let processed = 0;
    for (const s of summaries) {
      processed += s.transactionCount;
      if (new Prisma.Decimal(s.totalAmount).equals(new Prisma.Decimal(0))) {
        const d = await this.detailRepo.deleteByApplyNumber(
          tenantId,
          scheduleNumber,
          s.applyNumber,
        );
        deleted += d;
      }
    }
    return { processed, deleted, balanceForwardsCreated: 0 };
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 6 — age-debit with GL subtotals
  // Same algorithm as type 2 for Wave 3; GL subtotal breakdown is a reporting concern
  private async purgeType6AgeDebit(tenantId: string, scheduleNumber: string, closeDate: Date) {
    return this.purgeType2DatePurge(tenantId, scheduleNumber, closeDate);
  }

  // @trace-cobol purge.extraction.md INV-EOM-08 type 7
  // Delete ALL records regardless of date
  private async purgeType7DeleteAll(tenantId: string, scheduleNumber: string) {
    const count = await this.detailRepo.countBySchedule(tenantId, scheduleNumber);
    const deleted = await this.detailRepo.deleteBySchedule(tenantId, scheduleNumber);
    return { processed: count, deleted, balanceForwardsCreated: 0 };
  }

  // -------------------------------------------------------------------------
  // Schedule Report
  // @trace-cobol schedprn.cbl
  // -------------------------------------------------------------------------

  async generateReport(req: ScheduleReportRequest): Promise<ScheduleReport> {
    const { tenantId, userId, scheduleNumber, format, includeZeroBalance, cutoffDate } =
      req;

    // Check user permissions if not an admin
    // isMis bypass handled in route middleware

    const schedules = scheduleNumber
      ? [await this.getSchedule(tenantId, scheduleNumber)]
      : await this.scheduleRepo.findAll(tenantId);

    const sections: ScheduleReportSection[] = [];

    for (const schedule of schedules) {
      // Permission check — schedprn.cbl reads SS record
      const hasAccess = await this.permissionRepo.canUserAccess(
        tenantId,
        userId,
        schedule.scheduleNumber,
      );
      if (!hasAccess) continue; // skip schedules user can't access

      const details = await this.detailRepo.findBySchedule(tenantId, schedule.scheduleNumber, {
        toDate: cutoffDate,
      });

      const latestDate = await this.detailRepo.findLatestTransactionDate(
        tenantId,
        schedule.scheduleNumber,
      );

      const hasDateWarning = latestDate ? latestDate > cutoffDate : false;

      // Group by control number for totals
      const byControl = new Map<string, { lines: ScheduleReportLine[]; total: Prisma.Decimal }>();
      let grandTotal = new Prisma.Decimal(0);

      for (const d of details) {
        if (!includeZeroBalance && d.amount.equals(0)) continue;

        const line: ScheduleReportLine = {
          scheduleNumber: d.scheduleNumber,
          controlNumber: d.controlNumber,
          controlName: null, // vehicle/name enrichment deferred
          date: d.transactionDate,
          source: d.journalSource,
          referenceNumber: d.referenceNumber,
          description: d.description,
          amounts: [d.amount],
          ageDays: d.transactionDate ? ageDays(d.transactionDate, cutoffDate) : null,
          applyNumber: d.applyNumber,
          applyCd: d.applyCd,
          isBalanceForward: d.isBalanceForward,
          agingBuckets:
            d.isBalanceForward && d.balanceCurrent != null
              ? {
                  current: d.balanceCurrent,
                  over30: d.balanceOver30 ?? new Prisma.Decimal(0),
                  over60: d.balanceOver60 ?? new Prisma.Decimal(0),
                  over90: d.balanceOver90 ?? new Prisma.Decimal(0),
                }
              : null,
        };

        const existing = byControl.get(d.controlNumber) ?? {
          lines: [],
          total: new Prisma.Decimal(0),
        };
        existing.lines.push(line);
        existing.total = existing.total.add(d.amount);
        byControl.set(d.controlNumber, existing);
        grandTotal = grandTotal.add(d.amount);
      }

      const controlTotals: ScheduleReportControlTotal[] = [];
      const allLines: ScheduleReportLine[] = [];

      for (const [controlNumber, { lines, total }] of byControl) {
        if (!includeZeroBalance && total.equals(0)) continue;
        if (format === 'DETAIL') allLines.push(...lines);
        controlTotals.push({
          controlNumber,
          controlName: null,
          glTotals: [total],
          overallTotal: total,
          transactionCount: lines.length,
          ageDays: lines[0]?.ageDays ?? null,
        });
      }

      sections.push({
        scheduleNumber: schedule.scheduleNumber,
        scheduleTitle: schedule.title,
        scheduleType: schedule.scheduleType as ScheduleType,
        glAccountNumbers: schedule.glAccountNumbers as string[],
        lines: format === 'DETAIL' ? allLines : [],
        controlTotals,
        grandTotal,
        isOutOfBalance: false, // GL balance check requires gl-service call (future wave)
        latestTransactionDate: latestDate,
        hasDateWarning,
      });
    }

    return {
      generatedAt: new Date(),
      cutoffDate,
      format,
      sections,
    };
  }

  // -------------------------------------------------------------------------
  // Security / permissions
  // @trace-cobol schedsec.cbl
  // -------------------------------------------------------------------------

  async getUserPermissions(tenantId: string, userId: string) {
    return this.permissionRepo.getUserAccessMap(tenantId, userId);
  }

  async setUserPermissions(
    tenantId: string,
    userId: string,
    permissions: Record<string, boolean>,
  ) {
    return this.permissionRepo.replaceUserAccess(tenantId, userId, permissions);
  }

  async deleteUserPermissions(tenantId: string, userId: string) {
    return this.permissionRepo.deleteUserAccess(tenantId, userId);
  }

  async listUsersWithAccess(tenantId: string) {
    return this.permissionRepo.listUsersWithAccess(tenantId);
  }

  async checkUserAccess(tenantId: string, userId: string, scheduleNumber: string) {
    return this.permissionRepo.canUserAccess(tenantId, userId, scheduleNumber);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async ensureScheduleExists(tenantId: string, scheduleNumber: string) {
    const s = await this.scheduleRepo.findById(tenantId, scheduleNumber);
    if (!s) throw new ScheduleNotFoundError(scheduleNumber);
    return s;
  }

  // @trace-cobol schedup.cbl all EDT- routines
  private validateScheduleFields(
    scheduleType: ScheduleType,
    eomPurgeType: EomPurgeType,
    glAccountNumbers: string[],
    title: string,
  ) {
    if (!title || title.trim() === '') {
      throw new ScheduleValidationError('Schedule Name required.');
    }
    if (glAccountNumbers.length === 0) {
      throw new NoAccountsError();
    }
    // Types 2, 4, 5: only 1 account allowed
    if ([2, 4, 5].includes(scheduleType) && glAccountNumbers.length > 1) {
      throw new MultipleAccountsNotAllowedError(scheduleType);
    }
    // No duplicates
    const seen = new Set<string>();
    for (const gl of glAccountNumbers) {
      if (seen.has(gl)) throw new DuplicateGlAccountError(gl);
      seen.add(gl);
    }
    // Purge code valid for type
    const validCodes = VALID_PURGE_CODES_BY_TYPE[scheduleType];
    if (!validCodes.includes(eomPurgeType)) {
      throw new InvalidPurgeCodeError(scheduleType, eomPurgeType);
    }
  }
}
