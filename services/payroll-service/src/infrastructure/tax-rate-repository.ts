import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface TaxRateDto {
  taxType: string;
  rate: number;
  wageBase?: number | null;
  effectiveYear: number;
  isEmployer: boolean;
}

export interface ITaxRateRepository {
  findAll(tenantId: TenantId, effectiveYear?: number): Promise<any[]>;
  findByType(tenantId: TenantId, taxType: string, effectiveYear: number, isEmployer: boolean): Promise<any | null>;
  upsert(tenantId: TenantId, dto: TaxRateDto): Promise<any>;
  delete(tenantId: TenantId, taxType: string, effectiveYear: number, isEmployer: boolean): Promise<void>;
}

@injectable()
export class PrismaTaxRateRepository implements ITaxRateRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findAll(tenantId: TenantId, effectiveYear?: number) {
    return this.prisma.payrollTaxRate.findMany({
      where: { tenantId, ...(effectiveYear != null && { effectiveYear }) },
      orderBy: [{ taxType: 'asc' }, { effectiveYear: 'desc' }],
    });
  }

  findByType(tenantId: TenantId, taxType: string, effectiveYear: number, isEmployer: boolean) {
    return this.prisma.payrollTaxRate.findUnique({
      where: { tenantId_taxType_effectiveYear_isEmployer: { tenantId, taxType, effectiveYear, isEmployer } },
    });
  }

  upsert(tenantId: TenantId, dto: TaxRateDto) {
    return this.prisma.payrollTaxRate.upsert({
      where: { tenantId_taxType_effectiveYear_isEmployer: { tenantId, taxType: dto.taxType, effectiveYear: dto.effectiveYear, isEmployer: dto.isEmployer } },
      create: { tenantId, ...dto, wageBase: dto.wageBase ?? null },
      update: { rate: dto.rate, wageBase: dto.wageBase ?? null },
    });
  }

  async delete(tenantId: TenantId, taxType: string, effectiveYear: number, isEmployer: boolean): Promise<void> {
    await this.prisma.payrollTaxRate.deleteMany({ where: { tenantId, taxType, effectiveYear, isEmployer } });
  }
}
