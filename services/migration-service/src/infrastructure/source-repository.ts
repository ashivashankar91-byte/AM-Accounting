import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { ISourceRepository } from '../domain/interfaces';

@injectable()
export class PrismaSourceRepository implements ISourceRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listSystems(tenantId: string) {
    return this.prisma.sourceSystem.findMany({ where: { tenantId }, orderBy: { systemCode: 'asc' } });
  }

  createSystem(input: {
    tenantId: string; systemCode: string; systemName: string; sourceType: string; configuredBy: string;
    connectionStatus?: string; metadata?: Record<string, unknown>;
  }) {
    return this.prisma.sourceSystem.create({
      data: {
        tenantId: input.tenantId,
        systemCode: input.systemCode,
        systemName: input.systemName,
        sourceType: input.sourceType,
        connectionStatus: input.connectionStatus ?? 'CONFIGURED',
        configuredAt: new Date(),
        configuredBy: input.configuredBy,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  }

  findSystem(tenantId: string, id: string) {
    return this.prisma.sourceSystem.findFirst({ where: { tenantId, id } });
  }

  findSnapshotByRef(tenantId: string, snapshotRef: string) {
    return this.prisma.sourceSnapshot.findFirst({ where: { tenantId, snapshotRef } });
  }

  createSnapshot(input: {
    tenantId: string; legalEntityId: string; sourceSystemId: string; snapshotRef: string; extractedAt: Date;
    importedBy: string; isDelta?: boolean; baseSnapshotId?: string | null; checksums?: Record<string, unknown>;
  }) {
    return this.prisma.sourceSnapshot.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        sourceSystemId: input.sourceSystemId,
        snapshotRef: input.snapshotRef,
        extractedAt: input.extractedAt,
        importedBy: input.importedBy,
        isDelta: input.isDelta ?? false,
        baseSnapshotId: input.baseSnapshotId ?? null,
        checksums: (input.checksums ?? {}) as any,
      },
    });
  }

  listSnapshots(tenantId: string, sourceSystemId: string) {
    return this.prisma.sourceSnapshot.findMany({
      where: { tenantId, sourceSystemId },
      orderBy: { extractedAt: 'desc' },
    });
  }

  findSnapshot(tenantId: string, snapshotId: string) {
    return this.prisma.sourceSnapshot.findFirst({ where: { tenantId, id: snapshotId } });
  }

  findFileByChecksum(tenantId: string, checksum: string) {
    return this.prisma.sourceFile.findFirst({ where: { tenantId, checksumSha256: checksum } });
  }

  createFile(input: {
    tenantId: string; snapshotId: string; filename: string; filePath: string; fileSize: number;
    checksumSha256: string; rowCount: number;
  }) {
    return this.prisma.sourceFile.create({
      data: {
        tenantId: input.tenantId,
        snapshotId: input.snapshotId,
        filename: input.filename,
        filePath: input.filePath,
        fileSize: input.fileSize,
        checksumSha256: input.checksumSha256,
        rowCount: input.rowCount,
        status: 'IMPORTED',
        importedAt: new Date(),
      },
    });
  }

  /**
   * Rerun safety: `skipDuplicates` relies on the (source_file_id, row_hash)
   * unique index, so re-importing the same extract inserts nothing new
   * rather than double-loading.
   */
  async insertRows(input: {
    tenantId: string; sourceFileId: string;
    rows: { rowIndex: number; rowHash: string; rawData: Record<string, unknown> }[];
  }): Promise<{ inserted: number; skippedDuplicates: number }> {
    if (input.rows.length === 0) return { inserted: 0, skippedDuplicates: 0 };
    const result = await this.prisma.sourceRow.createMany({
      data: input.rows.map((r) => ({
        tenantId: input.tenantId,
        sourceFileId: input.sourceFileId,
        rowIndex: r.rowIndex,
        rowHash: r.rowHash,
        rawData: r.rawData as any,
      })),
      skipDuplicates: true,
    });
    return { inserted: result.count, skippedDuplicates: input.rows.length - result.count };
  }

  listRows(tenantId: string, sourceFileId: string, limit: number, offset: number) {
    return this.prisma.sourceRow.findMany({
      where: { tenantId, sourceFileId },
      orderBy: { rowIndex: 'asc' },
      take: limit,
      skip: offset,
    });
  }

  async listRowsBySnapshot(tenantId: string, snapshotId: string, limit = 5000) {
    const files = await this.prisma.sourceFile.findMany({ where: { tenantId, snapshotId }, select: { id: true } });
    if (files.length === 0) return [];
    return this.prisma.sourceRow.findMany({
      where: { tenantId, sourceFileId: { in: files.map((f: any) => f.id) } },
      orderBy: [{ sourceFileId: 'asc' }, { rowIndex: 'asc' }],
      take: limit,
    });
  }

  countRows(tenantId: string, sourceFileId: string) {
    return this.prisma.sourceRow.count({ where: { tenantId, sourceFileId } });
  }

  listFiles(tenantId: string, snapshotId: string) {
    return this.prisma.sourceFile.findMany({ where: { tenantId, snapshotId }, orderBy: { filename: 'asc' } });
  }

  async updateSnapshotTotals(tenantId: string, snapshotId: string, fileCount: number, totalRows: number): Promise<void> {
    await this.prisma.sourceSnapshot.updateMany({
      where: { tenantId, id: snapshotId },
      data: { fileCount, totalRows, status: 'IMPORTED' },
    });
  }
}
