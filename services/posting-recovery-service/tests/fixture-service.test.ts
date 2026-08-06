import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FixtureService } from '../src/application/fixture-service';
import { DeadLetterIntakeService } from '../src/application/dead-letter-intake-service';
import { InvalidCaseTransitionError } from '../src/domain/lifecycle';
import { PostingRecoveryValidationError } from '../src/domain/errors';

const CASE_ID = 'case-1';

function makeMockPrisma(initialCase: any) {
  let current = { ...initialCase };
  const tx = {
    postingReplayAttempt: { create: vi.fn(async ({ data }: any) => data) },
    postingDeadLetter: {
      update: vi.fn(async ({ data }: any) => { current = { ...current, ...data }; return current; }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.version !== current.version) return { count: 0 };
        current = { ...current, status: data.status, version: current.version + 1 };
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => current),
    },
    postingCaseTransition: { create: vi.fn(async ({ data }: any) => data) },
    postingRecoveryAuditReference: { create: vi.fn(async ({ data }: any) => data) },
  };
  return {
    postingDeadLetter: {
      findFirst: vi.fn(async () => current),
    },
    postingCorrectionRevision: { count: vi.fn(async () => 0), create: vi.fn(async ({ data }: any) => data) },
    $transaction: vi.fn(async (cb: any) => cb(tx)),
    _tx: tx,
    _getCurrent: () => current,
  };
}

describe('FixtureService', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let svc: FixtureService;

  beforeEach(() => {
    prisma = makeMockPrisma({ id: CASE_ID, tenantId: 'tenant-a', status: 'QUARANTINED', attemptCount: 0, version: 1 });
    svc = new FixtureService(prisma as any, {} as DeadLetterIntakeService);
  });

  it('appends a replay attempt with the next sequential attempt number and increments attemptCount', async () => {
    await svc.addReplayAttemptFixture('tenant-a', CASE_ID, {
      status: 'FAILED', requestedBy: 'tester', requestedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(prisma._tx.postingReplayAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attemptNumber: 1 }) }),
    );
    expect(prisma._tx.postingDeadLetter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attemptCount: 1 }) }),
    );
  });

  it('rejects an unknown replay-attempt status', async () => {
    await expect(
      svc.addReplayAttemptFixture('tenant-a', CASE_ID, { status: 'BOGUS', requestedBy: 'tester', requestedAt: '2026-07-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(PostingRecoveryValidationError);
  });

  it('appends correction revisions with sequential revision numbers', async () => {
    await svc.addCorrectionFixture('tenant-a', CASE_ID, {
      correctionType: 'FIELD_CORRECTION', description: 'fix account mapping', createdBy: 'tester',
    });
    expect(prisma.postingCorrectionRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revisionNumber: 1 }) }),
    );
  });

  it('performs a valid lifecycle transition and appends a transition row', async () => {
    const updated = await svc.transitionFixture('tenant-a', CASE_ID, 'UNDER_REVIEW', 'tester', 'starting review');
    expect(updated.status).toBe('UNDER_REVIEW');
    expect(prisma._tx.postingCaseTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromStatus: 'QUARANTINED', toStatus: 'UNDER_REVIEW' }) }),
    );
  });

  it('rejects an invalid lifecycle transition before touching the database', async () => {
    await expect(svc.transitionFixture('tenant-a', CASE_ID, 'RESOLVED', 'tester')).rejects.toBeInstanceOf(InvalidCaseTransitionError);
    expect(prisma._tx.postingCaseTransition.create).not.toHaveBeenCalled();
  });
});
