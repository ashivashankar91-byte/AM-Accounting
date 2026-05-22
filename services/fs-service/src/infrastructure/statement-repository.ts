import { Decimal } from '@prisma/client/runtime/library';
import { PrismaClient } from '.prisma/fs-client';
import type { GeneratedLine } from '../domain/fs-generator';

export interface CreateStatementDto {
  oemProfileId: string;
  periodYear: number;
  periodMonth: number;
  statementType?: string;
}

export class StatementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.financialStatement.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { displayOrder: 'asc' } },
        comparisons: true,
        oemProfile: true,
      },
    });
  }

  async findByPeriod(
    tenantId: string,
    oemProfileId: string,
    periodYear: number,
    periodMonth: number,
    statementType = 'MONTHLY',
  ) {
    return this.prisma.financialStatement.findUnique({
      where: {
        tenantId_oemProfileId_periodYear_periodMonth_statementType: {
          tenantId,
          oemProfileId,
          periodYear,
          periodMonth,
          statementType,
        },
      },
      include: { lineItems: { orderBy: { displayOrder: 'asc' } }, comparisons: true, oemProfile: true },
    });
  }

  async listByTenant(tenantId: string, status?: string) {
    return this.prisma.financialStatement.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { oemProfile: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
  }

  async create(tenantId: string, dto: CreateStatementDto) {
    return this.prisma.financialStatement.create({
      data: {
        tenantId,
        oemProfileId: dto.oemProfileId,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        statementType: dto.statementType ?? 'MONTHLY',
      },
    });
  }

  async upsertWithLines(
    tenantId: string,
    oemProfileId: string,
    periodYear: number,
    periodMonth: number,
    statementType: string,
    lines: GeneratedLine[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Upsert statement record
      const stmt = await tx.financialStatement.upsert({
        where: {
          tenantId_oemProfileId_periodYear_periodMonth_statementType: {
            tenantId,
            oemProfileId,
            periodYear,
            periodMonth,
            statementType,
          },
        },
        create: {
          tenantId,
          oemProfileId,
          periodYear,
          periodMonth,
          statementType,
          status: 'GENERATED',
          generatedAt: new Date(),
        },
        update: {
          status: 'GENERATED',
          generatedAt: new Date(),
          reviewedBy: null,
          reviewedAt: null,
          submittedAt: null,
          submittedBy: null,
          responseCode: null,
          responseMessage: null,
          rejectionReason: null,
        },
      });

      // Replace line items
      await tx.fSLineItem.deleteMany({ where: { tenantId, statementId: stmt.id } });
      await tx.fSLineItem.createMany({
        data: lines.map((l) => ({
          tenantId,
          statementId: stmt.id,
          oemLineNumber: l.oemLineNumber,
          oemLineLabel: l.oemLineLabel,
          oemSection: l.oemSection,
          currentMonth: l.currentMonth,
          yearToDate: l.yearToDate,
          priorMonth: l.priorMonth ?? null,
          priorYear: l.priorYear ?? null,
          variance: l.variance ?? null,
          variancePct: l.variancePct ?? null,
          displayOrder: l.displayOrder,
          isSubtotal: l.isSubtotal,
          isTotal: l.isTotal,
          glAccountCodes: l.glAccountCodes,
        })),
      });

      return tx.financialStatement.findUniqueOrThrow({
        where: { id: stmt.id },
        include: { lineItems: { orderBy: { displayOrder: 'asc' } }, comparisons: true, oemProfile: true },
      });
    });
  }

  async updateStatus(id: string, patch: Partial<{
    status: string;
    reviewedBy: string;
    reviewedAt: Date;
    submittedAt: Date;
    submittedBy: string;
    responseCode: string;
    responseMessage: string;
    rejectionReason: string;
  }>) {
    return this.prisma.financialStatement.update({ where: { id }, data: patch });
  }

  async upsertComparison(
    tenantId: string,
    statementId: string,
    comparisonType: string,
    comparisonYear: number,
    comparisonMonth: number,
  ) {
    return this.prisma.fSComparison.upsert({
      where: { tenantId_statementId_comparisonType: { tenantId, statementId, comparisonType } },
      create: { tenantId, statementId, comparisonType, comparisonYear, comparisonMonth },
      update: { comparisonYear, comparisonMonth },
    });
  }
}
