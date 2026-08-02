import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { IKpiRepository } from '../domain/interfaces';

@injectable()
export class PrismaKpiRepository implements IKpiRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async listFormulas(tenantId: string) {
    return this.prisma.kpiFormulaVersion.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async createFormula(tenantId: string, data: any) {
    return this.prisma.kpiFormulaVersion.create({ data: { tenantId, ...data } });
  }

  async saveResult(tenantId: string, data: any) {
    return this.prisma.kpiComputedResult.create({ data: { tenantId, ...data } });
  }

  async findFormula(tenantId: string, formulaCode: string) {
    return this.prisma.kpiFormulaVersion.findFirst({ where: { tenantId, formulaCode }, orderBy: { version: 'desc' } });
  }
}
