import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { IScrubRepository } from '../domain/interfaces';

@injectable()
export class PrismaScrubRepository implements IScrubRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async createRun(tenantId: string, data: any) {
    return this.prisma.scrubRun.create({ data: { tenantId, ...data } });
  }

  async findRuns(tenantId: string, params: any) {
    return this.prisma.scrubRun.findMany({ where: { tenantId, ...params }, orderBy: { createdAt: 'desc' } });
  }

  async findFindings(tenantId: string, scrubRunId: string) {
    return this.prisma.scrubFinding.findMany({ where: { tenantId, scrubRunId } });
  }

  async disposeFinding(_tenantId: string, id: string, data: any) {
    return this.prisma.scrubFinding.update({
      where: { id },
      data: { status: data.action === 'OVERRIDE' ? 'OVERRIDDEN' : 'DEFERRED', overriddenBy: data.actor, overrideReason: data.reason, deferredUntil: data.deferredUntil },
    });
  }

  async completeRun(_tenantId: string, id: string, findingsCount: number) {
    return this.prisma.scrubRun.update({ where: { id }, data: { status: 'COMPLETED', findingsCount } });
  }

  async createFindings(tenantId: string, scrubRunId: string, findings: any[]) {
    await this.prisma.scrubFinding.createMany({ data: findings.map(f => ({ tenantId, scrubRunId, ...f })) });
  }
}
