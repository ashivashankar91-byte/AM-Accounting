import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { IStagingRepository } from '../domain/interfaces';

@injectable()
export class PrismaStagingRepository implements IStagingRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async upsertDataset(input: {
    tenantId: string; legalEntityId: string; runId: string; datasetType: string; transformationVersion: string;
    mappingSetId?: string | null; sourceRef?: string | null;
  }) {
    const existing = await this.findDataset(input.tenantId, input.runId, input.datasetType);
    if (existing) {
      await this.prisma.stagingDataset.update({
        where: { id: existing.id },
        data: {
          transformationVersion: input.transformationVersion,
          mappingSetId: input.mappingSetId ?? existing.mappingSetId,
          sourceRef: input.sourceRef ?? existing.sourceRef,
        },
      });
      return this.findDataset(input.tenantId, input.runId, input.datasetType);
    }
    return this.prisma.stagingDataset.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        runId: input.runId,
        datasetType: input.datasetType,
        transformationVersion: input.transformationVersion,
        mappingSetId: input.mappingSetId ?? null,
        sourceRef: input.sourceRef ?? null,
      },
    });
  }

  findDataset(tenantId: string, runId: string, datasetType: string) {
    return this.prisma.stagingDataset.findFirst({ where: { tenantId, runId, datasetType } });
  }

  listDatasets(tenantId: string, runId: string) {
    return this.prisma.stagingDataset.findMany({ where: { tenantId, runId }, orderBy: { datasetType: 'asc' } });
  }

  /**
   * Idempotent by construction: staging_rows is UNIQUE (staging_dataset_id,
   * row_hash) and the row hash is a pure function of source identity + mapped
   * payload + transformation version. Restaging the same batch inserts zero
   * rows and reports them as skipped duplicates.
   */
  async insertRows(input: {
    tenantId: string; stagingDatasetId: string;
    rows: {
      sourceRowId: string | null; rowHash: string; stagedData: Record<string, unknown>;
      validationErrors: unknown[]; lineageRef: Record<string, unknown>;
    }[];
  }): Promise<{ inserted: number; skippedDuplicates: number }> {
    if (input.rows.length === 0) return { inserted: 0, skippedDuplicates: 0 };
    const result = await this.prisma.stagingRow.createMany({
      data: input.rows.map((r) => ({
        tenantId: input.tenantId,
        stagingDatasetId: input.stagingDatasetId,
        sourceRowId: r.sourceRowId,
        rowHash: r.rowHash,
        stagedData: r.stagedData as any,
        validationErrors: r.validationErrors as any,
        lineageRef: r.lineageRef as any,
        state: r.validationErrors.length > 0 ? 'ERROR' : 'STAGED',
      })),
      skipDuplicates: true,
    });
    return { inserted: result.count, skippedDuplicates: input.rows.length - result.count };
  }

  listRows(tenantId: string, stagingDatasetId: string, limit = 500, offset = 0) {
    return this.prisma.stagingRow.findMany({
      where: { tenantId, stagingDatasetId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    });
  }

  countRows(tenantId: string, stagingDatasetId: string) {
    return this.prisma.stagingRow.count({ where: { tenantId, stagingDatasetId } });
  }

  async updateDataset(tenantId: string, datasetId: string, patch: Record<string, unknown>) {
    await this.prisma.stagingDataset.updateMany({ where: { tenantId, id: datasetId }, data: patch as any });
    return this.prisma.stagingDataset.findFirst({ where: { tenantId, id: datasetId } });
  }

  async markRowsPromoted(tenantId: string, datasetId: string, promotions: { rowHash: string; promotedRecordId: string }[]): Promise<number> {
    let count = 0;
    for (const promotion of promotions) {
      const result = await this.prisma.stagingRow.updateMany({
        where: { tenantId, stagingDatasetId: datasetId, rowHash: promotion.rowHash },
        data: { state: 'PROMOTED', promotedAt: new Date(), promotedRecordId: promotion.promotedRecordId },
      });
      count += result.count;
    }
    return count;
  }

  /**
   * Staged-data reset. Rows are only deletable while nothing has been
   * promoted — a promoted row is evidence of what was posted, so promoted
   * rows are deliberately excluded from the delete predicate.
   */
  async resetRows(tenantId: string, stagingDatasetId: string): Promise<number> {
    const result = await this.prisma.stagingRow.deleteMany({
      where: { tenantId, stagingDatasetId, state: { notIn: ['PROMOTED'] } },
    });
    return result.count;
  }
}
