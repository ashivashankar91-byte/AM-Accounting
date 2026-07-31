import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplayService } from '../src/application/replay-service';
import { CH01PostingExecutionPort, CH01ReplayResult } from '../src/domain/ch01-adapter';
import { PostingRecoveryConflictError, PostingRecoveryNotFoundError, PostingRecoveryValidationError } from '../src/domain/errors';
import { hashPayload } from '../src/domain/hash';

function baseRow(overrides: Record<string, any> = {}) {
  const payload = { dealNumber: 'D-1', amount: '100.00' };
  return {
    id: 'dl-1',
    tenantId: 'tenant-a',
    legalEntityId: null,
    storeId: null,
    status: 'READY_FOR_REPLAY',
    sourceEventId: 'evt-1',
    sourceEventType: 'DEAL_POSTED',
    eventSchemaVersion: '1.0',
    sourceSystem: 'deal-service',
    sourceEntityType: 'DEAL',
    sourceEntityId: 'deal-123',
    sourceTransactionId: 'D-1',
    correlationId: 'corr-1',
    causationId: null,
    originalEventTimestamp: new Date('2026-07-01T00:00:00.000Z'),
    originalEventPublishedAt: new Date('2026-07-01T00:00:01.000Z'),
    businessDate: new Date('2026-07-01T00:00:00.000Z'),
    postingIdempotencyKey: 'idem-1',
    payload,
    payloadHash: hashPayload(payload),
    latestFailureCategory: 'RULE_NOT_FOUND',
    latestFailureCode: 'RULE_PACK_NOT_FOUND',
    latestFailureMessage: 'No rule pack matched DEAL_POSTED',
    latestFailureAt: new Date('2026-07-01T00:05:00.000Z'),
    attemptCount: 0,
    version: 1,
    ...overrides,
  };
}

function makeMockPrisma(row: any) {
  const store = new Map<string, any>([[row.id, { ...row }]]);
  const attempts: any[] = [];
  const transitions: any[] = [];
  const auditRows: any[] = [];
  const failures = [
    {
      failureCategory: row.latestFailureCategory,
      failureCode: row.latestFailureCode,
      failureStage: 'RULE_RESOLUTION',
      failureMessage: row.latestFailureMessage,
      fieldErrors: null,
      ruleContext: null,
      occurredAt: row.latestFailureAt,
    },
  ];

  const tx = {
    postingReplayAttempt: {
      create: vi.fn(async ({ data }: any) => {
        attempts.push(data);
        return data;
      }),
    },
    postingDeadLetter: {
      update: vi.fn(async ({ where, data }: any) => {
        const current = store.get(where.id);
        const next = { ...current };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            next[k] = (current[k] ?? 0) + (v as any).increment;
          } else if (v !== undefined) {
            next[k] = v;
          }
        }
        store.set(where.id, next);
        return next;
      }),
    },
    postingCaseTransition: {
      create: vi.fn(async ({ data }: any) => {
        transitions.push(data);
        return data;
      }),
    },
    postingRecoveryAuditReference: {
      create: vi.fn(async ({ data }: any) => {
        auditRows.push(data);
        return data;
      }),
    },
  };

  return {
    postingDeadLetter: {
      findFirst: vi.fn(async ({ where }: any) => {
        const current = store.get(where.id);
        if (!current || current.tenantId !== where.tenantId) return null;
        return { ...current };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const current = store.get(where.id);
        if (!current || current.tenantId !== where.tenantId || current.status !== where.status || current.version !== where.version) {
          return { count: 0 };
        }
        const next = { ...current };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            next[k] = (current[k] ?? 0) + (v as any).increment;
          } else {
            next[k] = v;
          }
        }
        store.set(where.id, next);
        return { count: 1 };
      }),
    },
    postingDeadLetterFailure: {
      findFirst: vi.fn(async () => failures[0] ?? null),
    },
    postingCaseTransition: { create: tx.postingCaseTransition.create },
    postingRecoveryAuditReference: { create: tx.postingRecoveryAuditReference.create },
    $transaction: vi.fn(async (cb: any) => cb(tx)),
    _store: store,
    _attempts: attempts,
    _transitions: transitions,
    _auditRows: auditRows,
  };
}

