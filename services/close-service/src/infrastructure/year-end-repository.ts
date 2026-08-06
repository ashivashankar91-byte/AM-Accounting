import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { IYearEndRepository } from '../domain/interfaces';

@injectable()
export class PrismaYearEndRepository implements IYearEndRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async createPreview(tenantId: string, data: any) {
    return this.prisma.yearEndRun.create({ data: { tenantId, ...data } });
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.yearEndRun.findFirst({ where: { id, tenantId } });
  }

  async approve(_tenantId: string, id: string, _approvedBy: string) {
    return this.prisma.yearEndRun.update({ where: { id }, data: { status: 'APPROVED' } });
  }

  async post(_tenantId: string, id: string, postedBy: string, journalId: string) {
    return this.prisma.yearEndRun.update({ where: { id }, data: { status: 'POSTED', postedBy, postedAt: new Date(), postedJournalId: journalId } });
  }
}
