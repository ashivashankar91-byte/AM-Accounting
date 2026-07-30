// @wave S027 — per-tenant aging bucket configuration.
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/schedule-client';
import type { ScheduleAgingBucketConfig } from '.prisma/schedule-client';
import { AgingBucketDef } from '../domain/aging';

export interface IScheduleAgingConfigRepository {
  get(tenantId: string): Promise<ScheduleAgingBucketConfig | null>;
  upsert(tenantId: string, buckets: AgingBucketDef[], updatedBy?: string): Promise<ScheduleAgingBucketConfig>;
}

@injectable()
export class PrismaScheduleAgingConfigRepository implements IScheduleAgingConfigRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<ScheduleAgingBucketConfig | null> {
    return this.prisma.scheduleAgingBucketConfig.findUnique({ where: { tenantId } });
  }

  async upsert(tenantId: string, buckets: AgingBucketDef[], updatedBy?: string): Promise<ScheduleAgingBucketConfig> {
    return this.prisma.scheduleAgingBucketConfig.upsert({
      where: { tenantId },
      create: { tenantId, buckets: buckets as any, updatedBy },
      update: { buckets: buckets as any, updatedBy },
    });
  }
}
