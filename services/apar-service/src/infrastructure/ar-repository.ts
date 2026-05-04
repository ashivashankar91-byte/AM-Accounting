import { injectable, inject } from 'tsyringe';
import { IAREntryRepository, AREntry, TenantId, AREntryType } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/apar-client';
import type { AREntry as PrismaAREntry } from '.prisma/apar-client';

@injectable()
export class PrismaAREntryRepository implements IAREntryRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findAll(tenantId: TenantId): Promise<AREntry[]> {
    const rows = await this.prisma.aREntry.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(this.toDomain);
  }

  async create(data: Omit<AREntry, 'id'>, tenantId: TenantId): Promise<AREntry> {
    const row = await this.prisma.aREntry.create({
      data: { ...data, tenantId },
    });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<AREntry>, tenantId: TenantId): Promise<AREntry> {
    const row = await this.prisma.aREntry.update({ where: { id }, data });
    return this.toDomain(row);
  }

  private toDomain(row: PrismaAREntry): AREntry {
    return {
      id: row.id, tenantId: row.tenantId as TenantId,
      dealerRef: row.dealerRef, type: row.type as AREntryType,
      amount: row.amount, dueDate: row.dueDate,
      status: row.status, oemSource: row.oemSource,
    };
  }
}
