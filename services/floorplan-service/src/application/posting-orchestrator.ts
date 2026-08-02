// CE-12 — shared submit-then-recover orchestration used by every
// application service that posts a financial event (match, break write-off,
// interest accrual, curtailment payment). Centralizes the "submit to
// coa-service; on REJECTED/FAILED/NO_RULE_MATCH, report to
// posting-recovery-service" idiom so it is implemented exactly once.
import { injectable, inject } from 'tsyringe';
import type { PostingEngineClient, SubmitEventResult } from '../infrastructure/posting-engine-client';
import type { PostingRecoveryClient, PostingFailureCategory, PostingFailureStage } from '../infrastructure/posting-recovery-client';
import type { SourceEventEnvelope } from '../domain/envelope';

export const POSTING_ENGINE_CLIENT_TOKEN = 'PostingEngineClient';
export const POSTING_RECOVERY_CLIENT_TOKEN = 'PostingRecoveryClient';

export interface PostAndRecoverOptions {
  postingIdempotencyKey: string;
  legalEntityId?: string | null;
  sourceTransactionId?: string | null;
  /** Failure taxonomy used when reporting a REJECTED/FAILED/NO_RULE_MATCH
   * result to posting-recovery-service. ACCOUNTING_MAPPING_UNRESOLVED is
   * overwhelmingly the expected case for CE-12 (rule-pack rows default to
   * ACCOUNT_MAPPING_VALUES_PENDING), but callers may override for a
   * genuinely different failure shape. */
  failureCategory?: PostingFailureCategory;
  failureStage?: PostingFailureStage;
}

export interface PostAndRecoverResult {
  submitResult: SubmitEventResult;
  /** Set only when the posting engine result was REJECTED/FAILED/
   * NO_RULE_MATCH and the posting-recovery intake call succeeded. */
  deadLetterId?: string;
  /** Set when the posting engine result was non-POSTED AND the
   * posting-recovery-service intake call itself also failed (e.g. network).
   * The caller MUST still persist the REJECTED/FAILED worklist state — this
   * is surfaced so it can additionally be logged/alerted on, never used to
   * roll back the local record of the posting engine's own authoritative
   * result. */
  recoveryReportError?: string;
}

@injectable()
export class PostingOrchestrator {
  constructor(
    @inject(POSTING_ENGINE_CLIENT_TOKEN) private readonly postingEngine: PostingEngineClient,
    @inject(POSTING_RECOVERY_CLIENT_TOKEN) private readonly postingRecovery: PostingRecoveryClient,
  ) {}

  async postAndRecover(envelope: SourceEventEnvelope, options: PostAndRecoverOptions): Promise<PostAndRecoverResult> {
    const submitResult = await this.postingEngine.submitEvent(envelope);

    if (submitResult.status === 'POSTED') {
      return { submitResult };
    }

    const failureCategory = options.failureCategory ?? 'ACCOUNTING_MAPPING_UNRESOLVED';
    const failureStage = options.failureStage ?? 'MAPPING';

    try {
      const { deadLetterId } = await this.postingRecovery.reportFailure({
        envelope,
        postingIdempotencyKey: options.postingIdempotencyKey,
        legalEntityId: options.legalEntityId ?? null,
        sourceTransactionId: options.sourceTransactionId ?? null,
        failureCategory,
        failureCode: `FLOORPLAN_${submitResult.status}`,
        failureStage,
        failureMessage: submitResult.failureReason ?? `Posting engine returned ${submitResult.status} with no failureReason.`,
      });
      return { submitResult, deadLetterId };
    } catch (err) {
      // The posting engine's own result is still authoritative; a failed
      // recovery-intake call must never prevent the worklist row from
      // recording the REJECTED/FAILED outcome itself (see doc comment on
      // recoveryReportError above) — never silently swallowed, but also
      // never turned into a thrown exception that would roll back the
      // caller's own transaction.
      return { submitResult, recoveryReportError: (err as Error).message };
    }
  }
}
