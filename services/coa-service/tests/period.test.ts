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
  const client: any = {
    _periods: periods,
    _audits: audits,
    _outbox: outbox,
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
    },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
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
