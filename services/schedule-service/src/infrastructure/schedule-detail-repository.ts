// @trace-cobol detail.fc/fd + komdetail.cbl — DETAIL-FILE CRUD operations
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import type { ScheduleDetail } from '.prisma/schedule-client';
import type {
  CreateScheduleDetailDto,
  UpdateScheduleDetailDto,
  DetailFilters,
  EomPurgeType,
} from '../domain/schedule';

export interface IScheduleDetailRepository {
  create(tenantId: string, dto: CreateScheduleDetailDto & { scheduleNumber: string }): Promise<ScheduleDetail>;
  findById(tenantId: string, id: string): Promise<ScheduleDetail | null>;
  findBySchedule(tenantId: string, scheduleNumber: string, filters?: DetailFilters): Promise<ScheduleDetail[]>;
  findByControlNumber(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<ScheduleDetail[]>;
  findByJournalEntryId(tenantId: string, journalEntryId: string): Promise<ScheduleDetail[]>;
  update(tenantId: string, id: string, dto: UpdateScheduleDetailDto): Promise<ScheduleDetail>;
  /**
   * @trace-cobol schedmgr.cbl — when a GL account is reassigned to a different schedule,
   *   all existing detail records must migrate from the old schedule to the new one.
   */
  migrateByGLAccount(
    tenantId: string,
    glAccountNumber: string,
    fromScheduleNumber: string,
    toScheduleNumber: string | null,
  ): Promise<number>;
  delete(tenantId: string, id: string): Promise<void>;
  deleteBySchedule(tenantId: string, scheduleNumber: string): Promise<number>;
  deleteByControlNumber(tenantId: string, scheduleNumber: string, controlNumber: string): Promise<number>;
  deleteByApplyNumber(tenantId: string, scheduleNumber: string, applyNumber: string): Promise<number>;
  deleteByScheduleBeforeDate(tenantId: string, scheduleNumber: string, date: Date, includeBalanceForward: boolean): Promise<number>;
  summarizeByControlNumber(tenantId: string, scheduleNumber: string): Promise<{ controlNumber: string; totalAmount: string; transactionCount: number }[]>;
  summarizeByApplyNumber(tenantId: string, scheduleNumber: string): Promise<{ applyNumber: string; totalAmount: string; transactionCount: number }[]>;
  countBySchedule(tenantId: string, scheduleNumber: string): Promise<number>;
  countPurgeable(tenantId: string, scheduleNumber: string, purgeType: EomPurgeType, closeDate: Date): Promise<number>;
  findLatestTransactionDate(tenantId: string, scheduleNumber: string): Promise<Date | null>;
}

@injectable()
export class PrismaScheduleDetailRepository implements IScheduleDetailRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(
    tenantId: string,
    dto: CreateScheduleDetailDto & { scheduleNumber: string },
  ): Promise<ScheduleDetail> {
    return this.prisma.scheduleDetail.create({
      data: {
        tenantId,
        scheduleNumber: dto.scheduleNumber,
        controlNumber: dto.controlNumber,
        amount: dto.amount,
        referenceNumber: dto.referenceNumber,
        journalSource: dto.journalSource,
        transactionDate: dto.transactionDate,
        glAccountNumber: dto.glAccountNumber,
        description: dto.description,
        isBalanceForward: dto.isBalanceForward ?? false,
        balanceCurrent: dto.balanceCurrent,
        balanceOver30: dto.balanceOver30,
        balanceOver60: dto.balanceOver60,
        balanceOver90: dto.balanceOver90,
        applyNumber: dto.applyNumber,
        applyCd: dto.applyCd,
        journalEntryId: dto.journalEntryId,
      },
    });
  }

  async findById(tenantId: string, id: string): Promise<ScheduleDetail | null> {
    return this.prisma.scheduleDetail.findFirst({ where: { id, tenantId } });
  }

  async findBySchedule(
    tenantId: string,
    scheduleNumber: string,
    filters?: DetailFilters,
  ): Promise<ScheduleDetail[]> {
    return this.prisma.scheduleDetail.findMany({
      where: {
        tenantId,
        scheduleNumber,
        ...(filters?.controlNumber && { controlNumber: filters.controlNumber }),
        ...(filters?.fromDate || filters?.toDate
          ? {
              transactionDate: {
                ...(filters.fromDate && { gte: filters.fromDate }),
                ...(filters.toDate && { lte: filters.toDate }),
              },
            }
          : {}),
        ...(filters?.includeBalanceForward === false && { isBalanceForward: false }),
      },
      orderBy: [{ controlNumber: 'asc' }, { transactionDate: 'asc' }],
    });
  }

  async findByControlNumber(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
  ): Promise<ScheduleDetail[]> {
    return this.prisma.scheduleDetail.findMany({
      where: { tenantId, scheduleNumber, controlNumber },
      orderBy: { transactionDate: 'asc' },
    });
  }

