/**
 * S220 — GL Account Activity Inquiry. Proves beginning balance, chronological
 * period activity with a running balance, and ending balance for a GL account,
 * with the BR220-1 foot/cross-foot proof (ending = beginning + sum(lines)
 * independently of the per-line running-balance accumulator), zero-activity
 * behavior, store-scoped beginning-balance recomputation (BalanceSnapshot does
 * not preserve store/dept granularity), pagination that does not perturb the
 * running-balance math, date-range/period/preset selection (including the
 * fail-closed no-selector / conflicting-selector / unknown-preset paths), and
 * the unconditional S007 audit-on-view/export events.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  GLInquiryService,
  RangeRequiredError,
  RangeConflictError,
  InvalidRangeError,
  UnknownPresetError,
  PeriodNotFoundError,
} from '../src/application/gl-inquiry-service';
import { AccountService, AccountNotFoundError } from '../src/application/account-service';

const TENANT = 'tenant-kunes';
const TENANT_B = 'tenant-other';
const ENTITY = 'e1';

function d(iso: string) {
  return new Date(iso);
}

/** Minimal in-memory Prisma double covering only what GLInquiryService + AccountService.get touch. */
function makePrisma(seed: {
  accounts?: any[];
  periods?: any[];
  snapshots?: any[];
  entries?: any[];
  lines?: any[];
} = {}) {
  const accounts: any[] = seed.accounts ?? [];
  const periods: any[] = seed.periods ?? [];
  const snapshots: any[] = seed.snapshots ?? [];
  const entries: any[] = seed.entries ?? [];
  const lines: any[] = seed.lines ?? [];
  const outbox: any[] = [];
  const audits: any[] = [];

  function entryMatches(entry: any, where: any): boolean {
    if (!entry) return false;
    if (where.tenantId && entry.tenantId !== where.tenantId) return false;
    if (where.entityId && entry.entityId !== where.entityId) return false;
    if (where.entryDate?.gte && entry.entryDate < where.entryDate.gte) return false;
    if (where.entryDate?.lte && entry.entryDate > where.entryDate.lte) return false;
    if (where.entryDate?.lt && !(entry.entryDate < where.entryDate.lt)) return false;
    return true;
  }

  const prisma: any = {
    _outbox: outbox,
    _audits: audits,
    glAccount: {
      findUnique: async ({ where }: any) => {
        const a = accounts.find((x) => x.id === where.id);
        return a ? { ...a } : null;
      },
    },
    fiscalPeriod: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = periods.filter((p) => {
          if (where.tenantId && p.tenantId !== where.tenantId) return false;
          if (where.entityId && p.entityId !== where.entityId) return false;
          if (where.code && p.code !== where.code) return false;
          if (where.status && p.status !== where.status) return false;
          return true;
        });
        if (orderBy?.periodNumber === 'desc') rows = rows.sort((a, b) => b.periodNumber - a.periodNumber);
        return rows[0] ? { ...rows[0] } : null;
      },
    },
    balanceSnapshot: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = snapshots.filter((s) => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (where.entityId && s.entityId !== where.entityId) return false;
          if (where.accountId && s.accountId !== where.accountId) return false;
          if (where.postedAt?.lt && !(s.postedAt < where.postedAt.lt)) return false;
          return true;
        });
        if (orderBy?.postedAt === 'desc') rows = rows.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
        return rows[0] ? { ...rows[0] } : null;
      },
    },
    journalLine: {
      findMany: async ({ where }: any) => {
        const entryWhere = where.entry ?? {};
        let rows = lines.filter((l) => {
          if (where.tenantId && l.tenantId !== where.tenantId) return false;
          if (where.accountId && l.accountId !== where.accountId) return false;
          if (where.storeId && l.storeId !== where.storeId) return false;
          if (where.deptCode && l.deptCode !== where.deptCode) return false;
          const entry = entries.find((e) => e.id === l.journalEntryId);
          return entryMatches(entry, entryWhere);
        });
        return rows.map((l) => {
          const entry = entries.find((e) => e.id === l.journalEntryId);
          return { ...l, entry: entry ? { ...entry } : undefined };
        });
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

const ACCOUNT: any = {
  id: 'acc-1',
  tenantId: TENANT,
  entityId: ENTITY,
  accountNumber: '10000',
  name: 'Cash',
  normalBalance: 'DR',
};

const AUG_PERIOD: any = {
  tenantId: TENANT,
  entityId: ENTITY,
  code: '2026-08',
  periodNumber: 8,
  startDate: d('2026-08-01'),
  endDate: d('2026-08-31'),
  status: 'OPEN',
};

function svc(prisma: any) {
  const accountSvc = new AccountService(prisma, makeEvents() as any);
  return new GLInquiryService(prisma, makeEvents() as any, accountSvc);
}

describe('GLInquiryService', () => {
  it('computes beginning (from BalanceSnapshot) / activity / ending balance, and ending = beginning + sum(lines)', async () => {
    const prisma = makePrisma({
      accounts: [ACCOUNT],
      periods: [AUG_PERIOD],
      snapshots: [
        { tenantId: TENANT, entityId: ENTITY, accountId: 'acc-1', postedAt: d('2026-07-15'), balanceAfter: 500 },
      ],
      entries: [
        { id: 'je1', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0001', sourceCode: 'GJ', entryDate: d('2026-08-05'), status: 'POSTED' },
        { id: 'je2', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0002', sourceCode: 'GJ', entryDate: d('2026-08-10'), status: 'REVERSED' },
        { id: 'je3', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0003', sourceCode: 'GJ', entryDate: d('2026-08-11'), status: 'POSTED', reversalOf: 'je2' },
      ],
      lines: [
        { id: 'l1', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 100, cr: 0 },
        { id: 'l2', journalEntryId: 'je2', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 0, cr: 50 },
        { id: 'l3', journalEntryId: 'je3', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 50, cr: 0 },
      ],
    });

    const view = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08' }, { userId: 'u1', role: 'ACCOUNTANT' });

    expect(view.beginningBalance).toBe(500);
    expect(view.lines).toHaveLength(3);
    expect(view.lines.map((l) => l.journalNumber)).toEqual(['JE-0001', 'JE-0002', 'JE-0003']);
    // BR013-7: a REVERSED entry's own lines still count as real, permanent ledger effect.
    expect(view.lines[1].journalNumber).toBe('JE-0002');
    // Running balance: 500 +100=600, -50=550, +50=600.
    expect(view.lines.map((l) => l.runningBalance)).toEqual([600, 550, 600]);
    expect(view.periodDebitActivity).toBe(150);
    expect(view.periodCreditActivity).toBe(50);
    // BR220-1 — independently derived ending must equal both the last running
    // balance AND beginning + net(sum(lines)).
    expect(view.endingBalance).toBe(600);
    expect(view.endingBalance).toBe(view.beginningBalance + (view.periodDebitActivity - view.periodCreditActivity));
    expect(view.lines[view.lines.length - 1].runningBalance).toBe(view.endingBalance);

    // BR220-2 drill-down key present on every line.
    for (const l of view.lines) expect(l.journalNumber).toMatch(/^JE-/);

    // Real S007 audit-on-view event, unconditionally (not masked-role-gated).
    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0]).toMatchObject({ tenantId: TENANT, docType: 'GL_ACCOUNT_INQUIRY', docId: 'acc-1', action: 'VIEWED' });
    expect(JSON.stringify(prisma._audits[0])).not.toMatch(/password|secret|hash/i);
  });

  it('zero-activity account: beginning = ending, not an error', async () => {
    const prisma = makePrisma({
      accounts: [{ ...ACCOUNT, id: 'acc-quiet' }],
      periods: [AUG_PERIOD],
      snapshots: [],
      entries: [],
      lines: [],
    });
    const view = await svc(prisma).getActivity(TENANT, 'acc-quiet', { periodCode: '2026-08' }, { userId: 'u1' });
    expect(view.beginningBalance).toBe(0);
    expect(view.endingBalance).toBe(0);
    expect(view.lines).toHaveLength(0);
  });

  it('store-filtered beginning balance is recomputed from JournalLine, not the (unfiltered) BalanceSnapshot', async () => {
    const prisma = makePrisma({
      accounts: [ACCOUNT],
      periods: [AUG_PERIOD],
      snapshots: [
        // Snapshot aggregates BOTH stores for je-prior (40+10=50) — using it
        // directly for a store-filtered query would be wrong (BR220 store scope).
        { tenantId: TENANT, entityId: ENTITY, accountId: 'acc-1', postedAt: d('2026-07-21'), balanceAfter: 50 },
      ],
      entries: [
        { id: 'je-prior', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0000', sourceCode: 'GJ', entryDate: d('2026-07-20'), status: 'POSTED' },
        { id: 'je1', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0001', sourceCode: 'GJ', entryDate: d('2026-08-05'), status: 'POSTED' },
      ],
      lines: [
        { id: 'lp1', journalEntryId: 'je-prior', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 40, cr: 0 },
        { id: 'lp2', journalEntryId: 'je-prior', tenantId: TENANT, lineIndex: 1, accountId: 'acc-1', storeId: 'store-2', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 10, cr: 0 },
        { id: 'l1', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 20, cr: 0 },
        { id: 'l2', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 1, accountId: 'acc-1', storeId: 'store-2', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: 5, cr: 0 },
      ],
    });

    const filtered = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08', storeId: 'store-1' }, { userId: 'u1' });
    // Only store-1's prior line (40), NOT the snapshot's cross-store total (50).
    expect(filtered.beginningBalance).toBe(40);
    expect(filtered.lines).toHaveLength(1);
    expect(filtered.lines[0].store).toBe('store-1');
    expect(filtered.endingBalance).toBe(60); // 40 + 20

    const unfiltered = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08' }, { userId: 'u1' });
    expect(unfiltered.beginningBalance).toBe(50); // fast path uses the snapshot
    expect(unfiltered.lines).toHaveLength(2);
  });

  it('pagination does not perturb the running-balance math across page boundaries', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `je${i}`,
      tenantId: TENANT,
      entityId: ENTITY,
      journalNumber: `JE-000${i}`,
      sourceCode: 'GJ',
      entryDate: d(`2026-08-0${i + 1}`),
      status: 'POSTED',
    }));
    const lines = entries.map((e, i) => ({
      id: `l${i}`,
      journalEntryId: e.id,
      tenantId: TENANT,
      lineIndex: 0,
      accountId: 'acc-1',
      storeId: 'store-1',
      deptCode: null,
      controlNumber: null,
      applyNumber: null,
      memo: null,
      dr: 10,
      cr: 0,
    }));
    const prisma = makePrisma({ accounts: [ACCOUNT], periods: [AUG_PERIOD], snapshots: [], entries, lines });

    const page1 = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08', page: 1, pageSize: 2 }, { userId: 'u1' });
    const page2 = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08', page: 2, pageSize: 2 }, { userId: 'u1' });
    const page3 = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08', page: 3, pageSize: 2 }, { userId: 'u1' });

    expect(page1.pagination).toEqual({ page: 1, pageSize: 2, totalLines: 5, totalPages: 3 });
    expect(page1.lines.map((l) => l.runningBalance)).toEqual([10, 20]);
    expect(page2.lines.map((l) => l.runningBalance)).toEqual([30, 40]);
    expect(page3.lines.map((l) => l.runningBalance)).toEqual([50]);
    // Ending balance identical regardless of which page was requested.
    expect(page1.endingBalance).toBe(50);
    expect(page2.endingBalance).toBe(50);
    expect(page3.endingBalance).toBe(50);
  });

  it('preset=OPEN_MONTH resolves the entity\'s currently OPEN fiscal period', async () => {
    const prisma = makePrisma({
      accounts: [ACCOUNT],
      periods: [
        { tenantId: TENANT, entityId: ENTITY, code: '2026-07', periodNumber: 7, startDate: d('2026-07-01'), endDate: d('2026-07-31'), status: 'HARD_CLOSED' },
        AUG_PERIOD,
      ],
      snapshots: [],
      entries: [],
      lines: [],
    });
    const view = await svc(prisma).getActivity(TENANT, 'acc-1', { preset: 'OPEN_MONTH' }, { userId: 'u1' });
    expect(view.range).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31', periodCode: '2026-08', preset: 'OPEN_MONTH' });
  });

  it('rejects an unsupported preset rather than fabricating one', async () => {
    const prisma = makePrisma({ accounts: [ACCOUNT], periods: [AUG_PERIOD] });
    await expect(svc(prisma).getActivity(TENANT, 'acc-1', { preset: 'QTD' }, { userId: 'u1' })).rejects.toThrow(UnknownPresetError);
  });

  it('requires exactly one range selector — none supplied fails closed', async () => {
    const prisma = makePrisma({ accounts: [ACCOUNT] });
    await expect(svc(prisma).getActivity(TENANT, 'acc-1', {}, { userId: 'u1' })).rejects.toThrow(RangeRequiredError);
  });

  it('rejects conflicting range selectors rather than silently picking one', async () => {
    const prisma = makePrisma({ accounts: [ACCOUNT], periods: [AUG_PERIOD] });
    await expect(
      svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31' }, { userId: 'u1' }),
    ).rejects.toThrow(RangeConflictError);
  });

  it('rejects an unknown periodCode with 404 PeriodNotFoundError', async () => {
    const prisma = makePrisma({ accounts: [ACCOUNT], periods: [AUG_PERIOD] });
    await expect(svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2099-01' }, { userId: 'u1' })).rejects.toThrow(PeriodNotFoundError);
  });

  it('rejects a malformed or inverted explicit date range', async () => {
    const prisma = makePrisma({ accounts: [ACCOUNT] });
    await expect(
      svc(prisma).getActivity(TENANT, 'acc-1', { startDate: '08/01/2026', endDate: '2026-08-31' }, { userId: 'u1' }),
    ).rejects.toThrow(InvalidRangeError);
    await expect(
      svc(prisma).getActivity(TENANT, 'acc-1', { startDate: '2026-08-31', endDate: '2026-08-01' }, { userId: 'u1' }),
    ).rejects.toThrow(InvalidRangeError);
  });

  it('denies cross-tenant access with the same 404 as an unknown account (no existence leak)', async () => {
    const prisma = makePrisma({ accounts: [ACCOUNT], periods: [AUG_PERIOD] });
    await expect(
      svc(prisma).getActivity(TENANT_B, 'acc-1', { periodCode: '2026-08' }, { userId: 'u1' }),
    ).rejects.toThrow(AccountNotFoundError);
  });

  it('CSV export matches the screen exactly (BR220-3) and emits a distinct EXPORTED audit event', async () => {
    const prisma = makePrisma({
      accounts: [ACCOUNT],
      periods: [AUG_PERIOD],
      snapshots: [{ tenantId: TENANT, entityId: ENTITY, accountId: 'acc-1', postedAt: d('2026-07-15'), balanceAfter: 500 }],
      entries: [{ id: 'je1', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0001', sourceCode: 'GJ', entryDate: d('2026-08-05'), status: 'POSTED' }],
      lines: [{ id: 'l1', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: 'rent', dr: 100, cr: 0 }],
    });
    const view = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08' }, { userId: 'u1' });
    const csv = await svc(prisma).exportCsv(TENANT, 'acc-1', { periodCode: '2026-08' }, { userId: 'u1' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('entryDate,journalNumber,source,store,dept,controlNumber,applyNumber,memo,dr,cr,runningBalance');
    expect(lines[1]).toBe('2026-08-05,JE-0001,GJ,store-1,,,,rent,100,0,600');
    expect(lines[1]).toContain(String(view.lines[0].runningBalance));

    expect(prisma._audits.filter((a: any) => a.action === 'EXPORTED')).toHaveLength(1);
    // Export computes independently of getActivity and must not also emit a
    // spurious VIEWED event — exactly one VIEWED (from the getActivity call
    // above) and one EXPORTED (from exportCsv), not two VIEWEDs.
    expect(prisma._audits.filter((a: any) => a.action === 'VIEWED')).toHaveLength(1);
  });

  it('handles Prisma Decimal-shaped dr/cr/balanceAfter values (not just plain JS numbers) — regression for a real defect where toCents() silently produced NaN (serialized as null) on non-string/non-number Decimal objects', async () => {
    // Mirrors Prisma's real decimal.js Decimal: no overridden valueOf, so
    // Number(decimalLike) falls back to toString() — exactly the objects
    // toCents() must handle, and exactly what account.test.ts's own dec()
    // fixture already relies on elsewhere in this repo.
    const decimalLike = (n: number) => ({ toString: () => String(n) });
    const prisma = makePrisma({
      accounts: [ACCOUNT],
      periods: [AUG_PERIOD],
      snapshots: [
        { tenantId: TENANT, entityId: ENTITY, accountId: 'acc-1', postedAt: d('2026-07-15'), balanceAfter: decimalLike(500) },
      ],
      entries: [{ id: 'je1', tenantId: TENANT, entityId: ENTITY, journalNumber: 'JE-0001', sourceCode: 'GJ', entryDate: d('2026-08-05'), status: 'POSTED' }],
      lines: [
        { id: 'l1', journalEntryId: 'je1', tenantId: TENANT, lineIndex: 0, accountId: 'acc-1', storeId: 'store-1', deptCode: null, controlNumber: null, applyNumber: null, memo: null, dr: decimalLike(100), cr: decimalLike(0) },
      ],
    });
    const view = await svc(prisma).getActivity(TENANT, 'acc-1', { periodCode: '2026-08' }, { userId: 'u1' });
    expect(view.beginningBalance).toBe(500);
    expect(view.periodDebitActivity).toBe(100);
    expect(view.periodCreditActivity).toBe(0);
    expect(view.endingBalance).toBe(600);
    expect(view.lines[0].runningBalance).toBe(600);
    expect(view.lines[0].dr).toBe(100);
    // None of the numeric fields may silently be NaN/null.
    for (const v of [view.beginningBalance, view.endingBalance, view.periodDebitActivity, view.periodCreditActivity]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
