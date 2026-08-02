import { inject, injectable } from 'tsyringe';
import { createHash } from 'crypto';
import { ISourceRepository, IUpstreamTargetClient } from '../domain/interfaces';
import { computeSourceRowHash } from '../domain/transformation-engine';
import { maskRecords } from '../domain/sensitive-data-masker';

export class DuplicateSourceFileError extends Error {
  readonly code = 'DUPLICATE_SOURCE_FILE';
  readonly statusCode = 409;
  constructor(public readonly checksum: string, public readonly existingFileId: string) {
    super(`A source file with checksum ${checksum} has already been imported (file ${existingFileId})`);
    this.name = 'DuplicateSourceFileError';
  }
}

export class ChecksumMismatchError extends Error {
  readonly code = 'CHECKSUM_MISMATCH';
  readonly statusCode = 422;
  constructor(public readonly declared: string, public readonly computed: string) {
    super(`Declared checksum ${declared} does not match computed checksum ${computed}`);
    this.name = 'ChecksumMismatchError';
  }
}

export interface ImportRowsInput {
  tenantId: string;
  legalEntityId: string;
  snapshotId: string;
  filename: string;
  filePath: string;
  /** SHA-256 the caller claims for the file; verified against the payload. */
  declaredChecksum: string;
  rows: Record<string, unknown>[];
  actor: string;
}

@injectable()
export class SourceService {
  constructor(
    @inject('ISourceRepository') private readonly repo: ISourceRepository,
    @inject('IUpstreamTargetClient') private readonly upstream: IUpstreamTargetClient,
  ) {}

  listSystems(tenantId: string) {
    return this.repo.listSystems(tenantId);
  }

  registerSystem(input: {
    tenantId: string; systemCode: string; systemName: string; sourceType: string; actor: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!['AUTOMATE', 'COMPETITOR'].includes(input.sourceType)) {
      const err: any = new Error(`sourceType must be AUTOMATE or COMPETITOR (received '${input.sourceType}')`);
      err.statusCode = 400;
      err.code = 'INVALID_SOURCE_TYPE';
      throw err;
    }
    return this.repo.createSystem({
      tenantId: input.tenantId,
      systemCode: input.systemCode,
      systemName: input.systemName,
      sourceType: input.sourceType,
      configuredBy: input.actor,
      metadata: input.metadata,
    });
  }

  async registerSnapshot(input: {
    tenantId: string; legalEntityId: string; sourceSystemId: string; snapshotRef: string;
    extractedAt: string; actor: string; isDelta?: boolean; baseSnapshotId?: string | null;
  }) {
    const system = await this.repo.findSystem(input.tenantId, input.sourceSystemId);
    if (!system) {
      const err: any = new Error('SOURCE_NOT_CONFIGURED');
      err.statusCode = 404;
      err.code = 'SOURCE_NOT_CONFIGURED';
      throw err;
    }
    // Re-registering the same extract reference is a restart, not a second
    // extract: the existing snapshot is returned rather than duplicated.
    const existing = await this.repo.findSnapshotByRef(input.tenantId, input.snapshotRef);
    if (existing) {
      if (existing.sourceSystemId !== input.sourceSystemId) {
        const err: any = new Error(`Snapshot reference ${input.snapshotRef} already belongs to another source system`);
        err.statusCode = 409;
        err.code = 'SNAPSHOT_REF_CONFLICT';
        throw err;
      }
      return existing;
    }

    return this.repo.createSnapshot({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      sourceSystemId: input.sourceSystemId,
      snapshotRef: input.snapshotRef,
      extractedAt: new Date(input.extractedAt),
      importedBy: input.actor,
      isDelta: input.isDelta ?? false,
      baseSnapshotId: input.baseSnapshotId ?? null,
    });
  }

  listSnapshots(tenantId: string, sourceSystemId: string) {
    return this.repo.listSnapshots(tenantId, sourceSystemId);
  }

  /** Canonical file checksum: SHA-256 over the canonical JSON row payload. */
  static computeFileChecksum(rows: Record<string, unknown>[]): string {
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  /**
   * Imports extract rows into controlled staging.
   *
   * Two distinct protections, deliberately not merged:
   *   * checksum verification — the payload must actually be the file the
   *     caller says it is;
   *   * duplicate-file refusal — a checksum already imported for this tenant
   *     is rejected outright, so an operator cannot double-load by re-running
   *     the same import.
   *
   * Row-level idempotency is handled underneath by the (file, row hash)
   * unique index, so a partially-failed import is safely restartable.
   */
  async importRows(input: ImportRowsInput) {
    const snapshot = await this.repo.findSnapshot(input.tenantId, input.snapshotId);
    if (!snapshot) {
      const err: any = new Error('SOURCE_NOT_CONFIGURED');
      err.statusCode = 404;
      err.code = 'SOURCE_NOT_CONFIGURED';
      throw err;
    }

    const computed = SourceService.computeFileChecksum(input.rows);
    if (input.declaredChecksum && input.declaredChecksum !== computed) {
      throw new ChecksumMismatchError(input.declaredChecksum, computed);
    }

    const existing = await this.repo.findFileByChecksum(input.tenantId, computed);
    if (existing) throw new DuplicateSourceFileError(computed, existing.id);

    // The pre-check above catches the ordinary case; the unique index catches
    // two imports racing, and is translated into the same refusal so a
    // concurrent double-load is never accepted.
    let file: any;
    try {
      file = await this.repo.createFile({
        tenantId: input.tenantId,
        snapshotId: input.snapshotId,
        filename: input.filename,
        filePath: input.filePath,
        fileSize: JSON.stringify(input.rows).length,
        checksumSha256: computed,
        rowCount: input.rows.length,
      });
    } catch (error) {
      if ((error as any)?.code === 'P2002') {
        const winner = await this.repo.findFileByChecksum(input.tenantId, computed);
        throw new DuplicateSourceFileError(computed, winner?.id ?? 'unknown');
      }
      throw error;
    }

    const result = await this.repo.insertRows({
      tenantId: input.tenantId,
      sourceFileId: file.id,
      rows: input.rows.map((raw, index) => ({
        rowIndex: index,
        rowHash: computeSourceRowHash(raw),
        rawData: raw,
      })),
    });

    const files = await this.repo.listFiles(input.tenantId, input.snapshotId);
    const totalRows = files.reduce((sum: number, f: any) => sum + (f.rowCount ?? 0), 0);
    await this.repo.updateSnapshotTotals(input.tenantId, input.snapshotId, files.length, totalRows);

    return { file, checksum: computed, ...result };
  }

  async listRows(tenantId: string, sourceFileId: string, limit: number, offset: number, allowSensitive: boolean) {
    const rows = await this.repo.listRows(tenantId, sourceFileId, limit, offset);
    const total = await this.repo.countRows(tenantId, sourceFileId);
    return {
      total,
      items: rows.map((r: any) => ({
        ...r,
        rawData: maskRecords([r.rawData as Record<string, unknown>], { allowSensitive })[0],
      })),
    };
  }

  listFiles(tenantId: string, snapshotId: string) {
    return this.repo.listFiles(tenantId, snapshotId);
  }

  /** Truthful upstream inventory for the sources screen. */
  upstreamSignals() {
    return this.upstream.getAllSignals();
  }
}
