/**
 * S213 — Journal Numbering Sequences unit tests.
 * Strategy: in-memory fake Prisma + fake event publisher via tsyringe.
 * Covers BR213-1 (atomic distinct sequential numbers under concurrency),
 * BR213-2 (mint-only; never revised), BR213-3 (gaps logged + report + period
 * reset), plus every §9 4xx path (422 validation) with a named test.
 *
 * The fake models the atomic `UPDATE ... SET next_seq = next_seq + 1 RETURNING`
 * via $queryRawUnsafe so concurrency semantics are exercised. JS is
 * single-threaded so awaited increments serialize deterministically, which is
 * exactly the invariant we assert: no two allocations return the same value.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { SequenceService, SequenceValidationError } from '../src/application/sequence-service';
import { formatJournalNumber } from '../src/domain/journal-sequence';

const TENANT = 'tenant-kunes';
const ENTITY = 'entity-1';

function makePrisma() {
  const seqs: any[] = [];
  const gaps: any[] = [];
  const audits: any[] = [];
  const seqKey = (t: string, s: string, e: string, p: string) => `${t}::${s}::${e}::${p}`;
  const client: any = {
    _seqs: seqs,
    _gaps: gaps,
    _audits: audits,
    journalSequence: {
      findUnique: async ({ where }: any) => {
        const { tenantId, sourceCode, entityId, periodCode } = where.tenantId_sourceCode_entityId_periodCode;
        return (
          seqs.find((r) => seqKey(r.tenantId, r.sourceCode, r.entityId, r.periodCode) === seqKey(tenantId, sourceCode, entityId, periodCode)) ?? null
        );
      },
      create: async ({ data }: any) => {
        const k = seqKey(data.tenantId, data.sourceCode, data.entityId, data.periodCode);
        if (seqs.some((r) => seqKey(r.tenantId, r.sourceCode, r.entityId, r.periodCode) === k)) {
          const e: any = new Error('unique violation');
          e.code = 'P2002';
          throw e;
        }
        seqs.push(data);
        return data;
      },
    },
    sequenceGapLog: {
      create: async ({ data }: any) => (gaps.push(data), data),
      findMany: async ({ where }: any) =>
        gaps
          .filter((r) => r.tenantId === where.tenantId)
          .filter((r) => (where.entityId ? r.entityId === where.entityId : true))
          .filter((r) => (where.periodCode ? r.periodCode === where.periodCode : true)),
    },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    // Atomic claim emulation: read-and-increment the matching seq row.
    $queryRawUnsafe: async (_sql: string, tenantId: string, sourceCode: string, entityId: string, periodCode: string) => {
      const row = seqs.find(
        (r) => seqKey(r.tenantId, r.sourceCode, r.entityId, r.periodCode) === seqKey(tenantId, sourceCode, entityId, periodCode),
      );
      if (!row) return [];
      const claimed = row.nextSeq;
      row.nextSeq = row.nextSeq + 1;
      return [{ claimed }];
    },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;

}

function makeEvents() {
  const published: any[] = [];
  return { published, publish: async (e: any) => void published.push(e) };
}

function setup() {
  container.reset();
  const prisma = makePrisma();
  const events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('SequenceService', { useClass: SequenceService });
  return { svc: container.resolve<SequenceService>('SequenceService'), prisma };
}

describe('SequenceService.allocate (BR213-1/2)', () => {
  it('mints sequential numbers starting at 1 with the interim format', async () => {
    const { svc } = setup();
    const a = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' });
    const b = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' });
    expect(a.seq).toBe(1);
    expect(a.journalNumber).toBe('GJ-2026-01-000001');
    expect(b.seq).toBe(2);
    expect(b.journalNumber).toBe('GJ-2026-01-000002');
  });

  it('upper-cases the source code before minting', async () => {
    const { svc } = setup();
    const a = await svc.allocate({ tenantId: TENANT, sourceCode: 'gj', entityId: ENTITY, periodCode: '2026-01' });
    expect(a.journalNumber).toBe('GJ-2026-01-000001');
  });

  it('BR213-1 concurrent allocations return distinct sequential numbers (race hammer)', async () => {
    const { svc } = setup();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' })),
    );
    const seqs = results.map((r) => r.seq).sort((x, y) => x - y);
    // No duplicates, contiguous 1..100 (REGULATORY: zero duplicate numbers).
    expect(new Set(seqs).size).toBe(100);
    expect(seqs[0]).toBe(1);
    expect(seqs[99]).toBe(100);
  });

  it('BR213-3 resets per period — new period restarts at 1', async () => {
    const { svc } = setup();
    await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' });
    await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' });
    const feb = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-02' });
    expect(feb.seq).toBe(1);
    expect(feb.journalNumber).toBe('GJ-2026-02-000001');
  });

  it('scopes counters by source and entity independently', async () => {
    const { svc } = setup();
    const gj = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' });
    const adj = await svc.allocate({ tenantId: TENANT, sourceCode: 'ADJ', entityId: ENTITY, periodCode: '2026-01' });
    const other = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: 'entity-2', periodCode: '2026-01' });
    expect(gj.seq).toBe(1);
    expect(adj.seq).toBe(1);
    expect(other.seq).toBe(1);
  });

  it('422 INVALID_SOURCE_CODE on malformed source', async () => {
    const { svc } = setup();
    await expect(
      svc.allocate({ tenantId: TENANT, sourceCode: 'x', entityId: ENTITY, periodCode: '2026-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_CODE', status: 422 });
  });

  it('422 INVALID_PERIOD_CODE on malformed period', async () => {
    const { svc } = setup();
    await expect(
      svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026/1' }),
    ).rejects.toBeInstanceOf(SequenceValidationError);
  });
});

describe('SequenceService.logGap + gapReport (BR213-3)', () => {
  it('logs a gap with reason + interim number and audits it', async () => {
    const { svc, prisma } = setup();
    const gap = await svc.logGap({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01', seq: 5, reason: 'post aborted' });
    expect(gap.expectedNumber).toBe(formatJournalNumber('GJ', '2026-01', 5));
    expect(gap.reason).toBe('post aborted');
    expect(prisma._audits.some((a) => a.action === 'GAP_LOGGED' && a.docType === 'journal_sequence')).toBe(true);
  });

  it('failed post leaves a gap while the sequence continues', async () => {
    const { svc } = setup();
    const a = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' }); // 1 (posted)
    const b = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' }); // 2 (fails)
    await svc.logGap({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01', seq: b.seq, reason: 'db error' });
    const c = await svc.allocate({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' }); // 3 (continues)
    expect(a.seq).toBe(1);
    expect(c.seq).toBe(3);
    const report = await svc.gapReport(TENANT, { entityId: ENTITY, periodCode: '2026-01' });
    expect(report).toHaveLength(1);
    expect(report[0].expectedSeq).toBe(2);
  });

  it('422 MISSING_REASON when reason is blank', async () => {
    const { svc } = setup();
    await expect(
      svc.logGap({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01', seq: 1, reason: '  ' }),
    ).rejects.toMatchObject({ code: 'MISSING_REASON', status: 422 });
  });

  it('gapReport filters by entity and period', async () => {
    const { svc } = setup();
    await svc.logGap({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01', seq: 1, reason: 'a' });
    await svc.logGap({ tenantId: TENANT, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-02', seq: 1, reason: 'b' });
    await svc.logGap({ tenantId: TENANT, sourceCode: 'GJ', entityId: 'entity-2', periodCode: '2026-01', seq: 1, reason: 'c' });
    const jan1 = await svc.gapReport(TENANT, { entityId: ENTITY, periodCode: '2026-01' });
    expect(jan1).toHaveLength(1);
    const allEntity1 = await svc.gapReport(TENANT, { entityId: ENTITY });
    expect(allEntity1).toHaveLength(2);
  });
});
