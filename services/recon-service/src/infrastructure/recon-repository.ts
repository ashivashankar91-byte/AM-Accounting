import { injectable, inject } from 'tsyringe';
import { IBankReconRepository, BankRecon, TenantId, ReconStatus } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/recon-client';
import type { BankRecon as PrismaBankRecon } from '.prisma/recon-client';

@injectable()
export class PrismaBankReconRepository implements IBankReconRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: TenantId): Promise<BankRecon | null> {
    const row = await this.prisma.bankRecon.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  async findAll(tenantId: TenantId): Promise<BankRecon[]> {
    const rows = await this.prisma.bankRecon.findMany({ where: { tenantId }, orderBy: { reconDate: 'desc' } });
    return rows.map(this.toDomain);
  }

  async create(data: Omit<BankRecon, 'id'>, tenantId: TenantId): Promise<BankRecon> {
    const row = await this.prisma.bankRecon.create({ data: { ...data, tenantId } });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<BankRecon>, tenantId: TenantId): Promise<BankRecon> {
    const row = await this.prisma.bankRecon.update({ where: { id }, data });
    return this.toDomain(row);
  }

  private toDomain(row: PrismaBankRecon): BankRecon {
    return {
      id: row.id, tenantId: row.tenantId as TenantId,
      accountName: row.accountName, reconDate: row.reconDate,
      glBalance: row.glBalance, bankBalance: row.bankBalance,
      variance: row.variance, status: row.status as ReconStatus,
      lockedBy: row.lockedBy, lockedAt: row.lockedAt,
    };
  }
}
