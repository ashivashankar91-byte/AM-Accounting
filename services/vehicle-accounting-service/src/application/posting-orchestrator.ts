// Shared "submit through coa-service, and if it comes back REJECTED/FAILED
// report it into posting-recovery-service's S021 dead-letter queue" flow —
// every S074-S077 application service goes through this ONE helper so the
// CE-12 GLOBAL RULE ("missing mapping => deterministic rejection + S021
// case") is implemented exactly once, not re-derived per event family.
import { inject, injectable } from 'tsyringe';
import { SourceEventEnvelope } from '../domain/event-envelope';
import { PostingEngineClient, SubmitEventResult } from '../infrastructure/posting-engine-client';
import { PostingRecoveryClient, PostingFailureCategory } from '../infrastructure/posting-recovery-client';

export interface PostResult extends SubmitEventResult {
  deadLetterReported: boolean;
  deadLetterId?: string | null;
  deadLetterReportError?: string | null;
}

/** Best-effort category classification from coa-service's freeform failureReason string — the pending-mapping sentinel path (ACCOUNT_MAPPING_VALUES_PENDING) is this epic's dominant, expected case pre-tenant-onboarding. */
function classifyFailure(result: SubmitEventResult): { category: PostingFailureCategory; stage: 'RULE_RESOLUTION' | 'MAPPING' | 'DOWNSTREAM_POST' | 'UNKNOWN'; code: string } {
  const reason = (result.failureReason ?? '').toLowerCase();
  if (result.status === 'NO_RULE_MATCH') {
    return { category: 'RULE_NOT_FOUND', stage: 'RULE_RESOLUTION', code: 'NO_ACTIVE_RULE_PACK_MATCH' };
  }
  if (reason.includes('could not be resolved')) {
    return { category: 'ACCOUNTING_MAPPING_UNRESOLVED', stage: 'MAPPING', code: 'ACCOUNT_MAPPING_VALUES_PENDING' };
  }
  if (reason.includes('rejected: ')) {
    return { category: 'DOWNSTREAM_PERMANENT', stage: 'DOWNSTREAM_POST', code: 'POSTING_VIOLATION' };
  }
  return { category: 'UNKNOWN_FAILURE', stage: 'UNKNOWN', code: 'UNCLASSIFIED_POSTING_FAILURE' };
}

@injectable()
export class PostingOrchestrator {
  constructor(
    @inject('PostingEngineClient') private readonly postingEngine: PostingEngineClient,
    @inject('PostingRecoveryClient') private readonly postingRecovery: PostingRecoveryClient,
  ) {}

  async submitAndRecord(envelope: SourceEventEnvelope, opts?: { legalEntityId?: string; storeId?: string; sourceTransactionId?: string }): Promise<PostResult> {
    const result = await this.postingEngine.submitEvent(envelope);

    if (result.status === 'POSTED' || result.idempotent) {
      return { ...result, deadLetterReported: false };
    }

    // REJECTED / FAILED / NO_RULE_MATCH — report into the S021 queue.
    const { category, stage, code } = classifyFailure(result);
    try {
      const intake = await this.postingRecovery.reportFailure({
        envelope,
        legalEntityId: opts?.legalEntityId ?? null,
        storeId: opts?.storeId ?? null,
        sourceTransactionId: opts?.sourceTransactionId ?? null,
        failureCategory: category,
        failureCode: code,
        failureStage: stage,
        failureMessage: result.failureReason ?? `Posting engine returned ${result.status}.`,
      });
      return { ...result, deadLetterReported: true, deadLetterId: intake.deadLetterId };
    } catch (err: any) {
      return { ...result, deadLetterReported: false, deadLetterReportError: err?.message ?? String(err) };
    }
  }

  async simulate(envelope: SourceEventEnvelope) {
    return this.postingEngine.simulate(envelope);
  }
}
