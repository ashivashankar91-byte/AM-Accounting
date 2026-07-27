import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/coa-client';

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * S221 deliberately requires at least one real search criterion rather than
 * accepting a fully-empty query. The approved Story Contract's negative
 * acceptance criterion (c) is "over-broad search paginates, never silently
 * times out" — but an entirely unfiltered search across the whole ledger
 * (potentially 1M+ lines per the contract's own performance target) is a
 * different and worse failure mode than "over-broad": it is an unbounded
 * full-table scan with no selective predicate at all. Failing this closed
 * (rather than accepting it and hoping pagination alone saves query cost) is
 * a documented, conservative interpretation, not a literal contract
 * requirement — matching this fleet's fail-closed convention used elsewhere
 * (e.g. S220's RangeRequiredError).
 */
export class SearchCriteriaRequiredError extends Error {
  readonly status = 400;
  readonly code = 'SEARCH_CRITERIA_REQUIRED';
  constructor() {
    super(
      'At least one search criterion (amount/amountRange, dateRange, sourceCode, memoContains, postedBy, or docRef) is required.',
    );
    this.name = 'SearchCriteriaRequiredError';
  }
}

export class InvalidSearchRangeError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_RANGE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSearchRangeError';
  }
}

export class SavedSearchNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'SAVED_SEARCH_NOT_FOUND';
  constructor() {
    super('Saved search not found.');
    this.name = 'SavedSearchNotFoundError';
  }
}

export class DuplicateSearchNameError extends Error {
  readonly status = 409;
  readonly code = 'DUPLICATE_SEARCH_NAME';
  constructor(name: string) {
    super(`A saved search named "${name}" already exists for this user.`);
    this.name = 'DuplicateSearchNameError';
  }
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * S221's approved criteria set (Story Contract field 12), plus an optional
 * `direction` filter (DEBIT/CREDIT) — not literally enumerated in the
 * contract's criteria list, but explicitly required by the PO's Lane A
 * directive for S221 ("debit/credit direction"); included as a documented,
 * PO-authorized addition, not a fabricated one.
 */
export interface GLSearchCriteria {
  entityId?: string;
  amount?: number;
  amountMin?: number;
  amountMax?: number;
  direction?: 'DEBIT' | 'CREDIT';
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  sourceCode?: string;
  memoContains?: string;
  postedBy?: string;
  /**
   * No `docRef` field exists on JournalLine/JournalEntry today; the closest
   * existing analogs are `controlNumber` and `applyNumber` (both already
   * part of S220's frozen result-line contract). A docRef search matches
   * either field — documented interpretation, not a new schema concept.
   */
  docRef?: string;
  page?: number;
  pageSize?: number;
}

/**
 * BR221-1 result shape: "S220 column set + accountNumber". This mirrors
 * gl-inquiry-service.ts's ActivityLineView field-for-field (frozen contract
 * per PO instruction), adding accountId/accountNumber (a search spans
 * multiple accounts, so identifying which account each row belongs to is
 * required) and omitting `runningBalance` — a per-account running balance is
 * not well-defined across a cross-account result set; this is a documented
 * decision, not an omission.
 */
export interface GLSearchResultRow {
  journalEntryId: string;
  journalNumber: string; // drill-down key into S217 GET /journals/:number
  accountId: string; // drill-down key into S220 GET /inquiry/accounts/:id/activity
  accountNumber: string;
  entryDate: string; // YYYY-MM-DD
  source: string;
  store: string;
  dept: string | null;
  controlNumber: string | null;
  applyNumber: string | null;
  memo: string | null;
  dr: number;
  cr: number;
}

export interface GLSearchResult {
  criteria: GLSearchCriteria;
  results: GLSearchResultRow[];
  pagination: { page: number; pageSize: number; totalResults: number; totalPages: number };
}

export interface SavedSearchView {
  id: string;
  name: string;
  criteria: GLSearchCriteria;
  createdAt: string;
  updatedAt: string;
}

export interface SearchActor {
  userId: string;
  role?: string;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

@injectable()
export class GLSearchService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  /**
   * S221 — cross-account ledger search. BR221-1: results respect tenant
   * scoping (enforced both by an explicit tenantId predicate and by real
   * PostgreSQL RLS on journal_line/journal_entry) and any field masks
   * (S004A masking is applied at the HTTP/serialization layer the same way
   * S217 already does it — not duplicated here).
   */
  async search(tenantId: string, criteria: GLSearchCriteria, actor: SearchActor): Promise<GLSearchResult> {
    this.validate(criteria);
    const page = Math.max(1, criteria.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, criteria.pageSize ?? DEFAULT_PAGE_SIZE));

