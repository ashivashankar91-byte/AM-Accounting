import { injectable, inject } from 'tsyringe';
import {
  IJournalRepository,
  JournalEntry,
  CreateJournalEntryDTO,
  EntryFilters,
  TenantId,
  JournalStatus,
  JournalLine,
  Period,
} from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/gl-client';
import type {
  JournalEntry as PrismaJournalEntry,
  JournalLine as PrismaJournalLine,
  GLAccount as PrismaGLAccount,
} from '.prisma/gl-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditRowsTx } from './audit';

type JournalEntryWithLines = PrismaJournalEntry & {
  lines?: (PrismaJournalLine & { glAccount?: PrismaGLAccount | null })[];
};

@injectable()
export class PrismaJournalRepository implements IJournalRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: TenantId): Promise<JournalEntry | null> {
    const row = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId },
      include: { lines: { include: { glAccount: true } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findBySourceRef(ref: string, tenantId: TenantId, since: Date): Promise<JournalEntry[]> {
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        sourceRef: ref,
        createdAt: { gte: since },
      },
      include: { lines: { include: { glAccount: true } } },
    });
    return rows.map(this.toDomain);
  }

  async findAll(tenantId: TenantId, filters: EntryFilters): Promise<JournalEntry[]> {
    const where: Prisma.JournalEntryWhereInput = { tenantId };
    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: Prisma.DateTimeFilter<'JournalEntry'> = {};
      if (filters.dateFrom) dateFilter.gte = filters.dateFrom;
      if (filters.dateTo) dateFilter.lte = filters.dateTo;
      where.entryDate = dateFilter;
    }
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;

    const rows = await this.prisma.journalEntry.findMany({
      where,
      include: { lines: { include: { glAccount: true } } },
      take: filters.limit ?? 100,
      skip: filters.offset ?? 0,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(this.toDomain);
  }

  /**
   * CE-07 — authoritative GL idempotency. When `dto.idempotencyKey` is set,
   * this is the sole, database-enforced duplicate-prevention point for the
   * authoritative journal — independent of any caller's own bookkeeping
   * (e.g. coa-service's PostingExecution claim row, which is a real but
   * NOT sufficient layer on its own: losing that row before a resubmit
   * must still never create a second journal here).
   *
   * Three paths, all returning the SAME original journal for the same key:
   *  1. Fast path — a prior call already committed a row for this key
   *     (the common retry-after-successful-persistence / crash-recovery
   *     case): found here before ever attempting an insert.
   *  2. Race path — two callers reach the check within the same window;
   *     the loser's INSERT hits the partial unique index
   *     (tenant_id, idempotency_key) and fails with P2002; the loser
   *     re-queries and returns the winner's row rather than erroring.
   *  3. Winner path — genuinely new key: inserts normally, DRAFT status,
   *     no auto-approval, identical to every other caller's journal.
   */
  async create(dto: CreateJournalEntryDTO, tenantId: TenantId): Promise<JournalEntry> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { tenantId, idempotencyKey: dto.idempotencyKey },
        include: { lines: { include: { glAccount: true } } },
      });
      if (existing) return this.toDomain(existing);
    }
    let row: any;
    try {
      row = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const created = await tx.journalEntry.create({
        data: {
          tenantId,
          entryDate: dto.entryDate,
          description: dto.description,
          source: dto.source,
          sourceRef: dto.sourceRef,
          createdByUserId: dto.createdByUserId ?? null,
          priorPeriodAdjustment: dto.priorPeriodAdjustment ?? false,
          adjustmentReason: dto.adjustmentReason ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          // fix(integration): these columns existed but were never wired
          // through from the DTO — every journal's legalEntityId/
          // postingExecutionId/sourceEventId was silently persisted as
          // null, found while certifying JOURNAL_ENTRY_POSTED evidence.
          legalEntityId: dto.legalEntityId ?? null,
          postingExecutionId: dto.postingExecutionId ?? null,
          sourceEventId: dto.sourceEventId ?? null,
          rulePackKey: dto.rulePackKey ?? null,
          rulePackVersion: dto.rulePackVersion ?? null,
          status: 'DRAFT',
          lines: {
            create: dto.lines.map((l) => ({
              glAccountId: l.glAccountId,
              debit: l.debit,
              credit: l.credit,
              memo: l.memo,
              storeId: l.storeId ?? '',
              departmentCode: l.departmentCode,
              technicianId: l.technicianId,
              roNumber: l.roNumber,
              roLineNumber: l.roLineNumber,
              flatRateHours: l.flatRateHours,
              clockHours: l.clockHours,
              partNumber: l.partNumber,
              partQuantity: l.partQuantity,
              earningCode: l.earningCode,
              dealProductCode: l.dealProductCode,
              dealNumber: l.dealNumber,
              vehicleVin: l.vehicleVin,
              moduleSource: l.moduleSource,
              laborType: l.laborType,
              costType: l.costType,
              costAmount: l.costAmount,
              applyCd: l.applyCd,
              applyNumber: l.applyNumber,
              companyCode: l.companyCode,
              controlNumber: l.controlNumber,
              applyToCost: l.applyToCost,
              unitCount: l.unitCount ?? 0,
            })),
          },
        },
        include: { lines: { include: { glAccount: true } } },
      });
      await appendAuditRowsTx(tx, {
        tenantId,
        docType: 'JOURNAL_ENTRY',
        docId: created.id,
        action: 'CREATE_DRAFT',
        actor: dto.createdByUserId ?? 'system',
        after: {
          description: created.description,
          source: created.source,
          status: created.status,
          lineCount: created.lines.length,
        },
        eventType: 'journal_entry.created',
      });
      return created;
      });
    } catch (err: any) {
      if (dto.idempotencyKey && err?.code === 'P2002') {
        const winner = await this.prisma.journalEntry.findFirst({
          where: { tenantId, idempotencyKey: dto.idempotencyKey },
          include: { lines: { include: { glAccount: true } } },
        });
        if (winner) return this.toDomain(winner);
      }
      throw err;
    }
    return this.toDomain(row);
  }

  async findByPeriod(tenantId: TenantId, period: Period): Promise<JournalEntry[]> {
    const start = new Date(period.year, period.month - 1, 1);
    const end = new Date(period.year, period.month, 0);
    return this.findAll(tenantId, { dateFrom: start, dateTo: end });
  }

  async hold(id: string, tenantId: TenantId, reason: string): Promise<JournalEntry> {
    const row = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: 'HELD' },
      include: { lines: { include: { glAccount: true } } },
    });
    return this.toDomain(row);
  }

  async setPendingReview(id: string, tenantId: TenantId): Promise<JournalEntry> {
    const row = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: 'PENDING_REVIEW', agentReviewed: false },
      include: { lines: { include: { glAccount: true } } },
    });
    return this.toDomain(row);
  }

  async post(id: string, tenantId: TenantId, postedBy: string): Promise<JournalEntry> {
    const row = await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'POSTED',
        postedBy,
        postedAt: new Date(),
      },
      include: { lines: { include: { glAccount: true } } },
    });
    return this.toDomain(row);
  }

  private toDomain(row: JournalEntryWithLines): JournalEntry {
    return {
      id: row.id,
      tenantId: row.tenantId as TenantId,
      entryDate: row.entryDate,
      description: row.description,
      source: row.source,
      sourceRef: row.sourceRef,
      postedBy: row.postedBy,
      postedAt: row.postedAt,
      status: row.status as JournalStatus,
      agentReviewed: row.agentReviewed,
      createdByUserId: row.createdByUserId ?? undefined,
      approvedByUserId: row.approvedByUserId ?? undefined,
      approvedAt: row.approvedAt ?? undefined,
      priorPeriodAdjustment: row.priorPeriodAdjustment ?? false,
      adjustmentReason: row.adjustmentReason ?? undefined,
      idempotencyKey: (row as any).idempotencyKey ?? null,
      legalEntityId: (row as any).legalEntityId ?? null,
      postingExecutionId: (row as any).postingExecutionId ?? null,
      sourceEventId: (row as any).sourceEventId ?? null,
      rulePackKey: (row as any).rulePackKey ?? null,
      rulePackVersion: (row as any).rulePackVersion ?? null,
      lines: (row.lines ?? []).map((l): JournalLine => ({
        id: l.id,
        journalEntryId: l.journalEntryId,
        glAccountId: l.glAccountId,
        glAccountCode: l.glAccount?.code ?? '',
        debit: Number(l.debit),
        credit: Number(l.credit),
        memo: l.memo,
        storeId: l.storeId ?? undefined,
        departmentCode: l.departmentCode ?? undefined,
        controlNumber: l.controlNumber ?? undefined,
        applyCd: l.applyCd ?? undefined,
        applyNumber: l.applyNumber ?? undefined,
        companyCode: l.companyCode ?? undefined,
        applyToCost: l.applyToCost == null ? undefined : Number(l.applyToCost),
        unitCount: l.unitCount ?? undefined,
        costAmount: l.costAmount == null ? undefined : Number(l.costAmount),
        technicianId: l.technicianId ?? undefined,
        roNumber: l.roNumber ?? undefined,
        roLineNumber: l.roLineNumber ?? undefined,
        flatRateHours: l.flatRateHours ?? undefined,
        clockHours: l.clockHours ?? undefined,
        partNumber: l.partNumber ?? undefined,
        partQuantity: l.partQuantity ?? undefined,
        earningCode: l.earningCode ?? undefined,
        dealProductCode: l.dealProductCode ?? undefined,
        dealNumber: l.dealNumber ?? undefined,
        vehicleVin: l.vehicleVin ?? undefined,
        moduleSource: l.moduleSource ?? undefined,
        laborType: l.laborType ?? undefined,
        costType: l.costType ?? undefined,
        agentConfidence: l.agentConfidence ?? undefined,
      })),
    };
  }
}