  async findByJournalEntryId(tenantId: string, journalEntryId: string): Promise<ScheduleDetail[]> {
    return this.prisma.scheduleDetail.findMany({
      where: { tenantId, journalEntryId },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateScheduleDetailDto): Promise<ScheduleDetail> {
    return this.prisma.scheduleDetail.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.referenceNumber !== undefined && { referenceNumber: dto.referenceNumber }),
        ...(dto.journalSource !== undefined && { journalSource: dto.journalSource }),
        ...(dto.transactionDate !== undefined && { transactionDate: dto.transactionDate }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.balanceCurrent !== undefined && { balanceCurrent: dto.balanceCurrent }),
        ...(dto.balanceOver30 !== undefined && { balanceOver30: dto.balanceOver30 }),
        ...(dto.balanceOver60 !== undefined && { balanceOver60: dto.balanceOver60 }),
        ...(dto.balanceOver90 !== undefined && { balanceOver90: dto.balanceOver90 }),
        ...(dto.applyNumber !== undefined && { applyNumber: dto.applyNumber }),
        ...(dto.applyCd !== undefined && { applyCd: dto.applyCd }),
      },
    });
  }

  // @trace-cobol schedmgr.cbl — bulk move detail records when GL account schedule changes
  async migrateByGLAccount(
    tenantId: string,
    glAccountNumber: string,
    fromScheduleNumber: string,
    toScheduleNumber: string | null,
  ): Promise<number> {
    if (!toScheduleNumber) {
      // No target schedule — leave details in place (don't orphan them)
      return 0;
    }
    const result = await this.prisma.scheduleDetail.updateMany({
      where: { tenantId, glAccountNumber, scheduleNumber: fromScheduleNumber },
      data: { scheduleNumber: toScheduleNumber },
    });
    return result.count;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.prisma.scheduleDetail.deleteMany({ where: { id, tenantId } });
  }

  async deleteBySchedule(tenantId: string, scheduleNumber: string): Promise<number> {
    const result = await this.prisma.scheduleDetail.deleteMany({
      where: { tenantId, scheduleNumber },
    });
    return result.count;
  }

  async deleteByControlNumber(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
  ): Promise<number> {
    const result = await this.prisma.scheduleDetail.deleteMany({
      where: { tenantId, scheduleNumber, controlNumber },
    });
    return result.count;
  }

  async deleteByApplyNumber(
    tenantId: string,
    scheduleNumber: string,
    applyNumber: string,
  ): Promise<number> {
    const result = await this.prisma.scheduleDetail.deleteMany({
      where: { tenantId, scheduleNumber, applyNumber },
    });
    return result.count;
  }

  async deleteByScheduleBeforeDate(
    tenantId: string,
    scheduleNumber: string,
    date: Date,
    includeBalanceForward: boolean,
  ): Promise<number> {
    const result = await this.prisma.scheduleDetail.deleteMany({
      where: {
        tenantId,
        scheduleNumber,
        transactionDate: { lte: date },
        ...(!includeBalanceForward && { isBalanceForward: false }),
      },
    });
    return result.count;
  }

  async summarizeByControlNumber(
    tenantId: string,
    scheduleNumber: string,
  ): Promise<{ controlNumber: string; totalAmount: string; transactionCount: number }[]> {
    const rows = await this.prisma.scheduleDetail.groupBy({
      by: ['controlNumber'],
      where: { tenantId, scheduleNumber },
      _sum: { amount: true },
      _count: { id: true },
    });
    return rows.map((r) => ({
      controlNumber: r.controlNumber,
      totalAmount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      transactionCount: r._count.id,
    }));
  }

  async summarizeByApplyNumber(
    tenantId: string,
    scheduleNumber: string,
  ): Promise<{ applyNumber: string; totalAmount: string; transactionCount: number }[]> {
    const rows = await this.prisma.scheduleDetail.groupBy({
      by: ['applyNumber'],
      where: { tenantId, scheduleNumber, applyNumber: { not: null } },
      _sum: { amount: true },
      _count: { id: true },
    });
    return rows.map((r) => ({
      applyNumber: r.applyNumber as string,
      totalAmount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      transactionCount: r._count.id,
    }));
  }

  async countBySchedule(tenantId: string, scheduleNumber: string): Promise<number> {
    return this.prisma.scheduleDetail.count({ where: { tenantId, scheduleNumber } });
  }

  async countPurgeable(
    tenantId: string,
    scheduleNumber: string,
    purgeType: EomPurgeType,
    closeDate: Date,
  ): Promise<number> {
    // For preview: count records that would be deleted for the given purge type
    switch (purgeType) {
      case 1:
      case 2:
      case 4:
      case 6:
        return this.prisma.scheduleDetail.count({
          where: { tenantId, scheduleNumber, transactionDate: { lte: closeDate } },
        });
      case 7:
        return this.prisma.scheduleDetail.count({ where: { tenantId, scheduleNumber } });
      case 3:
      case 5:
        // For zero-balance purge types, count everything as potential (conservative estimate)
        return this.prisma.scheduleDetail.count({ where: { tenantId, scheduleNumber } });
      default:
        return 0;
    }
  }

  async findLatestTransactionDate(tenantId: string, scheduleNumber: string): Promise<Date | null> {
    const row = await this.prisma.scheduleDetail.findFirst({
      where: { tenantId, scheduleNumber, transactionDate: { not: null } },
      orderBy: { transactionDate: 'desc' },
      select: { transactionDate: true },
    });
    return row?.transactionDate ?? null;
  }
}
