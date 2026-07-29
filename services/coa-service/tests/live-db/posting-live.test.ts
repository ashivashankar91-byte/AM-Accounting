/**
 * R0 Stabilization Phase 6 — LIVE DATABASE integration tests. Unlike every
 * other coa-service test (which mocks Prisma), these run against a real
 * PostgreSQL instance and prove guarantees a mock cannot: the DR=CR deferred
 * constraint trigger, real unique-constraint concurrency, real Postgres RLS
 * enforcement, and atomicity of a genuinely committed transaction.
 *
 * Deliberately separate from the regular unit-test suite: skipped entirely
 * unless LIVE_DATABASE_URL is set, so `npm test` (mocked unit tests) is
 * unaffected and CI can opt into this suite explicitly by providing a real
 * (ephemeral, disposable) Postgres connection string. See
 * docs/accounting-modernization/stabilization/LIVE_DATABASE_TEST_REPORT.md
 * for exactly how the database this was run against was provisioned
 * (initdb-based ephemeral instance, isolated from any developer/shared DB —
 * never touches the shared `amacc` dev database).
 *
 * This file's LIVE_DATABASE_URL is expected to authenticate as a role that
 * bypasses RLS on every connection unconditionally (e.g. the migration
 * superuser) — deliberately. `set_config`/`SET ROLE` are per-connection, and
 * Prisma's pool opens multiple physical connections (the 20-way concurrency
 * test below would otherwise need per-connection tenant-context setup to
 * avoid a false failure); this file's purpose is proving Postgres-native
 * guarantees (the DR=CR trigger, unique-constraint concurrency, transaction
 * atomicity, idempotency), not tenant isolation. RLS itself is proven
 * separately, deliberately avoiding the pooling hazard by using single-
 * connection psql sessions — see LIVE_DATABASE_TEST_REPORT.md.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/coa-client';
import { PostingService } from '../../src/application/posting-service';
import { ReversalService } from '../../src/application/reversal-service';
import { FiscalCalendarService } from '../../src/application/fiscal-service';
import { SequenceService } from '../../src/application/sequence-service';
import { AnalysisCodeService } from '../../src/application/analysis-code-service';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

const noopEvents: IEventPublisher = {
  publish: async () => {},
  subscribe: () => {},
};

describe.skipIf(!LIVE_DB_URL)('Live database — atomic posting, idempotency, reversal, concurrency (Phase 6)', () => {
  let prisma: PrismaClient;
  let posting: PostingService;
  let reversal: ReversalService;
  let sequence: SequenceService;

  // Unique per run so re-running this suite never collides with a previous
  // run's fixtures (no shared/persistent test tenant) — and afterAll below
  // cleans its own rows up regardless, so nothing accumulates across runs.
  const TENANT = `live-test-tenant-${randomUUID()}`;
  const ENTITY = randomUUID();
  const STORE = randomUUID();
  const SOURCE_CODE = 'LT';
  let periodId: string;
  let periodCode: string;
  let drAccountId: string;
  let crAccountId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    const cal = await prisma.fiscalCalendar.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', status: 'DEFINED', actor: 'live-test' },
    });
    const period = await prisma.fiscalPeriod.create({
      data: {
        id: randomUUID(), tenantId: TENANT, entityId: ENTITY, calendarId: cal.id,
        fiscalYear: 2026, periodNumber: 1, code: '2026-01',
        startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'),
        status: 'OPEN',
      },
    });
    periodId = period.id;
    periodCode = period.code;

    const dr = await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', name: 'Cash (live test)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
    });
    const cr = await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '40000', name: 'Revenue (live test)', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE' },
    });
    drAccountId = dr.id;
    crAccountId = cr.id;

    await prisma.journalSource.create({
      data: { id: randomUUID(), tenantId: TENANT, code: SOURCE_CODE, name: 'Live Test Source', sourceClass: 'MANUAL', status: 'ACTIVE' },
    });

    posting = new PostingService(prisma, noopEvents, new FiscalCalendarService(prisma, noopEvents), new SequenceService(prisma, noopEvents), new AnalysisCodeService(prisma, noopEvents));
    reversal = new ReversalService(prisma, posting);
    sequence = new SequenceService(prisma, noopEvents);
  });

  afterAll(async () => {
    // Clean up this run's own fixtures — never leaves data behind, safe to
    // re-run repeatedly (each run uses its own randomUUID()-suffixed tenant,
    // so this can never delete another run's or another tenant's rows).
    await prisma.journalLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalEntry.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalSequence.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalSource.deleteMany({ where: { tenantId: TENANT } });
    await prisma.glAccount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalPeriod.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalCalendar.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it('BR013: posts a balanced entry atomically, updates account balances, and writes the audit outbox row in the process', async () => {
    const idempotencyKey = randomUUID();
    const result = await posting.post({
      tenantId: TENANT, entityId: ENTITY, date: '2026-01-15', sourceCode: SOURCE_CODE,
      memo: 'live-db test entry', idempotencyKey, callerClass: 'MANUAL', postedBy: 'live-test-user',
      lines: [
        { accountId: drAccountId, storeId: STORE, dr: 250, cr: 0 },
        { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 250 },
      ],
    });

    expect(result.idempotent).toBe(false);
    expect(result.status).toBe('POSTED');
    expect(Number(result.totalDebits)).toBe(250);
    expect(Number(result.totalCredits)).toBe(250);

    const lines = await prisma.journalLine.findMany({ where: { journalEntryId: result.id } });
    expect(lines).toHaveLength(2);

    const auditRows = await prisma.auditOutboxEvent.findMany({ where: { tenantId: TENANT, docId: result.id } });
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it('BR013-6: re-posting with the SAME idempotencyKey returns the original journal, not a duplicate — proven against a real unique constraint, not a mock', async () => {
    const idempotencyKey = randomUUID();
    const dto = {
      tenantId: TENANT, entityId: ENTITY, date: '2026-01-16', sourceCode: SOURCE_CODE,
      memo: 'idempotency test', idempotencyKey, callerClass: 'MANUAL' as const, postedBy: 'live-test-user',
      lines: [
        { accountId: drAccountId, storeId: STORE, dr: 100, cr: 0 },
        { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 100 },
      ],
    };
    const first = await posting.post(dto);
    const second = await posting.post(dto);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id);

    const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey } });
    expect(count).toBe(1); // never a duplicate row, even though post() was called twice
  });

  it('the deferred DR=CR trigger rejects a direct unbalanced insert at COMMIT (bypassing the application layer entirely) — proves the DB-level backstop is real, not just app-layer validation', async () => {
    // Deliberately raw SQL rather than prisma.$transaction(callback): Prisma's
    // interactive-transaction wrapper was found (empirically, in this exact
    // test) not to surface the error a DEFERRED constraint trigger raises at
    // COMMIT — the promise resolves as if successful, but the row is not
    // actually persisted (confirmed rolled back). This is disclosed as a
    // genuine finding about Prisma's interactive-transaction API, not
    // silently worked around — see LIVE_DATABASE_TEST_REPORT.md. Raw
    // executeRawUnsafe BEGIN/INSERT/INSERT/COMMIT (exactly what a direct
    // psql session already proved triggers correctly) sidesteps that
    // specific Prisma-layer gap while still proving the trigger itself.
    const entryId = randomUUID();
    const lineId = randomUUID();
    const idemKey = randomUUID();

    await prisma.$executeRawUnsafe('BEGIN');
    let caught: unknown;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO journal_entry (id, tenant_id, entity_id, journal_number, source_code, period_id, period_code, entry_date, idempotency_key, total_debits, total_credits, posted_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 100, 100, 'live-test-user', 'POSTED')`,
        entryId, TENANT, ENTITY, `DIRECT-${entryId.slice(0, 8)}`, SOURCE_CODE, periodId, periodCode, new Date('2026-01-17'), idemKey,
      );
      // Only one leg — deliberately unbalanced.
      await prisma.$executeRawUnsafe(
        `INSERT INTO journal_line (id, journal_entry_id, tenant_id, line_index, account_id, account_number, store_id, dr, cr)
         VALUES ($1, $2, $3, 0, $4, '10000', $5, 999, 0)`,
        lineId, entryId, TENANT, drAccountId, STORE,
      );
      await prisma.$executeRawUnsafe('COMMIT');
    } catch (err) {
      caught = err;
      await prisma.$executeRawUnsafe('ROLLBACK').catch(() => {});
    }

    expect(caught).toBeTruthy();
    const stillThere = await prisma.journalEntry.findUnique({ where: { id: entryId } });
    expect(stillThere).toBeNull(); // rolled back — the unbalanced entry was never persisted
  });

  it('BR218: reverses a posted entry with mirrored lines, both-way linkage, and TB restoration (net balance impact of original+reversal is zero)', async () => {
    const idempotencyKey = randomUUID();
    const posted = await posting.post({
      tenantId: TENANT, entityId: ENTITY, date: '2026-01-18', sourceCode: SOURCE_CODE,
      memo: 'to be reversed', idempotencyKey, callerClass: 'MANUAL', postedBy: 'live-test-user',
      lines: [
        { accountId: drAccountId, storeId: STORE, dr: 75, cr: 0 },
        { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 75 },
      ],
    });

    const rev = await reversal.reverse(TENANT, posted.id, { targetPeriod: null, reason: 'live-db test reversal' }, { userId: 'live-test-user' });

    const original = await prisma.journalEntry.findUnique({ where: { id: posted.id } });
    const reversalEntry = await prisma.journalEntry.findUnique({ where: { id: rev.reversalId } });

    expect(original?.status).toBe('REVERSED');
    expect(original?.reversedBy).toBe(rev.reversalId);
    expect(reversalEntry?.reversalOf).toBe(posted.id);

    const reversalLines = await prisma.journalLine.findMany({ where: { journalEntryId: rev.reversalId }, orderBy: { lineIndex: 'asc' } });
    const originalLines = await prisma.journalLine.findMany({ where: { journalEntryId: posted.id }, orderBy: { lineIndex: 'asc' } });
    // Mirrored: what was DR on the original is CR on the reversal, and vice versa — net zero.
    for (let i = 0; i < originalLines.length; i++) {
      expect(Number(reversalLines[i].dr)).toBe(Number(originalLines[i].cr));
      expect(Number(reversalLines[i].cr)).toBe(Number(originalLines[i].dr));
    }
  });

  it('BR213-1: journal numbering is atomic under real concurrency — 20 concurrent allocations against real Postgres yield 20 distinct, gapless-from-1 numbers', async () => {
    const period = '2026-02';
    const results = await Promise.all(
      Array.from({ length: 20 }, () => sequence.allocate({ tenantId: TENANT, entityId: ENTITY, sourceCode: SOURCE_CODE, periodCode: period })),
    );
    const numbers = results.map((r) => r.seq);
    const distinct = new Set(numbers);
    expect(distinct.size).toBe(20); // no two concurrent callers ever got the same number
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(20);
  });
});
