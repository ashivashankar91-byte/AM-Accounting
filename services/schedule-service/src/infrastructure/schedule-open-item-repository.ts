// @wave S026 — read-side repository for schedule open items.
// Transactional writes (create / apply / reverse) live in
// application/open-item-service.ts, operating directly on the injected
// PrismaClient inside withSerializableRetry — mirroring gl-service's own
// approveJournalEntry(), which writes directly on `tx` rather than through a
// repository abstraction for its core atomic path.
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import type { ScheduleOpenItem } from '.prisma/schedule-client';

export interface OpenItemFilters {
  controlNumber?: string;
  status?: string;
  asOfDate?: Date;
  glAccountNumber?: string;
}

export interface AgeableFilters {
  scheduleNumber?: string;
  controlNumber?: string;
  glAccountNumber?: string;
}

export interface IScheduleOpenItemRepository {
  findById(tenantId: string, id: string): Promise<ScheduleOpenItem | null>;
  findBySchedule(tenantId: string, scheduleNumber: string, filters?: OpenItemFilters): Promise<ScheduleOpenItem[]>;
  findOpenByKey(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
    itemNumber: string,
  ): Promise<ScheduleOpenItem[]>;
  sumRemainingBalanceByGlAccount(
    tenantId: string,
    scheduleNumber: string,
  ): Promise<{ glAccountNumber: string | null; totalRemaining: string }[]>;
  // S027 — every non-CLOSED item (remainingBalance != 0 by construction of
  // deriveStatus), the exclusive source for the aging report.
  findAgeable(tenantId: string, filters?: AgeableFilters): Promise<ScheduleOpenItem[]>;
  // S027 — independent total used to prove the aging report reconciles
  // exactly to S026's own open-item balances (not just "trust the same code
  // path computed both").
  sumRemainingBalanceTotal(tenantId: string, filters?: AgeableFilters): Promise<string>;
}

@injectable()
export class PrismaScheduleOpenItemRepository implements IScheduleOpenItemRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findById(tenantId: string, id: string): Promise<ScheduleOpenItem | null> {
    return this.prisma.scheduleOpenItem.findFirst({ where: { id, tenantId } });
  }

  async findBySchedule(
    tenantId: string,
    scheduleNumber: string,
    filters?: OpenItemFilters,
  ): Promise<ScheduleOpenItem[]> {
    return this.prisma.scheduleOpenItem.findMany({
      where: {
        tenantId,
        scheduleNumber,
        ...(filters?.controlNumber && { controlNumber: filters.controlNumber }),
        ...(filters?.status && { status: filters.status }),
        ...(filters?.glAccountNumber && { glAccountNumber: filters.glAccountNumber }),
        ...(filters?.asOfDate && {
          OR: [{ transactionDate: { lte: filters.asOfDate } }, { transactionDate: null }],
        }),
      },
      orderBy: [{ controlNumber: 'asc' }, { transactionDate: 'asc' }],
      include: { applications: { orderBy: { appliedAt: 'asc' } } },
    });
  }

  // Application target lookup: must resolve to at most one non-closed item
  // sharing (scheduleNumber, controlNumber, itemNumber) — the caller (
  // OpenItemService) treats >1 as a data-integrity condition, not a silent
  // pick, and 0 as "reject / log, do not fabricate" per the S026 contract.
  async findOpenByKey(
    tenantId: string,
    scheduleNumber: string,
    controlNumber: string,
    itemNumber: string,
  ): Promise<ScheduleOpenItem[]> {
    return this.prisma.scheduleOpenItem.findMany({
      where: { tenantId, scheduleNumber, controlNumber, itemNumber, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sumRemainingBalanceByGlAccount(
    tenantId: string,
    scheduleNumber: string,
  ): Promise<{ glAccountNumber: string | null; totalRemaining: string }[]> {
    const rows = await this.prisma.scheduleOpenItem.groupBy({
      by: ['glAccountNumber'],
      where: { tenantId, scheduleNumber },
      _sum: { remainingBalance: true },
    });
    return rows.map((r) => ({
      glAccountNumber: r.glAccountNumber,
      totalRemaining: (r._sum.remainingBalance ?? new Prisma.Decimal(0)).toFixed(2),
    }));
  }

  async findAgeable(tenantId: string, filters?: AgeableFilters): Promise<ScheduleOpenItem[]> {
    return this.prisma.scheduleOpenItem.findMany({
      where: {
        tenantId,
        status: { not: 'CLOSED' },
        ...(filters?.scheduleNumber && { scheduleNumber: filters.scheduleNumber }),
        ...(filters?.controlNumber && { controlNumber: filters.controlNumber }),
        ...(filters?.glAccountNumber && { glAccountNumber: filters.glAccountNumber }),
      },
      orderBy: [{ scheduleNumber: 'asc' }, { controlNumber: 'asc' }],
    });
  }

  async sumRemainingBalanceTotal(tenantId: string, filters?: AgeableFilters): Promise<string> {
    const agg = await this.prisma.scheduleOpenItem.aggregate({
      where: {
        tenantId,
        status: { not: 'CLOSED' },
        ...(filters?.scheduleNumber && { scheduleNumber: filters.scheduleNumber }),
        ...(filters?.controlNumber && { controlNumber: filters.controlNumber }),
        ...(filters?.glAccountNumber && { glAccountNumber: filters.glAccountNumber }),
      },
      _sum: { remainingBalance: true },
    });
    return (agg._sum.remainingBalance ?? new Prisma.Decimal(0)).toFixed(2);
  }
}
