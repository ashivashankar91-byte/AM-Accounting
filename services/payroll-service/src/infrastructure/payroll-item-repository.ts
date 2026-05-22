import { PrismaClient, Prisma } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface CreatePayrollItemDto {
  batchId: string;
  employeeId: string;
  department: string;

  regularHours?: number | null;
  overtimeHours?: number | null;
  regularPay: number;
  overtimePay?: number;
  commissionPay?: number;
  bonusPay?: number;
  otherPay?: number;
  grossPay: number;

  federalTax: number;
  stateTax: number;
  socialSecurity: number;
  medicare: number;
  otherDeductions?: number;
  totalDeductions: number;
  netPay: number;

  employerFICA: number;
  employerMedicare: number;
  employerFUTA: number;
  employerSUTA: number;
  totalEmployerTax: number;

  glAccountCode?: string | null;
  glDepartment?: string | null;
}

export interface IPayrollItemRepository {
  findByBatch(tenantId: TenantId, batchId: string): Promise<any[]>;
  findById(tenantId: TenantId, id: string): Promise<any | null>;
  create(tenantId: TenantId, dto: CreatePayrollItemDto): Promise<any>;
  deleteById(tenantId: TenantId, id: string): Promise<void>;
  deleteByBatch(tenantId: TenantId, batchId: string): Promise<void>;
  sumByBatch(tenantId: TenantId, batchId: string): Promise<{
    totalGrossPay: Prisma.Decimal;
    totalDeductions: Prisma.Decimal;
    totalNetPay: Prisma.Decimal;
    totalEmployerTax: Prisma.Decimal;
    employeeCount: number;
  }>;
}

@injectable()
export class PrismaPayrollItemRepository implements IPayrollItemRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findByBatch(tenantId: TenantId, batchId: string) {
    return this.prisma.payrollItem.findMany({
      where: { tenantId, batchId },
      include: { employee: true },
      orderBy: { employee: { lastName: 'asc' } },
    });
  }

  findById(tenantId: TenantId, id: string) {
    return this.prisma.payrollItem.findFirst({ where: { id, tenantId }, include: { employee: true } });
  }

  create(tenantId: TenantId, dto: CreatePayrollItemDto) {
    return this.prisma.payrollItem.create({
      data: {
        tenantId,
        batchId: dto.batchId,
        employeeId: dto.employeeId,
        department: dto.department,
        regularHours: dto.regularHours != null ? dto.regularHours : null,
        overtimeHours: dto.overtimeHours != null ? dto.overtimeHours : null,
        regularPay: dto.regularPay,
        overtimePay: dto.overtimePay ?? 0,
        commissionPay: dto.commissionPay ?? 0,
        bonusPay: dto.bonusPay ?? 0,
        otherPay: dto.otherPay ?? 0,
        grossPay: dto.grossPay,
        federalTax: dto.federalTax,
        stateTax: dto.stateTax,
        socialSecurity: dto.socialSecurity,
        medicare: dto.medicare,
        otherDeductions: dto.otherDeductions ?? 0,
        totalDeductions: dto.totalDeductions,
        netPay: dto.netPay,
        employerFICA: dto.employerFICA,
        employerMedicare: dto.employerMedicare,
        employerFUTA: dto.employerFUTA,
        employerSUTA: dto.employerSUTA,
        totalEmployerTax: dto.totalEmployerTax,
        glAccountCode: dto.glAccountCode ?? null,
        glDepartment: dto.glDepartment ?? null,
      },
    });
  }

  async deleteById(tenantId: TenantId, id: string): Promise<void> {
    await this.prisma.payrollItem.deleteMany({ where: { id, tenantId } });
  }

  async deleteByBatch(tenantId: TenantId, batchId: string): Promise<void> {
    await this.prisma.payrollItem.deleteMany({ where: { batchId, tenantId } });
  }

  async sumByBatch(tenantId: TenantId, batchId: string) {
    const agg = await this.prisma.payrollItem.aggregate({
      where: { tenantId, batchId },
      _sum: { grossPay: true, totalDeductions: true, netPay: true, totalEmployerTax: true },
      _count: { employeeId: true },
    });
    return {
      totalGrossPay: agg._sum.grossPay ?? new Prisma.Decimal(0),
      totalDeductions: agg._sum.totalDeductions ?? new Prisma.Decimal(0),
      totalNetPay: agg._sum.netPay ?? new Prisma.Decimal(0),
      totalEmployerTax: agg._sum.totalEmployerTax ?? new Prisma.Decimal(0),
      employeeCount: agg._count.employeeId,
    };
  }
}
