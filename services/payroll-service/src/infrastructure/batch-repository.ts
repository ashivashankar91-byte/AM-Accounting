import { PrismaClient } from '.prisma/payroll-client';
import { inject, injectable } from 'tsyringe';
import { Prisma } from '.prisma/payroll-client';
import { TenantId } from '@amacc/shared-kernel';

export interface CreateBatchDto {
  batchNumber: string;
  /** fix(integration): required — replaces the temporary legalEntityId=tenantId substitution. */
  legalEntityId: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  payDate: Date;
  payFrequency: string;
  createdBy: string;
  providerRunId?: string;
}

export interface IBatchRepository {
  findById(tenantId: TenantId, id: string): Promise<any | null>;
  findByBatchNumber(tenantId: TenantId, batchNumber: string): Promise<any | null>;
  findByProviderRunId(tenantId: TenantId, legalEntityId: string | null, providerRunId: string, payPeriodStart: Date, payPeriodEnd: Date): Promise<any | null>;
  listByTenant(tenantId: TenantId, filters?: { status?: string; payFrequency?: string; legalEntityId?: string | null }): Promise<any[]>;
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

  // fix(integration): findFirst, not the native compound-key findUnique —
  // Prisma requires every compound-key member non-null even though
  // legalEntityId is a nullable column (see gl-mapping-repository.ts's
  // doc-comment for the same limitation).
  findByProviderRunId(tenantId: TenantId, legalEntityId: string | null, providerRunId: string, payPeriodStart: Date, payPeriodEnd: Date) {
    return this.prisma.payrollBatch.findFirst({
      where: { tenantId, legalEntityId, providerRunId, payPeriodStart, payPeriodEnd },
    });
  }

  listByTenant(tenantId: TenantId, filters?: { status?: string; payFrequency?: string; legalEntityId?: string | null }) {
    return this.prisma.payrollBatch.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.payFrequency && { payFrequency: filters.payFrequency }),
        ...(filters?.legalEntityId !== undefined && { legalEntityId: filters.legalEntityId }),
      },
      orderBy: { payDate: 'desc' },
    });
  }

  create(tenantId: TenantId, dto: CreateBatchDto) {
    return this.prisma.payrollBatch.create({
      data: {
        tenantId,
        legalEntityId: dto.legalEntityId,
        batchNumber: dto.batchNumber,
        payPeriodStart: dto.payPeriodStart,
        payPeriodEnd: dto.payPeriodEnd,
        payDate: dto.payDate,
        payFrequency: dto.payFrequency,
        status: 'DRAFT',
        createdBy: dto.createdBy,
        providerRunId: dto.providerRunId ?? null,
      } as any,
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
