/**
 * S221 — GL Search. Proves cross-account ledger search across the approved
 * criteria set (amount/amountRange with optional debit/credit direction,
 * dateRange, sourceCode, memoContains, postedBy, docRef), the frozen
 * S220-plus-accountNumber result shape (BR221-1), saved-search
 * create/list/run/delete round-trips (BR221-2), fail-closed validation
 * (no criteria at all, malformed ranges), deterministic pagination, tenant
 * isolation, and the unconditional S007 audit-on-search event.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  GLSearchService,
  SearchCriteriaRequiredError,
  InvalidSearchRangeError,
  SavedSearchNotFoundError,
  DuplicateSearchNameError,
} from '../src/application/gl-search-service';

const TENANT = 'tenant-kunes';
const TENANT_B = 'tenant-other';

function d(iso: string) {
  return new Date(iso);
}

function entryMatches(entry: any, where: any): boolean {
  if (!entry) return false;
  if (where.tenantId && entry.tenantId !== where.tenantId) return false;
  if (where.entityId && entry.entityId !== where.entityId) return false;
  if (where.sourceCode && entry.sourceCode !== where.sourceCode) return false;
  if (where.postedBy && entry.postedBy !== where.postedBy) return false;
  if (where.entryDate?.gte && entry.entryDate < where.entryDate.gte) return false;
  if (where.entryDate?.lte && entry.entryDate > where.entryDate.lte) return false;
  if (where.memo?.contains) {
    const hay = (entry.memo ?? '').toLowerCase();
    if (!hay.includes(where.memo.contains.toLowerCase())) return false;
  }
  return true;
}

function orMatches(line: any, entry: any, orClauses: any[]): boolean {
  return orClauses.some((clause) => {
    if (clause.dr !== undefined) {
      if (typeof clause.dr === 'object') {
        if (clause.dr.gte !== undefined && !(line.dr >= clause.dr.gte)) return false;
        if (clause.dr.lte !== undefined && !(line.dr <= clause.dr.lte)) return false;
        return true;
      }
      return line.dr === clause.dr;
    }
    if (clause.cr !== undefined) {
      if (typeof clause.cr === 'object') {
        if (clause.cr.gte !== undefined && !(line.cr >= clause.cr.gte)) return false;
        if (clause.cr.lte !== undefined && !(line.cr <= clause.cr.lte)) return false;
        return true;
      }
      return line.cr === clause.cr;
    }
    if (clause.controlNumber !== undefined) return line.controlNumber === clause.controlNumber;
    if (clause.applyNumber !== undefined) return line.applyNumber === clause.applyNumber;
    if (clause.memo?.contains) return (line.memo ?? '').toLowerCase().includes(clause.memo.contains.toLowerCase());
    if (clause.entry) return entryMatches(entry, clause.entry);
    return false;
  });
}

/** Minimal in-memory Prisma double covering only what GLSearchService touches. */
function makePrisma(seed: { entries?: any[]; lines?: any[]; savedSearches?: any[] } = {}) {
  const entries: any[] = seed.entries ?? [];
  const lines: any[] = seed.lines ?? [];
  const saved: any[] = seed.savedSearches ?? [];
  const outbox: any[] = [];
  const audits: any[] = [];

  function filterLines(where: any) {
    return lines.filter((l) => {
      if (where.tenantId && l.tenantId !== where.tenantId) return false;
      const entry = entries.find((e) => e.id === l.journalEntryId);
      if (where.entry && !entryMatches(entry, where.entry)) return false;
      if (where.AND) {
        for (const clause of where.AND) {
          if (clause.OR && !orMatches(l, entry, clause.OR)) return false;
        }
      }
      return true;
    });
  }

  const prisma: any = {
    _outbox: outbox,
    _audits: audits,
    journalLine: {
      count: async ({ where }: any) => filterLines(where).length,
      findMany: async ({ where, skip = 0, take = 1000, orderBy }: any) => {
        let rows = filterLines(where).map((l) => {
          const entry = entries.find((e) => e.id === l.journalEntryId);
          return { ...l, entry: entry ? { ...entry } : undefined };
        });
        // Deterministic ordering matching the service's orderBy: entryDate desc, journalNumber desc, lineIndex asc.
        rows.sort((a, b) => {
          const dcmp = b.entry.entryDate.getTime() - a.entry.entryDate.getTime();
          if (dcmp !== 0) return dcmp;
          const jcmp = b.entry.journalNumber.localeCompare(a.entry.journalNumber);
          if (jcmp !== 0) return jcmp;
          return a.lineIndex - b.lineIndex;
        });
        return rows.slice(skip, skip + take);
      },
    },
    savedGlSearch: {
      findUnique: async ({ where }: any) => {
        const key = where.tenantId_createdBy_name;
        const row = saved.find((s) => s.tenantId === key.tenantId && s.createdBy === key.createdBy && s.name === key.name);
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }: any) => {
        const row = saved.find((s) => s.id === where.id && s.tenantId === where.tenantId && s.createdBy === where.createdBy);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: any) => {
        return saved
          .filter((s) => s.tenantId === where.tenantId && s.createdBy === where.createdBy)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((s) => ({ ...s }));
      },
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        saved.push(row);
        return { ...row };
      },
      delete: async ({ where }: any) => {
        const idx = saved.findIndex((s) => s.id === where.id);
        if (idx >= 0) saved.splice(idx, 1);
      },
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
  };
  prisma.$transaction = async (fn: (tx: any) => Promise<any>) => fn(prisma);
  return prisma;
}

