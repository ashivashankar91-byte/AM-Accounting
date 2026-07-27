/**
 * S216 — Post Manual JE (Direct-Post Mode). Proves the deliberate Post action moves a
 * draft through the ONE posting door (PostingService.post = the S013 engine) and links
 * the draft to its immutable journal. Covers BR216-1 (atomic post + linkage), BR216-2
 * (je.posting_mode gate — non-direct refused with 'routing requires S031'), BR216-3
 * (poster identity = authenticated user), validate-first (§3 negative), idempotency,
 * the terminal-state guards, and atomicity fault injection (§12).
 *
 * NOTE (fake-persistence limitation): the in-memory $transaction does NOT roll back
 * array writes, so the atomicity test injects the fault BEFORE any persistence (at
 * sequence allocation) and asserts the draft is never linked and no journal is minted.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  DraftService,
  DraftValidationBlockedError,
  DraftPostValidationError,
  PostingModeGateError,
} from '../src/application/draft-service';
import { PostingService } from '../src/application/posting-service';

const TENANT = 'tenant-kunes';
const ENTITY = 'e1';

const ACCOUNTS = [
  { id: 'a-cash', tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-rev', tenantId: TENANT, entityId: ENTITY, accountNumber: '49000', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE', balance: 0 },
];

const SOURCES: Record<string, any> = {
  GJ: { code: 'GJ', sourceClass: 'MANUAL', status: 'ACTIVE' },
};

function makePrisma(opts: { failSequence?: boolean } = {}) {
  const drafts: any[] = [];
  const revisions: any[] = [];
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
    _drafts: drafts,
    _entries: entries,
    _lines: lines,
    _outbox: outbox,
    _audits: audits,
    _accounts: accounts,
    manualJeDraft: {
      create: async ({ data }: any) => (drafts.push({ ...data }), { ...data }),
      update: async ({ where, data }: any) => {
        const d = drafts.find((x) => x.id === where.id);
        Object.assign(d, data);
        return { ...d };
      },
      findFirst: async ({ where }: any) => {
        const d = drafts.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        return d ? { ...d } : null;
      },
      findMany: async ({ where }: any) => drafts.filter((x) => x.tenantId === where.tenantId).map((x) => ({ ...x })),
    },
    manualJeDraftRevision: { create: async ({ data }: any) => (revisions.push({ ...data }), { ...data }) },
    attachment: { create: async ({ data }: any) => data, findMany: async () => [] },
    journalEntry: {
      findUnique: async ({ where }: any) => {
        if (where.tenantId_idempotencyKey) {
          const { tenantId, idempotencyKey } = where.tenantId_idempotencyKey;
          return entries.find((e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey) ?? null;
        }
        return entries.find((e) => e.id === where.id) ?? null;
      },
      create: async ({ data }: any) => (entries.push(data), data),
    },
    journalLine: { create: async ({ data }: any) => (lines.push(data), data) },
    balanceSnapshot: { create: async ({ data }: any) => (snaps.push(data), data) },
    glAccount: {
      findMany: async ({ where }: any) =>
        accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId && where.id.in.includes(a.id)),
      update: async ({ where, data }: any) => {
        const a = accounts.find((x) => x.id === where.id);
        if (data.balance !== undefined) a.balance = applyIncrement(a.balance, data.balance);
        if (data.hasPostings !== undefined) a.hasPostings = data.hasPostings;
        if (data.version !== undefined) a.version = applyIncrement(a.version ?? 1, data.version);
        return a;
      },
    },
    fiscalPeriod: { update: async ({ where, data }: any) => { const p = periods.find((x) => x.id === where.id); if (p) Object.assign(p, data); return p; } },
    journalSource: { findUnique: async ({ where }: any) => SOURCES[where.tenantId_code?.code] ?? null },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $executeRawUnsafe: async () => undefined,
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma;
}

function fakeFiscal() {
  return {
    resolve: async (_t: string, _e: string, date: string) => {
      if (date === '2026-01-15') return { id: 'p1', code: '2026-01', status: 'OPEN', adjustmentsOnly: false };
      throw new Error('no period for date');
    },
  };
}

function fakeSequence(opts: { failSequence?: boolean } = {}) {
  let n = 0;
  return {
    allocate: async () => {
      if (opts.failSequence) throw new Error('sequence backend unavailable');
      n += 1;
      return { journalNumber: `GJ-2026-01-${String(n).padStart(6, '0')}`, seq: n, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' };
    },
    logGap: async () => undefined,
  };
}

function setup(opts: { mode?: string; failSequence?: boolean } = {}) {
  container.reset();
  const prisma = makePrisma({ failSequence: opts.failSequence });
  const events = { publish: async () => undefined };
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('FiscalCalendarService', fakeFiscal() as any);
  container.registerInstance('SequenceService', fakeSequence({ failSequence: opts.failSequence }) as any);
  container.register('PostingService', { useClass: PostingService });
  container.registerInstance('ConfigService', { resolve: async () => ({ value: opts.mode ?? 'direct' }) } as any);
  container.register('DraftService', { useClass: DraftService });
  return { draft: container.resolve<DraftService>('DraftService'), prisma };
}

const actor = { tenantId: TENANT, userId: 'alice', canViewAll: false };

const balanced = [
  { accountId: 'a-cash', storeId: '01', dr: 100 },
  { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
];

async function mkDraft(svc: DraftService, payload: any = {}) {
  const d = await svc.create({
    tenantId: TENANT,
    preparer: 'alice',
    entityId: ENTITY,
    sourceCode: 'GJ',
    entryDate: '2026-01-15',
    lines: balanced,
    ...payload,
  });
  return d.id as string;
}

describe('DraftService.postDraft — S216 acceptance criteria', () => {
  it('BR216-1: posts a balanced validated draft -> immutable JE + POSTED_LINKED linkage', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft);
    await draft.validate(id, actor); // status -> VALIDATED

    const res = await draft.postDraft(id, actor);

    expect(res.status).toBe('POSTED_LINKED');
    expect(res.journalNumber).toMatch(/^GJ-2026-01-\d{6}$/);
    expect(res.idempotent).toBe(false);

    // Journal persisted through the S013 door.
    expect(prisma._entries).toHaveLength(1);
    expect(prisma._entries[0].status).toBe('POSTED');
    expect(prisma._entries[0].draftId).toBe(id); // back-ref written

    // Draft linked.
    const d = prisma._drafts.find((x: any) => x.id === id);
    expect(d.status).toBe('POSTED_LINKED');
    expect(d.postedJournalId).toBe(prisma._entries[0].id);
    expect(d.postedJournalNumber).toBe(res.journalNumber);
  });

  it('BR216-3: poster identity = authenticated user on the JE', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft);
    await draft.validate(id, actor);
    await draft.postDraft(id, { tenantId: TENANT, userId: 'controller-bob', canViewAll: true });
    expect(prisma._entries[0].postedBy).toBe('controller-bob');
  });

  it('acct.je.posted + DRAFT_POSTED audit are emitted', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft);
    await draft.validate(id, actor);
    await draft.postDraft(id, actor);
    expect(prisma._outbox.some((e: any) => e.eventType === 'acct.je.posted')).toBe(true);
    expect(prisma._audits.some((a: any) => a.action === 'DRAFT_POSTED')).toBe(true);
  });

  it('§3 negative: never-validated draft runs validation first, then posts', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft); // status DRAFT (never validated)
    const res = await draft.postDraft(id, actor);
    expect(res.status).toBe('POSTED_LINKED');
    expect(prisma._entries).toHaveLength(1);
    // validation ran (DRAFT_VALIDATED audit precedes DRAFT_POSTED)
    expect(prisma._audits.some((a: any) => a.action === 'DRAFT_VALIDATED')).toBe(true);
  });

  it('§3 negative: unbalanced draft is refused with S215-shaped validation, no journal', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft, { lines: [
      { accountId: 'a-cash', storeId: '01', dr: 100 },
      { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 90 },
    ] });
    await expect(draft.postDraft(id, actor)).rejects.toBeInstanceOf(DraftPostValidationError);
    try {
      await draft.postDraft(id, actor);
    } catch (e: any) {
      expect(e.status).toBe(422);
      expect(e.validation.pass).toBe(false);
      expect(e.validation.errors.some((x: any) => x.rule.startsWith('BR013'))).toBe(true);
    }
    expect(prisma._entries).toHaveLength(0);
    const d = prisma._drafts.find((x: any) => x.id === id);
    expect(d.status).toBe('DRAFT'); // never advanced
  });

  it('BR216-2: posting_mode=approval_required (review) is refused with routing message', async () => {
    const { draft, prisma } = setup({ mode: 'review' });
    const id = await mkDraft(draft);
    await draft.validate(id, actor);
    let err: any;
    try { await draft.postDraft(id, actor); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PostingModeGateError);
    expect(err.status).toBe(422);
    expect(err.message).toBe('routing requires S031');
    expect(prisma._entries).toHaveLength(0); // gate is before posting
  });

  it('idempotent: re-posting a POSTED_LINKED draft returns the same journal, no second JE', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft);
    await draft.validate(id, actor);
    const first = await draft.postDraft(id, actor);
    const second = await draft.postDraft(id, actor);
    expect(second.idempotent).toBe(true);
    expect(second.journalNumber).toBe(first.journalNumber);
    expect(prisma._entries).toHaveLength(1);
  });

  it('409: a VOIDED draft cannot be posted (reverse the journal instead)', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft);
    // force VOIDED state directly (S219 not built yet)
    prisma._drafts.find((x: any) => x.id === id).status = 'VOIDED';
    await expect(draft.postDraft(id, actor)).rejects.toBeInstanceOf(DraftValidationBlockedError);
    expect(prisma._entries).toHaveLength(0);
  });

  it('§12 atomicity: a fault during posting leaves the draft unlinked and mints no journal', async () => {
    const { draft, prisma } = setup({ failSequence: true });
    const id = await mkDraft(draft);
    await draft.validate(id, actor); // VALIDATED
    await expect(draft.postDraft(id, actor)).rejects.toThrow();
    expect(prisma._entries).toHaveLength(0); // nothing minted
    const d = prisma._drafts.find((x: any) => x.id === id);
    expect(d.status).toBe('VALIDATED'); // not advanced to POSTED_LINKED
    expect(d.postedJournalId ?? null).toBeNull();
  });
});
