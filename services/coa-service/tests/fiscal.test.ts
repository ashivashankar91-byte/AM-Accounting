/**
 * S208 — Fiscal Calendar Definition unit tests.
 *
 * Strategy (matches org-foundation + S223 precedent): inject an in-memory fake
 * Prisma + fake event publisher via tsyringe. The AuditPort stub is exercised
 * through an in-memory recorder here (permitted for unit tests, packet §11/§12);
 * the real audit_outbox / coa_outbox_events tables are written by the Docker
 * runtime transcript, which is the integration evidence.
 *
 * Covers: BR208-2 generation (12 / 12+13), BR208-5 deterministic date resolution
 * incl. leap years and 13th-period exclusion, and a named negative test for every
 * 409/422/404 path in packet §9.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  FiscalCalendarService,
  FiscalValidationError,
  CalendarLockedError,
  FiscalYearOverlapError,
  CalendarNotFoundError,
  PeriodNotFoundError,
} from '../src/application/fiscal-service';
import {
  generatePeriods,
  resolveDate,
  lastDayOfMonth,
} from '../src/domain/fiscal-calendar';

const TENANT = 'tenant-kunes';
const ENTITY = 'a24612ec-d281-4360-a159-9c0debc8610b'; // KUNES legal entity
const ACTOR = 'controller-1';

// ── In-memory fake Prisma ─────────────────────────────────────────────────────

function makePrisma() {
  const calendars: any[] = [];
  const periods: any[] = [];
  const audits: any[] = [];
  const outbox: any[] = [];
  return {
    _calendars: calendars,
    _periods: periods,
    _audits: audits,
    _outbox: outbox,
    fiscalCalendar: {
      findUnique: async ({ where }: any) =>
        calendars.find((c) => c.entityId === where.entityId) ?? null,
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        calendars.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = calendars.find((c) => c.entityId === where.entityId);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    fiscalPeriod: {
      count: async ({ where }: any) =>
        periods.filter(
          (p) =>
            p.entityId === where.entityId &&
            (where.fiscalYear === undefined || p.fiscalYear === where.fiscalYear) &&
            (where.hasPostings === undefined || p.hasPostings === where.hasPostings),
        ).length,
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date() };
        periods.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        periods
          .filter(
            (p) =>
              p.tenantId === where.tenantId &&
              p.entityId === where.entityId &&
              (where.fiscalYear === undefined || p.fiscalYear === where.fiscalYear),
          )
          .sort((a, b) =>
            a.fiscalYear - b.fiscalYear || a.periodNumber - b.periodNumber,
          ),
    },
    auditOutboxEvent: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
    coaOutboxEvent: {
      create: async ({ data }: any) => {
        outbox.push(data);
        return data;
      },
    },
    // Fake $transaction: our service passes an array of already-invoked create
    // promises, so just await them all.
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
  };
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
  container.register('FiscalCalendarService', { useClass: FiscalCalendarService });
  const svc = container.resolve<FiscalCalendarService>('FiscalCalendarService');
  return { svc, prisma, events };
}

// ── Pure domain: generation ────────────────────────────────────────────────────

describe('S208 domain — period generation (BR208-2)', () => {
  it('Jan-start TWELVE yields 12 contiguous monthly periods with correct ranges', () => {
    const ps = generatePeriods(2026, 1, 'TWELVE');
    expect(ps).toHaveLength(12);
    expect(ps[0]).toMatchObject({ periodNumber: 1, code: '2026-01', startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(ps[1]).toMatchObject({ code: '2026-02', endDate: '2026-02-28' }); // 2026 not leap
    expect(ps[11]).toMatchObject({ periodNumber: 12, code: '2026-12', endDate: '2026-12-31' });
  });

  it('Jan-start TWELVE_PLUS_13TH yields 13 periods, 13th adjustments-only', () => {
    const ps = generatePeriods(2026, 1, 'TWELVE_PLUS_13TH');
    expect(ps).toHaveLength(13);
    expect(ps[12]).toMatchObject({ periodNumber: 13, code: '2026-13', adjustmentsOnly: true });
    expect(ps.slice(0, 12).every((p) => !p.adjustmentsOnly)).toBe(true);
  });

  it('leap year: Feb 2028 spans 29 days', () => {
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    const ps = generatePeriods(2028, 1, 'TWELVE');
    expect(ps[1]).toMatchObject({ code: '2028-02', endDate: '2028-02-29' });
  });

  it('July-start crosses the calendar-year boundary correctly', () => {
    const ps = generatePeriods(2026, 7, 'TWELVE');
    expect(ps[0]).toMatchObject({ periodNumber: 1, code: '2026-07' });
    expect(ps[6]).toMatchObject({ periodNumber: 7, code: '2027-01' });
    expect(ps[11]).toMatchObject({ periodNumber: 12, code: '2027-06', endDate: '2027-06-30' });
  });

  it('periods tile the year with no gaps (property)', () => {
    const ps = generatePeriods(2026, 4, 'TWELVE');
    for (let i = 1; i < ps.length; i++) {
      const prevEnd = new Date(`${ps[i - 1]!.endDate}T00:00:00Z`);
      const thisStart = new Date(`${ps[i]!.startDate}T00:00:00Z`);
      expect(thisStart.getTime() - prevEnd.getTime()).toBe(24 * 3600 * 1000); // exactly one day
    }
  });
});

// ── Pure domain: resolution (BR208-5) ───────────────────────────────────────────

describe('S208 domain — date resolution (BR208-5)', () => {
  const ps = generatePeriods(2026, 1, 'TWELVE_PLUS_13TH').map((p) => ({
    code: p.code,
    startDate: p.startDate,
    endDate: p.endDate,
    adjustmentsOnly: p.adjustmentsOnly,
  }));

  it('2026-08-15 resolves to 2026-08', () => {
    expect(resolveDate('2026-08-15', ps)?.code).toBe('2026-08');
  });

  it('month boundaries resolve deterministically (first/last day)', () => {
    expect(resolveDate('2026-03-01', ps)?.code).toBe('2026-03');
    expect(resolveDate('2026-03-31', ps)?.code).toBe('2026-03');
  });

  it('13th period is excluded from date resolution', () => {
    // 2026-12-31 is period 12 end AND the 13th period pin; must resolve to 2026-12.
    expect(resolveDate('2026-12-31', ps)?.code).toBe('2026-12');
  });

  it('out-of-range date resolves to null', () => {
    expect(resolveDate('2025-12-31', ps)).toBeNull();
    expect(resolveDate('2027-01-01', ps)).toBeNull();
  });
});

// ── Service: calendar + generation happy path ───────────────────────────────────

describe('S208 service — define + generate', () => {
  it('defines a calendar (201-create) and audits it', async () => {
    const { svc, prisma } = setup();
    const r = await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE_PLUS_13TH', actor: ACTOR });
    expect(r.created).toBe(true);
    expect(prisma._calendars).toHaveLength(1);
    expect(prisma._audits.some((a) => a.action === 'CREATE' && a.docType === 'fiscal_calendar')).toBe(true);
  });

  it('generates FY2026 (13 periods, all FUTURE) + emits fiscal.year.generated', async () => {
    const { svc, prisma, events } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE_PLUS_13TH', actor: ACTOR });
    const r = await svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR });
    expect(r.periodCount).toBe(13);
    expect(prisma._periods.every((p) => p.status === 'FUTURE')).toBe(true);
    const evt = events.published.find((e) => e.type === 'fiscal.year.generated');
    expect(evt).toBeTruthy();
    expect(evt.payload).toMatchObject({ entityId: ENTITY, fy: 2026, periodCount: 13, schemaV: 1 });
    expect(prisma._outbox.some((o) => o.eventType === 'fiscal.year.generated')).toBe(true);
  });

  it('resolves a live date after generation', async () => {
    const { svc } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', actor: ACTOR });
    await svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR });
    const p = await svc.resolve(TENANT, ENTITY, '2026-08-15');
    expect(p.code).toBe('2026-08');
  });

  it('allows structure change before any postings (update path, 200)', async () => {
    const { svc } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', actor: ACTOR });
    const r = await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 4, structure: 'TWELVE_PLUS_13TH', actor: ACTOR });
    expect(r.created).toBe(false);
    expect(r.calendar.structure).toBe('TWELVE_PLUS_13TH');
    expect(r.calendar.fyStartMonth).toBe(4);
  });
});

// ── Service: named negatives (packet §9) ────────────────────────────────────────

describe('S208 service — negative paths', () => {
  it('422 INVALID_STRUCTURE on bad structure', async () => {
    const { svc } = setup();
    await expect(
      svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'FOURTEEN' as any, actor: ACTOR }),
    ).rejects.toBeInstanceOf(FiscalValidationError);
  });

  it('422 INVALID_START_MONTH on month out of 1-12', async () => {
    const { svc } = setup();
    await expect(
      svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 13, structure: 'TWELVE', actor: ACTOR }),
    ).rejects.toBeInstanceOf(FiscalValidationError);
  });

  it('409 FISCAL_YEAR_OVERLAP when regenerating an existing year', async () => {
    const { svc } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', actor: ACTOR });
    await svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR });
    await expect(
      svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR }),
    ).rejects.toBeInstanceOf(FiscalYearOverlapError);
  });

  it('422 CALENDAR_LOCKED on structure change after a period has postings (BR208-4)', async () => {
    const { svc, prisma } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', actor: ACTOR });
    await svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR });
    // Simulate a posting having landed in a generated period.
    prisma._periods[0].hasPostings = true;
    await expect(
      svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 4, structure: 'TWELVE_PLUS_13TH', actor: ACTOR }),
    ).rejects.toBeInstanceOf(CalendarLockedError);
  });

  it('404 CALENDAR_NOT_FOUND when generating without a calendar', async () => {
    const { svc } = setup();
    await expect(
      svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR }),
    ).rejects.toBeInstanceOf(CalendarNotFoundError);
  });

  it('404 PERIOD_NOT_FOUND when resolving an ungenerated date', async () => {
    const { svc } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', actor: ACTOR });
    await svc.generateYear({ tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, actor: ACTOR });
    await expect(svc.resolve(TENANT, ENTITY, '2030-05-05')).rejects.toBeInstanceOf(PeriodNotFoundError);
  });

  it('tenant isolation: other tenant cannot read the calendar', async () => {
    const { svc } = setup();
    await svc.defineCalendar({ tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', actor: ACTOR });
    await expect(svc.getCalendar('tenant-other', ENTITY)).rejects.toBeInstanceOf(CalendarNotFoundError);
  });
});
