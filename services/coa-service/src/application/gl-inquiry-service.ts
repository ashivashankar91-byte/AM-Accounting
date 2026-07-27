import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import { AccountService, AccountNotFoundError } from './account-service';
import { balanceDelta, toCents, centsToDollars } from '../domain/journal-posting';

export { AccountNotFoundError };

// ── Errors ───────────────────────────────────────────────────────────────────

/** No date-range selector supplied — fail closed rather than guess a default. */
export class RangeRequiredError extends Error {
  readonly status = 400;
  readonly code = 'RANGE_REQUIRED';
  constructor() {
    super('Exactly one of periodCode, preset or (startDate & endDate) is required.');
    this.name = 'RangeRequiredError';
  }
}

/** More than one range selector supplied — ambiguous, do not silently pick one. */
export class RangeConflictError extends Error {
  readonly status = 400;
  readonly code = 'RANGE_CONFLICT';
  constructor() {
    super('Only one of periodCode, preset or (startDate & endDate) may be supplied.');
    this.name = 'RangeConflictError';
  }
}

/** startDate/endDate supplied but malformed or inverted. */
export class InvalidRangeError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_RANGE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRangeError';
  }
}

/**
 * Unknown fiscal period code, or `preset=OPEN_MONTH` requested for an entity
 * with no currently OPEN period. Only OPEN_MONTH is implemented here — the
 * approved Story Contract names "12 presets incl. OPEN_MONTH" but leaves the
 * remaining 11 preset names as an open SME-confirmation question (not
 * DoR-blocking). Inventing 11 unconfirmed names would violate the
 * zero-fabrication mandate, so only the one explicitly named preset
 * (OPEN_MONTH) plus explicit start/end dates and periodCode are implemented;
 * this is a documented, known gap, not a silent omission.
 */
export class UnknownPresetError extends Error {
  readonly status = 400;
  readonly code = 'UNKNOWN_PRESET';
  constructor(preset: string) {
    super(
      `Unsupported preset "${preset}". Only "OPEN_MONTH" is implemented pending SME ` +
        `confirmation of the full preset list (Story Contract field 22, S220).`,
    );
    this.name = 'UnknownPresetError';
  }
}

export class PeriodNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'PERIOD_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'PeriodNotFoundError';
  }
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface InquiryFilters {
  periodCode?: string;
  preset?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  storeId?: string;
  deptCode?: string;
  page?: number;
  pageSize?: number;
}

export interface ActivityLineView {
  journalEntryId: string;
  journalNumber: string; // BR220-2 — drill-down key into S217 GET /journals/:number
  entryDate: string; // YYYY-MM-DD
  source: string;
  store: string;
  dept: string | null;
  controlNumber: string | null;
  applyNumber: string | null;
  memo: string | null;
  dr: number;
  cr: number;
  runningBalance: number;
}

export interface AccountActivityView {
  account: {
    id: string;
    accountNumber: string;
    name: string;
    normalBalance: string;
    entityId: string;
  };
  range: { startDate: string; endDate: string; periodCode: string | null; preset: string | null };
  filters: { storeId: string | null; deptCode: string | null };
  beginningBalance: number;
  endingBalance: number; // BR220-1 — provably beginningBalance + sum(lines)
  periodDebitActivity: number;
  periodCreditActivity: number;
  lines: ActivityLineView[];
  pagination: { page: number; pageSize: number; totalLines: number; totalPages: number };
}

