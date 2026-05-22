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
      orderBy: [{ sortKey: 'asc' }, { code: 'asc' }],
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
        sortKey: (data as any).sortKey ?? null,
        parentId: data.parentId,
        isActive: data.isActive,
        cosAccountId: (data as any).cosAccountId ?? null,
        invAccountId: (data as any).invAccountId ?? null,
        isCashClearing: (data as any).isCashClearing ?? false,
        isDepositClearing: (data as any).isDepositClearing ?? false,
        subtotalGroup1: (data as any).subtotalGroup1 ?? null,
        subtotalGroup2: (data as any).subtotalGroup2 ?? null,
        subtotalGroup3: (data as any).subtotalGroup3 ?? null,
        reqControlNumber: (data as any).reqControlNumber ?? null,
        printCode: (data as any).printCode ?? 'D',
      },
    });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<GLAccount>, tenantId: TenantId): Promise<GLAccount> {
    const updateData: Record<string, any> = {
      name: data.name,
      type: data.type,
      subType: data.subType,
      normalBalance: data.normalBalance,
      allowPosting: data.allowPosting,
      scheduleCode: data.scheduleCode,
      glGroup: data.glGroup,
      parentId: data.parentId,
      isActive: data.isActive,
    };
    // Only set cos/inv account IDs if they're provided (allow explicit null to clear them)
    if ((data as any).cosAccountId !== undefined) updateData.cosAccountId = (data as any).cosAccountId;
    if ((data as any).invAccountId !== undefined) updateData.invAccountId = (data as any).invAccountId;
    if ((data as any).sortKey !== undefined) updateData.sortKey = (data as any).sortKey;
    if ((data as any).isCashClearing !== undefined) updateData.isCashClearing = (data as any).isCashClearing;
    if ((data as any).isDepositClearing !== undefined) updateData.isDepositClearing = (data as any).isDepositClearing;
    if ((data as any).subtotalGroup1 !== undefined) updateData.subtotalGroup1 = (data as any).subtotalGroup1;
    if ((data as any).subtotalGroup2 !== undefined) updateData.subtotalGroup2 = (data as any).subtotalGroup2;
    if ((data as any).subtotalGroup3 !== undefined) updateData.subtotalGroup3 = (data as any).subtotalGroup3;
    if ((data as any).reqControlNumber !== undefined) updateData.reqControlNumber = (data as any).reqControlNumber;
    if ((data as any).printCode !== undefined) updateData.printCode = (data as any).printCode;
    const row = await this.prisma.gLAccount.update({
      where: { id },
      data: updateData,
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
      cosAccountId: (row as any).cosAccountId ?? undefined,
      invAccountId: (row as any).invAccountId ?? undefined,
      isCashClearing: (row as any).isCashClearing ?? false,
      isDepositClearing: (row as any).isDepositClearing ?? false,
      subtotalGroup1: (row as any).subtotalGroup1 ?? undefined,
      subtotalGroup2: (row as any).subtotalGroup2 ?? undefined,
      subtotalGroup3: (row as any).subtotalGroup3 ?? undefined,
      reqControlNumber: (row as any).reqControlNumber ?? undefined,
      printCode: (row as any).printCode ?? 'D',
    } as unknown as GLAccount;
  }
}
