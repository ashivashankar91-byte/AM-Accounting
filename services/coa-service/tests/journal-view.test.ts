/**
 * S217 — View Journal Entry. Proves a posted JE is fully inspectable by number:
 * header, lines, source, poster, timestamps, attachments and reversal linkage in
 * BOTH directions (BR217-3). Covers the immutability badge (BR217-2), field masking
 * for masked roles + the audit.viewed PII event (BR217-1 / §9), tenant scoping, and
 * the §3 negative path (unknown number -> 404 with a search suggestion).
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { JournalViewService, JournalNotFoundError } from '../src/application/journal-view-service';

const TENANT = 'tenant-kunes';
const ENTITY = 'e1';

function d(iso: string) {
  return new Date(iso);
}

/** Minimal in-memory Prisma double covering only what the view service touches. */
function makePrisma(seed: {
  entries?: any[];
  lines?: any[];
  attachments?: any[];
} = {}) {
  const entries: any[] = seed.entries ?? [];
  const lines: any[] = seed.lines ?? [];
  const attachments: any[] = seed.attachments ?? [];
  const outbox: any[] = [];
  const audits: any[] = [];

  const prisma: any = {
    _outbox: outbox,
    _audits: audits,
    journalEntry: {
      findFirst: async ({ where, select }: any) => {
        let rows = entries.filter((e) => {
          if (where.tenantId && e.tenantId !== where.tenantId) return false;
          if (where.id && e.id !== where.id) return false;
          if (where.journalNumber && typeof where.journalNumber === 'string' && e.journalNumber !== where.journalNumber) return false;
          return true;
        });
        const e = rows[0];
        if (!e) return null;
        return select ? pick(e, select) : { ...e };
      },
      findMany: async ({ where, select, take }: any) => {
        let rows = entries.filter((e) => {
          if (where.tenantId && e.tenantId !== where.tenantId) return false;
          if (where.journalNumber?.startsWith && !e.journalNumber.startsWith(where.journalNumber.startsWith)) return false;
          return true;
        });
        rows = rows.sort((a, b) => a.journalNumber.localeCompare(b.journalNumber));
        if (take) rows = rows.slice(0, take);
        return rows.map((e) => (select ? pick(e, select) : { ...e }));
      },
    },
    journalLine: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = lines.filter((l) => l.journalEntryId === where.journalEntryId && l.tenantId === where.tenantId);
        if (orderBy?.lineIndex === 'asc') rows = rows.sort((a, b) => a.lineIndex - b.lineIndex);
        return rows.map((l) => ({ ...l }));
      },
    },
    attachment: {
      findMany: async ({ where }: any) =>
        attachments.filter((a) => a.tenantId === where.tenantId && a.draftId === where.draftId).map((a) => ({ ...a })),
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
  };
  return prisma;
}

function pick(obj: any, select: Record<string, boolean>) {
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = obj[k];
  return out;
}

const noopEvents = { publish: async () => {} } as any;

function entry(over: Partial<any> = {}) {
  return {
    id: 'je-1',
    tenantId: TENANT,
    entityId: ENTITY,
    journalNumber: 'GJ-2026-01-000001',
    sourceCode: 'GJ',
    periodId: 'p1',
    periodCode: '2026-01',
    entryDate: d('2026-01-15T00:00:00.000Z'),
    memo: 'january accrual',
    status: 'POSTED',
    idempotencyKey: 'k1',
    totalDebits: 250,
    totalCredits: 250,
    reversalOf: null,
    reversedBy: null,
    reversalReason: null,
    draftId: null,
    postedBy: 'alice',
    postedAt: d('2026-01-15T12:00:00.000Z'),
    ...over,
  };
}

