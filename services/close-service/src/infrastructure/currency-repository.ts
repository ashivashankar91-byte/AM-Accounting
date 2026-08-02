import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { ICurrencyRepository } from '../domain/interfaces';

@injectable()
export class PrismaCurrencyRepository implements ICurrencyRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async getConfig(tenantId: string, legalEntityId: string) {
    return this.prisma.currencyConfig.findFirst({ where: { tenantId, legalEntityId } });
  }

  async upsertConfig(tenantId: string, legalEntityId: string, data: any) {
    return this.prisma.currencyConfig.upsert({
      where: { tenantId_legalEntityId: { tenantId, legalEntityId } },
      update: data,
      create: { tenantId, legalEntityId, ...data },
    });
  }

  async addRate(tenantId: string, data: any) {
    return this.prisma.translationRate.create({ data: { tenantId, ...data } });
  }

  async listRates(tenantId: string, params: any) {
    return this.prisma.translationRate.findMany({ where: { tenantId, ...params } });
  }

  async createTranslationRun(tenantId: string, data: any) {
    return this.prisma.translationRun.create({ data: { tenantId, ...data } });
  }

  async findTranslationRun(tenantId: string, id: string) {
    return this.prisma.translationRun.findFirst({ where: { id, tenantId } });
  }

  async approveTranslationRun(_tenantId: string, id: string, approvedBy: string) {
    return this.prisma.translationRun.update({ where: { id }, data: { approvedBy, approvedAt: new Date(), status: 'APPROVED' } });
  }

  async postTranslationRun(_tenantId: string, id: string, postedBy: string, journalId: string) {
    return this.prisma.translationRun.update({ where: { id }, data: { approvedBy: postedBy, postedAt: new Date(), postedJournalId: journalId, status: 'POSTED' } });
  }
}
