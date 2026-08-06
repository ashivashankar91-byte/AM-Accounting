import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { IComparisonRepository } from '../domain/interfaces';
import { EXPLAINED_CLASSIFICATIONS } from '../domain/parallel-run-comparator';

@injectable()
export class PrismaComparisonRepository implements IComparisonRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  create(input: {
    tenantId: string; legalEntityId: string; runId: string; periodYear: number; periodMonth: number;
    legacySnapshotRef?: string | null; operatorId: string; comparisonVersion: number;
  }) {
    return this.prisma.comparisonRun.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        runId: input.runId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        legacySnapshotRef: input.legacySnapshotRef ?? null,
        comparisonVersion: input.comparisonVersion,
        operatorId: input.operatorId,
      },
    });
  }

  async nextVersion(tenantId: string, runId: string, periodYear: number, periodMonth: number): Promise<number> {
    const latest = await this.prisma.comparisonRun.findFirst({
      where: { tenantId, runId, periodYear, periodMonth },
      orderBy: { comparisonVersion: 'desc' },
      select: { comparisonVersion: true },
    });
    return (latest?.comparisonVersion ?? 0) + 1;
  }

  find(tenantId: string, id: string) {
    return this.prisma.comparisonRun.findFirst({ where: { tenantId, id } });
  }

  list(tenantId: string, runId: string) {
    return this.prisma.comparisonRun.findMany({
      where: { tenantId, runId },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { comparisonVersion: 'desc' }],
    });
  }

  async insertDiffs(tenantId: string, comparisonRunId: string, diffs: {
    diffType: string; dimension: string; sourceValue: number; targetValue: number; variance: number; classification: string;
  }[]): Promise<number> {
    if (diffs.length === 0) return 0;
    const result = await this.prisma.comparisonDiff.createMany({
      data: diffs.map((d) => ({
        tenantId,
        comparisonRunId,
        diffType: d.diffType,
        dimension: d.dimension,
        sourceValue: d.sourceValue,
        targetValue: d.targetValue,
        variance: d.variance,
        classification: d.classification,
      })),
    });
    return result.count;
  }

  listDiffs(tenantId: string, comparisonRunId: string) {
    return this.prisma.comparisonDiff.findMany({
      where: { tenantId, comparisonRunId },
      orderBy: [{ diffType: 'asc' }, { dimension: 'asc' }],
    });
  }

  findDiff(tenantId: string, diffId: string) {
    return this.prisma.comparisonDiff.findFirst({ where: { tenantId, id: diffId } });
  }

  async updateDiff(tenantId: string, diffId: string, patch: Record<string, unknown>) {
    await this.prisma.comparisonDiff.updateMany({ where: { tenantId, id: diffId }, data: patch as any });
    return this.findDiff(tenantId, diffId);
  }

  async updateRun(tenantId: string, id: string, patch: Record<string, unknown>) {
    await this.prisma.comparisonRun.updateMany({ where: { tenantId, id }, data: patch as any });
    return this.find(tenantId, id);
  }

  /**
   * A difference counts as explained only when it carries a non-UNEXPLAINED
   * classification, a reason, AND an APPROVED disposition. Anything else is
   * still an open item that blocks the cutover recommendation.
   */
  async countUnexplained(tenantId: string, runId: string): Promise<number> {
    const runs = await this.prisma.comparisonRun.findMany({ where: { tenantId, runId }, select: { id: true } });
    if (runs.length === 0) return 0;
    return this.prisma.comparisonDiff.count({
      where: {
        tenantId,
        comparisonRunId: { in: runs.map((r: any) => r.id) },
        OR: [
          { classification: { notIn: EXPLAINED_CLASSIFICATIONS } },
          { disposition: { not: 'APPROVED' } },
          { reason: null },
        ],
      },
    });
  }

  async allPeriodsSignedOff(tenantId: string, runId: string): Promise<boolean> {
    const runs = await this.prisma.comparisonRun.findMany({ where: { tenantId, runId }, select: { state: true } });
    if (runs.length === 0) return false;
    return runs.every((r: any) => r.state === 'SIGNED_OFF');
  }
}
