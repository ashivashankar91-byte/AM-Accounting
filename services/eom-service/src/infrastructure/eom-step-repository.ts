import { injectable, inject } from 'tsyringe';
import { IEOMStepRepository, EOMStep, EOMStepStatus } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/eom-client';
import type { EOMStep as PrismaEOMStep } from '.prisma/eom-client';

@injectable()
export class PrismaEOMStepRepository implements IEOMStepRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findByCloseId(closeId: string): Promise<EOMStep[]> {
    const rows = await this.prisma.eOMStep.findMany({
      where: { eomCloseId: closeId },
      orderBy: { stepCode: 'asc' },
    });
    return rows.map(this.toDomain);
  }

  async updateStatus(id: string, status: string, errorMessage?: string): Promise<EOMStep> {
    const row = await this.prisma.eOMStep.update({
      where: { id },
      data: {
        status,
        errorMessage: errorMessage ?? null,
        ...(status === 'RUNNING' ? { startedAt: new Date() } : {}),
        ...(status === 'DONE' ? { completedAt: new Date() } : {}),
      },
    });
    return this.toDomain(row);
  }

  async incrementRetry(id: string): Promise<EOMStep> {
    const row = await this.prisma.eOMStep.update({
      where: { id },
      data: { retryCount: { increment: 1 } },
    });
    return this.toDomain(row);
  }

  private toDomain(row: PrismaEOMStep): EOMStep {
    return {
      id: row.id,
      eomCloseId: row.eomCloseId,
      stepCode: row.stepCode,
      stepName: row.stepName,
      status: row.status as EOMStepStatus,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      errorMessage: row.errorMessage,
      retryCount: row.retryCount,
    };
  }
}
