// CE-12 (Workstream R) — the single call site every application service in
// this codebase uses to submit a SourceEventEnvelope to coa-service's
// posting engine and, on REJECTED/FAILED, report the failure to
// posting-recovery-service's production intake route. Centralizing this
// here guarantees every event family in this service follows the exact
// same mandatory posting path (never a direct GL write, never a
// service-specific shortcut).
import { injectable, inject } from 'tsyringe';
import type { IPostingClient, SourceEventEnvelope, SubmitEventResult } from '../infrastructure/posting-client';
import type { IPostingRecoveryClient, PostingFailureCategory } from '../infrastructure/posting-recovery-client';

export const POSTING_CLIENT_TOKEN = 'IPostingClient';
export const POSTING_RECOVERY_CLIENT_TOKEN = 'IPostingRecoveryClient';

export interface PostingOutcome {
  submitResult: SubmitEventResult;
  /** True if the caller should treat this as a hard failure (REJECTED/FAILED
   *  and NOT idempotently-already-posted) — the caller's own persisted
   *  record should reflect status POSTING_FAILED, never fabricate success. */
  failed: boolean;
  deadLetterId?: string | null;
  deadLetterReportError?: string | null;
}

@injectable()
export class PostingOrchestrator {
  constructor(
    @inject(POSTING_CLIENT_TOKEN) private readonly postingClient: IPostingClient,
    @inject(POSTING_RECOVERY_CLIENT_TOKEN) private readonly recoveryClient: IPostingRecoveryClient,
  ) {}

  async submit(
    envelope: SourceEventEnvelope,
    failureCategory: PostingFailureCategory = 'ACCOUNTING_MAPPING_UNRESOLVED',
  ): Promise<PostingOutcome> {
    const submitResult = await this.postingClient.submit(envelope);
    if (submitResult.status === 'POSTED') {
      return { submitResult, failed: false };
    }

    // REJECTED / FAILED / NO_RULE_MATCH — report to posting-recovery-service
    // so the failure lands in the real recovery queue instead of being
    // silently dropped.
    let deadLetterId: string | null = null;
    let deadLetterReportError: string | null = null;
    try {
      const result = await this.recoveryClient.reportFailure(envelope, {
        failureCategory,
        failureCode: submitResult.status,
        failureStage: failureCategory === 'ACCOUNTING_MAPPING_UNRESOLVED' ? 'MAPPING' : 'DOWNSTREAM_POST',
        failureMessage: submitResult.failureReason ?? `Posting engine returned ${submitResult.status}.`,
        occurredAt: new Date().toISOString(),
      });
      deadLetterId = result.deadLetterId;
    } catch (err: any) {
      deadLetterReportError = err?.message ?? String(err);
    }

    return { submitResult, failed: true, deadLetterId, deadLetterReportError };
  }
}

export type { SourceEventEnvelope, SubmitEventResult };
