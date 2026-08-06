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
import { PostingService, PostingViolationError, AnalysisTagViolationError } from '../src/application/posting-service';

const TENANT = 'tenant-kunes';
const ENTITY = 'e1';

const ACCOUNTS = [
  { id: 'a-cash', tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-rev', tenantId: TENANT, entityId: ENTITY, accountNumber: '49000', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-sched', tenantId: TENANT, entityId: ENTITY, accountNumber: '19500', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0, scheduleCode: 'VEH-UNIT-LEDGER' },
];

function makePrisma() {
  const entries: any[] = [];
  const lines: any[] = [];
  const tags: any[] = [];
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
    _tags: tags,
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
    journalLineAnalysisTag: {
      createMany: async ({ data }: any) => {
        (data as any[]).forEach((d) => tags.push(d));
        return { count: data.length };
      },
    },
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
    $executeRawUnsafe: async () => undefined,
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

function fakeAnalysisCodes(overrides: { types?: Map<string, any>; values?: Map<string, any> } = {}) {
  return {
    loadValidationContext: async (_tenantId: string) => ({
      types: overrides.types ?? new Map(),
      values: overrides.values ?? new Map(),
    }),
  };
}

function setup(opts: { periodStatus?: string; analysisCodes?: ReturnType<typeof fakeAnalysisCodes> } = {}) {
  container.reset();
  const prisma = makePrisma();
  const events = { published: [] as any[], publish: async (e: any) => void (events.published as any[]).push(e) };
  const fiscal = fakeFiscal(opts.periodStatus);
  const sequence = fakeSequence();
  const analysisCodes = opts.analysisCodes ?? fakeAnalysisCodes();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('FiscalCalendarService', fiscal as any);
  container.registerInstance('SequenceService', sequence as any);
  container.registerInstance('AnalysisCodeService', analysisCodes as any);
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

describe('PostingService.post — CE-12 schedule-service bridge event', () => {
  it('a line on a scheduleCode-linked account with a controlNumber also publishes a JOURNAL_ENTRY_POSTED bridge event', async () => {
    const { svc, events } = setup();
    await svc.post(dto({
      lines: [
        { accountId: 'a-sched', storeId: '01', dr: 100, controlNumber: 'STK-001' },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    }));
    const bridge = events.published.find((e: any) => e.type === 'JOURNAL_ENTRY_POSTED');
    expect(bridge).toBeTruthy();
    expect(bridge.payload.tenantId).toBe(TENANT);
    expect(bridge.payload.glAccountNumber).toBe('19500');
    expect(bridge.payload.scheduleNumber).toBe('VEH-UNIT-LEDGER');
    expect(bridge.payload.controlNumber).toBe('STK-001');
    // referenceNumber becomes the new ScheduleOpenItem's itemNumber (see
    // schedule-service's OpenItemService.processPostingEvent) — must be the
    // real business key, not a fabricated/idempotency-derived value.
    expect(bridge.payload.referenceNumber).toBe('STK-001');
    expect(bridge.payload.amount).toBe('100');
    expect(bridge.payload.applyNumber).toBeNull();
  });

  it('a line without controlNumber, even on a scheduleCode-linked account, does not publish a bridge event', async () => {
    const { svc, events } = setup();
    await svc.post(dto({
      lines: [
        { accountId: 'a-sched', storeId: '01', dr: 100 },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    }));
    expect(events.published.some((e: any) => e.type === 'JOURNAL_ENTRY_POSTED')).toBe(false);
  });

  it('a line on an account with no scheduleCode never publishes a bridge event, regardless of controlNumber (pre-CE-12 behavior unaffected)', async () => {
    const { svc, events } = setup();
    await svc.post(dto({
      lines: [
        { accountId: 'a-cash', storeId: '01', dr: 100, controlNumber: 'IRRELEVANT' },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    }));
    expect(events.published.some((e: any) => e.type === 'JOURNAL_ENTRY_POSTED')).toBe(false);
  });

  it('applyNumber (relieving an existing item) flows through with applyCd "#", matching gl-service\'s convention', async () => {
    const { svc, events } = setup();
    await svc.post(dto({
      lines: [
        { accountId: 'a-sched', storeId: '01', cr: 100, controlNumber: 'STK-001', applyNumber: 'STK-001' },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', dr: 100 },
      ],
    }));
    const bridge = events.published.find((e: any) => e.type === 'JOURNAL_ENTRY_POSTED');
    expect(bridge.payload.applyNumber).toBe('STK-001');
    expect(bridge.payload.applyCd).toBe('#');
    expect(bridge.payload.amount).toBe('-100'); // CR line — matches gl-service's netAmount = dr - cr convention
  });

  it('a controlNumber/applyNumber longer than schedule-service\'s column limits is truncated, never dropped or rejected', async () => {
    const { svc, events } = setup();
    const longKey = 'DEAL-2026-000123456789'; // 22 chars — exceeds both VarChar(10) and VarChar(12)
    await svc.post(dto({
      lines: [
        { accountId: 'a-sched', storeId: '01', dr: 100, controlNumber: longKey, applyNumber: longKey },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    }));
    const bridge = events.published.find((e: any) => e.type === 'JOURNAL_ENTRY_POSTED');
    expect(bridge.payload.controlNumber).toBe(longKey.slice(0, 10));
    expect(bridge.payload.referenceNumber).toBe(longKey.slice(0, 10));
    expect(bridge.payload.applyNumber).toBe(longKey.slice(0, 12));
  });

  it('a memo longer than schedule-service\'s ScheduleDetail.description VarChar(35) is truncated, never dropped or rejected', async () => {
    const { svc, events } = setup();
    const longMemo = 'Deferral booking origination — deal D1 product GAP'; // 51 chars — exceeds VarChar(35)
    await svc.post(dto({
      memo: longMemo,
      lines: [
        { accountId: 'a-sched', storeId: '01', dr: 100, controlNumber: 'D1-GAP', memo: longMemo },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    }));
    const bridge = events.published.find((e: any) => e.type === 'JOURNAL_ENTRY_POSTED');
    expect(bridge.payload.description).toBe(longMemo.slice(0, 35));
    expect(bridge.payload.description.length).toBe(35);
  });
});

// ── S011 — Analysis Codes / Dimensions: tag persistence at the S013 door ────
describe('PostingService.post — S011 analysis tag persistence (BR011-1/2)', () => {
  it('persists a valid tag on a JournalLine atomically with the entry', async () => {
    const analysisCodes = fakeAnalysisCodes({
      types: new Map([['t-project', { id: 't-project', isActive: true }]]),
      values: new Map([['v-alpha', { id: 'v-alpha', typeId: 't-project', isActive: true }]]),
    });
    const { svc, prisma } = setup({ analysisCodes });
    await svc.post(dto({
      lines: [
        { accountId: 'a-cash', storeId: '01', dr: 100, analysisTags: [{ typeId: 't-project', valueId: 'v-alpha' }] },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    }));
    expect(prisma._tags).toHaveLength(1);
    expect(prisma._tags[0]).toMatchObject({ typeId: 't-project', valueId: 'v-alpha' });
    // The tag row must reference the SAME line id just written to _lines,
    // proving atomic association (not a dangling/out-of-order write).
    expect(prisma._tags[0].journalLineId).toBe(prisma._lines[0].id);
  });

  it('rejects an unknown analysis-code value with a 422 AnalysisTagViolationError and writes NOTHING', async () => {
    const { svc, prisma } = setup(); // empty registry — every tag reference is "unknown"
    await expect(
      svc.post(dto({
        lines: [
          { accountId: 'a-cash', storeId: '01', dr: 100, analysisTags: [{ typeId: 't-nope', valueId: 'v-nope' }] },
          { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
        ],
      })),
    ).rejects.toBeInstanceOf(AnalysisTagViolationError);
    expect(prisma._entries).toHaveLength(0);
    expect(prisma._lines).toHaveLength(0);
    expect(prisma._tags).toHaveLength(0);
  });

  it('rejects more than MAX_TAGS_PER_LINE tags on one line (BLK-13 proposed cap) with no partial write', async () => {
    const analysisCodes = fakeAnalysisCodes({
      types: new Map([
        ['t-a', { id: 't-a', isActive: true }],
        ['t-b', { id: 't-b', isActive: true }],
        ['t-c', { id: 't-c', isActive: true }],
        ['t-d', { id: 't-d', isActive: true }],
      ]),
      values: new Map([
        ['v-a', { id: 'v-a', typeId: 't-a', isActive: true }],
        ['v-b', { id: 'v-b', typeId: 't-b', isActive: true }],
        ['v-c', { id: 'v-c', typeId: 't-c', isActive: true }],
        ['v-d', { id: 'v-d', typeId: 't-d', isActive: true }],
      ]),
    });
    const { svc, prisma } = setup({ analysisCodes });
    await expect(
      svc.post(dto({
        lines: [
          {
            accountId: 'a-cash', storeId: '01', dr: 100,
            analysisTags: [
              { typeId: 't-a', valueId: 'v-a' },
              { typeId: 't-b', valueId: 'v-b' },
              { typeId: 't-c', valueId: 'v-c' },
              { typeId: 't-d', valueId: 'v-d' },
            ],
          },
          { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
        ],
      })),
    ).rejects.toBeInstanceOf(AnalysisTagViolationError);
    expect(prisma._entries).toHaveLength(0);
  });

  it('never lets tags affect balancing — an otherwise-unbalanced entry still fails BR013-1, not a tag rule (BR011-3)', async () => {
    const analysisCodes = fakeAnalysisCodes({
      types: new Map([['t-project', { id: 't-project', isActive: true }]]),
      values: new Map([['v-alpha', { id: 'v-alpha', typeId: 't-project', isActive: true }]]),
    });
    const { svc } = setup({ analysisCodes });
    await expect(
      svc.post(dto({
        lines: [
          { accountId: 'a-cash', storeId: '01', dr: 100, analysisTags: [{ typeId: 't-project', valueId: 'v-alpha' }] },
          { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 90 },
        ],
      })),
    ).rejects.toBeInstanceOf(PostingViolationError); // BR013 rejection, NOT AnalysisTagViolationError
  });
});
