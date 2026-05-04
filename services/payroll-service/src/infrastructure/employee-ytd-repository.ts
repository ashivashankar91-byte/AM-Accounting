import { PrismaClient, Prisma } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';

export interface YTDAccumulatorDelta {
  grossPay: Prisma.Decimal;
  federalTax: Prisma.Decimal;
  stateTax: Prisma.Decimal;
  socialSecurity: Prisma.Decimal;
  medicare: Prisma.Decimal;
  ficaWages: Prisma.Decimal;
  otherDeductions: Prisma.Decimal;
  netPay: Prisma.Decimal;
}

export interface IEmployeeYTDRepository {
  findByEmployeeAndYear(tenantId: TenantId, employeeId: string, year: number): Promise<any | null>;
  findByTenantAndYear(tenantId: TenantId, year: number): Promise<any[]>;
  accumulateDelta(tenantId: TenantId, employeeId: string, year: number, delta: YTDAccumulatorDelta): Promise<any>;
  reverseDelta(tenantId: TenantId, employeeId: string, year: number, delta: YTDAccumulatorDelta): Promise<any>;
}

@injectable()
export class PrismaEmployeeYTDRepository implements IEmployeeYTDRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findByEmployeeAndYear(tenantId: TenantId, employeeId: string, year: number) {
    return this.prisma.employeeYTD.findUnique({
      where: { tenantId_employeeId_year: { tenantId, employeeId, year } },
    });
  }

  findByTenantAndYear(tenantId: TenantId, year: number) {
    return this.prisma.employeeYTD.findMany({
      where: { tenantId, year },
      include: { employee: true },
      orderBy: { employee: { lastName: 'asc' } },
    });
  }

  async accumulateDelta(
    tenantId: TenantId,
    employeeId: string,
    year: number,
    delta: YTDAccumulatorDelta,
  ) {
    // Upsert: create with delta values if row doesn't exist, otherwise increment
    return this.prisma.employeeYTD.upsert({
      where: { tenantId_employeeId_year: { tenantId, employeeId, year } },
      create: {
        tenantId,
        employeeId,
        year,
        grossPay: delta.grossPay,
        federalTax: delta.federalTax,
        stateTax: delta.stateTax,
        socialSecurity: delta.socialSecurity,
        medicare: delta.medicare,
        ficaWages: delta.ficaWages,
        otherDeductions: delta.otherDeductions,
        netPay: delta.netPay,
      },
      update: {
        grossPay: { increment: delta.grossPay },
        federalTax: { increment: delta.federalTax },
        stateTax: { increment: delta.stateTax },
        socialSecurity: { increment: delta.socialSecurity },
        medicare: { increment: delta.medicare },
        ficaWages: { increment: delta.ficaWages },
        otherDeductions: { increment: delta.otherDeductions },
        netPay: { increment: delta.netPay },
      },
    });
  }

  async reverseDelta(
    tenantId: TenantId,
    employeeId: string,
    year: number,
    delta: YTDAccumulatorDelta,
  ) {
    const negDelta: YTDAccumulatorDelta = {
      grossPay: delta.grossPay.negated(),
      federalTax: delta.federalTax.negated(),
      stateTax: delta.stateTax.negated(),
      socialSecurity: delta.socialSecurity.negated(),
      medicare: delta.medicare.negated(),
      ficaWages: delta.ficaWages.negated(),
      otherDeductions: delta.otherDeductions.negated(),
      netPay: delta.netPay.negated(),
    };
    return this.accumulateDelta(tenantId, employeeId, year, negDelta);
  }
}
