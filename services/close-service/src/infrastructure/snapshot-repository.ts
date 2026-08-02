import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { ISnapshotRepository } from '../domain/interfaces';

@injectable()
export class PrismaSnapshotRepository implements ISnapshotRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: any) {
    return this.prisma.statementSnapshot.create({ data: { tenantId, ...data } });
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.statementSnapshot.findFirst({ where: { id, tenantId } });
  }

  async primarySign(_tenantId: string, id: string, data: any) {
    return this.prisma.statementSnapshot.update({ where: { id }, data: { primarySignerId: data.signerId, primarySignedAt: new Date(), primaryAttestation: data.attestation } });
  }

  async secondarySign(_tenantId: string, id: string, data: any) {
    return this.prisma.statementSnapshot.update({ where: { id }, data: { secondarySignerId: data.signerId, secondarySignedAt: new Date(), secondaryAttestation: data.attestation } });
  }

  async verify(_tenantId: string, id: string) {
    return this.prisma.statementSnapshot.update({ where: { id }, data: { isVerified: true } });
  }
}
