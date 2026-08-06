// @wave S026 — nightly GL-to-schedule tie-out persistence.
import { injectable, inject } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/schedule-client';
import type { ScheduleGlTieOut } from '.prisma/schedule-client';

export interface CreateTieOutRowInput {
  scheduleNumber: string;
  glAccountNumber: string;
  asOfDate: Date;
  scheduleBalance: Prisma.Decimal;
  glBalance: Prisma.Decimal | null;
  variance: Prisma.Decimal | null;
  status: 'MATCHED' | 'DISCREPANCY' | 'GL_UNAVAILABLE';
  glQueryError?: string | null;
  runId: string;
  triggeredBy?: string | null;
}

export interface IScheduleTieOutRepository {
  create(tenantId: string, dto: CreateTieOutRowInput): Promise<ScheduleGlTieOut>;
  listByRun(tenantId: string, runId: string): Promise<ScheduleGlTieOut[]>;
  list(
    tenantId: string,
    filters?: { scheduleNumber?: string; status?: string; asOfDate?: Date },
  ): Promise<ScheduleGlTieOut[]>;
  latestRunId(tenantId: string): Promise<string | null>;
}

@injectable()
export class PrismaScheduleTieOutRepository implements IScheduleTieOutRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(tenantId: string, dto: CreateTieOutRowInput): Promise<ScheduleGlTieOut> {
    return this.prisma.scheduleGlTieOut.create({
      data: {
        tenantId,
        scheduleNumber: dto.scheduleNumber,
        glAccountNumber: dto.glAccountNumber,
        asOfDate: dto.asOfDate,
        scheduleBalance: dto.scheduleBalance,
        glBalance: dto.glBalance,
        variance: dto.variance,
        status: dto.status,
        glQueryError: dto.glQueryError,
        runId: dto.runId,
        triggeredBy: dto.triggeredBy,
      },
    });
  }

  async listByRun(tenantId: string, runId: string): Promise<ScheduleGlTieOut[]> {
    return this.prisma.scheduleGlTieOut.findMany({
      where: { tenantId, runId },
      orderBy: [{ scheduleNumber: 'asc' }, { glAccountNumber: 'asc' }],
    });
  }

  async list(
    tenantId: string,
    filters?: { scheduleNumber?: string; status?: string; asOfDate?: Date },
  ): Promise<ScheduleGlTieOut[]> {
    return this.prisma.scheduleGlTieOut.findMany({
      where: {
        tenantId,
        ...(filters?.scheduleNumber && { scheduleNumber: filters.scheduleNumber }),
        ...(filters?.status && { status: filters.status }),
        ...(filters?.asOfDate && { asOfDate: filters.asOfDate }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async latestRunId(tenantId: string): Promise<string | null> {
    const row = await this.prisma.scheduleGlTieOut.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { runId: true },
    });
    return row?.runId ?? null;
  }
}
