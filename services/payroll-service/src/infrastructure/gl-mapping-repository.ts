import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface GLMappingDto {
  legalEntityId: string | null;
  department: string;
  payComponent: string;
  glAccountCode: string;
  isDebit: boolean;
}

export interface IGLMappingRepository {
  findAll(tenantId: TenantId, legalEntityId?: string | null): Promise<any[]>;
  findByDeptAndComponent(tenantId: TenantId, legalEntityId: string | null, department: string, payComponent: string): Promise<any | null>;
  findByDepartment(tenantId: TenantId, legalEntityId: string | null, department: string): Promise<any[]>;
  upsert(tenantId: TenantId, dto: GLMappingDto): Promise<any>;
  delete(tenantId: TenantId, legalEntityId: string | null, department: string, payComponent: string): Promise<void>;
}

/**
 * fix(integration): Prisma's compound-unique-key `findUnique`/`upsert`
 * input types require every member to be non-null even when the
 * underlying column (legalEntityId) is nullable (a well-known Prisma
 * limitation — NULL in a Postgres unique index doesn't have find-unique
 * semantics). Lookups/upserts here use findFirst + explicit create/update
 * instead of the native compound-key helpers so a null legalEntityId
 * (legacy, pre-reconciliation rows only) still round-trips correctly.
 */
@injectable()
export class PrismaGLMappingRepository implements IGLMappingRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findAll(tenantId: TenantId, legalEntityId?: string | null) {
    return this.prisma.payrollGLMapping.findMany({
      where: { tenantId, ...(legalEntityId !== undefined ? { legalEntityId } : {}) },
      orderBy: [{ department: 'asc' }, { payComponent: 'asc' }],
    });
  }

  findByDeptAndComponent(tenantId: TenantId, legalEntityId: string | null, department: string, payComponent: string) {
    return this.prisma.payrollGLMapping.findFirst({
      where: { tenantId, legalEntityId, department, payComponent },
    });
  }

  findByDepartment(tenantId: TenantId, legalEntityId: string | null, department: string) {
    return this.prisma.payrollGLMapping.findMany({ where: { tenantId, legalEntityId, department } });
  }

  async upsert(tenantId: TenantId, dto: GLMappingDto) {
    const existing = await this.prisma.payrollGLMapping.findFirst({
      where: { tenantId, legalEntityId: dto.legalEntityId, department: dto.department, payComponent: dto.payComponent },
    });
    if (existing) {
      return this.prisma.payrollGLMapping.update({
        where: { id: existing.id },
        data: { glAccountCode: dto.glAccountCode, isDebit: dto.isDebit },
      });
    }
    return this.prisma.payrollGLMapping.create({ data: { tenantId, ...dto } });
  }

  async delete(tenantId: TenantId, legalEntityId: string | null, department: string, payComponent: string): Promise<void> {
    await this.prisma.payrollGLMapping.deleteMany({ where: { tenantId, legalEntityId, department, payComponent } });
  }
}
