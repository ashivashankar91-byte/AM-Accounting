/**
 * S218 — Reverse Posted Journal Entry. Proves a correction is an equal-and-opposite
 * LINKED posting through the single door — history is never mutated. Covers the
 * REGULATORY TB-restoration property (account balances return to their pre-post
 * state), BR218-1 (mirrored lines + reversal_of linkage + own number), BR218-2
 * (reversible once -> 409; a reversal is itself reversible = reinstatement, warned),
 * BR218-3 (reason mandatory -> 422), and the closed-target-period 422 with the
 * eligible-period list.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { PostingService } from '../src/application/posting-service';
import { AnalysisCodeService } from '../src/application/analysis-code-service';
import {
  ReversalService,
  ReversalReasonRequiredError,
  AlreadyReversedError,
  ClosedTargetPeriodError,
  ReversalTargetNotFoundError,
} from '../src/application/reversal-service';

const TENANT = 'tenant-kunes';
const ENTITY = 'e1';

const ACCOUNTS = [
  { id: 'a-cash', tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-rev', tenantId: TENANT, entityId: ENTITY, accountNumber: '49000', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE', balance: 0 },
];

const SOURCES: Record<string, any> = {
  GJ: { code: 'GJ', sourceClass: 'MANUAL', status: 'ACTIVE' },
  CE12: { code: 'CE12', sourceClass: 'SYSTEM', status: 'ACTIVE' },
};

// Fiscal periods for the reversal eligible-target query. post() uses fakeFiscal (below).
const PERIODS = [
  { id: 'p1', tenantId: TENANT, entityId: ENTITY, code: '2026-01', status: 'OPEN', startDate: new Date('2026-01-01') },
  { id: 'p3', tenantId: TENANT, entityId: ENTITY, code: '2026-03', status: 'OPEN', startDate: new Date('2026-03-01') },
  { id: 'p12', tenantId: TENANT, entityId: ENTITY, code: '2025-12', status: 'HARD_CLOSED', startDate: new Date('2025-12-01') },
];

function makePrisma() {
  const entries: any[] = [];
  const lines: any[] = [];
  const snaps: any[] = [];
  const outbox: any[] = [];
  const audits: any[] = [];
  const accounts = ACCOUNTS.map((a) => ({ ...a }));
  const periods = PERIODS.map((p) => ({ ...p }));
  const inc = (cur: number, patch: any) => (patch && typeof patch === 'object' && 'increment' in patch ? cur + patch.increment : patch);

  const prisma: any = {
    _entries: entries,
    _lines: lines,
    _outbox: outbox,
    _audits: audits,
    _accounts: accounts,
    journalEntry: {
      findUnique: async ({ where }: any) => {
        if (where.tenantId_idempotencyKey) {
          const { tenantId, idempotencyKey } = where.tenantId_idempotencyKey;
          return entries.find((e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey) ?? null;
        }
        return entries.find((e) => e.id === where.id) ?? null;
      },
      findFirst: async ({ where, select }: any) => {
        const e = entries.find((x) => x.id === where.id && (!where.tenantId || x.tenantId === where.tenantId));
        if (!e) return null;
        if (select) {
          const out: any = {};
          for (const k of Object.keys(select)) if (select[k]) out[k] = e[k];
          return out;
        }
        return { ...e };
      },
      create: async ({ data }: any) => (entries.push(data), data),
      update: async ({ where, data }: any) => {
        const e = entries.find((x) => x.id === where.id);
        Object.assign(e, data);
        return { ...e };
      },
    },
    journalLine: {
      create: async ({ data }: any) => (lines.push(data), data),
      findMany: async ({ where, orderBy }: any) => {
        let rows = lines.filter((l) => l.journalEntryId === where.journalEntryId && l.tenantId === where.tenantId);
        if (orderBy?.lineIndex === 'asc') rows = rows.sort((a, b) => a.lineIndex - b.lineIndex);
        return rows.map((l) => ({ ...l }));
      },
    },
    balanceSnapshot: { create: async ({ data }: any) => (snaps.push(data), data) },
    glAccount: {
      findMany: async ({ where }: any) =>
        accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId && where.id.in.includes(a.id)).map((a) => ({ ...a })),
      update: async ({ where, data }: any) => {
        const a = accounts.find((x) => x.id === where.id);
        if (data.balance !== undefined) a.balance = inc(a.balance, data.balance);
        if (data.hasPostings !== undefined) a.hasPostings = data.hasPostings;
        if (data.version !== undefined) a.version = inc(a.version ?? 1, data.version);
        return { ...a };
      },
    },
    fiscalPeriod: {
      update: async ({ where, data }: any) => { const p = periods.find((x) => x.id === where.id); if (p) Object.assign(p, data); return p; },
      findMany: async ({ where, orderBy, select }: any) => {
        let rows = periods.filter((p) => {
          if (where.tenantId && p.tenantId !== where.tenantId) return false;
          if (where.entityId && p.entityId !== where.entityId) return false;
          if (where.status && p.status !== where.status) return false;
          if (where.code?.gte && p.code < where.code.gte) return false;
          return true;
        });
        if (orderBy?.code === 'asc') rows = rows.sort((a, b) => a.code.localeCompare(b.code));
        return rows.map((p) => (select ? project(p, select) : { ...p }));
      },
    },
    journalSource: { findUnique: async ({ where }: any) => SOURCES[where.tenantId_code?.code] ?? null },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $executeRawUnsafe: async () => undefined,
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma;
}

function project(obj: any, select: Record<string, boolean>) {
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = obj[k];
  return out;
}

function fakeFiscal() {
  return {
    resolve: async (_t: string, _e: string, date: string) => {
      const ym = date.slice(0, 7);
      const p = PERIODS.find((x) => x.code === ym);
      if (!p) throw new Error(`no period for date ${date}`);
      return { id: p.id, code: p.code, status: p.status, adjustmentsOnly: false };
    },
  };
}

function fakeSequence() {
  let n = 0;
  return {
    allocate: async (args: any) => {
      n += 1;
      return { journalNumber: `GJ-${args.periodCode ?? '2026-01'}-${String(n).padStart(6, '0')}`, seq: n, sourceCode: 'GJ', entityId: ENTITY, periodCode: args.periodCode ?? '2026-01' };
    },
    logGap: async () => undefined,
  };
}

const noopEvents = { publish: async () => undefined } as any;

function build() {
  const prisma = makePrisma();
  const posting = new PostingService(prisma, noopEvents, fakeFiscal() as any, fakeSequence() as any, new AnalysisCodeService(prisma, noopEvents));
  const reversal = new ReversalService(prisma, posting);
  return { prisma, posting, reversal };
}

const BALANCED = [
  { accountId: 'a-cash', storeId: '01', dr: 100 },
  { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
];

async function postOriginal(posting: PostingService, over: any = {}) {
  return posting.post({
    tenantId: TENANT,
    entityId: ENTITY,
    date: '2026-01-15',
    sourceCode: 'GJ',
    idempotencyKey: over.idempotencyKey ?? 'orig-1',
    callerClass: 'MANUAL',
    postedBy: 'alice',
    lines: over.lines ?? BALANCED,
  });
}

const actor = { userId: 'alice' };

describe('ReversalService.reverse — S218 acceptance criteria', () => {
  it('REGULATORY (TB restoration): reversal returns every account balance to pre-post state', async () => {
    const { prisma, posting, reversal } = build();
    const before = new Map(prisma._accounts.map((a: any) => [a.id, a.balance]));

    const orig = await postOriginal(posting);
    // balances moved
    expect(prisma._accounts.find((a: any) => a.id === 'a-cash').balance).not.toBe(before.get('a-cash'));

    await reversal.reverse(TENANT, orig.id, { reason: 'keyed wrong amount' }, actor);

    for (const a of prisma._accounts) {
      expect(a.balance).toBe(before.get(a.id)); // fully restored
    }
  });

  it('BR218-1: reversal has mirrored lines, reversal_of linkage, and its own number', async () => {
    const { prisma, posting, reversal } = build();
    const orig = await postOriginal(posting);

    const res = await reversal.reverse(TENANT, orig.id, { reason: 'correction' }, actor);

    expect(res.reversalNumber).not.toBe(orig.journalNumber); // own number
    const reversalEntry = prisma._entries.find((e: any) => e.id === res.reversalId);
    expect(reversalEntry.reversalOf).toBe(orig.id); // linkage
    expect(reversalEntry.reversalReason).toBe('correction');

    // mirrored lines — the original cash DR becomes CR, the revenue CR becomes DR
    const revLines = prisma._lines.filter((l: any) => l.journalEntryId === res.reversalId).sort((a: any, b: any) => a.lineIndex - b.lineIndex);
    expect(Number(revLines[0].cr)).toBe(100); // was dr 100
    expect(Number(revLines[0].dr)).toBe(0);
    expect(Number(revLines[1].dr)).toBe(100); // was cr 100
    expect(revLines[1].deptCode).toBe('SVC'); // dimension preserved

    // original flipped + back-linked (both directions)
    const original = prisma._entries.find((e: any) => e.id === orig.id);
    expect(original.status).toBe('REVERSED');
    expect(original.reversedBy).toBe(res.reversalId);
    expect(res.reinstatement).toBe(false);
  });

  it('BR013-3: reversing a SYSTEM-sourced journal (e.g. CE12) re-posts as callerClass SYSTEM, not hardcoded MANUAL', async () => {
    const { prisma, posting, reversal } = build();
    const orig = await posting.post({
      tenantId: TENANT,
      entityId: ENTITY,
      date: '2026-01-15',
      sourceCode: 'CE12',
      idempotencyKey: 'ce12-orig-1',
      callerClass: 'SYSTEM',
      postedBy: 'system',
      lines: BALANCED,
    });

    const res = await reversal.reverse(TENANT, orig.id, { reason: 'CE12 unwind' }, actor);

    const reversalEntry = prisma._entries.find((e: any) => e.id === res.reversalId);
    expect(reversalEntry.sourceCode).toBe('CE12');
    expect(reversalEntry.reversalOf).toBe(orig.id);
    const original = prisma._entries.find((e: any) => e.id === orig.id);
    expect(original.status).toBe('REVERSED');
  });

  it('emits acct.je.posted (reversal, reversalOf) + a REVERSED audit on the original', async () => {
    const { prisma, posting, reversal } = build();
    const orig = await postOriginal(posting);
    await reversal.reverse(TENANT, orig.id, { reason: 'oops' }, actor);

    const posted = prisma._outbox.filter((e: any) => e.eventType === 'acct.je.posted');
    expect(posted.length).toBe(2); // original + reversal
    expect(posted[1].payload.reversalOf).toBe(orig.id);
    expect(prisma._audits.some((a: any) => a.docId === orig.id && a.action === 'REVERSED')).toBe(true);
  });

  it('BR218-3: a missing reason is rejected 422 before anything is posted', async () => {
    const { prisma, posting, reversal } = build();
    const orig = await postOriginal(posting);
    const countBefore = prisma._entries.length;

    await expect(reversal.reverse(TENANT, orig.id, { reason: '   ' }, actor)).rejects.toBeInstanceOf(ReversalReasonRequiredError);
    expect(prisma._entries.length).toBe(countBefore); // no reversal posted
  });

  it('BR218-2: a second reversal attempt is refused 409 (reversible once)', async () => {
    const { posting, reversal } = build();
    const orig = await postOriginal(posting);
    await reversal.reverse(TENANT, orig.id, { reason: 'first' }, actor);

    await expect(reversal.reverse(TENANT, orig.id, { reason: 'second' }, actor)).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_REVERSED',
    });
  });

  it('BR218-2: a reversal is itself reversible (reinstatement, warned)', async () => {
    const { prisma, posting, reversal } = build();
    const orig = await postOriginal(posting);
    const rev = await reversal.reverse(TENANT, orig.id, { reason: 'reverse it' }, actor);

    const reinstate = await reversal.reverse(TENANT, rev.reversalId, { reason: 'put it back' }, actor);
    expect(reinstate.reinstatement).toBe(true); // BR218-2 warning flag
    const reversalEntry = prisma._entries.find((e: any) => e.id === rev.reversalId);
    expect(reversalEntry.status).toBe('REVERSED');
    expect(reversalEntry.reversedBy).toBe(reinstate.reversalId);
  });

  it('§3 negative: reversal into a closed period is 422 with the eligible-period list', async () => {
    const { posting, reversal } = build();
    const orig = await postOriginal(posting);

    try {
      await reversal.reverse(TENANT, orig.id, { targetPeriod: '2025-12', reason: 'wrong period' }, actor);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ClosedTargetPeriodError);
      const err = e as ClosedTargetPeriodError;
      expect(err.targetPeriod).toBe('2025-12');
      expect(err.eligiblePeriods).toEqual(['2026-01', '2026-03']); // same-or-later OPEN only
    }
  });

  it('can reverse into a later OPEN period (2026-03)', async () => {
    const { prisma, posting, reversal } = build();
    const orig = await postOriginal(posting);

    const res = await reversal.reverse(TENANT, orig.id, { targetPeriod: '2026-03', reason: 'defer' }, actor);
    expect(res.reversalPeriod).toBe('2026-03');
    // TB still restores across periods (net zero)
    for (const a of prisma._accounts) expect(a.balance).toBe(0);
  });

  it('§3 negative: unknown journal id is 404', async () => {
    const { reversal } = build();
    await expect(reversal.reverse(TENANT, 'nope', { reason: 'x' }, actor)).rejects.toBeInstanceOf(ReversalTargetNotFoundError);
  });

  it('tenant scoping: cannot reverse another tenant\'s journal', async () => {
    const { posting, reversal } = build();
    const orig = await postOriginal(posting);
    await expect(reversal.reverse('tenant-other', orig.id, { reason: 'x' }, actor)).rejects.toBeInstanceOf(ReversalTargetNotFoundError);
  });
});