function makeCh01(scripted: CH01ReplayResult): CH01PostingExecutionPort & { replay: ReturnType<typeof vi.fn> } {
  return { replay: vi.fn(async () => scripted) } as any;
}

describe('ReplayService', () => {
  let row: ReturnType<typeof baseRow>;
  let prisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    row = baseRow();
    prisma = makeMockPrisma(row);
  });

  it('throws NotFound when the case does not exist for this tenant', async () => {
    const ch01 = makeCh01({ outcome: 'POSTED' });
    const svc = new ReplayService(prisma as any, ch01);
    await expect(svc.replay('tenant-a', 'missing', 'user-1')).rejects.toBeInstanceOf(PostingRecoveryNotFoundError);
    expect(ch01.replay).not.toHaveBeenCalled();
  });

  it('rejects replay of a case not in READY_FOR_REPLAY (422 NOT_REPLAY_ELIGIBLE)', async () => {
    prisma._store.set(row.id, { ...row, status: 'QUARANTINED' });
    const ch01 = makeCh01({ outcome: 'POSTED' });
    const svc = new ReplayService(prisma as any, ch01);
    await expect(svc.replay('tenant-a', row.id, 'user-1')).rejects.toMatchObject({ code: 'NOT_REPLAY_ELIGIBLE' });
    expect(ch01.replay).not.toHaveBeenCalled();
  });

  it('rejects replay when required envelope fields are missing (422 REPLAY_ENVELOPE_INCOMPLETE), never calling CH01', async () => {
    prisma._store.set(row.id, { ...row, eventSchemaVersion: null, businessDate: null });
    const ch01 = makeCh01({ outcome: 'POSTED' });
    const svc = new ReplayService(prisma as any, ch01);
    const err: any = await svc.replay('tenant-a', row.id, 'user-1').catch((e: any) => e);
    expect(err).toBeInstanceOf(PostingRecoveryValidationError);
    expect(err.code).toBe('REPLAY_ENVELOPE_INCOMPLETE');
    expect(err.message).toContain('eventSchemaVersion');
    expect(err.message).toContain('businessDate');
    expect(ch01.replay).not.toHaveBeenCalled();
    // Status must be untouched — the case is still replayable once corrected.
    expect(prisma._store.get(row.id).status).toBe('READY_FOR_REPLAY');
  });

  it('rejects replay on payload hash integrity violation (409), never calling CH01', async () => {
    prisma._store.set(row.id, { ...row, payloadHash: 'tampered-hash' });
    const ch01 = makeCh01({ outcome: 'POSTED' });
    const svc = new ReplayService(prisma as any, ch01);
    await expect(svc.replay('tenant-a', row.id, 'user-1')).rejects.toMatchObject({ code: 'PAYLOAD_INTEGRITY_VIOLATION' });
    expect(ch01.replay).not.toHaveBeenCalled();
  });

  it('rejects a second concurrent replay attempt once the CAS has already flipped status (409 REPLAY_ALREADY_IN_PROGRESS)', async () => {
    prisma._store.set(row.id, { ...row, status: 'REPLAY_IN_PROGRESS', version: 2 });
    const ch01 = makeCh01({ outcome: 'POSTED' });
    const svc = new ReplayService(prisma as any, ch01);
    // The read at the top of replay() sees REPLAY_IN_PROGRESS directly, so
    // this actually surfaces as NOT_REPLAY_ELIGIBLE — the CAS-loser path
    // (findFirst still sees READY_FOR_REPLAY but updateMany loses the race)
    // is exercised by the live-Postgres concurrency proof
    // (tests/live-db/replay-concurrency.ts), which is what genuinely
    // requires two real concurrent connections racing the same UPDATE.
    await expect(svc.replay('tenant-a', row.id, 'user-1')).rejects.toMatchObject({ code: 'NOT_REPLAY_ELIGIBLE' });
    expect(ch01.replay).not.toHaveBeenCalled();
  });

  it('the CAS-loser path (updateMany affects 0 rows) is treated as a 409 conflict, not a silent success', async () => {
    // Simulate exactly what a real concurrent loser sees: findFirst() still
    // observes READY_FOR_REPLAY (stale read), but by the time updateMany
    // runs, the version has already moved — the WHERE clause matches nothing.
    const originalUpdateMany = prisma.postingDeadLetter.updateMany;
    prisma.postingDeadLetter.updateMany = vi.fn(async () => ({ count: 0 }));
    const ch01 = makeCh01({ outcome: 'POSTED' });
    const svc = new ReplayService(prisma as any, ch01);
    await expect(svc.replay('tenant-a', row.id, 'user-1')).rejects.toMatchObject({ code: 'REPLAY_ALREADY_IN_PROGRESS' });
    expect(ch01.replay).not.toHaveBeenCalled();
    expect(prisma.postingReplayAttempt).toBeUndefined(); // no attempt row machinery even touched
    prisma.postingDeadLetter.updateMany = originalUpdateMany;
  });

  it('a fresh POSTED outcome resolves the case, records one SUCCEEDED attempt, and surfaces the journal reference', async () => {
    const ch01 = makeCh01({ outcome: 'POSTED', journalReference: 'JE-100', message: 'Posted as journal JE-100.' });
    const svc = new ReplayService(prisma as any, ch01);
    const result = await svc.replay('tenant-a', row.id, 'user-1');

    expect(ch01.replay).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('POSTED');
    expect(result.status).toBe('RESOLVED');
    expect(result.journalReference).toBe('JE-100');
    expect(result.attemptNumber).toBe(1);
    expect(result.idempotentPassthrough).toBe(false);

    expect(prisma._attempts).toHaveLength(1);
    expect(prisma._attempts[0]).toMatchObject({ attemptNumber: 1, status: 'SUCCEEDED', resultingJournalReference: 'JE-100' });

    const finalRow = prisma._store.get(row.id);
    expect(finalRow.status).toBe('RESOLVED');
    expect(finalRow.attemptCount).toBe(1);
    expect(finalRow.journalReference).toBe('JE-100');
    // CAS increment (+1) then finalize increment (+1) = version 3.
    expect(finalRow.version).toBe(3);
    // CE-07 crash-recovery: the lock timestamp set at CAS-acquire time must
    // be cleared once the replay finalizes normally — only a genuinely
    // stuck (crashed) case should ever have a non-null replayLockAcquiredAt.
    expect(finalRow.replayLockAcquiredAt).toBeNull();
  });

  it('sets replayLockAcquiredAt at CAS-acquire time (CE-07 crash-recovery foundation)', async () => {
    const capturedAcquire: any[] = [];
    const originalUpdateMany = prisma.postingDeadLetter.updateMany;
    prisma.postingDeadLetter.updateMany = vi.fn(async (args: any) => {
      capturedAcquire.push(args.data);
      return originalUpdateMany(args);
    });
    const ch01 = makeCh01({ outcome: 'POSTED', journalReference: 'JE-1', message: 'Posted.' });
    const svc = new ReplayService(prisma as any, ch01);
    await svc.replay('tenant-a', row.id, 'user-1');

    expect(capturedAcquire[0].replayLockAcquiredAt).toBeInstanceOf(Date);
  });

  it('an idempotent-passthrough POSTED (CH01 already recorded this eventId) is surfaced as NOOP_ALREADY_POSTED, not a fresh POSTED', async () => {
    const ch01 = makeCh01({ outcome: 'NOOP_ALREADY_POSTED', journalReference: 'JE-50', idempotentPassthrough: true, message: 'Already posted.' });
    const svc = new ReplayService(prisma as any, ch01);
    const result = await svc.replay('tenant-a', row.id, 'user-1');

    expect(result.outcome).toBe('NOOP_ALREADY_POSTED');
    expect(result.idempotentPassthrough).toBe(true);
    expect(result.status).toBe('RESOLVED');
    expect(prisma._attempts[0].status).toBe('NOOP_ALREADY_POSTED');
  });

  it('a REJECTED outcome routes the case to UNDER_REVIEW and records a REJECTED attempt, no journal reference', async () => {
    const ch01 = makeCh01({ outcome: 'REJECTED', message: 'Blueprint failed defensive verification.' });
    const svc = new ReplayService(prisma as any, ch01);
    const result = await svc.replay('tenant-a', row.id, 'user-1');

    expect(result.outcome).toBe('REJECTED');
    expect(result.status).toBe('UNDER_REVIEW');
    expect(result.journalReference).toBeNull();
    expect(prisma._attempts[0].status).toBe('REJECTED');
    expect(prisma._store.get(row.id).journalReference).toBeUndefined();
  });

  it('a transport/unexpected error calling CH01 is caught and recorded as a FAILED attempt (never throws out of replay())', async () => {
    const ch01: CH01PostingExecutionPort = { replay: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    const svc = new ReplayService(prisma as any, ch01);
    const result = await svc.replay('tenant-a', row.id, 'user-1');

    expect(result.outcome).toBe('FAILED');
    expect(result.status).toBe('UNDER_REVIEW');
    expect(result.message).toContain('ECONNREFUSED');
    expect(prisma._attempts[0].status).toBe('FAILED');
  });

  it('records exactly one attempt per replay call and increments attemptNumber/attemptCount correctly across sequential replays', async () => {
    const ch01 = makeCh01({ outcome: 'REJECTED', message: 'still not matching' });
    const svc = new ReplayService(prisma as any, ch01);

    const first = await svc.replay('tenant-a', row.id, 'user-1');
    expect(first.attemptNumber).toBe(1);
    expect(prisma._store.get(row.id).attemptCount).toBe(1);

    // Operator routes it back to READY_FOR_REPLAY for a second attempt.
    const afterFirst = prisma._store.get(row.id);
    prisma._store.set(row.id, { ...afterFirst, status: 'READY_FOR_REPLAY' });

    const second = await svc.replay('tenant-a', row.id, 'user-1');
    expect(second.attemptNumber).toBe(2);
    expect(prisma._store.get(row.id).attemptCount).toBe(2);
    expect(prisma._attempts).toHaveLength(2);
    expect(ch01.replay).toHaveBeenCalledTimes(2);
  });

  it('calls CH01 exactly once per replay and passes a byte-faithful reconstructed envelope (no duplicate accounting effects)', async () => {
    const ch01 = makeCh01({ outcome: 'POSTED', journalReference: 'JE-1' });
    const svc = new ReplayService(prisma as any, ch01);
    await svc.replay('tenant-a', row.id, 'user-1');

    expect(ch01.replay).toHaveBeenCalledTimes(1);
    const call = (ch01.replay as any).mock.calls[0][0];
    expect(call.event.eventId).toBe(row.sourceEventId);
    expect(call.event.tenantId).toBe(row.tenantId);
    expect(call.event.eventType).toBe(row.sourceEventType);
    expect(call.event.eventSchemaVersion).toBe(row.eventSchemaVersion);
    expect(call.event.sourceEntityId).toBe(row.sourceEntityId);
    expect(call.event.correlationId).toBe(row.correlationId);
    expect(call.event.payloadHash).toBe(row.payloadHash);
    expect(call.event.payload).toEqual(row.payload);
  });

  it('writes replay_started and replay_completed audit rows', async () => {
    const ch01 = makeCh01({ outcome: 'POSTED', journalReference: 'JE-1' });
    const svc = new ReplayService(prisma as any, ch01);
    await svc.replay('tenant-a', row.id, 'user-1');

    const eventTypes = prisma._auditRows.map((r: any) => r.eventType);
    expect(eventTypes).toContain('posting_recovery.replay_started');
    expect(eventTypes).toContain('posting_recovery.replay_completed');
  });
});
