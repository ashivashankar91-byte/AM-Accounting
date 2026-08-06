import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { IReconciliationRepository } from '../domain/interfaces';

@injectable()
export class PrismaReconciliationRepository implements IReconciliationRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findAll(tenantId: string, params: any) {
    return this.prisma.reconciliationRegister.findMany({ where: { tenantId, ...params } });
  }

  async create(tenantId: string, data: any) {
    return this.prisma.reconciliationRegister.create({ data: { tenantId, ...data } });
  }

  async signOff(tenantId: string, id: string, data: any) {
    return this.prisma.reconciliationRegister.update({
      where: { id },
      data: { status: 'RECONCILED', reviewerId: data.reviewerId, reviewedAt: new Date(), notes: data.notes },
    });
  }
}
