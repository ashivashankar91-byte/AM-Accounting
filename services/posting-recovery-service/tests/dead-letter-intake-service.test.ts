import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeadLetterIntakeService } from '../src/application/dead-letter-intake-service';
import { PostingRecoveryConflictError, PostingRecoveryValidationError } from '../src/domain/errors';
import { hashPayload } from '../src/domain/hash';
import { PostingFailureEnvelope } from '../src/domain/ch01-adapter';

function makeEnvelope(overrides: Partial<PostingFailureEnvelope['event']> = {}): PostingFailureEnvelope {
  const payload = { dealNumber: 'D-1', amount: '100.00' };
  const event = {
    eventId: 'evt-1',
    tenantId: 'tenant-a',
    eventType: 'DEAL_POSTED',
    sourceSystem: 'deal-service',
    correlationId: 'corr-1',
    occurredAt: '2026-07-01T00:00:00.000Z',
    postingIdempotencyKey: 'idem-1',
    payload,
    payloadHash: hashPayload(payload),
    ...overrides,
  };
  return {
    event,
    failure: {
      failureCategory: 'RULE_NOT_FOUND',
      failureCode: 'RULE_PACK_NOT_FOUND',
      failureStage: 'RULE_RESOLUTION',
      failureMessage: 'No rule pack matched DEAL_POSTED',
      occurredAt: '2026-07-01T00:05:00.000Z',
    },
  };
}

function makeMockPrisma() {
  const store = new Map<string, any>();
  const tx = {
    postingDeadLetter: {
      create: vi.fn(async ({ data }: any) => {
        store.set(`${data.tenantId}:${data.sourceEventId}`, data);
        return data;
      }),
    },
    postingDeadLetterFailure: { create: vi.fn(async ({ data }: any) => data) },
    postingCaseTransition: { create: vi.fn(async ({ data }: any) => data) },
    postingRecoveryAuditReference: { create: vi.fn(async ({ data }: any) => data) },
  };
  return {
    postingDeadLetter: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = `${where.tenantId_sourceEventId.tenantId}:${where.tenantId_sourceEventId.sourceEventId}`;
        return store.get(key) ?? null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const key = `${where.tenantId_sourceEventId.tenantId}:${where.tenantId_sourceEventId.sourceEventId}`;
        const row = store.get(key);
        if (!row) throw new Error('not found');
        return row;
      }),
    },
    $transaction: vi.fn(async (cb: any) => cb(tx)),
    _store: store,
    _tx: tx,
  };
}

describe('DeadLetterIntakeService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let svc: DeadLetterIntakeService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    svc = new DeadLetterIntakeService(prisma as any);
  });

  it('creates a new case on first intake, and emits the dead_letter_created audit row', async () => {
    const result = await svc.intake(makeEnvelope(), 'system');
    expect(result.created).toBe(true);
    expect(prisma._tx.postingDeadLetter.create).toHaveBeenCalledTimes(1);
    expect(prisma._tx.postingDeadLetterFailure.create).toHaveBeenCalledTimes(1);
    expect(prisma._tx.postingCaseTransition.create).toHaveBeenCalledTimes(1);
    expect(prisma._tx.postingRecoveryAuditReference.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'posting_recovery.dead_letter_created' }) }),
    );
  });

  it('is idempotent: re-delivering the identical envelope is a no-op (created:false, no duplicate rows)', async () => {
    const envelope = makeEnvelope();
    const first = await svc.intake(envelope, 'system');
    const second = await svc.intake(envelope, 'system');

    expect(second.created).toBe(false);
    expect(second.deadLetterId).toBe(first.deadLetterId);
    // Only the first intake ever called create — the duplicate delivery
    // never touches postingDeadLetter.create/postingDeadLetterFailure.create again.
    expect(prisma._tx.postingDeadLetter.create).toHaveBeenCalledTimes(1);
    expect(prisma._tx.postingDeadLetterFailure.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a conflicting re-delivery: same eventId, different payload hash -> IDEMPOTENCY_CONFLICT, never overwrites', async () => {
    const first = makeEnvelope();
    await svc.intake(first, 'system');

    const conflicting = makeEnvelope();
    conflicting.event.payload = { dealNumber: 'D-1', amount: '999.99' };
    conflicting.event.payloadHash = hashPayload(conflicting.event.payload);

    await expect(svc.intake(conflicting, 'system')).rejects.toBeInstanceOf(PostingRecoveryConflictError);
    await expect(svc.intake(conflicting, 'system')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    // The original row is untouched — create was never called a second time.
    expect(prisma._tx.postingDeadLetter.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an envelope whose payloadHash does not match the computed hash of payload (contract integrity)', async () => {
    const envelope = makeEnvelope();
    envelope.event.payloadHash = 'not-the-real-hash';
    await expect(svc.intake(envelope, 'system')).rejects.toBeInstanceOf(PostingRecoveryValidationError);
    expect(prisma._tx.postingDeadLetter.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown failure category (stable taxonomy enforcement)', async () => {
    const envelope = makeEnvelope();
    (envelope.failure as any).failureCategory = 'NOT_A_REAL_CATEGORY';
    await expect(svc.intake(envelope, 'system')).rejects.toBeInstanceOf(PostingRecoveryValidationError);
  });

  it('rejects an envelope missing required contract fields (eventId, correlationId, idempotency key)', async () => {
    const missingEventId = makeEnvelope({ eventId: '' });
    await expect(svc.intake(missingEventId, 'system')).rejects.toBeInstanceOf(PostingRecoveryValidationError);

    const missingCorrelation = makeEnvelope({ correlationId: '' });
    await expect(svc.intake(missingCorrelation, 'system')).rejects.toBeInstanceOf(PostingRecoveryValidationError);

    const missingIdemKey = makeEnvelope({ postingIdempotencyKey: '' });
    await expect(svc.intake(missingIdemKey, 'system')).rejects.toBeInstanceOf(PostingRecoveryValidationError);
  });

  it('never calls an update on postingDeadLetter during intake — original-event fields are write-once by construction', async () => {
    await svc.intake(makeEnvelope(), 'system');
    expect((prisma._tx.postingDeadLetter as any).update).toBeUndefined();
  });

  it('preserves the original event timestamp, correlation id, and idempotency key verbatim on the created row', async () => {
    await svc.intake(makeEnvelope(), 'system');
    const created = prisma._tx.postingDeadLetter.create.mock.calls[0][0].data;
    expect(created.correlationId).toBe('corr-1');
    expect(created.postingIdempotencyKey).toBe('idem-1');
    expect(created.originalEventTimestamp.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(created.payloadHash).toBe(hashPayload({ dealNumber: 'D-1', amount: '100.00' }));
  });
});