export interface InquiryActor {
  userId: string;
  role?: string;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

@injectable()
export class GLInquiryService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('AccountService') private readonly accounts: AccountService,
  ) {}

  /**
   * S220 — beginning balance, chronological period activity (with running
   * balance) and ending balance for one GL account, optionally scoped to a
   * store/department. BR220-4: source = every posted JournalLine (via S013);
   * a JournalEntry.status of REVERSED does not exclude it — reversal creates
   * a NEW linked entry (S218) rather than mutating history (BR013-7), so
   * both the original and its reversal remain real, permanent ledger effects
   * that must both be counted.
   */
  async getActivity(
    tenantId: string,
    accountId: string,
    filters: InquiryFilters,
    actor: InquiryActor,
  ): Promise<AccountActivityView> {
    const view = await this.computeActivity(tenantId, accountId, filters);
    await this.emitAudited(tenantId, view.account.id, 'VIEWED', actor, view.range, view.filters);
    return view;
  }

  private async computeActivity(
    tenantId: string,
    accountId: string,
    filters: InquiryFilters,
  ): Promise<AccountActivityView> {
    const account = await this.accounts.get(tenantId, accountId);
    const { startDate, endDate, periodCode, preset } = await this.resolveRange(tenantId, account.entityId, filters);
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const beginningBalance = await this.computeBeginningBalance(
      tenantId,
      account.entityId,
      accountId,
      account.normalBalance,
      startDate,
      filters.storeId,
      filters.deptCode,
    );

    const rows = await this.prisma.journalLine.findMany({
      where: {
        tenantId,
        accountId,
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.deptCode ? { deptCode: filters.deptCode } : {}),
        entry: {
          tenantId,
          entityId: account.entityId,
          entryDate: { gte: new Date(startDate), lte: new Date(endDate) },
        },
      },
      include: { entry: true },
      orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { journalNumber: 'asc' } }, { lineIndex: 'asc' }],
    });

    // Running balance must be computed over the FULL chronological set before
    // pagination slices it — a page boundary must never change the balance
    // math (BR220-1's foot/cross-foot proof holds across the whole range,
    // not per-page).
    let running = beginningBalance;
    let periodDebitCents = 0;
    let periodCreditCents = 0;
    const allLines: ActivityLineView[] = rows.map((l) => {
      const drCents = toCents(Number(l.dr));
      const crCents = toCents(Number(l.cr));
      periodDebitCents += drCents;
      periodCreditCents += crCents;
      running = centsToDollars(toCents(running) + toCents(balanceDelta(account.normalBalance, drCents, crCents)));
      return {
        journalEntryId: l.entry.id,
        journalNumber: l.entry.journalNumber,
        entryDate: l.entry.entryDate.toISOString().slice(0, 10),
        source: l.entry.sourceCode,
        store: l.storeId,
        dept: l.deptCode ?? null,
        controlNumber: l.controlNumber ?? null,
        applyNumber: l.applyNumber ?? null,
        memo: l.memo ?? null,
        dr: Number(l.dr),
        cr: Number(l.cr),
        runningBalance: running,
      };
    });

    // BR220-1 — provable: ending = beginning + sum(lines), independent of
    // the per-line running-balance loop above (a second, independent path).
    const endingBalance = centsToDollars(
      toCents(beginningBalance) + toCents(balanceDelta(account.normalBalance, periodDebitCents, periodCreditCents)),
    );

    const totalLines = allLines.length;
    const start = (page - 1) * pageSize;
    const pageLines = allLines.slice(start, start + pageSize);

    const view: AccountActivityView = {
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        name: account.name,
        normalBalance: account.normalBalance,
        entityId: account.entityId,
      },
      range: { startDate, endDate, periodCode: periodCode ?? null, preset: preset ?? null },
      filters: { storeId: filters.storeId ?? null, deptCode: filters.deptCode ?? null },
      beginningBalance,
      endingBalance,
      periodDebitActivity: centsToDollars(periodDebitCents),
      periodCreditActivity: centsToDollars(periodCreditCents),
      lines: pageLines,
      pagination: { page, pageSize, totalLines, totalPages: Math.max(1, Math.ceil(totalLines / pageSize)) },
    };

    return view;
  }

  /**
   * BR220-3 — CSV export must match the screen exactly, so it reuses the
   * identical computation (unpaginated) rather than a parallel query path.
   * Emits exactly one EXPORTED audit event (not also a VIEWED one — export
   * is its own distinct action, not a view followed by an export).
   */
  async exportCsv(
    tenantId: string,
    accountId: string,
    filters: InquiryFilters,
    actor: InquiryActor,
  ): Promise<string> {
    const full = await this.computeActivity(tenantId, accountId, { ...filters, page: 1, pageSize: Number.MAX_SAFE_INTEGER });
    const header = [
      'entryDate',
      'journalNumber',
      'source',
      'store',
      'dept',
      'controlNumber',
      'applyNumber',
      'memo',
      'dr',
      'cr',
      'runningBalance',
    ].join(',');
    const csvEscape = (v: string | number | null) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = full.lines.map((l) =>
      [
        l.entryDate,
        l.journalNumber,
        l.source,
        l.store,
        l.dept,
        l.controlNumber,
        l.applyNumber,
        l.memo,
        l.dr,
        l.cr,
        l.runningBalance,
      ]
        .map(csvEscape)
        .join(','),
    );
    await this.emitAudited(tenantId, accountId, 'EXPORTED', actor, full.range, full.filters);
    return [header, ...rows].join('\n');
  }

  // ── Beginning balance ───────────────────────────────────────────────────────

  private async computeBeginningBalance(
    tenantId: string,
    entityId: string,
    accountId: string,
    normalBalance: string,
    startDate: string,
    storeId?: string,
    deptCode?: string,
  ): Promise<number> {
    if (!storeId && !deptCode) {
      // Fast path: BalanceSnapshot is one row per (journalEntry x account),
      // already aggregated to the account's running normal-balance-signed
      // total. Only valid when no store/dept filter narrows below that
      // aggregation grain (see technical note in gl-inquiry-service header).
      const snap = await this.prisma.balanceSnapshot.findFirst({
        where: { tenantId, entityId, accountId, postedAt: { lt: new Date(startDate) } },
        orderBy: { postedAt: 'desc' },
      });
      return snap ? Number(snap.balanceAfter) : 0;
    }

    // Store/dept-filtered path: BalanceSnapshot does not preserve store/dept
    // granularity (it aggregates every line for the account across an entire
    // journal entry), so re-derive from JournalLine directly using the same
    // balanceDelta() domain function the posting engine itself uses.
    const priorLines = await this.prisma.journalLine.findMany({
      where: {
        tenantId,
        accountId,
        ...(storeId ? { storeId } : {}),
        ...(deptCode ? { deptCode } : {}),
        entry: { tenantId, entityId, entryDate: { lt: new Date(startDate) } },
      },
      select: { dr: true, cr: true },
    });
    let drCents = 0;
    let crCents = 0;
    for (const l of priorLines) {
      drCents += toCents(Number(l.dr));
      crCents += toCents(Number(l.cr));
    }
    return balanceDelta(normalBalance, drCents, crCents);
  }

  // ── Range resolution ─────────────────────────────────────────────────────────

  private async resolveRange(
    tenantId: string,
    entityId: string,
    filters: InquiryFilters,
  ): Promise<{ startDate: string; endDate: string; periodCode?: string; preset?: string }> {
    const selectors = [filters.periodCode, filters.preset, filters.startDate || filters.endDate].filter(Boolean);
    if (selectors.length === 0) throw new RangeRequiredError();
    if (selectors.length > 1) throw new RangeConflictError();

    if (filters.periodCode) {
      const period = await this.prisma.fiscalPeriod.findFirst({
        where: { tenantId, entityId, code: filters.periodCode },
      });
      if (!period) throw new PeriodNotFoundError(`No fiscal period "${filters.periodCode}" for this entity.`);
      return {
        startDate: period.startDate.toISOString().slice(0, 10),
        endDate: period.endDate.toISOString().slice(0, 10),
        periodCode: period.code,
      };
    }

    if (filters.preset) {
      if (filters.preset !== 'OPEN_MONTH') throw new UnknownPresetError(filters.preset);
      const period = await this.prisma.fiscalPeriod.findFirst({
        where: { tenantId, entityId, status: 'OPEN' },
        orderBy: { periodNumber: 'desc' },
      });
      if (!period) throw new PeriodNotFoundError('No currently OPEN fiscal period for this entity.');
      return {
        startDate: period.startDate.toISOString().slice(0, 10),
        endDate: period.endDate.toISOString().slice(0, 10),
        periodCode: period.code,
        preset: 'OPEN_MONTH',
      };
    }

    const { startDate, endDate } = filters;
    if (!startDate || !endDate) throw new RangeRequiredError();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new InvalidRangeError('startDate and endDate must be YYYY-MM-DD.');
    }
    if (startDate > endDate) throw new InvalidRangeError('startDate must not be after endDate.');
    return { startDate, endDate };
  }

  // ── S007 audit (view/export) ────────────────────────────────────────────────
  // Unlike S217's masked-role-only audit.viewed, the PO-approved outcomes for
  // S220 require a real audit event on EVERY view/export, not conditionally —
  // GL Inquiry exposes account totals across the full ledger, treated the
  // same as S224's unconditional audit.viewed for document history views.

  private async emitAudited(
    tenantId: string,
    accountId: string,
    action: 'VIEWED' | 'EXPORTED',
    actor: InquiryActor,
    range: { startDate: string; endDate: string; periodCode: string | null; preset: string | null },
    filters: { storeId: string | null; deptCode: string | null },
  ): Promise<void> {
    const payload = {
      eventId: crypto.randomUUID(),
      tenantId,
      accountId,
      action,
      viewedBy: actor.userId,
      role: actor.role ?? null,
      range,
      filters,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    const eventType = action === 'VIEWED' ? 'audit.viewed' : 'audit.exported';
    // BR7-1 — the audit write must be transactionally coupled to the domain
    // outbox write (see journal-view-service.ts precedent / S007 checkpoint).
    await this.prisma.$transaction(async (tx) => {
      await tx.coaOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId: accountId, payload: payload as any },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'GL_ACCOUNT_INQUIRY',
          docId: accountId,
          action,
          before: null as any,
          after: payload as any,
          actor: actor.userId,
        },
      });
    });
    try {
      await this.events.publish({
        type: eventType,
        tenantId,
        payload,
        occurredAt: new Date().toISOString(),
        correlationId: accountId,
      } as any);
    } catch {
      /* outbox row already durable */
    }
  }
}
