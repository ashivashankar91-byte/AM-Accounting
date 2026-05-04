import { injectable, inject } from 'tsyringe';
import { IGLAccountRepository, GLAccount, TenantId, GLAccountType } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/gl-client';
import type { GLAccount as PrismaGLAccount } from '.prisma/gl-client';

@injectable()
export class PrismaGLAccountRepository implements IGLAccountRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findAll(tenantId: TenantId): Promise<GLAccount[]> {
    const rows = await this.prisma.gLAccount.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
    return rows.map(this.toDomain);
  }

  async findById(id: string, tenantId: TenantId): Promise<GLAccount | null> {
    const row = await this.prisma.gLAccount.findFirst({
      where: { id, tenantId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByCode(code: string, tenantId: TenantId): Promise<GLAccount | null> {
    const row = await this.prisma.gLAccount.findFirst({
      where: { code, tenantId },
    });
    return row ? this.toDomain(row) : null;
  }

  async create(data: Omit<GLAccount, 'id'>, tenantId: TenantId): Promise<GLAccount> {
    const row = await this.prisma.gLAccount.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        type: data.type,
        subType: data.subType ?? null,
        normalBalance: data.normalBalance ?? 'DEBIT',
        allowPosting: data.allowPosting ?? true,
        scheduleCode: data.scheduleCode ?? null,
        glGroup: data.glGroup ?? null,
        parentId: data.parentId,
        isActive: data.isActive,
      },
    });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<GLAccount>, tenantId: TenantId): Promise<GLAccount> {
    const row = await this.prisma.gLAccount.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        subType: data.subType,
        normalBalance: data.normalBalance,
        allowPosting: data.allowPosting,
        scheduleCode: data.scheduleCode,
        glGroup: data.glGroup,
        parentId: data.parentId,
        isActive: data.isActive,
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: PrismaGLAccount): GLAccount {
    return {
      id: row.id,
      tenantId: row.tenantId as TenantId,
      code: row.code,
      name: row.name,
      type: row.type as GLAccountType,
      subType: row.subType ?? undefined,
      normalBalance: (row.normalBalance ?? 'DEBIT') as 'DEBIT' | 'CREDIT',
      allowPosting: row.allowPosting ?? true,
      scheduleCode: row.scheduleCode ?? undefined,
      glGroup: row.glGroup ?? undefined,
      parentId: row.parentId,
      isActive: row.isActive,
    };
  }
}
