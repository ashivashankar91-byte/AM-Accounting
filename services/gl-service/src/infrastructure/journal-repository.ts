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

  async create(dto: CreateJournalEntryDTO, tenantId: TenantId): Promise<JournalEntry> {
    const row = await this.prisma.journalEntry.create({
      data: {
        tenantId,
        entryDate: dto.entryDate,
        description: dto.description,
        source: dto.source,
        sourceRef: dto.sourceRef,
        createdByUserId: dto.createdByUserId ?? null,
        priorPeriodAdjustment: dto.priorPeriodAdjustment ?? false,
        adjustmentReason: dto.adjustmentReason ?? null,
        status: 'DRAFT',
        lines: {
          create: dto.lines.map((l) => ({
            glAccountId: l.glAccountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
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
          })),
        },
      },
      include: { lines: { include: { glAccount: true } } },
    });
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
      lines: (row.lines ?? []).map((l): JournalLine => ({
        id: l.id,
        journalEntryId: l.journalEntryId,
        glAccountId: l.glAccountId,
        glAccountCode: l.glAccount?.code ?? '',
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
        departmentCode: l.departmentCode ?? undefined,
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