function makeEvents() {
  return { publish: async () => {} };
}

function svc(prisma: any) {
  return new GLSearchService(prisma, makeEvents() as any);
}

const ACTOR = { userId: 'u1', role: 'ACCOUNTANT' };

const ENTRIES = [
  { id: 'je1', tenantId: TENANT, entityId: 'e1', journalNumber: 'JE-0001', sourceCode: 'GJ', postedBy: 'alice', entryDate: d('2026-08-05'), memo: 'August accrual' },
  { id: 'je2', tenantId: TENANT, entityId: 'e1', journalNumber: 'JE-0002', sourceCode: 'CR', postedBy: 'bob', entryDate: d('2026-08-10'), memo: 'Cash receipt batch' },
  { id: 'je3', tenantId: TENANT_B, entityId: 'e2', journalNumber: 'JE-0001', sourceCode: 'GJ', postedBy: 'carol', entryDate: d('2026-08-06'), memo: 'Other tenant entry' },
];

const LINES = [
  { id: 'l1', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', accountNumber: '10000', storeId: 'store-1', deptCode: null, controlNumber: 'CTRL-100', applyNumber: null, memo: 'accrual line', dr: 500, cr: 0 },
  { id: 'l2', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 1, accountId: 'acc-2', accountNumber: '20000', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 0, cr: 500 },
  { id: 'l3', journalEntryId: 'je2', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', accountNumber: '10000', storeId: 'store-1', deptCode: 'D1', controlNumber: null, applyNumber: 'APP-9', memo: 'receipt', dr: 250, cr: 0 },
  { id: 'l4', journalEntryId: 'je3', tenantId: TENANT_B, lineIndex: 0, accountId: 'acc-9', accountNumber: '10000', storeId: 'store-9', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 999, cr: 0 },
];

describe('GLSearchService', () => {
  it('rejects a fully-empty search (fail-closed, no unbounded scan)', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    await expect(svc(prisma).search(TENANT, {}, ACTOR)).rejects.toBeInstanceOf(SearchCriteriaRequiredError);
  });

  it('rejects a one-sided date range and an inverted range', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    await expect(svc(prisma).search(TENANT, { startDate: '2026-08-01' }, ACTOR)).rejects.toBeInstanceOf(InvalidSearchRangeError);
    await expect(
      svc(prisma).search(TENANT, { startDate: '2026-08-31', endDate: '2026-08-01' }, ACTOR),
    ).rejects.toBeInstanceOf(InvalidSearchRangeError);
  });

  it('rejects amountMin > amountMax', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    await expect(svc(prisma).search(TENANT, { amountMin: 100, amountMax: 10 }, ACTOR)).rejects.toBeInstanceOf(InvalidSearchRangeError);
  });

  it('searches by exact amount, matching either dr or cr side', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { amount: 500 }, ACTOR);
    expect(result.results.map((r) => r.journalEntryId + ':' + r.accountId).sort()).toEqual(['je1:acc-1', 'je1:acc-2'].sort());
  });

  it('restricts amount match to a single side when direction is supplied', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const drOnly = await svc(prisma).search(TENANT, { amount: 500, direction: 'DEBIT' }, ACTOR);
    expect(drOnly.results.map((r) => r.accountId)).toEqual(['acc-1']);
    const crOnly = await svc(prisma).search(TENANT, { amount: 500, direction: 'CREDIT' }, ACTOR);
    expect(crOnly.results.map((r) => r.accountId)).toEqual(['acc-2']);
  });

  it('searches by amount range', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { amountMin: 200, amountMax: 300 }, ACTOR);
    expect(result.results.map((r) => r.journalEntryId)).toEqual(['je2']);
  });

  it('searches by date range', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { startDate: '2026-08-09', endDate: '2026-08-31' }, ACTOR);
    expect(result.results.map((r) => r.journalEntryId)).toEqual(['je2']);
  });

  it('searches by sourceCode', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { sourceCode: 'CR' }, ACTOR);
    expect(result.results.map((r) => r.journalEntryId)).toEqual(['je2']);
  });

  it('searches by postedBy', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { postedBy: 'alice' }, ACTOR);
    expect(result.results.map((r) => r.journalEntryId)).toEqual(['je1', 'je1']);
  });

  it('searches by memoContains against either the line memo or the entry memo, case-insensitively', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const byLineMemo = await svc(prisma).search(TENANT, { memoContains: 'RECEIPT' }, ACTOR);
    expect(byLineMemo.results.map((r) => r.journalEntryId)).toEqual(['je2']);
    const byEntryMemo = await svc(prisma).search(TENANT, { memoContains: 'accrual' }, ACTOR);
    expect(byEntryMemo.results.map((r) => r.journalEntryId).sort()).toEqual(['je1', 'je1'].sort());
  });

  it('searches by docRef matching either controlNumber or applyNumber', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const byControl = await svc(prisma).search(TENANT, { docRef: 'CTRL-100' }, ACTOR);
    expect(byControl.results.map((r) => r.accountId)).toEqual(['acc-1']);
    const byApply = await svc(prisma).search(TENANT, { docRef: 'APP-9' }, ACTOR);
    expect(byApply.results.map((r) => r.journalEntryId)).toEqual(['je2']);
  });

  it('combines multiple criteria with AND semantics (not silently dropping any of them)', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    // sourceCode=GJ AND amount=500 AND docRef=CTRL-100 — only l1 (acc-1) satisfies all three;
    // l2 (acc-2, also amount 500, also entry je1/GJ) is excluded because it lacks the docRef.
    const result = await svc(prisma).search(TENANT, { sourceCode: 'GJ', amount: 500, docRef: 'CTRL-100' }, ACTOR);
    expect(result.results.map((r) => r.accountId)).toEqual(['acc-1']);
  });

  it('never returns another tenant\'s lines regardless of criteria', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { amountMin: 0, amountMax: 100000 }, ACTOR);
    expect(result.results.every((r) => r.accountId !== 'acc-9')).toBe(true);
  });

  it('returns the frozen S220-plus-accountNumber shape, omitting runningBalance', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const result = await svc(prisma).search(TENANT, { docRef: 'CTRL-100' }, ACTOR);
    expect(result.results[0]).toEqual({
      journalEntryId: 'je1',
      journalNumber: 'JE-0001',
      accountId: 'acc-1',
      accountNumber: '10000',
      entryDate: '2026-08-05',
      source: 'GJ',
      store: 'store-1',
      dept: null,
      controlNumber: 'CTRL-100',
      applyNumber: null,
      memo: 'accrual line',
      dr: 500,
      cr: 0,
    });
    expect('runningBalance' in result.results[0]).toBe(false);
  });

  it('paginates deterministically', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const page1 = await svc(prisma).search(TENANT, { amountMin: 0, amountMax: 100000, page: 1, pageSize: 1 }, ACTOR);
    const page2 = await svc(prisma).search(TENANT, { amountMin: 0, amountMax: 100000, page: 2, pageSize: 1 }, ACTOR);
    expect(page1.pagination).toEqual({ page: 1, pageSize: 1, totalResults: 3, totalPages: 3 });
    expect(page2.pagination.page).toBe(2);
    expect(page1.results[0]).not.toEqual(page2.results[0]);
  });

  it('emits exactly one transactionally-coupled audit.viewed/SEARCHED event per search', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    await svc(prisma).search(TENANT, { sourceCode: 'GJ' }, ACTOR);
    expect(prisma._outbox).toHaveLength(1);
    expect(prisma._outbox[0].eventType).toBe('audit.viewed');
    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0].action).toBe('SEARCHED');
    expect(prisma._audits[0].docType).toBe('GL_SEARCH');
  });

  it('saves, lists, re-runs and deletes a saved search (BR221-2)', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const s = svc(prisma);
    const savedView = await s.saveSearch(TENANT, ACTOR, 'August GJ', { sourceCode: 'GJ' });
    expect(savedView.name).toBe('August GJ');

    const list = await s.listSavedSearches(TENANT, ACTOR);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(savedView.id);

    const rerun = await s.runSavedSearch(TENANT, ACTOR, savedView.id, undefined, undefined);
    expect(rerun.results.map((r) => r.journalEntryId)).toEqual(['je1', 'je1']);

    await s.deleteSavedSearch(TENANT, ACTOR, savedView.id);
    expect(await s.listSavedSearches(TENANT, ACTOR)).toHaveLength(0);
  });

  it('rejects saving a duplicate name for the same user', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const s = svc(prisma);
    await s.saveSearch(TENANT, ACTOR, 'Dup', { sourceCode: 'GJ' });
    await expect(s.saveSearch(TENANT, ACTOR, 'Dup', { sourceCode: 'CR' })).rejects.toBeInstanceOf(DuplicateSearchNameError);
  });

  it('rejects running or deleting a saved search that does not exist / belongs to another tenant', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const s = svc(prisma);
    const savedView = await s.saveSearch(TENANT, ACTOR, 'Mine', { sourceCode: 'GJ' });
    await expect(s.runSavedSearch(TENANT_B, ACTOR, savedView.id, undefined, undefined)).rejects.toBeInstanceOf(
      SavedSearchNotFoundError,
    );
    await expect(s.deleteSavedSearch(TENANT_B, ACTOR, savedView.id)).rejects.toBeInstanceOf(SavedSearchNotFoundError);
    await expect(s.runSavedSearch(TENANT, ACTOR, 'nope', undefined, undefined)).rejects.toBeInstanceOf(SavedSearchNotFoundError);
  });

  it('re-run overrides page/pageSize while keeping the persisted criteria', async () => {
    const prisma = makePrisma({ entries: ENTRIES, lines: LINES });
    const s = svc(prisma);
    const savedView = await s.saveSearch(TENANT, ACTOR, 'Wide', { amountMin: 0, amountMax: 100000 });
    const rerun = await s.runSavedSearch(TENANT, ACTOR, savedView.id, 2, 1);
    expect(rerun.pagination).toEqual({ page: 2, pageSize: 1, totalResults: 3, totalPages: 3 });
  });
});
