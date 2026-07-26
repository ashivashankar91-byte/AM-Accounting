/**
 * S013 — PostingService integration-style unit tests with an in-memory fake
 * Prisma + fake FiscalCalendarService + fake SequenceService via tsyringe.
 * Covers the persistence contract: atomic write of entry+lines, per-account
 * balance updates, append-only snapshots, outbox + audit rows, the idempotency
 * short-circuit (BR013-6), and NO-partial-write on a rule violation (422).
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { PostingService, PostingViolationError } from '../src/application/posting-service';

const TENANT = 'tenant-kunes';
const ENTITY = 'e1';

const ACCOUNTS = [
  { id: 'a-cash', tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-rev', tenantId: TENANT, entityId: ENTITY, accountNumber: '49000', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE', balance: 0 },
];

function makePrisma() {
  const entries: any[] = [];
  const lines: any[] = [];
  const snaps: any[] = [];
  const outbox: any[] = [];
  const audits: any[] = [];
  const accounts = ACCOUNTS.map((a) => ({ ...a }));
  const periods: any[] = [{ id: 'p1', hasPostings: false }];

  const applyIncrement = (current: number, patch: any) =>
    patch && typeof patch === 'object' && 'increment' in patch ? current + patch.increment : patch;

  const prisma: any = {
    _entries: entries,
    _lines: lines,
    _snaps: snaps,
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
      create: async ({ data }: any) => {
        if (entries.some((e) => e.tenantId === data.tenantId && e.idempotencyKey === data.idempotencyKey)) {
          const err: any = new Error('unique violation');
          err.code = 'P2002';
          err.meta = { target: ['tenant_id', 'idempotency_key'] };
          throw err;
        }
        entries.push(data);
        return data;
      },
    },
    journalLine: { create: async ({ data }: any) => (lines.push(data), data) },
    balanceSnapshot: { create: async ({ data }: any) => (snaps.push(data), data) },
    glAccount: {
      findMany: async ({ where }: any) =>
        accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId && where.id.in.includes(a.id)),
      update: async ({ where, data }: any) => {
        const a = accounts.find((x) => x.id === where.id);
        if (!a) throw new Error('account not found');
        if (data.balance !== undefined) a.balance = applyIncrement(a.balance, data.balance);
        if (data.hasPostings !== undefined) a.hasPostings = data.hasPostings;
        if (data.version !== undefined) a.version = applyIncrement(a.version ?? 1, data.version);
        return a;
      },
    },
    fiscalPeriod: {
      update: async ({ where, data }: any) => {
        const p = periods.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      },
    },
    journalSource: {
      findUnique: async ({ where }: any) =>
        where.tenantId_code && where.tenantId_code.code === 'GJ'
          ? { code: 'GJ', sourceClass: 'MANUAL', status: 'ACTIVE' }
          : null,
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma;
}

function fakeFiscal(periodStatus = 'OPEN') {
  return {
    resolve: async (_t: string, _e: string, date: string) => {
      if (date.startsWith('2099')) throw new Error('no period');
      return { id: 'p1', code: '2026-01', status: periodStatus, adjustmentsOnly: false };
    },
  };
}

function fakeSequence() {
  let n = 0;
  const gaps: any[] = [];
  return {
    _gaps: gaps,
    allocate: async (_dto: any) => {
      n += 1;
      return { journalNumber: `GJ-2026-01-${String(n).padStart(6, '0')}`, seq: n, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' };
    },
    logGap: async (dto: any) => void gaps.push(dto),
  };
}

function setup(opts: { periodStatus?: string } = {}) {
  container.reset();
  const prisma = makePrisma();
  const events = { published: [] as any[], publish: async (e: any) => void (events.published as any[]).push(e) };
  const fiscal = fakeFiscal(opts.periodStatus);
  const sequence = fakeSequence();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('FiscalCalendarService', fiscal as any);
  container.registerInstance('SequenceService', sequence as any);
  container.register('PostingService', { useClass: PostingService });
  return { svc: container.resolve<PostingService>('PostingService'), prisma, events, sequence };
}

const goodLines = [
  { accountId: 'a-cash', storeId: '01', dr: 100 },
  { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
];

function dto(overrides: any = {}) {
  return {
    tenantId: TENANT,
    entityId: ENTITY,
    date: '2026-01-15',
    sourceCode: 'GJ',
    idempotencyKey: 'idem-1',
    postedBy: 'alice',
    lines: goodLines,
    ...overrides,
  };
}

describe('PostingService.post — happy path', () => {
  it('posts a balanced entry: writes entry, lines, balances, snapshot, outbox, audit', async () => {
    const { svc, prisma } = setup();
    const r = await svc.post(dto());
    expect(r.status).toBe('POSTED');
    expect(r.idempotent).toBe(false);
    expect(r.journalNumber).toBe('GJ-2026-01-000001');
    expect(r.totalDebits).toBe(100);
    expect(r.totalCredits).toBe(100);

    expect(prisma._entries).toHaveLength(1);
    expect(prisma._lines).toHaveLength(2);
    expect(prisma._snaps).toHaveLength(2);
    expect(prisma._outbox).toHaveLength(1);
    expect(prisma._outbox[0].eventType).toBe('acct.je.posted');
    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0].action).toBe('POSTED');

    const cash = prisma._accounts.find((a: any) => a.id === 'a-cash');
    const rev = prisma._accounts.find((a: any) => a.id === 'a-rev');
    expect(cash.balance).toBe(100); // DR-normal +100
    expect(rev.balance).toBe(100); // CR-normal +100
    expect(cash.hasPostings).toBe(true);
  });
});

describe('PostingService.post — BR013-6 idempotency', () => {
  it('a duplicate idempotencyKey returns the original entry (idempotent) without a second write', async () => {
    const { svc, prisma } = setup();
    const first = await svc.post(dto());
    const second = await svc.post(dto());
    expect(second.idempotent).toBe(true);
    expect(second.journalNumber).toBe(first.journalNumber);
    expect(prisma._entries).toHaveLength(1);
    expect(prisma._lines).toHaveLength(2);
  });
});

describe('PostingService.post — no partial write on violation', () => {
  it('an unbalanced entry throws 422 and writes NOTHING (BR013-1)', async () => {
    const { svc, prisma } = setup();
    await expect(
      svc.post(dto({ lines: [
        { accountId: 'a-cash', storeId: '01', dr: 100 },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 90 },
      ] })),
    ).rejects.toBeInstanceOf(PostingViolationError);
    expect(prisma._entries).toHaveLength(0);
    expect(prisma._lines).toHaveLength(0);
    expect(prisma._snaps).toHaveLength(0);
    expect(prisma._outbox).toHaveLength(0);
  });

  it('a closed period throws 422 with BR013-2 and no write', async () => {
    const { svc, prisma } = setup({ periodStatus: 'HARD_CLOSED' });
    await expect(svc.post(dto())).rejects.toMatchObject({ status: 422 });
    expect(prisma._entries).toHaveLength(0);
  });

  it('a date resolving to no period throws 422 with BR013-2', async () => {
    const { svc } = setup();
    await expect(svc.post(dto({ date: '2099-01-01' }))).rejects.toMatchObject({ status: 422 });
  });
});

describe('PostingService.post — event payload', () => {
  it('emits acct.je.posted with journalNumber, lines and schemaV=1', async () => {
    const { svc, prisma } = setup();
    await svc.post(dto());
    const payload = prisma._outbox[0].payload;
    expect(payload.schemaV).toBe(1);
    expect(payload.journalNumber).toBe('GJ-2026-01-000001');
    expect(payload.lines).toHaveLength(2);
    expect(payload.postedBy).toBe('alice');
  });
});
