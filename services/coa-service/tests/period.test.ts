/**
 * S209 — Accounting Period Open & Status unit tests.
 *
 * Strategy (matches S208/S223 precedent): in-memory fake Prisma + fake event
 * publisher + fake ConfigService via tsyringe. Real audit_outbox /
 * coa_outbox_events rows are the Docker runtime evidence.
 *
 * Covers: FUTURE->OPEN transition + event/audit, eligibility API, concurrent-open
 * limit (BR209-2), skip-open warning + confirm (BR209-3), and a named negative
 * test for every 404/422 path in packet §9 + the illegal-transition matrix.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  PeriodService,
  PeriodNotFoundError,
  InvalidTransitionError,
  MaxOpenReachedError,
  PeriodReasonRequiredError,
  HardCloseBlockedByDraftsError,
} from '../src/application/period-service';
import {
  canTransition,
  eligibility,
  detectSkippedPeriods,
  PERIOD_STATUSES,
} from '../src/domain/period-status';

const TENANT = 'tenant-kunes';
const ENTITY = 'a24612ec-d281-4360-a159-9c0debc8610b';
const ACTOR = 'controller-1';

// ── In-memory fakes ────────────────────────────────────────────────────────────

function makePrisma(seed: any[] = []) {
  const periods: any[] = [...seed];
  const audits: any[] = [];
  const outbox: any[] = [];
  const drafts: any[] = [];
  const client: any = {
    _periods: periods,
    _audits: audits,
    _outbox: outbox,
    _drafts: drafts,
    fiscalPeriod: {
      findUnique: async ({ where }: any) => periods.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        periods
          .filter(
            (p) =>
              p.tenantId === where.tenantId &&
              p.entityId === where.entityId &&
              (where.status === undefined || p.status === where.status),
          )
          .sort((a, b) => a.fiscalYear - b.fiscalYear || a.periodNumber - b.periodNumber),
      count: async ({ where }: any) =>
        periods.filter(
          (p) =>
            p.tenantId === where.tenantId &&
            p.entityId === where.entityId &&
            (where.status === undefined || p.status === where.status),
        ).length,
      update: async ({ where, data }: any) => {
        const row = periods.find((p) => p.id === where.id);
        Object.assign(row, data);
        return row;
      },
      // S008 — CAS guard used by applyTransition(): only updates when the row
      // still matches the expected `status` (the concurrency backstop).
      updateMany: async ({ where, data }: any) => {
        const matches = periods.filter(
          (p) =>
            p.id === where.id &&
            p.tenantId === where.tenantId &&
            (where.status === undefined || p.status === where.status),
        );
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
    },
    // S008 — open-draft worklist source (board + findBlockingDrafts).
    manualJeDraft: {
      findMany: async ({ where }: any) =>
        drafts.filter((d) => {
          if (d.tenantId !== where.tenantId) return false;
          if (where.entityId !== undefined && d.entityId !== where.entityId) return false;
          if (where.status?.in && !where.status.in.includes(d.status)) return false;
          if (where.entryDate) {
            if (where.entryDate.not === null && d.entryDate === null) return false;
            if (where.entryDate.gte && !(d.entryDate && d.entryDate >= where.entryDate.gte)) return false;
            if (where.entryDate.lte && !(d.entryDate && d.entryDate <= where.entryDate.lte)) return false;
          }
          return true;
        }),
    },
    // S008 — most-recent transition summary per period (board), sourced from
    // the audit outbox (see period-service.ts board() comment: the DB-owned
    // fiscal_period_transition ledger carries no `reason`, so the board reads
    // the S007 audit event instead, matching production behavior exactly).
    auditOutboxEvent: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        audits.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        audits
          .filter(
            (a) =>
              a.tenantId === where.tenantId &&
              a.docType === where.docType &&
              (!where.docId?.in || where.docId.in.includes(a.docId)),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    $executeRawUnsafe: async () => undefined,
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;

}

function makeEvents() {
  const published: any[] = [];
  return { published, publish: async (e: any) => void published.push(e) };
}

function makeConfig(maxOpen = 2) {
  return {
    resolve: async ({ key }: any) => ({
      key,
      type: 'INT',
      value: String(maxOpen),
      resolvedScope: 'DEFAULT',
    }),
  };
}

let periodSeq = 0;
function period(overrides: Partial<any> = {}) {
  periodSeq += 1;
  const n = overrides.periodNumber ?? periodSeq;
  return {
    id: overrides.id ?? `p-${n}`,
    tenantId: TENANT,
    entityId: ENTITY,
    calendarId: 'cal-1',
    fiscalYear: 2026,
    periodNumber: n,
    code: `2026-${String(n).padStart(2, '0')}`,
    startDate: new Date(`2026-${String(n).padStart(2, '0')}-01`),
    endDate: new Date(`2026-${String(n).padStart(2, '0')}-28`),
    status: 'FUTURE',
    adjustmentsOnly: false,
    hasPostings: false,
    openedBy: null,
    openedAt: null,
    ...overrides,
  };
}

function setup(seed: any[], maxOpen = 2) {
  container.reset();
  const prisma = makePrisma(seed);
  const events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('ConfigService', makeConfig(maxOpen) as any);
  container.register('PeriodService', { useClass: PeriodService });
  const svc = container.resolve<PeriodService>('PeriodService');
  return { svc, prisma, events };
}

// ── Pure domain ─────────────────────────────────────────────────────────────────

describe('S209 domain — status vocabulary + transitions', () => {
  it('ships the full status enum for S013', () => {
    expect(PERIOD_STATUSES).toEqual(['FUTURE', 'OPEN', 'SOFT_CLOSED', 'HARD_CLOSED', 'LOCKED']);
  });

  it('the full S008 6-pair transition allowlist is legal; everything else is not', () => {
    expect(canTransition('FUTURE', 'OPEN')).toBe(true);
    expect(canTransition('OPEN', 'SOFT_CLOSED')).toBe(true);
    expect(canTransition('SOFT_CLOSED', 'OPEN')).toBe(true);
    expect(canTransition('SOFT_CLOSED', 'HARD_CLOSED')).toBe(true);
    expect(canTransition('HARD_CLOSED', 'OPEN')).toBe(true);
    expect(canTransition('HARD_CLOSED', 'LOCKED')).toBe(true);
    // LOCKED is terminal in S008 v1 -- no transition out, including back to OPEN.
    expect(canTransition('LOCKED', 'OPEN')).toBe(false);
    expect(canTransition('FUTURE', 'LOCKED')).toBe(false);
    expect(canTransition('OPEN', 'HARD_CLOSED')).toBe(false);
    expect(canTransition('FUTURE', 'SOFT_CLOSED')).toBe(false);
  });

  it('eligibility is postable only when OPEN', () => {
    expect(eligibility('OPEN')).toMatchObject({ postable: true });
    expect(eligibility('FUTURE').postable).toBe(false);
    expect(eligibility('HARD_CLOSED').postable).toBe(false);
  });

  it('detectSkippedPeriods finds earlier FUTURE non-adjustment periods', () => {
    const all = [
      { code: '2026-01', fiscalYear: 2026, periodNumber: 1, status: 'FUTURE' as const, adjustmentsOnly: false },
      { code: '2026-02', fiscalYear: 2026, periodNumber: 2, status: 'FUTURE' as const, adjustmentsOnly: false },
    ];
    const skipped = detectSkippedPeriods({ fiscalYear: 2026, periodNumber: 2, status: 'FUTURE', adjustmentsOnly: false }, all);
    expect(skipped).toEqual(['2026-01']);
  });
});

// ── Service ─────────────────────────────────────────────────────────────────────

describe('S209 service — open + board + eligibility', () => {
  it('opens a FUTURE period -> OPEN, emits fiscal.period.opened + audits', async () => {
    const { svc, prisma, events } = setup([period({ id: 'p-1', periodNumber: 1 })]);
    const r = await svc.open({ tenantId: TENANT, periodId: 'p-1', actor: ACTOR });
    expect(r).toMatchObject({ opened: true, status: 'OPEN' });
    expect(prisma._periods[0].openedBy).toBe(ACTOR);
    const evt = events.published.find((e) => e.type === 'fiscal.period.opened');
    expect(evt.payload).toMatchObject({ entityId: ENTITY, periodCode: '2026-01', schemaV: 1 });
    expect(prisma._audits.some((a) => a.docType === 'fiscal_period' && a.action === 'OPEN')).toBe(true);
    expect(prisma._outbox.some((o) => o.eventType === 'fiscal.period.opened')).toBe(true);
  });

  it('eligibility reports postable for OPEN, ineligible+reason otherwise', async () => {
    const { svc } = setup([
      period({ id: 'p-1', periodNumber: 1, status: 'OPEN' }),
      period({ id: 'p-2', periodNumber: 2, status: 'FUTURE' }),
    ]);
    expect(await svc.eligibility(TENANT, 'p-1')).toMatchObject({ postable: true });
    const f = await svc.eligibility(TENANT, 'p-2');
    expect(f.postable).toBe(false);
    expect(f.reason).toMatch(/FUTURE/);
  });

  it('board lists all periods with status', async () => {
    const { svc } = setup([
      period({ id: 'p-1', periodNumber: 1, status: 'OPEN' }),
      period({ id: 'p-2', periodNumber: 2 }),
    ]);
    const board = await svc.board(TENANT, ENTITY);
    expect(board).toHaveLength(2);
    expect(board[0]).toMatchObject({ periodCode: '2026-01', status: 'OPEN' });
  });

  it('idempotent: opening an already-open period is a no-op success', async () => {
    const { svc, events } = setup([period({ id: 'p-1', periodNumber: 1, status: 'OPEN' })]);
    const r = await svc.open({ tenantId: TENANT, periodId: 'p-1', actor: ACTOR });
    expect(r).toMatchObject({ opened: true, status: 'OPEN' });
    expect(events.published).toHaveLength(0); // no new event on no-op
  });
});

// ── Skip-open warning (BR209-3) ─────────────────────────────────────────────────

describe('S209 service — skip-open warning + confirm', () => {
  it('warns (no state change) when an earlier period is still FUTURE', async () => {
    const { svc, prisma } = setup([
      period({ id: 'p-1', periodNumber: 1, status: 'FUTURE' }),
      period({ id: 'p-2', periodNumber: 2, status: 'FUTURE' }),
    ]);
    const r = await svc.open({ tenantId: TENANT, periodId: 'p-2', actor: ACTOR });
    expect(r).toMatchObject({ opened: false, requiresConfirmation: true, warning: 'SKIP_OPEN' });
    expect(r.skippedPeriods).toEqual(['2026-01']);
    expect(prisma._periods[1].status).toBe('FUTURE'); // unchanged
  });

  it('confirm=true opens past the skip warning', async () => {
    const { svc, prisma } = setup([
      period({ id: 'p-1', periodNumber: 1, status: 'FUTURE' }),
      period({ id: 'p-2', periodNumber: 2, status: 'FUTURE' }),
    ]);
    const r = await svc.open({ tenantId: TENANT, periodId: 'p-2', actor: ACTOR, confirm: true });
    expect(r.opened).toBe(true);
    expect(prisma._periods[1].status).toBe('OPEN');
  });
});

// ── Named negatives (packet §9 + transition matrix) ─────────────────────────────

describe('S209 service — negative paths', () => {
  it('422 MAX_OPEN_REACHED when the concurrent-open limit is hit (BR209-2)', async () => {
    const { svc } = setup(
      [
        period({ id: 'p-1', periodNumber: 1, status: 'OPEN' }),
        period({ id: 'p-2', periodNumber: 2, status: 'OPEN' }),
        period({ id: 'p-3', periodNumber: 3, status: 'FUTURE' }),
      ],
      2,
    );
    await expect(
      svc.open({ tenantId: TENANT, periodId: 'p-3', actor: ACTOR, confirm: true }),
    ).rejects.toBeInstanceOf(MaxOpenReachedError);
  });

  it('404 PERIOD_NOT_FOUND when opening a nonexistent period', async () => {
    const { svc } = setup([]);
    await expect(
      svc.open({ tenantId: TENANT, periodId: 'nope', actor: ACTOR }),
    ).rejects.toBeInstanceOf(PeriodNotFoundError);
  });

  it('422 INVALID_TRANSITION when opening a non-FUTURE (e.g. LOCKED) period', async () => {
    const { svc } = setup([period({ id: 'p-1', periodNumber: 1, status: 'LOCKED' })]);
    await expect(
      svc.open({ tenantId: TENANT, periodId: 'p-1', actor: ACTOR }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('tenant isolation: another tenant cannot open the period', async () => {
    const { svc } = setup([period({ id: 'p-1', periodNumber: 1 })]);
    await expect(
      svc.open({ tenantId: 'tenant-other', periodId: 'p-1', actor: ACTOR }),
    ).rejects.toBeInstanceOf(PeriodNotFoundError);
  });
});

// ── S008 — close / reopen / lock lifecycle ──────────────────────────────────────

function draft(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? `d-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: TENANT,
    entityId: ENTITY,
    preparer: overrides.preparer ?? 't.chen',
    status: overrides.status ?? 'DRAFT',
    entryDate: overrides.entryDate ?? new Date('2026-08-15'),
    lines: overrides.lines ?? [{ dr: '450.00', cr: null }, { dr: null, cr: '450.00' }],
    ...overrides,
  };
}

describe('S008 service — soft-close (OPEN -> SOFT_CLOSED)', () => {
  it('soft-closes an OPEN period with a reason, writes the transition audit', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'OPEN' })]);
    const r = await svc.softClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'ops cutoff' });
    expect(r).toMatchObject({ transitioned: true, status: 'SOFT_CLOSED' });
    expect(prisma._periods[0].status).toBe('SOFT_CLOSED');
    expect(prisma._audits.some((a) => a.action === 'SOFT_CLOSE')).toBe(true);
  });

  it('400 PERIOD_REASON_REQUIRED when no reason is supplied', async () => {
    const { svc } = setup([period({ id: 'p-8', periodNumber: 8, status: 'OPEN' })]);
    await expect(
      svc.softClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: '   ' }),
    ).rejects.toBeInstanceOf(PeriodReasonRequiredError);
  });

  it('422 INVALID_TRANSITION when soft-closing a FUTURE period', async () => {
    const { svc } = setup([period({ id: 'p-8', periodNumber: 8, status: 'FUTURE' })]);
    await expect(
      svc.softClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'x' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('idempotent: soft-closing an already SOFT_CLOSED period is a no-op success', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'SOFT_CLOSED' })]);
    const r = await svc.softClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'x' });
    expect(r).toMatchObject({ transitioned: true, status: 'SOFT_CLOSED' });
    expect(prisma._audits).toHaveLength(0);
  });
});

describe('S008 service — hard-close (SOFT_CLOSED -> HARD_CLOSED) + drafts block (AC008-4)', () => {
  it('hard-closes a SOFT_CLOSED period with zero blocking drafts', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'SOFT_CLOSED' })]);
    const r = await svc.hardClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'month locked' });
    expect(r).toMatchObject({ transitioned: true, status: 'HARD_CLOSED' });
    expect(prisma._periods[0].status).toBe('HARD_CLOSED');
  });

  it('422 HARD_CLOSE_BLOCKED_BY_DRAFTS lists each in-period open draft (id, date, amount, preparer)', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'SOFT_CLOSED' })]);
    prisma._drafts.push(
      draft({ id: 'd-1', status: 'DRAFT', entryDate: new Date('2026-08-10'), preparer: 't.chen', lines: [{ dr: '450.00' }] }),
      draft({ id: 'd-2', status: 'VALIDATED', entryDate: new Date('2026-08-20'), preparer: 'm.rivera', lines: [{ dr: '86.40' }] }),
      // out-of-period + already-posted/voided drafts must NOT block:
      draft({ id: 'd-3', status: 'DRAFT', entryDate: new Date('2026-09-05') }),
      draft({ id: 'd-4', status: 'POSTED_LINKED', entryDate: new Date('2026-08-11') }),
      draft({ id: 'd-5', status: 'VOIDED', entryDate: new Date('2026-08-12') }),
    );
    try {
      await svc.hardClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'x' });
      throw new Error('expected HardCloseBlockedByDraftsError');
    } catch (err) {
      expect(err).toBeInstanceOf(HardCloseBlockedByDraftsError);
      const blockers = (err as HardCloseBlockedByDraftsError).blockingDrafts;
      expect(blockers.map((b) => b.draftId).sort()).toEqual(['d-1', 'd-2']);
      expect(blockers.find((b) => b.draftId === 'd-1')).toMatchObject({ amount: '450.00', preparer: 't.chen', entryDate: '2026-08-10' });
      expect(blockers.find((b) => b.draftId === 'd-2')).toMatchObject({ amount: '86.40', preparer: 'm.rivera' });
    }
    expect(prisma._periods[0].status).toBe('SOFT_CLOSED'); // no transition occurred
  });

  it('400 PERIOD_REASON_REQUIRED when hard-closing without a reason', async () => {
    const { svc } = setup([period({ id: 'p-8', periodNumber: 8, status: 'SOFT_CLOSED' })]);
    await expect(
      svc.hardClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR }),
    ).rejects.toBeInstanceOf(PeriodReasonRequiredError);
  });
});

describe('S008 service — reopen (SOFT_CLOSED -> OPEN) + reopen-hard-closed', () => {
  it('reopens a SOFT_CLOSED period with a reason, records it verbatim (AC008-3)', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'SOFT_CLOSED' })]);
    const r = await svc.reopen({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'late vendor invoice #A-118' });
    expect(r).toMatchObject({ transitioned: true, status: 'OPEN' });
    const evt = prisma._audits.find((a) => a.action === 'REOPEN');
    expect(evt.after).toMatchObject({ reason: 'late vendor invoice #A-118' });
  });

  it('reopen refuses a HARD_CLOSED period (must use the elevated reopen-hard-closed path)', async () => {
    const { svc } = setup([period({ id: 'p-8', periodNumber: 8, status: 'HARD_CLOSED' })]);
    await expect(
      svc.reopen({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'x' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('reopen-hard-closed requires explicit confirm before it transitions', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'HARD_CLOSED' })]);
    const pending = await svc.reopenHardClosed({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'audit request' });
    expect(pending).toMatchObject({ transitioned: false, requiresConfirmation: true });
    expect(prisma._periods[0].status).toBe('HARD_CLOSED');
    const done = await svc.reopenHardClosed({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'audit request', confirm: true });
    expect(done).toMatchObject({ transitioned: true, status: 'OPEN' });
  });
});

describe('S008 service — lock (HARD_CLOSED -> LOCKED, terminal)', () => {
  it('requires confirm, then locks; LOCKED is terminal', async () => {
    const { svc, prisma } = setup([period({ id: 'p-8', periodNumber: 8, status: 'HARD_CLOSED' })]);
    const pending = await svc.lock({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'year sealed' });
    expect(pending).toMatchObject({ transitioned: false, requiresConfirmation: true });
    const done = await svc.lock({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'year sealed', confirm: true });
    expect(done).toMatchObject({ transitioned: true, status: 'LOCKED' });
    // Terminal: no further transition (soft/hard/reopen/lock) is legal.
    await expect(
      svc.softClose({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, reason: 'x' }),
    ).rejects.toBeTruthy();
  });

  it('400 PERIOD_REASON_REQUIRED when locking without a reason', async () => {
    const { svc } = setup([period({ id: 'p-8', periodNumber: 8, status: 'HARD_CLOSED' })]);
    await expect(
      svc.lock({ tenantId: TENANT, periodId: 'p-8', actor: ACTOR, confirm: true }),
    ).rejects.toBeInstanceOf(PeriodReasonRequiredError);
  });
});

describe('S008 service — board enrichment (open drafts + last transition)', () => {
  it('reports per-period open-draft counts and the most-recent transition', async () => {
    const { svc, prisma } = setup([
      period({ id: 'p-8', periodNumber: 8, status: 'SOFT_CLOSED' }),
      period({ id: 'p-9', periodNumber: 9, status: 'OPEN' }),
    ]);
    prisma._drafts.push(
      draft({ id: 'd-1', status: 'DRAFT', entryDate: new Date('2026-09-10') }),
      draft({ id: 'd-2', status: 'VALIDATED', entryDate: new Date('2026-09-12') }),
      draft({ id: 'd-3', status: 'VOIDED', entryDate: new Date('2026-09-15') }), // ignored
    );
    prisma._audits.push({
      tenantId: TENANT, docType: 'fiscal_period', docId: 'p-8', action: 'SOFT_CLOSE',
      before: { status: 'OPEN' }, after: { status: 'SOFT_CLOSED', reason: 'ops cutoff' },
      actor: 'm.rivera', createdAt: new Date('2026-09-03T10:00:00Z'),
    });
    const board = await svc.board(TENANT, ENTITY);
    const p9 = board.find((b) => b.periodCode === '2026-09')!;
    const p8 = board.find((b) => b.periodCode === '2026-08')!;
    expect(p9.openDrafts).toBe(2);
    expect(p8.lastTransition).toMatchObject({ toStatus: 'SOFT_CLOSED', reason: 'ops cutoff', actor: 'm.rivera' });
  });
});