describe('S217 — View Journal Entry', () => {
  it('BR217-2: renders full header + lines with the immutability badge (unmasked role)', async () => {
    const prisma = makePrisma({
      entries: [entry()],
      lines: [
        { id: 'l0', journalEntryId: 'je-1', tenantId: TENANT, lineIndex: 0, accountNumber: '10000', storeId: '01', deptCode: null, dr: 250, cr: 0, memo: null },
        { id: 'l1', journalEntryId: 'je-1', tenantId: TENANT, lineIndex: 1, accountNumber: '49000', storeId: '01', deptCode: 'SVC', dr: 0, cr: 250, memo: 'svc rev' },
      ],
    });
    const svc = new JournalViewService(prisma, noopEvents);

    const v = await svc.view(TENANT, 'GJ-2026-01-000001', { userId: 'admin', role: 'ADMIN' });

    expect(v.journalNumber).toBe('GJ-2026-01-000001');
    expect(v.source).toBe('GJ');
    expect(v.periodCode).toBe('2026-01');
    expect(v.postedBy).toBe('alice');
    expect(v.memo).toBe('january accrual');
    expect(v.immutable).toBe(true); // BR217-2
    expect(v.entryDate).toBe('2026-01-15');
    expect(v.totalDebits).toBe(250);
    expect(v.totalCredits).toBe(250);
    expect(v.lines).toHaveLength(2);
    expect(v.lines[0]).toMatchObject({ lineIndex: 0, account: '10000', store: '01', dr: 250, cr: 0 });
    expect(v.lines[1]).toMatchObject({ account: '49000', dept: 'SVC', cr: 250 });
    expect(v.maskedFields).toBeUndefined();
    expect(prisma._outbox).toHaveLength(0); // no audit.viewed for unmasked role
  });

  it('BR217-3: reversal linkage is navigable in both directions', async () => {
    const original = entry({ id: 'je-orig', journalNumber: 'GJ-2026-01-000001', reversedBy: 'je-rev', status: 'REVERSED' });
    const reversal = entry({ id: 'je-rev', journalNumber: 'GJ-2026-01-000002', reversalOf: 'je-orig', reversalReason: 'keyed wrong' });
    const prisma = makePrisma({ entries: [original, reversal] });
    const svc = new JournalViewService(prisma, noopEvents);

    const vOrig = await svc.view(TENANT, 'GJ-2026-01-000001', { userId: 'admin', role: 'ADMIN' });
    expect(vOrig.reversedBy).toEqual({ id: 'je-rev', journalNumber: 'GJ-2026-01-000002' });
    expect(vOrig.reversalOf).toBeUndefined();

    const vRev = await svc.view(TENANT, 'GJ-2026-01-000002', { userId: 'admin', role: 'ADMIN' });
    expect(vRev.reversalOf).toEqual({ id: 'je-orig', journalNumber: 'GJ-2026-01-000001' });
    expect(vRev.reversedBy).toBeUndefined();
  });

  it('BR217-1: masked role hides PII (postedBy absent) and emits audit.viewed', async () => {
    const prisma = makePrisma({ entries: [entry()] });
    const svc = new JournalViewService(prisma, noopEvents);

    const v = await svc.view(TENANT, 'GJ-2026-01-000001', { userId: 'clerk-bob', role: 'CLERK' });

    expect('postedBy' in v).toBe(false); // masked field ABSENT, not nulled
    expect(v.maskedFields).toEqual(['postedBy']);
    expect(v.memo).toBe('january accrual'); // non-masked field still present

    // §9 — audit.viewed event + PII-access audit record
    expect(prisma._outbox).toHaveLength(1);
    expect(prisma._outbox[0].eventType).toBe('audit.viewed');
    expect(prisma._outbox[0].payload.viewedBy).toBe('clerk-bob');
    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0]).toMatchObject({ docType: 'JOURNAL_ENTRY', action: 'VIEWED', actor: 'clerk-bob' });
  });

  it('surfaces attachments carried by the originating draft', async () => {
    const prisma = makePrisma({
      entries: [entry({ draftId: 'draft-9' })],
      attachments: [
        { id: 'att-1', tenantId: TENANT, draftId: 'draft-9', fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: BigInt(1234), createdAt: d('2026-01-15T11:00:00Z') },
      ],
    });
    const svc = new JournalViewService(prisma, noopEvents);

    const v = await svc.view(TENANT, 'GJ-2026-01-000001', { userId: 'admin', role: 'ADMIN' });
    expect(v.attachments).toEqual([{ id: 'att-1', fileName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 1234 }]);
  });

  it('§3 negative: unknown number -> 404 with a search suggestion (sibling matches)', async () => {
    const prisma = makePrisma({
      entries: [
        entry({ id: 'a', journalNumber: 'GJ-2026-01-000001' }),
        entry({ id: 'b', journalNumber: 'GJ-2026-01-000002' }),
      ],
    });
    const svc = new JournalViewService(prisma, noopEvents);

    await expect(svc.view(TENANT, 'GJ-2026-01-000999', { userId: 'admin', role: 'ADMIN' })).rejects.toMatchObject({
      status: 404,
      code: 'JOURNAL_NOT_FOUND',
    });
    try {
      await svc.view(TENANT, 'GJ-2026-01-000999', { userId: 'admin', role: 'ADMIN' });
    } catch (e) {
      const err = e as JournalNotFoundError;
      expect(err.suggestion.prefix).toBe('GJ-2026-01-');
      expect(err.suggestion.matches).toEqual(['GJ-2026-01-000001', 'GJ-2026-01-000002']);
      expect(err.suggestion.message).toMatch(/Did you mean/);
    }
  });

  it('§3 negative: unknown number with no siblings -> empty suggestion matches', async () => {
    const prisma = makePrisma({ entries: [] });
    const svc = new JournalViewService(prisma, noopEvents);
    try {
      await svc.view(TENANT, 'AD-2026-05-000001', { userId: 'admin', role: 'ADMIN' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as JournalNotFoundError;
      expect(err.suggestion.matches).toEqual([]);
      expect(err.suggestion.message).toMatch(/Search by number/);
    }
  });

  it('tenant scoping: a journal in another tenant is not visible', async () => {
    const prisma = makePrisma({ entries: [entry({ tenantId: 'tenant-other' })] });
    const svc = new JournalViewService(prisma, noopEvents);
    await expect(svc.view(TENANT, 'GJ-2026-01-000001', { userId: 'admin', role: 'ADMIN' })).rejects.toBeInstanceOf(JournalNotFoundError);
  });
});
