/**
 * CE-12 gap-close — floorplan-service certification suite proving
 * `floorplan.advance-matched.v1` / `floorplan.payoff-matched.v1` (and, for
 * S218 symmetry, `floorplan.interest-accrual.v1`) against the REAL, running
 * coa-service + schedule-service over HTTP (not the in-memory doubles used
 * by tests/live-db/floorplan-live.test.ts, which certifies floorplan-
 * service's OWN DB behavior in isolation).
 *
 * Prerequisites (see scripts/seed-ce12-rule-packs.ts, --test-tenant mode):
 * tenant-kunes / entity-kunes-delavan / store STORE-1 must already have the
 * 5 ce12.floorplan-* rule packs ACTIVE, GL account 19102 scheduleCode='85',
 * schedule-service Schedule 85, and an OPEN fiscal period covering
 * 2026-08-xx. Run that script (--test-tenant tenant-kunes --test-entity
 * entity-kunes-delavan --test-store-id STORE-1) against the live stack
 * before running this suite.
 *
 * Gated on LIVE_DATABASE_URL + COA_SERVICE_URL + SCHEDULE_SERVICE_URL +
 * POSTING_RECOVERY_SERVICE_URL + AMACC_JWT_SECRET all being set — skipped
 * entirely otherwise (CI without a live stack).
 *
 * ── Schedule-effects (item 8) — KNOWN LIMITATION, read before editing ──────
 * The real, automatic coa-service -> schedule-service bridge (GlAccount.
 * scheduleCode + the JOURNAL_ENTRY_POSTED-shaped event coa-service's
 * PostingService publishes, see posting-service.ts) is verified CORRECT at
 * the coa-service emission side in this suite (JournalLine.controlNumber IS
 * populated on the schedule-linked line — asserted below via a direct read
 * of coa-service's own journal_line row, same physical DB in this cert
 * env). It could NOT be observed completing automatically end-to-end via
 * the real RabbitMQ hop in this environment, for THREE independently
 * confirmed, pre-existing issues outside floorplan-service's editable
 * scope (do not modify coa-service or schedule-service per this task):
 *
 *   1. coa-service's bridge payload sets `journalSource: dto.sourceCode`
 *      (posting-service.ts) — this service's real journalSourceCode is
 *      'FLRPLN' (6 chars). schedule-service's ScheduleDetail.journal_source
 *      column is `character(2)` (a legacy 2-digit-numeric-source
 *      assumption, see CLAUDE.md PO-DEC-004) — inserting a 6-char value
 *      into it raises a hard Postgres error ("value too long for type
 *      character(2)"), reproduced directly via SQL during investigation.
 *   2. schedule-service's OWN RabbitMQ consumer (src/infrastructure/
 *      event-publisher.ts's `subscribe()`) wraps the handler call in
 *      `Promise.allSettled(...)`, which never rejects, then unconditionally
 *      ACKs the message — so error #1 (and any other handler exception) is
 *      silently swallowed with zero logging; the message is marked
 *      processed even though nothing was written.
 *   3. In this specific shared-RabbitMQ dev environment, an UNRELATED
 *      worktree's schedule-service instance (AM-Accounting-r1-ce11-complete,
 *      a different certification run, different DB) is ALSO bound to the
 *      exact same unnamespaced queue name (`schedule-service.journal-
 *      entry-posted`) on the same broker and was observed winning ~100% of
 *      JOURNAL_ENTRY_POSTED deliveries via RabbitMQ's competing-consumers
 *      round-robin during a 26-message reproduction burst — an
 *      environmental collision, not a code defect, but one this agent
 *      cannot fix (cannot stop another worktree's process, cannot rename
 *      schedule-service's own queue).
 *
 * Given all three, the open()/relieve() calls below invoke schedule-
 * service's REAL HTTP API directly (POST is not exposed for open-item
 * creation — confirmed by reading schedule-service/src/http/routes.ts, only
 * the JOURNAL_ENTRY_POSTED event path opens an item), so this suite proves
 * the REAL schedule-service persistence + REAL GET read path using data
 * pulled from the REAL journal coa-service just posted (never fabricated),
 * with `describe.skipIf` degrading gracefully if schedule-service is
 * unreachable. See the final delivery summary for full reproduction steps.
 *
 * ── A 4th finding, this one IN floorplan-service and fixed here ───────────
 * While building the S218 reversal proof below, discovered
 * HttpPostingEngineClient.reverseJournal() (src/infrastructure/
 * posting-engine-client.ts) returned coa-service's raw reversal response
 * untouched, typed as {id, journalNumber} — but coa-service's
 * ReversalService.reverse() actually responds with {reversalId,
 * reversalNumber, ...}. Every caller's `reversal.id`/`reversal.
 * journalNumber` silently read as undefined, so a genuinely successful
 * reversal persisted a null reversalJournalEntryId/reversalJournalNumber.
 * Fixed (now maps the real field names); the "interest accrual ...
 * reversal" test below is the live proof.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/floorplan-client';
import { createServiceToken, createTenantRlsMiddleware, RlsTenantContext } from '@amacc/shared-kernel';
import { LenderService } from '../../src/application/lender-service';
import { FeedService } from '../../src/application/feed-service';
import { MatchService } from '../../src/application/match-service';
import { InterestService } from '../../src/application/interest-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { HttpPostingEngineClient } from '../../src/infrastructure/posting-engine-client';
import { HttpPostingRecoveryClient } from '../../src/infrastructure/posting-recovery-client';
import { buildEnvelope } from '../../src/domain/envelope';
import { EVENT_TYPES, EVENT_SCHEMA_VERSION, FLOORPLAN_SCHEDULE_NUMBER } from '../../src/domain/event-types';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const COA_SERVICE_URL = process.env['COA_SERVICE_URL'];
const SCHEDULE_SERVICE_URL = process.env['SCHEDULE_SERVICE_URL'];
const POSTING_RECOVERY_SERVICE_URL = process.env['POSTING_RECOVERY_SERVICE_URL'];
const JWT_SECRET = process.env['AMACC_JWT_SECRET'];

const READY = Boolean(LIVE_DB_URL && COA_SERVICE_URL && SCHEDULE_SERVICE_URL && POSTING_RECOVERY_SERVICE_URL && JWT_SECRET);

describe.skipIf(!READY)('CE-12 gap-close — floorplan-service LIVE coa-service + schedule-service certification', () => {
  const TENANT = 'tenant-kunes';
  const ENTITY = 'entity-kunes-delavan';
  const LENDER = `GAPCLOSE-${randomUUID().slice(0, 6)}`;

  let prisma: PrismaClient;
  let pgClient: pg.Client;
  let lenderService: LenderService;
  let feedService: FeedService;
  let matchService: MatchService;
  let interestService: InterestService;
  let serviceToken: string;

  async function coa(path: string, method: string, tenantId: string, body?: unknown) {
    const res = await fetch(`${COA_SERVICE_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${serviceToken}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const parsed = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body: parsed };
  }

  /** Sets app.current_tenant_id on pgClient's own connection — needed
   * before every raw query against a forced-RLS table (journal_source,
   * journal_entry, journal_line, schedule_open_items, ...), since pgClient
   * is a bare pg.Client, not routed through Prisma's RLS middleware. */
  async function setPgTenant(tenantId: string) {
    await pgClient.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantId]);
  }

  async function schedule(path: string, method: string, tenantId: string, body?: unknown) {
    const res = await fetch(`${SCHEDULE_SERVICE_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${serviceToken}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const parsed = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body: parsed };
  }

  beforeAll(async () => {
    serviceToken = createServiceToken('floorplan-service-live-cert', JWT_SECRET as string);

    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    // DATABASE_URL in this cert environment is the restricted `amacc_app`
    // role (not the table owner, and forced RLS is enabled — see the
    // schema-level doc comment on RLS in the migration) — every query
    // needs app.current_tenant_id set first, exactly like the real running
    // service does via createTenantRlsMiddleware/tenantContextHook. Set
    // once per tenant-scoped block below via RlsTenantContext.set(...).
    (prisma as any).$use(createTenantRlsMiddleware(prisma));
    pgClient = new pg.Client({ connectionString: LIVE_DB_URL });
    await pgClient.connect();

    lenderService = new LenderService(prisma as any);
    feedService = new FeedService(prisma as any, lenderService);
    const orchestrator = new PostingOrchestrator(new HttpPostingEngineClient(JWT_SECRET, COA_SERVICE_URL) as any, new HttpPostingRecoveryClient(JWT_SECRET, POSTING_RECOVERY_SERVICE_URL) as any);
    matchService = new MatchService(prisma as any, orchestrator);
    interestService = new InterestService(prisma as any, orchestrator, new HttpPostingEngineClient(JWT_SECRET, COA_SERVICE_URL) as any);

    RlsTenantContext.set(TENANT);
    await lenderService.upsertLenderProfile(TENANT, { lenderCode: LENDER, lenderName: 'CE-12 Gap-Close Cert Lender', adapterStatus: 'CONFIGURED', adapterType: 'FIXTURE_FEED' }, 'live-cert-setup');
  });

  afterAll(async () => {
    RlsTenantContext.set(TENANT);
    await prisma.floorplanLiabilityApplication.deleteMany({ where: { tenantId: TENANT, item: { lenderCode: LENDER } } });
    await prisma.floorplanMatch.deleteMany({ where: { tenantId: TENANT, stagedRow: { lenderCode: LENDER } } }).catch(() => {});
    await prisma.floorplanLiabilityItem.deleteMany({ where: { tenantId: TENANT, lenderCode: LENDER } });
    await prisma.floorplanStagedRow.deleteMany({ where: { tenantId: TENANT, lenderCode: LENDER } });
    await prisma.floorplanImportBatch.deleteMany({ where: { tenantId: TENANT, lenderCode: LENDER } });
    await prisma.lenderProfile.deleteMany({ where: { tenantId: TENANT, lenderCode: LENDER } });
    await prisma.floorplanInterestAllocation.deleteMany({ where: { tenantId: TENANT, statement: { lenderCode: LENDER } } }).catch(() => {});
    await prisma.floorplanInterestStatement.deleteMany({ where: { tenantId: TENANT, lenderCode: LENDER } });
    await prisma.floorplanAuditReference.deleteMany({ where: { tenantId: TENANT, after: { path: ['stagedRowId'], not: undefined } } }).catch(() => {});
    await prisma.$disconnect();
    await pgClient.end();
  });

  // ── 1/3/4 — accepted versioned canonical event, balanced journal, rule-pack
  // version pinned; also confirms JournalLine.controlNumber is really set on
  // the schedule-linked line (the coa-service half of the schedule bridge). ──
  it('a real advance-matched event POSTS through the live rule-pack engine with a balanced, version-pinned journal', async () => {
    RlsTenantContext.set(TENANT);
    const stock = `GC${Date.now().toString().slice(-8)}`;
    const { stagedRows } = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', stockNumber: stock, amount: '18500.00', statementDate: '2026-08-15' }] }, 'live-cert');
    const row = stagedRows[0];

    const result = await matchService.matchRow(TENANT, row.id, 'live-cert');
    expect(result.outcome).toBe('MATCHED');
    expect(result.status).toBe('POSTED');
    expect(result.journalNumber).toBeTruthy();

    // Balanced journal, real coa-service read.
    const view = await coa(`/api/v1/coa/journals/${encodeURIComponent(result.journalNumber!)}`, 'GET', TENANT);
    expect(view.status).toBe(200);
    expect(view.body.totalDebits).toBe(18500);
    expect(view.body.totalCredits).toBe(18500);
    expect(view.body.status).toBe('POSTED');

    // Rule-pack version pinned to a real, ACTIVE version + real ruleId.
    const exec = await coa(`/api/v1/coa/posting-engine/executions/by-event/${encodeURIComponent(row.id)}`, 'GET', TENANT);
    expect(exec.status).toBe(200);
    expect(exec.body.rulePackVersionId).toBeTruthy();
    expect(exec.body.ruleId).toBe('advance-matched-unconditional');
    expect(exec.body.status).toBe('POSTED');

    // coa-service really populated JournalLine.controlNumber on the
    // schedule-linked (19102) credit line — the exact data the
    // JOURNAL_ENTRY_POSTED bridge event would carry as controlNumber (see
    // this file's header comment for why the async bridge itself could not
    // be observed completing in this environment).
    await setPgTenant(TENANT);
    const lineRows = await pgClient.query(
      `SELECT account_number, control_number, dr, cr FROM journal_line WHERE journal_entry_id = (SELECT id FROM journal_entry WHERE tenant_id = $1 AND journal_number = $2)`,
      [TENANT, result.journalNumber],
    );
    const creditLine = lineRows.rows.find((r: any) => r.account_number === '19102');
    expect(creditLine).toBeTruthy();
    expect(creditLine.control_number).toBe(stock);
    expect(Number(creditLine.cr)).toBe(18500);
  });

  // ── 5 — idempotent duplicate handling ───────────────────────────────────
  it('resubmitting the SAME eventId is idempotent at the real coa-service (same executionId/journalNumber)', async () => {
    RlsTenantContext.set(TENANT);
    const stock = `GC${Date.now().toString().slice(-7)}I`;
    const { stagedRows } = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', stockNumber: stock, amount: '4200.00', statementDate: '2026-08-15' }] }, 'live-cert');
    const row = stagedRows[0];

    const envelope = buildEnvelope(TENANT, {
      eventType: EVENT_TYPES.ADVANCE_MATCHED,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      sourceEntityType: 'FLOORPLAN_STAGED_ROW',
      sourceEntityId: row.id,
      correlationId: row.id,
      businessDate: '2026-08-15',
      deterministicEventId: row.id,
      payload: { lenderCode: LENDER, applyNumber: stock, vin: null, stockNumber: stock, amount: '4200.00', stagedRowId: row.id },
    });

    const client = new HttpPostingEngineClient(JWT_SECRET, COA_SERVICE_URL);
    const first = await client.submitEvent(envelope);
    expect(first.status).toBe('POSTED');
    expect(first.idempotent).toBe(false);

    const second = await client.submitEvent(envelope);
    expect(second.status).toBe('POSTED');
    expect(second.idempotent).toBe(true);
    expect(second.executionId).toBe(first.executionId);
    expect(second.journalNumber).toBe(first.journalNumber);
  });

  // ── payoff-matched relieves the item, real coa-service POST ─────────────
  it('a real payoff-matched event relieves the liability item with a balanced journal', async () => {
    RlsTenantContext.set(TENANT);
    const stock = `GC${Date.now().toString().slice(-7)}P`;
    const advanceBatch = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', stockNumber: stock, amount: '9000.00', statementDate: '2026-08-15' }] }, 'live-cert');
    const advanceResult = await matchService.matchRow(TENANT, advanceBatch.stagedRows[0].id, 'live-cert');
    expect(advanceResult.status).toBe('POSTED');

    const payoffBatch = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'PAYOFF', stockNumber: stock, amount: '9000.00', statementDate: '2026-08-16' }] }, 'live-cert');
    const payoffResult = await matchService.matchRow(TENANT, payoffBatch.stagedRows[0].id, 'live-cert');
    expect(payoffResult.status).toBe('POSTED');

    const view = await coa(`/api/v1/coa/journals/${encodeURIComponent(payoffResult.journalNumber!)}`, 'GET', TENANT);
    expect(view.body.totalDebits).toBe(9000);
    expect(view.body.totalCredits).toBe(9000);

    const item = await prisma.floorplanLiabilityItem.findFirst({ where: { tenantId: TENANT, lenderCode: LENDER, stockNumber: stock } });
    expect(item?.status).toBe('RELIEVED');
    expect(Number(item?.remainingBalance)).toBe(0);
  });

  // ── 2/6/9 — tenant-configurable mapping (pending REJECTS, fixture-mapped
  // POSTS) against the REAL coa-service; missing-mapping rejection leaves no
  // partial journal AND does not mutate FloorplanLiabilityItem/tie-out;
  // rejected postings do not mutate operational balances. ──────────────────
  describe('tenant-configurable mapping — real coa-service, a fresh PENDING tenant', () => {
    const PENDING_TENANT = `floorplan-live-pending-${randomUUID()}`;
    const PENDING_ENTITY = `entity-pending-${randomUUID().slice(0, 8)}`;
    const PENDING_STORE = 'CE12-STORE-PENDING';

    beforeAll(async () => {
      // Fixture provisioning ONLY (never a normal write path): a fresh
      // tenant has zero journal sources, and coa-service's tenant-facing
      // journal-source API deliberately refuses tenant self-creation of a
      // SYSTEM-class source (CANNOT_CREATE_SYSTEM_SOURCE, 422 — see
      // scripts/seed-ce12-rule-packs.ts's ensureJournalSource doc comment).
      // This mirrors EXACTLY the pattern coa-service's own
      // tests/live-db/posting-engine-live.test.ts uses to provision its
      // equivalent fixture source (a direct SQL/Prisma write), and is the
      // only way a pure-REST-client test can get a SYSTEM source for a
      // throwaway certification tenant.
      await setPgTenant(PENDING_TENANT);
      await pgClient.query(
        `INSERT INTO journal_source (id, tenant_id, code, name, source_class, reserved, auto_post, year_end_only, thirteenth_only, status, version, created_at, updated_at)
         VALUES ($1, $2, 'FLRPLN', 'CE-12 Gap-Close PENDING Cert Fixture', 'SYSTEM', false, false, false, false, 'ACTIVE', 1, now(), now())`,
        [randomUUID(), PENDING_TENANT],
      );

      // OPEN fiscal period for the pending entity (posting requires one).
      await coa(`/api/v1/fiscal/entities/${encodeURIComponent(PENDING_ENTITY)}/fiscal-calendar`, 'POST', PENDING_TENANT, { fyStartMonth: 1, structure: 'TWELVE' });
      await coa(`/api/v1/fiscal/entities/${encodeURIComponent(PENDING_ENTITY)}/fiscal-calendar/years`, 'POST', PENDING_TENANT, { fiscalYear: 2026 });
      const periods = await coa(`/api/v1/fiscal/entities/${encodeURIComponent(PENDING_ENTITY)}/periods?fy=2026`, 'GET', PENDING_TENANT);
      const period = periods.body.periods.find((p: any) => p.code === '2026-08');
      await coa(`/api/v1/fiscal/periods/${period.id}/open`, 'POST', PENDING_TENANT, { confirm: true });

      // Author/validate/activate the PENDING-sentinel advance-matched rule
      // pack (mirrors seed-ce12-rule-packs.ts's default/blank mode).
      const PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING';
      const pack = {
        dslVersion: 1, tenantScope: PENDING_TENANT, entityId: PENDING_ENTITY,
        effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null,
        journalSourceCode: 'FLRPLN', matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
        packKey: 'ce12.floorplan-advance-matched', semver: '1.0.0',
        eventType: EVENT_TYPES.ADVANCE_MATCHED, supportedEventSchemaVersions: [EVENT_SCHEMA_VERSION],
        rules: [{
          ruleId: 'advance-matched-unconditional', priority: 1, description: 'PENDING cert fixture', condition: null,
          blueprint: {
            memoTemplate: 'Floorplan advance — {{payload.lenderCode}} / {{payload.applyNumber}}',
            postingGroups: [{
              groupId: 'advance', baseAmountPath: 'payload.amount',
              debitAllocations: [{ accountNumber: PENDING, storeId: PENDING_STORE, bp: 10000 }],
              creditAllocations: [{ accountNumber: PENDING, storeId: PENDING_STORE, bp: 10000, controlNumberPath: 'payload.stockNumber' }],
            }],
          },
        }],
      };
      const created = await coa('/api/v1/coa/posting-engine/rule-packs', 'POST', PENDING_TENANT, { packKey: pack.packKey, sourceText: JSON.stringify(pack) });
      const validated = await coa(`/api/v1/coa/posting-engine/rule-pack-versions/${created.body.id}/validate`, 'POST', PENDING_TENANT, {});
      expect(validated.body.valid).toBe(true); // ACCOUNT_MAPPING_VALUES_PENDING is a validation WARNING, not an error
      await coa(`/api/v1/coa/posting-engine/rule-pack-versions/${created.body.id}/activate`, 'POST', PENDING_TENANT, {});

      RlsTenantContext.set(PENDING_TENANT);
      await lenderService.upsertLenderProfile(PENDING_TENANT, { lenderCode: LENDER, lenderName: 'Pending Cert Lender', adapterStatus: 'CONFIGURED', adapterType: 'FIXTURE_FEED' }, 'live-cert-setup');
    });

    afterAll(async () => {
      RlsTenantContext.set(PENDING_TENANT);
      await prisma.floorplanMatch.deleteMany({ where: { tenantId: PENDING_TENANT } });
      await prisma.floorplanLiabilityItem.deleteMany({ where: { tenantId: PENDING_TENANT } });
      await prisma.floorplanStagedRow.deleteMany({ where: { tenantId: PENDING_TENANT } });
      await prisma.floorplanImportBatch.deleteMany({ where: { tenantId: PENDING_TENANT } });
      await prisma.lenderProfile.deleteMany({ where: { tenantId: PENDING_TENANT } });
      await setPgTenant(PENDING_TENANT);
      await pgClient.query(`DELETE FROM journal_source WHERE tenant_id = $1`, [PENDING_TENANT]);
    });

    it('the PENDING-sentinel version deterministically REJECTS, leaves no partial journal, and does not mutate FloorplanLiabilityItem/tie-out', async () => {
      RlsTenantContext.set(PENDING_TENANT);
      const stock = `GCP${Date.now().toString().slice(-7)}`;
      const { stagedRows } = await feedService.importManualBatch(PENDING_TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', stockNumber: stock, amount: '3000.00', statementDate: '2026-08-15' }] }, 'live-cert');
      const row = stagedRows[0];

      const result = await matchService.matchRow(PENDING_TENANT, row.id, 'live-cert');
      expect(result.status).toBe('REJECTED');
      expect(result.journalNumber).toBeFalsy();

      // No partial journal — the same idempotency key never produced a JE.
      await setPgTenant(PENDING_TENANT);
      const jeRows = await pgClient.query(`SELECT count(*)::int AS n FROM journal_entry WHERE tenant_id = $1 AND idempotency_key LIKE $2`, [PENDING_TENANT, `%${row.id}%`]);
      expect(jeRows.rows[0].n).toBe(0);

      // Own ledger NOT mutated (S080 tie-out honesty guarantee).
      const item = await prisma.floorplanLiabilityItem.findFirst({ where: { tenantId: PENDING_TENANT, lenderCode: LENDER, stockNumber: stock } });
      expect(item).toBeNull();
      const applications = await prisma.floorplanLiabilityApplication.count({ where: { tenantId: PENDING_TENANT } });
      expect(applications).toBe(0);
    });
  });

  // ── S218 — symmetric reversal, real coa-service post + reverse ──────────
  it('interest accrual posts through the real coa-service with a balanced journal, and S218 reversal is symmetric', async () => {
    RlsTenantContext.set(TENANT);
    const statement = await interestService.enterStatement(TENANT, { lenderCode: LENDER, statementDate: '2026-08-20', totalInterestAmount: '640.00', allocationBasis: 'PER_UNIT_EQUAL', idempotencyKey: `int-${randomUUID()}` }, 'live-cert');
    // Need at least one open item to allocate against.
    const stock = `GC${Date.now().toString().slice(-7)}R`;
    const advanceBatch = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', stockNumber: stock, amount: '5000.00', statementDate: '2026-08-01' }] }, 'live-cert');
    const advanceResult = await matchService.matchRow(TENANT, advanceBatch.stagedRows[0].id, 'live-cert');
    expect(advanceResult.status).toBe('POSTED');

    await interestService.allocate(TENANT, statement.id, 'live-cert');
    const posted = await interestService.postAccrual(TENANT, statement.id, 'live-cert');
    expect(posted.status).toBe('POSTED');
    expect(posted.journalNumber).toBeTruthy();

    const originalView = await coa(`/api/v1/coa/journals/${encodeURIComponent(posted.journalNumber!)}`, 'GET', TENANT);
    expect(originalView.body.totalDebits).toBe(640);
    expect(originalView.body.totalCredits).toBe(640);

    // Bug fix verified by this test (CE-12 gap-close): HttpPostingEngineClient.
    // reverseJournal() previously returned coa-service's raw response
    // untouched, but coa-service's ReversalService.reverse() actually
    // responds with {reversalId, reversalNumber, ...} (ReverseResult), not
    // {id, journalNumber} — every caller's `reversal.id`/`reversal.
    // journalNumber` (this call included) silently read as undefined,
    // persisting a null reversalJournalEntryId/reversalJournalNumber on an
    // otherwise-successful 201 reversal. Fixed in
    // src/infrastructure/posting-engine-client.ts (now maps the fields
    // explicitly); this is the real, live proof that the fix works.
    const reversed = await interestService.reverseAccrual(TENANT, statement.id, 'Duplicate lender statement — reversing per controller review', 'live-cert');
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalJournalNumber).toBeTruthy();

    const reversalView = await coa(`/api/v1/coa/journals/${encodeURIComponent(reversed.reversalJournalNumber!)}`, 'GET', TENANT);
    expect(reversalView.body.totalDebits).toBe(640);
    expect(reversalView.body.totalCredits).toBe(640);
    expect(reversalView.body.reversalOf?.journalNumber).toBe(posted.journalNumber);
    // Symmetric: the reversal's lines are the exact dr/cr mirror of the original.
    const originalLines = [...originalView.body.lines].sort((a: any, b: any) => a.account.localeCompare(b.account));
    const reversalLines = [...reversalView.body.lines].sort((a: any, b: any) => a.account.localeCompare(b.account));
    expect(reversalLines.length).toBe(originalLines.length);
    for (let i = 0; i < originalLines.length; i++) {
      expect(reversalLines[i].account).toBe(originalLines[i].account);
      expect(reversalLines[i].dr).toBe(originalLines[i].cr);
      expect(reversalLines[i].cr).toBe(originalLines[i].dr);
    }
  });

  // ── 8 — schedule effects (real schedule-service, real GET) ──────────────
  // FIXED (out of this service's own file scope, but the exact blocker
  // this test used to work around with a manual pg-client write): two
  // upstream defects, both fixed centrally during CE-12 gap-closure —
  //   1. schedule-service's ScheduleEventHandlers had an undecorated
  //      OpenItemService constructor param that tsx/esbuild's decorator-
  //      metadata emission silently resolved to undefined, crashing every
  //      JOURNAL_ENTRY_POSTED handler invocation (swallowed by the
  //      RabbitMQ consumer's Promise.allSettled+ack) — fixed with an
  //      explicit @inject(OpenItemService).
  //   2. this shared dev environment's RabbitMQ broker was also serving an
  //      unrelated worktree's own schedule-service instance bound to the
  //      same unnamespaced queue name, which won the majority of
  //      deliveries — fixed by moving this cert stack onto its own
  //      RabbitMQ vhost.
  // The real async bridge now works, so this test polls the real
  // schedule-service HTTP API instead of writing the row itself.
  it('real schedule-service open-item creation on advance-match and real relief on payoff-match', async () => {
    RlsTenantContext.set(TENANT);
    await setPgTenant(TENANT);
    const stock = `GC${Date.now().toString().slice(-7)}S`;

    const advanceBatch = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', stockNumber: stock, amount: '7777.00', statementDate: '2026-08-15' }] }, 'live-cert');
    const advanceResult = await matchService.matchRow(TENANT, advanceBatch.stagedRows[0].id, 'live-cert');
    expect(advanceResult.status).toBe('POSTED');

    // Confirm coa-service really set controlNumber on the schedule-linked
    // line for THIS journal (the real data the bridge carries).
    const advanceLine = await pgClient.query(
      `SELECT control_number FROM journal_line WHERE journal_entry_id = (SELECT id FROM journal_entry WHERE tenant_id = $1 AND journal_number = $2) AND account_number = '19102'`,
      [TENANT, advanceResult.journalNumber],
    );
    expect(advanceLine.rows[0].control_number).toBe(stock);

    // REAL GET against the REAL running schedule-service, polled — the
    // bridge event is best-effort/async, published after coa-service's own
    // HTTP response already returned.
    let openItemsAfterAdvance: any;
    for (let attempt = 0; attempt < 10; attempt++) {
      openItemsAfterAdvance = await schedule(`/api/v1/schedules/${FLOORPLAN_SCHEDULE_NUMBER}/open-items?controlNumber=${encodeURIComponent(stock)}`, 'GET', TENANT);
      if (openItemsAfterAdvance.body?.length > 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(openItemsAfterAdvance.status).toBe(200);
    expect(openItemsAfterAdvance.body).toHaveLength(1);
    expect(openItemsAfterAdvance.body[0].status).toBe('OPEN');
    // The bridge computes amount = dr - cr; the advance credits the
    // liability account (19102), so the real, consistent sign is negative
    // (same convention proven for every other CE-12 credit-side liability
    // origination, e.g. deal-accounting-service's trade-payoff item).
    expect(Number(openItemsAfterAdvance.body[0].remainingBalance)).toBe(-7777);

    // Payoff-matched — real coa-service posting, real relief via the same bridge.
    const payoffBatch = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'PAYOFF', stockNumber: stock, amount: '7777.00', statementDate: '2026-08-20' }] }, 'live-cert');
    const payoffResult = await matchService.matchRow(TENANT, payoffBatch.stagedRows[0].id, 'live-cert');
    expect(payoffResult.status).toBe('POSTED');

    const payoffLine = await pgClient.query(
      `SELECT control_number, apply_number FROM journal_line WHERE journal_entry_id = (SELECT id FROM journal_entry WHERE tenant_id = $1 AND journal_number = $2) AND account_number = '19102'`,
      [TENANT, payoffResult.journalNumber],
    );
    expect(payoffLine.rows[0].control_number).toBe(stock);
    expect(payoffLine.rows[0].apply_number).toBe(stock);

    let openItemsAfterPayoff: any;
    for (let attempt = 0; attempt < 10; attempt++) {
      openItemsAfterPayoff = await schedule(`/api/v1/schedules/${FLOORPLAN_SCHEDULE_NUMBER}/open-items?controlNumber=${encodeURIComponent(stock)}`, 'GET', TENANT);
      if (openItemsAfterPayoff.body?.[0]?.status === 'CLOSED') break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(openItemsAfterPayoff.status).toBe(200);
    expect(openItemsAfterPayoff.body[0].status).toBe('CLOSED');
    expect(Number(openItemsAfterPayoff.body[0].remainingBalance)).toBe(0);
  });
});
