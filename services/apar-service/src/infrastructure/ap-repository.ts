import { injectable, inject } from 'tsyringe';
import { IAPEntryRepository, APEntry, TenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/apar-client';
import type { APEntry as PrismaAPEntry } from '.prisma/apar-client';

@injectable()
export class PrismaAPEntryRepository implements IAPEntryRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findAll(tenantId: TenantId): Promise<APEntry[]> {
    const rows = await this.prisma.aPEntry.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(this.toDomain);
  }

  async create(data: Omit<APEntry, 'id'>, tenantId: TenantId): Promise<APEntry> {
    const row = await this.prisma.aPEntry.create({ data: { ...data, tenantId } });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<APEntry>, tenantId: TenantId): Promise<APEntry> {
    const row = await this.prisma.aPEntry.update({ where: { id }, data });
    return this.toDomain(row);
  }

  private toDomain(row: PrismaAPEntry): APEntry {
    return {
      id: row.id, tenantId: row.tenantId as TenantId,
      vendorName: row.vendorName, invoiceRef: row.invoiceRef,
      amount: row.amount, dueDate: row.dueDate,
      status: row.status, glAccountId: row.glAccountId,
    };
  }
}
