// Test doubles for this service's outbound HTTP dependencies (coa-service's
// posting engine, posting-recovery-service, schedule-service) — none of
// those services run as live HTTP servers in this test environment, so the
// live-db suite proves this service's OWN database behavior (idempotency,
// unique-constraint races, RLS, conservation identities) against a REAL
// Postgres instance while stubbing the network boundary. Production wiring
// (index.ts) always uses the real Http* clients — these doubles are
// test-only.
import type { IPostingClient, SourceEventEnvelope, SubmitEventResult } from '../../src/infrastructure/posting-client';
import type { IPostingRecoveryClient, PostingFailureDetail } from '../../src/infrastructure/posting-recovery-client';
import type { IScheduleOpenItemClient, ScheduleSummary, ScheduleOpenItemSummary } from '../../src/infrastructure/schedule-open-item-client';

/** Always returns POSTED — proves the "happy path" DB/application behavior. */
export class AlwaysPostedPostingClient implements IPostingClient {
  public submittedEnvelopes: SourceEventEnvelope[] = [];

  async submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    this.submittedEnvelopes.push(envelope);
    return {
      executionId: `exec-${envelope.eventId}`,
      eventId: envelope.eventId,
      status: 'POSTED',
      idempotent: false,
      rulePackVersionId: 'test-version',
      ruleId: 'test-rule',
      journalEntryId: `je-${envelope.eventId}`,
      journalNumber: `JN-${envelope.eventId.slice(0, 8)}`,
      failureReason: null,
    };
  }

  async simulate(): Promise<never> {
    throw new Error('not implemented in test double');
  }
}

/** Always returns REJECTED — proves the posting-recovery reporting path. */
export class AlwaysRejectedPostingClient implements IPostingClient {
  async submit(envelope: SourceEventEnvelope): Promise<SubmitEventResult> {
    return {
      executionId: `exec-${envelope.eventId}`,
      eventId: envelope.eventId,
      status: 'REJECTED',
      idempotent: false,
      failureReason: 'ACCOUNT_MAPPING_VALUES_PENDING (test fixture)',
    };
  }

  async simulate(): Promise<never> {
    throw new Error('not implemented in test double');
  }
}

export class InMemoryPostingRecoveryClient implements IPostingRecoveryClient {
  public reported: Array<{ envelope: SourceEventEnvelope; failure: PostingFailureDetail }> = [];

  async reportFailure(envelope: SourceEventEnvelope, failure: PostingFailureDetail) {
    this.reported.push({ envelope, failure });
    return { deadLetterId: `dl-${envelope.eventId}`, created: true };
  }
}

export class EmptyScheduleOpenItemClient implements IScheduleOpenItemClient {
  async findScheduleByGlAccount(): Promise<ScheduleSummary | null> {
    return null;
  }
  async listOpenItems(): Promise<ScheduleOpenItemSummary[]> {
    return [];
  }
}
