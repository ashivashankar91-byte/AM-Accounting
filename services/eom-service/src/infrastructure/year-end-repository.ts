/**
 * @module year-end-repository
 * Prisma implementation of IYearEndRecordRepository.
 * @trace-cobol yrend.cbl YE-INV-02 — histtran idempotency key (source + date + "EOY{YEAR}")
 *   TypeScript: dedicated table with DB-level UNIQUE(tenantId, fiscalYear) constraint.
 */

import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/eom-client';
import type { IYearEndRecordRepository } from '../application/eom-service';
import type { TenantId } from '@amacc/shared-kernel';

@injectable()
export class PrismaYearEndRecordRepository implements IYearEndRecordRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findByYear(
    tenantId: TenantId,
    fiscalYear: number,
  ): Promise<{ id: string; closedAt: Date } | null> {
    const record = await (this.prisma as any).yearEndRecord.findUnique({
      where: { tenantId_fiscalYear: { tenantId, fiscalYear } },
      select: { id: true, closedAt: true },
    });
    return record ?? null;
  }

  async create(
    tenantId: TenantId,
    fiscalYear: number,
    initiatedBy: string,
  ): Promise<{ id: string }> {
    const record = await (this.prisma as any).yearEndRecord.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        fiscalYear,
        initiatedBy,
      },
      select: { id: true },
    });
    return record;
  }
}
