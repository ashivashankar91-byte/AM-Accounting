import { inject, injectable } from 'tsyringe';
import { IExceptionRepository, IMigrationRunRepository } from '../domain/interfaces';
import { isSensitiveField, maskRecord, maskValue } from '../domain/sensitive-data-masker';

export const EXCEPTION_TYPES = [
  'AMBIGUOUS', 'INVALID', 'UNMAPPED', 'DUPLICATE', 'CONSERVATION_FAILED', 'MAPPING_INCOMPLETE',
] as const;

export const DISPOSITIONS = ['APPROVED', 'REJECTED', 'CORRECTED'] as const;

/**
 * An exception carries the offending legacy value verbatim so a human can judge
 * it. That value is exactly the kind of field that may be an SSN or a bank
 * account number, so it is masked unless the caller holds
 * `migration.sensitive.view`.
 */
function maskException(exception: Record<string, any>, allowSensitive: boolean): Record<string, any> {
  if (allowSensitive) return exception;
  const out = { ...exception };
  if (typeof out['sourceField'] === 'string' && isSensitiveField(out['sourceField'])) {
    out['sourceValue'] = maskValue(out['sourceValue']);
  }
  if (out['evidence'] && typeof out['evidence'] === 'object' && !Array.isArray(out['evidence'])) {
    out['evidence'] = maskRecord(out['evidence'] as Record<string, unknown>, { allowSensitive: false });
  }
  return out;
}

@injectable()
export class ExceptionService {
  constructor(
    @inject('IExceptionRepository') private readonly repo: IExceptionRepository,
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
  ) {}

  async list(
    tenantId: string,
    runId: string,
    filters?: { disposition?: string; exceptionType?: string },
    allowSensitive = false,
  ) {
    const raw = await this.repo.list(tenantId, runId, filters);
    const items = (raw as any[]).map((e) => maskException(e, allowSensitive));
    const blockingPending = await this.repo.countBlockingPending(tenantId, runId);
    return {
      items,
      total: items.length,
      blockingPending,
      // G5 asks for zero-or-dispositioned, not zero: a run with a fully
      // dispositioned queue is allowed to proceed.
      g5Satisfiable: blockingPending === 0,
    };
  }

  /**
   * Dispositions an exception. Every disposition demands a reason and an
   * identity — an exception silently marked approved would defeat the purpose
   * of routing ambiguous legacy data here in the first place.
   */
  async disposition(input: {
    tenantId: string; runId: string; exceptionId: string; disposition: string; reason: string; actor: string;
    correctedValue?: string | null;
  }) {
    if (!(DISPOSITIONS as readonly string[]).includes(input.disposition)) {
      const err: any = new Error(`disposition must be one of ${DISPOSITIONS.join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_DISPOSITION';
      throw err;
    }
    if (!input.reason || input.reason.trim().length < 5) {
      const err: any = new Error('A disposition reason is required');
      err.statusCode = 400;
      err.code = 'DISPOSITION_REASON_REQUIRED';
      throw err;
    }

    const existing = await this.repo.find(input.tenantId, input.exceptionId);
    if (!existing) {
      const err: any = new Error(`Exception ${input.exceptionId} not found`);
      err.statusCode = 404;
      err.code = 'EXCEPTION_NOT_FOUND';
      throw err;
    }

    const updated = await this.repo.disposition(input.tenantId, input.exceptionId, {
      disposition: input.disposition,
      dispositionedBy: input.actor,
      dispositionReason: input.correctedValue
        ? `${input.reason} (corrected value: ${input.correctedValue})`
        : input.reason,
    });

    await this.runs.appendAudit({
      tenantId: input.tenantId,
      runId: input.runId,
      action: 'EXCEPTION_DISPOSITIONED',
      actor: input.actor,
      reason: input.reason,
      evidence: {
        exceptionId: input.exceptionId,
        exceptionType: existing.exceptionType,
        disposition: input.disposition,
        correctedValue: input.correctedValue ?? null,
      },
    });

    const blockingPending = await this.repo.countBlockingPending(input.tenantId, input.runId);
    return { exception: updated, blockingPending };
  }
}
