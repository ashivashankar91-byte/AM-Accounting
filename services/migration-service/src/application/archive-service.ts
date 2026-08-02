import { inject, injectable } from 'tsyringe';
import { createHash } from 'crypto';
import { IArchiveRepository } from '../domain/interfaces';

/**
 * S017 WORM retention classes. A legacy statement is imported once and then
 * never modified — the archive is evidence, not a working document.
 */
export const WORM_CLASSES: Record<string, number> = {
  WORM_7Y: 7,
  WORM_10Y: 10,
  WORM_PERMANENT: 0,
};

export const STATEMENT_TYPES = [
  'BALANCE_SHEET', 'INCOME_STATEMENT', 'CASH_FLOW', 'TRIAL_BALANCE',
  'FACTORY_STATEMENT', 'SCHEDULE', 'OTHER',
] as const;

export class DuplicateArchiveError extends Error {
  readonly code = 'DUPLICATE_ARCHIVE_ARTIFACT';
  readonly statusCode = 409;
  constructor(checksum: string, existingId: string) {
    super(`An archived artifact with checksum ${checksum} already exists (${existingId})`);
    this.name = 'DuplicateArchiveError';
  }
}

@injectable()
export class ArchiveService {
  constructor(@inject('IArchiveRepository') private readonly repo: IArchiveRepository) {}

  list(tenantId: string, filters: {
    legalEntityId?: string; periodYear?: number; periodMonth?: number; statementType?: string; search?: string;
  }) {
    return this.repo.list(tenantId, filters);
  }

  /**
   * Imports a legacy statement as an immutable archived artifact. The payload
   * is hashed on arrival; the same artifact cannot be archived twice, which
   * keeps the index one-to-one with the underlying files.
   */
  async import(input: {
    tenantId: string; legalEntityId: string; periodYear: number; periodMonth: number;
    statementType: string; sourceSystem: string; filename: string; contentBase64?: string;
    checksumSha256?: string; fileSize?: number; wormClass?: string; actor: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!(STATEMENT_TYPES as readonly string[]).includes(input.statementType)) {
      const err: any = new Error(`statementType must be one of ${STATEMENT_TYPES.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_STATEMENT_TYPE';
      throw err;
    }
    const wormClass = input.wormClass ?? 'WORM_7Y';
    if (!(wormClass in WORM_CLASSES)) {
      const err: any = new Error(`wormClass must be one of ${Object.keys(WORM_CLASSES).join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_WORM_CLASS';
      throw err;
    }

    let checksum = input.checksumSha256 ?? '';
    let fileSize = input.fileSize ?? 0;
    if (input.contentBase64) {
      const buffer = Buffer.from(input.contentBase64, 'base64');
      const computed = createHash('sha256').update(buffer).digest('hex');
      if (checksum && checksum !== computed) {
        const err: any = new Error(`Declared checksum ${checksum} does not match computed ${computed}`);
        err.statusCode = 422;
        err.code = 'CHECKSUM_MISMATCH';
        throw err;
      }
      checksum = computed;
      fileSize = buffer.length;
    }
    if (!checksum) {
      const err: any = new Error('Either contentBase64 or checksumSha256 must be supplied');
      err.statusCode = 400;
      err.code = 'CHECKSUM_REQUIRED';
      throw err;
    }

    const existing = await this.repo.findByChecksum(input.tenantId, checksum);
    if (existing) throw new DuplicateArchiveError(checksum, existing.id);

    const years = WORM_CLASSES[wormClass]!;
    const retentionUntil = years === 0
      ? null
      : new Date(Date.UTC(input.periodYear + years, input.periodMonth, 0, 23, 59, 59));

    return this.repo.create({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      statementType: input.statementType,
      sourceSystem: input.sourceSystem,
      filename: input.filename,
      fileSize,
      checksumSha256: checksum,
      importedBy: input.actor,
      wormClass,
      retentionUntil,
      metadata: input.metadata,
    });
  }

  /** Viewing an archived artifact is itself an audited access. */
  recordAccess(tenantId: string, id: string) {
    return this.repo.recordAccess(tenantId, id);
  }
}
