/**
 * S008 Period Close Control — LIVE DATABASE certification suite.
 *
 * Real PostgreSQL (not the mocked Prisma client `period.test.ts` uses), same
 * skip-unless-LIVE_DATABASE_URL convention as `live-db/posting-live.test.ts`.
 * Provisioning: `tests/integration/rls-live-db/setup.sh` (extended in this
 * change to also apply the S008 migration's hand-written triggers/roles/RLS,
 * which — like the pre-existing DR=CR trigger — are not expressible in
 * Prisma schema language and are silently dropped by the combined-schema
 * bootstrap step otherwise).
 *
 * Covers the four S008 certification items this file exists for:
 *   1. Concurrency  — two genuinely concurrent transition attempts on the
 *      same period race at the database, not just in application memory;
 *      exactly one wins, the ledger never shows two transitions for one race.
 *   2. Idempotency  — retrying an identical transition after it already
 *      landed is a no-op success, not a second transition/audit row.
 *   3. RLS-negative — tenant isolation and privilege hardening on the two
 *      new S008 tables (`fiscal_period_transition`, `adjusting_entry_
 *      attestation`), proven with a real `amacc_app` connection (plain `pg`,
 *      not Prisma — see header comment on `tests/integration/
 *      test-rls-isolation.ts` for why a single-connection client is required
 *      for this specific kind of assertion).
 *   4. PostingService end-to-end proof — the DB trigger backstop
 *      (`enforce_period_postable()`) exercised through the real application
 *      code path (`PostingService.post()`), not direct SQL: OPEN succeeds,
 *      SOFT_CLOSED without attestation is rejected at the app layer,
 *      SOFT_CLOSED with a valid attestation succeeds, SOFT_CLOSED with
 *      isAdjusting=true but NO attestation is a case the app-layer evaluator
 *      (BR013-2) cannot see — it passes purely on status+flag — so this is
 *      the one case that proves the DB trigger is a genuine backstop beyond
 *      the application gate, not just a mirror of it. HARD_CLOSED and
 *      LOCKED are both rejected at the app layer (BR013-2), confirmed here
 *      too for completeness.
 *
 * Disclosed finding (empirically verified, not assumed — see period-service.ts
 * mapDbTransitionError()'s own "disclosed uncertainty" comment, which this
 * file is the promised verification for): Prisma's Rust query engine does
 * NOT expose these custom, non-built-in SQLSTATEs (AMPR0/AMPR1/.../AMPR6) as
 * a structured `.code`/`.meta.code` on the thrown error — every one of them
 * surfaces as a `PrismaClientUnknownRequestError` with `code`/`meta` both
 * `undefined`, and the SQLSTATE is visible only inside the free-text
 * `message`. This means `mapDbTransitionError`'s message-regex fallback is
 * load-bearing in practice, not merely defensive — its `sqlState === 'AMPRn'`
 * branch never actually matches against a real Postgres instance. The
 * assertions below match on message content for this reason, the same way
 * the pre-existing DR=CR bypass test in `posting-live.test.ts` does.
 *
 * Also disclosed: `enforce_period_postable()`'s AMPR1/AMPR2/AMPR3/AMPR6
 * rejections have no HTTP-layer translation in `journal-routes.ts`/
 * `draft-routes.ts` (unlike the period-transition trigger's errors, which
 * `period-service.ts` explicitly maps). In the normal case this trigger is a
 * pure backstop the application-layer BR013-2 check already prevents from
 * firing, so this is a latent 500 on a should-never-happen path, not a
 * behavior change requested by this certification pass — flagged for
 * Product/Eng awareness, not silently fixed here.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/coa-client';
import {
  PeriodService,
  InvalidTransitionError,
  PeriodLockedTerminalError,
  PeriodReasonRequiredError,
} from '../../src/application/period-service';
import { PostingService, PostingViolationError } from '../../src/application/posting-service';
import { FiscalCalendarService } from '../../src/application/fiscal-service';
import { SequenceService } from '../../src/application/sequence-service';
import { ConfigService } from '../../src/application/config-service';
import { AnalysisCodeService } from '../../src/application/analysis-code-service';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_URL = process.env['PG_APP_URL'];

const noopEvents: IEventPublisher = {
  publish: async () => {},
  subscribe: () => {},
};

describe.skipIf(!LIVE_DB_URL)('S008 Live database — period close control certification', () => {
  let prisma: PrismaClient;
  let periodSvc: PeriodService;
  let posting: PostingService;

  const TENANT = `s008-live-${randomUUID()}`;
  const ENTITY = randomUUID();
  const STORE = randomUUID();
  const SOURCE_CODE = 'S8';
  let calId: string;
  let drAccountId: string;
  let crAccountId: string;
  let seq = 100;

  // Each call gets its own non-overlapping calendar month (wrapping into the
  // next fiscal year past month 12) so FiscalCalendarService.resolve() can
  // unambiguously match a posting date to exactly one period — reusing one
  // full-year window per period (as an earlier draft of this file did) means
  // every period created after the first overlaps every other, and BR013-2's
  // "no fiscal period contains date" fires for a different reason than the
  // one each test intends to exercise. `midDate` is a date guaranteed to fall
  // inside this period's window, for tests that need to post into it.
  async function makePeriod(status: string) {
    seq += 1;
    const monthIndex = seq - 101;
    const year = 2026 + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const mm = String(month + 1).padStart(2, '0');
    const period = await prisma.fiscalPeriod.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        entityId: ENTITY,
        calendarId: calId,
        fiscalYear: year,
        periodNumber: month + 1,
        code: `${year}-${mm}`,
        startDate: new Date(year, month, 1),
        endDate: new Date(year, month + 1, 0),
        status,
      },
    });
    return Object.assign(period, { midDate: `${year}-${mm}-15` });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    const config = new ConfigService(prisma, noopEvents);
    periodSvc = new PeriodService(prisma, noopEvents, config);
    posting = new PostingService(prisma, noopEvents, new FiscalCalendarService(prisma, noopEvents), new SequenceService(prisma, noopEvents), new AnalysisCodeService(prisma, noopEvents));

    const cal = await prisma.fiscalCalendar.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, fyStartMonth: 1, structure: 'TWELVE', status: 'DEFINED', actor: 'live-test' },
    });
    calId = cal.id;

    const dr = await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', name: 'Cash (S008 live test)', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
    });
    const cr = await prisma.glAccount.create({
      data: { id: randomUUID(), tenantId: TENANT, entityId: ENTITY, accountNumber: '40000', name: 'Revenue (S008 live test)', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE' },
    });
    drAccountId = dr.id;
    crAccountId = cr.id;

    await prisma.journalSource.create({
      data: { id: randomUUID(), tenantId: TENANT, code: SOURCE_CODE, name: 'S008 Live Test Source', sourceClass: 'MANUAL', status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalEntry.deleteMany({ where: { tenantId: TENANT } });
    await prisma.adjustingEntryAttestation.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalPeriodTransition.deleteMany({ where: { tenantId: TENANT } });
    await prisma.journalSequence.deleteMany({ where: { tenantId: TENANT } }).catch(() => {});
    await prisma.journalSource.deleteMany({ where: { tenantId: TENANT } });
    await prisma.glAccount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalPeriod.deleteMany({ where: { tenantId: TENANT } });
    await prisma.fiscalCalendar.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  // ── 1. Concurrency ──────────────────────────────────────────────────────────

  describe('Concurrency', () => {
    it('two genuinely concurrent hard-close attempts on the same period: exactly one transition lands, no double-write', async () => {
      const period = await makePeriod('SOFT_CLOSED');

      const [a, b] = await Promise.allSettled([
        periodSvc.hardClose({ tenantId: TENANT, periodId: period.id, actor: 'racer-a', reason: 'race A' }),
        periodSvc.hardClose({ tenantId: TENANT, periodId: period.id, actor: 'racer-b', reason: 'race B' }),
      ]);

      // Both settlements must be a legitimate outcome: fulfilled (won the race,
      // or observed the already-closed status as a no-op success) or rejected
      // with InvalidTransitionError (lost the race against the CAS guard).
      // Never both fulfilled with different `transitioned` results, never a
      // silent swallow.
      for (const r of [a, b]) {
        if (r.status === 'fulfilled') {
          expect(r.value).toMatchObject({ transitioned: true, status: 'HARD_CLOSED' });
        } else {
          expect(r.reason).toBeInstanceOf(InvalidTransitionError);
        }
      }

      const fresh = await prisma.fiscalPeriod.findUnique({ where: { id: period.id } });
      expect(fresh?.status).toBe('HARD_CLOSED');

      // The DB trigger only records a row on a genuine status change — a race
      // must produce exactly ONE ledger row for this period, regardless of how
      // many application-layer attempts raced for it.
      const transitions = await prisma.fiscalPeriodTransition.findMany({ where: { tenantId: TENANT, periodId: period.id } });
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toMatchObject({ fromStatus: 'SOFT_CLOSED', toStatus: 'HARD_CLOSED' });

      // Likewise exactly one S007 audit event for this transition.
      const audits = await prisma.auditOutboxEvent.findMany({ where: { tenantId: TENANT, docType: 'fiscal_period', docId: period.id, action: 'HARD_CLOSE' } });
      expect(audits).toHaveLength(1);
    });

    it('10 concurrent soft-close attempts on the same OPEN period: exactly one transition, nine legitimate losers', async () => {
      const period = await makePeriod('OPEN');

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          periodSvc.softClose({ tenantId: TENANT, periodId: period.id, actor: `racer-${i}`, reason: `race ${i}` }),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.every((r: any) => r.reason instanceof InvalidTransitionError)).toBe(true);
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      for (const r of fulfilled as PromiseFulfilledResult<any>[]) {
        expect(r.value).toMatchObject({ transitioned: true, status: 'SOFT_CLOSED' });
      }

      const transitions = await prisma.fiscalPeriodTransition.findMany({ where: { tenantId: TENANT, periodId: period.id } });
      expect(transitions).toHaveLength(1); // only ONE genuine status change, no matter how many callers raced
    });
  });

  // ── 2. Idempotency ───────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('retrying an identical soft-close after it already landed is a no-op success — no new transition/audit row', async () => {
      const period = await makePeriod('OPEN');
      const first = await periodSvc.softClose({ tenantId: TENANT, periodId: period.id, actor: 'controller-1', reason: 'cutoff' });
      expect(first).toMatchObject({ transitioned: true, status: 'SOFT_CLOSED' });

      const second = await periodSvc.softClose({ tenantId: TENANT, periodId: period.id, actor: 'controller-1', reason: 'cutoff' });
      expect(second).toMatchObject({ transitioned: true, status: 'SOFT_CLOSED' });

      const transitions = await prisma.fiscalPeriodTransition.findMany({ where: { tenantId: TENANT, periodId: period.id } });
      expect(transitions).toHaveLength(1); // the retry wrote nothing
      const audits = await prisma.auditOutboxEvent.findMany({ where: { tenantId: TENANT, docType: 'fiscal_period', docId: period.id, action: 'SOFT_CLOSE' } });
      expect(audits).toHaveLength(1);
    });

    it('retrying reopen-hard-closed confirm=true twice locks in exactly one OPEN transition', async () => {
      const period = await makePeriod('HARD_CLOSED');
      const pending = await periodSvc.reopenHardClosed({ tenantId: TENANT, periodId: period.id, actor: 'admin-1', reason: 'audit request' });
      expect(pending).toMatchObject({ transitioned: false, requiresConfirmation: true });

      const first = await periodSvc.reopenHardClosed({ tenantId: TENANT, periodId: period.id, actor: 'admin-1', reason: 'audit request', confirm: true });
      expect(first).toMatchObject({ transitioned: true, status: 'OPEN' });
      const second = await periodSvc.reopenHardClosed({ tenantId: TENANT, periodId: period.id, actor: 'admin-1', reason: 'audit request', confirm: true });
      expect(second).toMatchObject({ transitioned: true, status: 'OPEN' });

      const transitions = await prisma.fiscalPeriodTransition.findMany({ where: { tenantId: TENANT, periodId: period.id, toStatus: 'OPEN' } });
      expect(transitions).toHaveLength(1);
    });
  });

  // ── 3. DB-trigger backstop (raw SQL bypass, independent of the CAS guard) ───

  describe('DB trigger backstop (bypassing the application layer entirely)', () => {
    it('LOCKED is terminal even against a direct-SQL transition attempt (AMPR5)', async () => {
      const period = await makePeriod('LOCKED');
      let caught: any;
      try {
        await prisma.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.current_actor', 'bypass-actor', true)`);
          await tx.fiscalPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(String(caught?.message)).toMatch(/LOCKED.*terminal/i);
      const fresh = await prisma.fiscalPeriod.findUnique({ where: { id: period.id } });
      expect(fresh?.status).toBe('LOCKED'); // never actually changed
    });

    it('a skip-transition direct-SQL attempt (OPEN -> HARD_CLOSED) is rejected (AMPR0)', async () => {
      const period = await makePeriod('OPEN');
      let caught: any;
      try {
        await prisma.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.current_actor', 'bypass-actor', true)`);
          await tx.fiscalPeriod.update({ where: { id: period.id }, data: { status: 'HARD_CLOSED' } });
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(String(caught?.message)).toMatch(/illegal fiscal_period transition/i);
      const fresh = await prisma.fiscalPeriod.findUnique({ where: { id: period.id } });
      expect(fresh?.status).toBe('OPEN');
    });

    it('a transition attempt with no actor context set is rejected (AMPR4)', async () => {
      const period = await makePeriod('OPEN');
      let caught: any;
      try {
        // Deliberately no set_config('app.current_actor', ...) on this connection.
        await prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: 'SOFT_CLOSED' } });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(String(caught?.message)).toMatch(/app\.current_actor.*required/i);
      const fresh = await prisma.fiscalPeriod.findUnique({ where: { id: period.id } });
      expect(fresh?.status).toBe('OPEN');
    });
  });

  // ── 4. PostingService end-to-end proof (live code, not direct SQL) ─────────

  describe('PostingService end-to-end proof (BLK-05)', () => {
    it('OPEN period: posting succeeds through the real application code path', async () => {
      const period = await makePeriod('OPEN');
      const result = await posting.post({
        tenantId: TENANT, entityId: ENTITY, date: period.midDate, sourceCode: SOURCE_CODE,
        idempotencyKey: randomUUID(), callerClass: 'MANUAL', postedBy: 'controller-1',
        lines: [
          { accountId: drAccountId, storeId: STORE, dr: 100, cr: 0 },
          { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 100 },
        ],
      });
      expect(result.status).toBe('POSTED');
    });

    it('SOFT_CLOSED, non-adjusting: app layer rejects (BR013-2), never reaches the DB insert', async () => {
      const period = await makePeriod('SOFT_CLOSED');
      await expect(
        posting.post({
          tenantId: TENANT, entityId: ENTITY, date: period.midDate, sourceCode: SOURCE_CODE,
          idempotencyKey: randomUUID(), callerClass: 'MANUAL', postedBy: 'controller-1',
          lines: [
            { accountId: drAccountId, storeId: STORE, dr: 50, cr: 0 },
            { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 50 },
          ],
        }),
      ).rejects.toBeInstanceOf(PostingViolationError);
    });

    it('SOFT_CLOSED, isAdjusting + a valid attestation: succeeds end-to-end (app layer AND DB trigger agree)', async () => {
      const period = await makePeriod('SOFT_CLOSED');
      const draftId = randomUUID();
      await prisma.adjustingEntryAttestation.create({
        data: { id: randomUUID(), tenantId: TENANT, draftId, attestedBy: 'controller-1', reason: 'late accrual correction' },
      });

      const result = await posting.post({
        tenantId: TENANT, entityId: ENTITY, date: period.midDate, sourceCode: SOURCE_CODE,
        idempotencyKey: randomUUID(), callerClass: 'MANUAL', postedBy: 'controller-1',
        isAdjusting: true, adjustingReason: 'late accrual correction', draftId,
        lines: [
          { accountId: drAccountId, storeId: STORE, dr: 25, cr: 0 },
          { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 25 },
        ],
      });
      expect(result.status).toBe('POSTED');
      const entry = await prisma.journalEntry.findUnique({ where: { id: result.id } });
      expect(entry?.isAdjusting).toBe(true);
    });

    it('SOFT_CLOSED, isAdjusting=true but NO attestation: the app-layer evaluator PASSES (status+flag only) yet the DB trigger still rejects — proves the DB is a genuine backstop beyond the application gate, not merely a mirror of it (AMPR6)', async () => {
      const period = await makePeriod('SOFT_CLOSED');
      const draftId = randomUUID(); // deliberately: no adjusting_entry_attestation row for this draftId

      let caught: any;
      try {
        await posting.post({
          tenantId: TENANT, entityId: ENTITY, date: period.midDate, sourceCode: SOURCE_CODE,
          idempotencyKey: randomUUID(), callerClass: 'MANUAL', postedBy: 'controller-1',
          isAdjusting: true, adjustingReason: 'unattested attempt', draftId,
          lines: [
            { accountId: drAccountId, storeId: STORE, dr: 10, cr: 0 },
            { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 10 },
          ],
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeTruthy();
      expect(caught).not.toBeInstanceOf(PostingViolationError); // did NOT get caught by BR013-2 — proves it reached the DB
      expect(String(caught?.message)).toMatch(/adjusting.*attestation/i);

      const entries = await prisma.journalEntry.findMany({ where: { tenantId: TENANT, draftId } });
      expect(entries).toHaveLength(0); // no partial write
    });

    it('HARD_CLOSED: app layer rejects any posting (BR013-2)', async () => {
      const period = await makePeriod('HARD_CLOSED');
      await expect(
        posting.post({
          tenantId: TENANT, entityId: ENTITY, date: period.midDate, sourceCode: SOURCE_CODE,
          idempotencyKey: randomUUID(), callerClass: 'MANUAL', postedBy: 'controller-1',
          lines: [
            { accountId: drAccountId, storeId: STORE, dr: 15, cr: 0 },
            { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 15 },
          ],
        }),
      ).rejects.toBeInstanceOf(PostingViolationError);
    });

    it('LOCKED: app layer rejects any posting (BR013-2)', async () => {
      const period = await makePeriod('LOCKED');
      await expect(
        posting.post({
          tenantId: TENANT, entityId: ENTITY, date: period.midDate, sourceCode: SOURCE_CODE,
          idempotencyKey: randomUUID(), callerClass: 'MANUAL', postedBy: 'controller-1',
          lines: [
            { accountId: drAccountId, storeId: STORE, dr: 5, cr: 0 },
            { accountId: crAccountId, storeId: STORE, deptCode: '01', dr: 0, cr: 5 },
          ],
        }),
      ).rejects.toBeInstanceOf(PostingViolationError);
    });
  });
});

// ── 3. RLS-negative (tenant isolation + privilege hardening) ──────────────────
// Deliberately plain `pg`, not Prisma — same reasoning as
// `tests/integration/test-rls-isolation.ts`: SET/set_config is per-connection,
// and this needs precise single-connection control per assertion.

describe.skipIf(!LIVE_DB_URL || !APP_URL)('S008 Live database — RLS-negative (fiscal_period_transition, adjusting_entry_attestation)', () => {
  const SUPER_URL = LIVE_DB_URL!;
  const TENANT_A = `s008-rls-a-${randomUUID()}`;
  const TENANT_B = `s008-rls-b-${randomUUID()}`;
  // fiscal_calendar has a UNIQUE(entity_id) constraint (BR208-1: one calendar
  // per entity) — a shared entity id across two tenants would collide, so
  // each tenant gets its own.
  const ENTITY_A = randomUUID();
  const ENTITY_B = randomUUID();
  let periodAId: string;
  let periodBId: string;

  async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await withClient(SUPER_URL, async (c) => {
      const calA = randomUUID();
      const calB = randomUUID();
      await c.query(
        `INSERT INTO fiscal_calendar (id, tenant_id, entity_id, fy_start_month, structure, status, actor, created_at, updated_at) VALUES ($1,$2,$3,1,'TWELVE','DEFINED','rls-test',now(),now())`,
        [calA, TENANT_A, ENTITY_A],
      );
      await c.query(
        `INSERT INTO fiscal_calendar (id, tenant_id, entity_id, fy_start_month, structure, status, actor, created_at, updated_at) VALUES ($1,$2,$3,1,'TWELVE','DEFINED','rls-test',now(),now())`,
        [calB, TENANT_B, ENTITY_B],
      );
      periodAId = randomUUID();
      periodBId = randomUUID();
      await c.query(
        `INSERT INTO fiscal_period (id, tenant_id, entity_id, calendar_id, fiscal_year, period_number, code, start_date, end_date, status) VALUES ($1,$2,$3,$4,2026,1,'2026-01','2026-01-01','2026-01-31','OPEN')`,
        [periodAId, TENANT_A, ENTITY_A, calA],
      );
      await c.query(
        `INSERT INTO fiscal_period (id, tenant_id, entity_id, calendar_id, fiscal_year, period_number, code, start_date, end_date, status) VALUES ($1,$2,$3,$4,2026,1,'2026-01','2026-01-01','2026-01-31','OPEN')`,
        [periodBId, TENANT_B, ENTITY_B, calB],
      );
      // A real transition row per tenant, written the only way the schema allows
      // (the SECURITY DEFINER function — same path the trigger uses), so there is
      // something tenant-scoped to actually try to read across tenants.
      await c.query(`SELECT set_config('app.current_actor', 'rls-test-actor', false)`);
      await c.query(`UPDATE fiscal_period SET status = 'SOFT_CLOSED' WHERE id = $1`, [periodAId]);
      await c.query(`UPDATE fiscal_period SET status = 'SOFT_CLOSED' WHERE id = $1`, [periodBId]);
    });
  });

  afterAll(async () => {
    await withClient(SUPER_URL, async (c) => {
      await c.query(`DELETE FROM fiscal_period_transition WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
      await c.query(`DELETE FROM fiscal_period WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
      await c.query(`DELETE FROM fiscal_calendar WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    });
  });

  it('tenant A reads only its own fiscal_period_transition rows, never tenant B\'s', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`SELECT tenant_id, period_id FROM fiscal_period_transition WHERE period_id IN ($1, $2)`, [periodAId, periodBId]);
      expect(res.rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
      expect(res.rows.some((r) => r.period_id === periodAId)).toBe(true);
      expect(res.rows.some((r) => r.period_id === periodBId)).toBe(false);
    });
  });

  it('missing tenant context sees zero fiscal_period_transition rows (deny-by-default)', async () => {
    await withClient(APP_URL!, async (c) => {
      const res = await c.query(`SELECT count(*)::int AS n FROM fiscal_period_transition WHERE period_id IN ($1, $2)`, [periodAId, periodBId]);
      expect(res.rows[0].n).toBe(0);
    });
  });

  it('amacc_app cannot INSERT directly into fiscal_period_transition — the trigger-only-write door is real, not just a convention', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      await expect(
        c.query(
          `INSERT INTO fiscal_period_transition (id, tenant_id, entity_id, period_id, from_status, to_status, actor) VALUES ($1,$2,$3,$4,'OPEN','SOFT_CLOSED','forged')`,
          [randomUUID(), TENANT_A, ENTITY_A, periodAId],
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it('amacc_app cannot UPDATE or DELETE an existing fiscal_period_transition row directly', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      await expect(c.query(`UPDATE fiscal_period_transition SET actor = 'forged' WHERE period_id = $1`, [periodAId])).rejects.toThrow(/permission denied/i);
      await expect(c.query(`DELETE FROM fiscal_period_transition WHERE period_id = $1`, [periodAId])).rejects.toThrow(/permission denied/i);
    });
  });

  it('amacc_app cannot invoke the amacc_period_ledger_writer role directly (the trigger-only door has no side entrance)', async () => {
    await withClient(APP_URL!, async (c) => {
      await expect(c.query(`SET ROLE amacc_period_ledger_writer`)).rejects.toThrow(/permission denied/i);
    });
  });

  it('adjusting_entry_attestation: tenant-isolated SELECT, no direct write from amacc_app', async () => {
    await withClient(SUPER_URL, async (c) => {
      await c.query(
        `INSERT INTO adjusting_entry_attestation (id, tenant_id, draft_id, attested_by, reason) VALUES ($1,$2,$3,'controller-1','rls test')`,
        [randomUUID(), TENANT_A, randomUUID()],
      );
    });
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_B]);
      const res = await c.query(`SELECT count(*)::int AS n FROM adjusting_entry_attestation WHERE tenant_id = $1`, [TENANT_A]);
      expect(res.rows[0].n).toBe(0); // tenant B's context sees none of tenant A's attestations
      await expect(
        c.query(`INSERT INTO adjusting_entry_attestation (id, tenant_id, draft_id, attested_by, reason) VALUES ($1,$2,$3,'forged','forged')`, [
          randomUUID(),
          TENANT_B,
          randomUUID(),
        ]),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
