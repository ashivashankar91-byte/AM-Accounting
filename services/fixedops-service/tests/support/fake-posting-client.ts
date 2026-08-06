import type { PostingEventProducer, SourceEventEnvelope, PostingEventResult } from '../../src/infrastructure/posting-client';

/** Records every envelope submitted (so tests can assert "exactly one
 * journal per RO close") and returns a scripted or default POSTED result. */
export class FakePostingEventProducer implements PostingEventProducer {
  readonly submitted: SourceEventEnvelope[] = [];
  private readonly seenEventIds = new Map<string, PostingEventResult>();
  public nextResult: Partial<PostingEventResult> | null = null;

  async submit(envelope: SourceEventEnvelope): Promise<PostingEventResult> {
    this.submitted.push(envelope);
    const already = this.seenEventIds.get(envelope.eventId);
    if (already) return { ...already, idempotent: true };

    const result: PostingEventResult = {
      executionId: `exec-${envelope.eventId}`,
      eventId: envelope.eventId,
      status: 'POSTED',
      idempotent: false,
      journalEntryId: `je-${envelope.eventId}`,
      journalNumber: `JE-${this.submitted.length}`,
      rulePackVersionId: 'rpv-fixture',
      ...this.nextResult,
    };
    this.seenEventIds.set(envelope.eventId, result);
    return result;
  }
}
