import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface GLMappingDto {
  department: string;
  payComponent: string;
  glAccountCode: string;
  isDebit: boolean;
}

export interface IGLMappingRepository {
  findAll(tenantId: TenantId): Promise<any[]>;
  findByDeptAndComponent(tenantId: TenantId, department: string, payComponent: string): Promise<any | null>;
  findByDepartment(tenantId: TenantId, department: string): Promise<any[]>;
  upsert(tenantId: TenantId, dto: GLMappingDto): Promise<any>;
  delete(tenantId: TenantId, department: string, payComponent: string): Promise<void>;
}

@injectable()
export class PrismaGLMappingRepository implements IGLMappingRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findAll(tenantId: TenantId) {
    return this.prisma.payrollGLMapping.findMany({
      where: { tenantId },
      orderBy: [{ department: 'asc' }, { payComponent: 'asc' }],
    });
  }

  findByDeptAndComponent(tenantId: TenantId, department: string, payComponent: string) {
    return this.prisma.payrollGLMapping.findUnique({
      where: { tenantId_department_payComponent: { tenantId, department, payComponent } },
    });
  }

  findByDepartment(tenantId: TenantId, department: string) {
    return this.prisma.payrollGLMapping.findMany({ where: { tenantId, department } });
  }

  upsert(tenantId: TenantId, dto: GLMappingDto) {
    return this.prisma.payrollGLMapping.upsert({
      where: { tenantId_department_payComponent: { tenantId, department: dto.department, payComponent: dto.payComponent } },
      create: { tenantId, ...dto },
      update: { glAccountCode: dto.glAccountCode, isDebit: dto.isDebit },
    });
  }

  async delete(tenantId: TenantId, department: string, payComponent: string): Promise<void> {
    await this.prisma.payrollGLMapping.deleteMany({ where: { tenantId, department, payComponent } });
  }
}
