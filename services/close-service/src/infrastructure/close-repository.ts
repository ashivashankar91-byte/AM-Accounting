import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { ICloseRepository } from '../domain/interfaces';

@injectable()
export class PrismaCloseRepository implements ICloseRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findState(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number) {
    return this.prisma.closePeriodState.findUnique({
      where: { tenantId_legalEntityId_periodYear_periodMonth: { tenantId, legalEntityId, periodYear, periodMonth } },
    });
  }

  async upsertState(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number, state: string, previousState: string, transitionBy: string, reason: string | undefined, _version: number) {
    return this.prisma.closePeriodState.upsert({
      where: { tenantId_legalEntityId_periodYear_periodMonth: { tenantId, legalEntityId, periodYear, periodMonth } },
      update: { state, previousState, transitionBy, transitionAt: new Date(), transitionReason: reason, version: { increment: 1 } },
      create: { tenantId, legalEntityId, periodYear, periodMonth, state, previousState, transitionBy, transitionAt: new Date(), transitionReason: reason },
    });
  }

  async getExceptionOverriderIds(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number): Promise<string[]> {
    const runs = await this.prisma.scrubRun.findMany({
      where: { tenantId, legalEntityId, periodYear, periodMonth },
      select: { id: true },
    });
    const runIds = runs.map((r: any) => r.id);
    if (runIds.length === 0) return [];
    const findings = await this.prisma.scrubFinding.findMany({
      where: { tenantId, scrubRunId: { in: runIds }, status: 'OVERRIDDEN' },
      select: { overriddenBy: true },
    });
    return findings.map((f: any) => f.overriddenBy).filter(Boolean) as string[];
  }
}