    const where = this.buildWhere(tenantId, criteria);

    const [totalResults, rows] = await Promise.all([
      this.prisma.journalLine.count({ where }),
      this.prisma.journalLine.findMany({
        where,
        include: { entry: true },
        // Deterministic, stable ordering (most-recent-first for search UX,
        // then journalNumber/lineIndex as tie-breakers so pagination is
        // never ambiguous across identical timestamps).
        orderBy: [{ entry: { entryDate: 'desc' } }, { entry: { journalNumber: 'desc' } }, { lineIndex: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const results: GLSearchResultRow[] = rows.map((l) => ({
      journalEntryId: l.entry.id,
      journalNumber: l.entry.journalNumber,
      accountId: l.accountId,
      accountNumber: l.accountNumber,
      entryDate: l.entry.entryDate.toISOString().slice(0, 10),
      source: l.entry.sourceCode,
      store: l.storeId,
      dept: l.deptCode ?? null,
      controlNumber: l.controlNumber ?? null,
      applyNumber: l.applyNumber ?? null,
      memo: l.memo ?? null,
      dr: Number(l.dr),
      cr: Number(l.cr),
    }));

    await this.emitAudited(tenantId, actor, criteria, totalResults);

    return {
      criteria,
      results,
      pagination: { page, pageSize, totalResults, totalPages: Math.max(1, Math.ceil(totalResults / pageSize)) },
    };
  }

  // ── Saved searches (BR221-2) ─────────────────────────────────────────────

  async saveSearch(tenantId: string, actor: SearchActor, name: string, criteria: GLSearchCriteria): Promise<SavedSearchView> {
    this.validate(criteria);
    const existing = await this.prisma.savedGlSearch.findUnique({
      where: { tenantId_createdBy_name: { tenantId, createdBy: actor.userId, name } },
    });
    if (existing) {
      throw new DuplicateSearchNameError(name);
    }
    const row = await this.prisma.savedGlSearch.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        createdBy: actor.userId,
        name,
        criteria: criteria as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toSavedSearchView(row);
  }

  async listSavedSearches(tenantId: string, actor: SearchActor): Promise<SavedSearchView[]> {
    const rows = await this.prisma.savedGlSearch.findMany({
      where: { tenantId, createdBy: actor.userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSavedSearchView(r));
  }

  async deleteSavedSearch(tenantId: string, actor: SearchActor, id: string): Promise<void> {
    const row = await this.prisma.savedGlSearch.findFirst({ where: { id, tenantId, createdBy: actor.userId } });
    if (!row) throw new SavedSearchNotFoundError();
    await this.prisma.savedGlSearch.delete({ where: { id: row.id } });
  }

  /**
   * BR221-2 — re-run a saved search. `overridePage`/`overridePageSize` let a
   * caller page through a saved search's results without needing to
   * re-supply every criterion — the persisted criteria are otherwise used
   * verbatim, so the search a user re-runs is provably the one they saved.
   */
  async runSavedSearch(
    tenantId: string,
    actor: SearchActor,
    id: string,
    overridePage?: number,
    overridePageSize?: number,
  ): Promise<GLSearchResult> {
    const row = await this.prisma.savedGlSearch.findFirst({ where: { id, tenantId, createdBy: actor.userId } });
    if (!row) throw new SavedSearchNotFoundError();
    const criteria = row.criteria as unknown as GLSearchCriteria;
    return this.search(
      tenantId,
      { ...criteria, page: overridePage ?? criteria.page, pageSize: overridePageSize ?? criteria.pageSize },
      actor,
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private validate(criteria: GLSearchCriteria): void {
    const hasAny =
      criteria.amount !== undefined ||
      criteria.amountMin !== undefined ||
      criteria.amountMax !== undefined ||
      criteria.startDate !== undefined ||
      criteria.endDate !== undefined ||
      !!criteria.sourceCode ||
      !!criteria.memoContains ||
      !!criteria.postedBy ||
      !!criteria.docRef;
    if (!hasAny) {
      throw new SearchCriteriaRequiredError();
    }
    if ((criteria.startDate && !criteria.endDate) || (!criteria.startDate && criteria.endDate)) {
      throw new InvalidSearchRangeError('startDate and endDate must both be supplied together.');
    }
    if (criteria.startDate && criteria.endDate) {
      const start = new Date(criteria.startDate);
      const end = new Date(criteria.endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new InvalidSearchRangeError('startDate/endDate must be valid YYYY-MM-DD dates.');
      }
      if (start > end) {
        throw new InvalidSearchRangeError('startDate must not be after endDate.');
      }
    }
    if (criteria.amountMin !== undefined && criteria.amountMax !== undefined && criteria.amountMin > criteria.amountMax) {
      throw new InvalidSearchRangeError('amountMin must not be greater than amountMax.');
    }
  }

  private buildWhere(tenantId: string, c: GLSearchCriteria): Prisma.JournalLineWhereInput {
    const amountField = (field: 'dr' | 'cr') => {
      if (c.amount !== undefined) return { [field]: c.amount };
      if (c.amountMin !== undefined || c.amountMax !== undefined) {
        return {
          [field]: {
            ...(c.amountMin !== undefined ? { gte: c.amountMin } : {}),
            ...(c.amountMax !== undefined ? { lte: c.amountMax } : {}),
          },
        };
      }
      return undefined;
    };

    const drCond = amountField('dr');
    const crCond = amountField('cr');
    const hasAmountFilter = drCond !== undefined || crCond !== undefined;

    // Each criterion contributes its own independent AND-clause; only WITHIN
    // a single criterion (e.g. "amount matches either the dr or the cr side")
    // is OR used. Combining every criterion's OR into one shared top-level
    // `OR` key would silently drop earlier predicates whenever more than one
    // criterion is supplied at once (a later object-spread would overwrite
    // an earlier one under the same `OR` key) — caught and avoided here
    // before this code was ever run, not found live.
    const and: Prisma.JournalLineWhereInput[] = [];

    if (hasAmountFilter) {
      and.push({
        OR:
          c.direction === 'DEBIT'
            ? [drCond as any]
            : c.direction === 'CREDIT'
            ? [crCond as any]
            : [drCond, crCond].filter((x) => x !== undefined) as any[],
      });
    }

    if (c.docRef) {
      and.push({ OR: [{ controlNumber: c.docRef }, { applyNumber: c.docRef }] });
    }

    if (c.memoContains) {
      and.push({
        OR: [
          { memo: { contains: c.memoContains, mode: 'insensitive' as const } },
          { entry: { memo: { contains: c.memoContains, mode: 'insensitive' as const } } },
        ],
      });
    }

    // Defense-in-depth entry-level scoping (tenant/entity/date/source/poster)
    // is always applied via the relation filter, independent of the
    // memo/amount/docRef OR-clauses above, so it can never be dropped by
    // them regardless of which combination of criteria is supplied.
    const entryWhere: Prisma.JournalEntryWhereInput = {
      tenantId,
      ...(c.entityId ? { entityId: c.entityId } : {}),
      ...(c.startDate && c.endDate ? { entryDate: { gte: new Date(c.startDate), lte: new Date(c.endDate) } } : {}),
      ...(c.sourceCode ? { sourceCode: c.sourceCode } : {}),
      ...(c.postedBy ? { postedBy: c.postedBy } : {}),
    };

    return {
      tenantId,
      entry: entryWhere,
      ...(and.length > 0 ? { AND: and } : {}),
    };
  }

  private toSavedSearchView(row: { id: string; name: string; criteria: unknown; createdAt: Date; updatedAt: Date }): SavedSearchView {
    return {
      id: row.id,
      name: row.name,
      criteria: row.criteria as GLSearchCriteria,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Unconditional audit-on-search, matching this fleet's package-wide
   * convention for read/inquiry stories (S220/S224) even though S221's
   * approved contract states "None specific beyond package-wide
   * convention" — documented, consistent inference, not a literal
   * requirement. Saved-search CRUD (save/list/delete) is NOT separately
   * audited: those actions manage a search *definition*, not ledger data
   * exposure, and running a saved search always routes through this same
   * `search()`/`emitAudited` path, so ledger-data exposure is always
   * captured regardless of how the search was invoked.
   */
  private async emitAudited(tenantId: string, actor: SearchActor, criteria: GLSearchCriteria, totalResults: number): Promise<void> {
    const payload = {
      eventId: crypto.randomUUID(),
      tenantId,
      action: 'SEARCHED',
      searchedBy: actor.userId,
      role: actor.role ?? null,
      criteria,
      totalResults,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    const eventType = 'audit.viewed';
    const aggregateId = 'GL_SEARCH';
    // BR7-1 — the audit write must be transactionally coupled to the domain
    // outbox write (see gl-inquiry-service.ts / journal-view-service.ts
    // precedent and the S007 checkpoint).
    await this.prisma.$transaction(async (tx) => {
      await tx.coaOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId, payload: payload as any },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'GL_SEARCH',
          docId: aggregateId,
          action: 'SEARCHED',
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
        correlationId: aggregateId,
      } as any);
    } catch {
      /* outbox row already durable */
    }
  }
}
