import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { Prisma } from '.prisma/payroll-client';
import { TenantId } from '@amacc/shared-kernel';

export interface CreateBatchDto {
  batchNumber: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  payDate: Date;
  payFrequency: string;
  createdBy: string;
}

export interface IBatchRepository {
  findById(tenantId: TenantId, id: string): Promise<any | null>;
  findByBatchNumber(tenantId: TenantId, batchNumber: string): Promise<any | null>;
  listByTenant(tenantId: TenantId, filters?: { status?: string; payFrequency?: string }): Promise<any[]>;
  create(tenantId: TenantId, dto: CreateBatchDto): Promise<any>;
  updateStatus(tenantId: TenantId, id: string, status: string, extra?: Record<string, unknown>): Promise<any>;
  updateTotals(tenantId: TenantId, id: string, totals: {
    totalGrossPay: Prisma.Decimal;
    totalDeductions: Prisma.Decimal;
    totalNetPay: Prisma.Decimal;
    totalEmployerTax: Prisma.Decimal;
    employeeCount: number;
  }): Promise<any>;
  setJournalEntryId(tenantId: TenantId, id: string, journalEntryId: string): Promise<any>;
  listNonVoidInWindow(tenantId: TenantId, fromDate: Date, toDate: Date): Promise<any[]>;
}

@injectable()
export class PrismaBatchRepository implements IBatchRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findById(tenantId: TenantId, id: string) {
    return this.prisma.payrollBatch.findFirst({
      where: { id, tenantId },
      include: { items: { include: { employee: true } } },
    });
  }

  findByBatchNumber(tenantId: TenantId, batchNumber: string) {
    return this.prisma.payrollBatch.findUnique({
      where: { tenantId_batchNumber: { tenantId, batchNumber } },
    });
  }

  listByTenant(tenantId: TenantId, filters?: { status?: string; payFrequency?: string }) {
    return this.prisma.payrollBatch.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.payFrequency && { payFrequency: filters.payFrequency }),
      },
      orderBy: { payDate: 'desc' },
    });
  }

  create(tenantId: TenantId, dto: CreateBatchDto) {
    return this.prisma.payrollBatch.create({
      data: {
        tenantId,
        batchNumber: dto.batchNumber,
        payPeriodStart: dto.payPeriodStart,
        payPeriodEnd: dto.payPeriodEnd,
        payDate: dto.payDate,
        payFrequency: dto.payFrequency,
        status: 'DRAFT',
        createdBy: dto.createdBy,
      },
    });
  }

  updateStatus(tenantId: TenantId, id: string, status: string, extra?: Record<string, unknown>) {
    return this.prisma.payrollBatch.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  updateTotals(tenantId: TenantId, id: string, totals: {
    totalGrossPay: Prisma.Decimal;
    totalDeductions: Prisma.Decimal;
    totalNetPay: Prisma.Decimal;
    totalEmployerTax: Prisma.Decimal;
    employeeCount: number;
  }) {
    return this.prisma.payrollBatch.update({
      where: { id },
      data: totals,
    });
  }

  setJournalEntryId(tenantId: TenantId, id: string, journalEntryId: string) {
    return this.prisma.payrollBatch.update({
      where: { id },
      data: { journalEntryId },
    });
  }

  listNonVoidInWindow(tenantId: TenantId, fromDate: Date, toDate: Date) {
    return this.prisma.payrollBatch.findMany({
      where: {
        tenantId,
        status: { not: 'VOID' },
        payDate: { gte: fromDate, lte: toDate },
      },
    });
  }
}
