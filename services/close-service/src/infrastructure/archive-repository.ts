import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { IArchiveRepository } from '../domain/interfaces';

@injectable()
export class PrismaArchiveRepository implements IArchiveRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: any) {
    return this.prisma.archiveObject.create({ data: { tenantId, ...data } });
  }

  async findAll(tenantId: string) {
    return this.prisma.archiveObject.findMany({ where: { tenantId, deletedAt: null } });
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.archiveObject.findFirst({ where: { id, tenantId } });
  }

  async softDelete(_tenantId: string, id: string) {
    return this.prisma.archiveObject.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async createRetentionSchedule(tenantId: string, data: any) {
    return this.prisma.retentionSchedule.upsert({
      where: { tenantId_recordClass: { tenantId, recordClass: data.recordClass } },
      update: data,
      create: { tenantId, ...data },
    });
  }
}
