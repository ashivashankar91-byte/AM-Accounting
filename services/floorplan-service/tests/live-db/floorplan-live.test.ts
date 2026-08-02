/**
 * CE-12 (S079/S080/S081/S082) — Floorplan Service LIVE DATABASE
 * certification suite.
 *
 * Same skip-unless-LIVE_DATABASE_URL convention as
 * services/coa-service/tests/live-db/posting-engine-live.test.ts and
 * services/schedule-service/tests/live-db/open-item-live.test.ts. Runs
 * against a real Postgres (the shared docker-compose `amacc` dev database,
 * localhost:5433, matching schedule-service's live-db precedent — this
 * service has no dedicated ephemeral-cluster bootstrap script yet). Every
 * fixture uses a randomUUID-suffixed tenantId, so this never collides with
 * or mutates any other tenant's data already present in that shared
 * database.
 *
 * The posting engine / posting-recovery HTTP clients are swapped for the
 * deterministic in-memory test doubles (InMemoryPostingEngineClient /
 * InMemoryPostingRecoveryClient) — this suite certifies floorplan-service's
 * OWN DB behavior (idempotency, concurrency, tie-out math, RLS, audit),
 * not coa-service's live posting engine (that is coa-service's own
 * certification surface, exercised in services/coa-service/tests/live-db/).
 *
 * Covers:
 *   1. Match idempotency: two concurrent matchRow() calls for the SAME
 *      staged row produce exactly one FloorplanMatch row (DB unique
 *      constraint on staged_row_id, not just an application-level check).
 *   2. Advance -> liability item opens; payoff -> relieves; tie-out
 *      inquiry reports $0 variance.
 *   3. A REJECTED posting does NOT move the liability item balance (S080's
 *      tie-out honesty guarantee).
 *   4. Break detection + disposition ceremony is audited
 *      (floorplan_break_disposition idempotent on idempotencyKey).
 *   5. SOT evaluation: a delivered unit whose item is still open transitions
 *      WATCH -> ESCALATED once the grace period elapses, with an audited
 *      escalation-history row.
 *   6. RLS-negative: a non-BYPASSRLS role scoped to tenant A cannot see
 *      tenant B's staged rows, proven with a real restricted connection.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/floorplan-client';
import { createTenantRlsMiddleware, RlsTenantContext } from '@amacc/shared-kernel';
import { FeedService } from '../../src/application/feed-service';
import { LenderService } from '../../src/application/lender-service';
import { MatchService } from '../../src/application/match-service';
import { BreakService } from '../../src/application/break-service';
import { TieOutService } from '../../src/application/tie-out-service';
import { SotService } from '../../src/application/sot-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { InMemoryPostingEngineClient } from '../../src/infrastructure/posting-engine-client';
import { InMemoryPostingRecoveryClient } from '../../src/infrastructure/posting-recovery-client';
import { InMemoryScheduleServiceClient } from '../../src/infrastructure/schedule-service-client';
import { FLOORPLAN_SCHEDULE_NUMBER } from '../../src/domain/event-types';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('CE-12 Live database — floorplan-service', () => {
  let prisma: PrismaClient;
  let lenderService: LenderService;
  let feedService: FeedService;
  let matchService: MatchService;
  let breakService: BreakService;
  let tieOutService: TieOutService;
  let sotService: SotService;
  let scheduleClient: InMemoryScheduleServiceClient;

  const TENANT = `floorplan-live-${randomUUID()}`;
  const LENDER = 'ACME-CAP';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    // CE-12 gap-close fix: LIVE_DATABASE_URL's role is not guaranteed to be
    // a BYPASSRLS superuser (a prior version of this suite's RLS-negative
    // test assumed it always was — see that test's own doc comment). Under
    // a real cert environment's restricted, forced-RLS role (e.g.
    // amacc_app), every query needs app.current_tenant_id set first, same
    // as the real running service does via createTenantRlsMiddleware/
    // tenantContextHook.
    (prisma as any).$use(createTenantRlsMiddleware(prisma));

    lenderService = new LenderService(prisma as any);
    feedService = new FeedService(prisma as any, lenderService);
    scheduleClient = new InMemoryScheduleServiceClient();
    tieOutService = new TieOutService(prisma as any, scheduleClient);
    sotService = new SotService(prisma as any);

    RlsTenantContext.set(TENANT);
    await lenderService.upsertLenderProfile(TENANT, { lenderCode: LENDER, lenderName: 'Acme Capital', adapterStatus: 'CONFIGURED', adapterType: 'FIXTURE_FEED' }, 'test-setup');
  });

  afterAll(async () => {
    RlsTenantContext.set(TENANT);
    await prisma.floorplanSotEscalationHistory.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanSotException.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanDeliveryEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanBreakDisposition.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanBreak.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanLiabilityApplication.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanMatch.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanLiabilityItem.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanStagedRow.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanImportBatch.deleteMany({ where: { tenantId: TENANT } });
    await prisma.lenderProfile.deleteMany({ where: { tenantId: TENANT } });
    await prisma.floorplanAuditReference.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  function scriptedPostedOrchestrator() {
    const postingEngine = new InMemoryPostingEngineClient((envelope) => ({
      executionId: randomUUID(),
      eventId: envelope.eventId,
      status: 'POSTED',
      idempotent: false,
      rulePackVersionId: 'rp-1',
      ruleId: 'rule-1',
      journalEntryId: randomUUID(),
      journalNumber: `JE-${envelope.eventId.slice(0, 8)}`,
      failureReason: null,
    }));
    const postingRecovery = new InMemoryPostingRecoveryClient();
    return { orchestrator: new PostingOrchestrator(postingEngine as any, postingRecovery as any), postingEngine, postingRecovery };
  }

  function scriptedRejectedOrchestrator() {
    const postingEngine = new InMemoryPostingEngineClient((envelope) => ({
      executionId: randomUUID(),
      eventId: envelope.eventId,
      status: 'REJECTED',
      idempotent: false,
      rulePackVersionId: 'rp-1',
      ruleId: 'rule-1',
      journalEntryId: null,
      journalNumber: null,
      failureReason: 'Account ACCOUNT_MAPPING_VALUES_PENDING could not be resolved.',
    }));
    const postingRecovery = new InMemoryPostingRecoveryClient();
    return { orchestrator: new PostingOrchestrator(postingEngine as any, postingRecovery as any), postingEngine, postingRecovery };
  }

  it('an ADVANCE that POSTS opens a liability item and ties out to $0 variance', async () => {
    RlsTenantContext.set(TENANT);
    const { orchestrator } = scriptedPostedOrchestrator();
    matchService = new MatchService(prisma as any, orchestrator);

    const vin = `VIN-${randomUUID().slice(0, 8)}`;
    const { stagedRows } = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', vin, amount: '25000.00', statementDate: '2026-08-01' }] }, 'tester');
    const row = stagedRows[0];

    const result = await matchService.matchRow(TENANT, row.id, 'tester');
    expect(result.outcome).toBe('MATCHED');
    expect(result.status).toBe('POSTED');

    // CE-12 gap-close: TieOutService's authoritative "sum of open items"
    // side now comes from schedule-service's real ScheduleOpenItem ledger,
    // not this service's own FloorplanLiabilityItem table (see
    // tie-out-service.ts's doc comment). This suite exercises
    // floorplan-service's OWN DB behavior against an in-memory
    // posting-engine double (file header) — it never calls real
    // coa-service/schedule-service, so the schedule-service open item a
    // REAL posting would have opened is stubbed here to exercise
    // TieOutService's schedule-service-sourced computation in isolation.
    // The REAL, non-stubbed proof (a real posted journal really opening a
    // real schedule-service open item) lives in
    // tests/live-db/schedule-linkage-live.test.ts.
    scheduleClient.setItems([
      {
        id: randomUUID(),
        scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER,
        controlNumber: vin,
        itemNumber: vin,
        glAccountNumber: '19102',
        originalAmount: '25000.00',
        appliedAmount: '0.00',
        remainingBalance: '25000.00',
        status: 'OPEN',
        transactionDate: '2026-08-01T00:00:00.000Z',
        journalEntryId: result.journalNumber ?? randomUUID(),
      },
    ]);

    const tieOut = await tieOutService.computeTieOut(TENANT, LENDER);
    expect(tieOut.tied).toBe(true);
    expect(tieOut.variance).toBe('0.00');
    expect(tieOut.sumOfOpenLiabilityItems).toBe('25000.00');
    expect(tieOut.scheduleNumber).toBe(FLOORPLAN_SCHEDULE_NUMBER);
  });

  it('matchRow is idempotent on the staged row identity — concurrent calls create exactly one FloorplanMatch', async () => {
    RlsTenantContext.set(TENANT);
    const { orchestrator } = scriptedPostedOrchestrator();
    matchService = new MatchService(prisma as any, orchestrator);

    const { stagedRows } = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', vin: `VIN-${randomUUID().slice(0, 8)}`, amount: '10000.00', statementDate: '2026-08-01' }] }, 'tester');
    const row = stagedRows[0];

    const [r1, r2, r3] = await Promise.all([
      matchService.matchRow(TENANT, row.id, 'tester'),
      matchService.matchRow(TENANT, row.id, 'tester'),
      matchService.matchRow(TENANT, row.id, 'tester'),
    ]);

    const matchIds = new Set([r1.matchId, r2.matchId, r3.matchId]);
    expect(matchIds.size).toBe(1);

    const count = await prisma.floorplanMatch.count({ where: { tenantId: TENANT, stagedRowId: row.id } });
    expect(count).toBe(1);
  });

  it('a REJECTED posting does not move the liability item balance (tie-out honesty)', async () => {
    RlsTenantContext.set(TENANT);
    const { orchestrator } = scriptedRejectedOrchestrator();
    matchService = new MatchService(prisma as any, orchestrator);

    const vin = `VIN-${randomUUID().slice(0, 8)}`;
    const { stagedRows } = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', vin, amount: '5000.00', statementDate: '2026-08-01' }] }, 'tester');
    const row = stagedRows[0];

    const result = await matchService.matchRow(TENANT, row.id, 'tester');
    expect(result.status).toBe('REJECTED');

    const item = await prisma.floorplanLiabilityItem.findFirst({ where: { tenantId: TENANT, vin } });
    expect(item).toBeNull();
  });

  it('a PAYOFF equal to the remaining balance fully relieves the item', async () => {
    RlsTenantContext.set(TENANT);
    const { orchestrator } = scriptedPostedOrchestrator();
    matchService = new MatchService(prisma as any, orchestrator);
    const vin = `VIN-${randomUUID().slice(0, 8)}`;

    const advanceImport = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', vin, amount: '15000.00', statementDate: '2026-08-01' }] }, 'tester');
    await matchService.matchRow(TENANT, advanceImport.stagedRows[0].id, 'tester');

    const payoffImport = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'PAYOFF', vin, amount: '15000.00', statementDate: '2026-08-05' }] }, 'tester');
    const payoffResult = await matchService.matchRow(TENANT, payoffImport.stagedRows[0].id, 'tester');
    expect(payoffResult.status).toBe('POSTED');

    const item = await prisma.floorplanLiabilityItem.findFirst({ where: { tenantId: TENANT, vin } });
    expect(item.status).toBe('RELIEVED');
    expect(Number(item.remainingBalance)).toBe(0);
  });

  it('a PAYOFF exceeding the remaining balance is a dispositioned, audited break', async () => {
    RlsTenantContext.set(TENANT);
    const { orchestrator } = scriptedPostedOrchestrator();
    matchService = new MatchService(prisma as any, orchestrator);
    breakService = new BreakService(prisma as any, orchestrator);
    const vin = `VIN-${randomUUID().slice(0, 8)}`;

    const advanceImport = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', vin, amount: '10000.00', statementDate: '2026-08-01' }] }, 'tester');
    await matchService.matchRow(TENANT, advanceImport.stagedRows[0].id, 'tester');

    const payoffImport = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'PAYOFF', vin, amount: '10050.00', statementDate: '2026-08-05' }] }, 'tester');
    const payoffResult = await matchService.matchRow(TENANT, payoffImport.stagedRows[0].id, 'tester');
    expect(payoffResult.outcome).toBe('BREAK_DETECTED');

    const brk = await breakService.getBreak(TENANT, payoffResult.breakId!);
    expect(brk.breakType).toBe('AMOUNT_VARIANCE');
    // Prisma's Decimal.toString() (decimal.js) strips trailing zeros
    // ('50' not '50.00') even though the underlying NUMERIC(15,2) column
    // stores exact 2dp precision — compare numerically, not as a literal
    // formatted string, to avoid a false failure on that library quirk.
    expect(Number(brk.varianceAmount)).toBe(50);

    const idempotencyKey = `disp-${randomUUID()}`;
    const disp1 = await breakService.dispositionBreak(TENANT, brk.id, { action: 'NO_ACTION_DOCUMENTED', reason: 'Under investigation with lender', idempotencyKey }, 'controller-1');
    const disp2 = await breakService.dispositionBreak(TENANT, brk.id, { action: 'NO_ACTION_DOCUMENTED', reason: 'Under investigation with lender', idempotencyKey }, 'controller-1');
    expect(disp1.id).toBe(disp2.id);

    const dispositionCount = await prisma.floorplanBreakDisposition.count({ where: { tenantId: TENANT, breakId: brk.id } });
    expect(dispositionCount).toBe(1);

    const auditRows = await prisma.floorplanAuditReference.count({ where: { tenantId: TENANT, entityId: brk.id, eventType: 'floorplan.break.dispositioned' } });
    expect(auditRows).toBe(1);
  });

  it('SOT: a delivered unit whose item is still open escalates past the grace period, with audited history', async () => {
    RlsTenantContext.set(TENANT);
    const { orchestrator } = scriptedPostedOrchestrator();
    matchService = new MatchService(prisma as any, orchestrator);
    const vin = `VIN-${randomUUID().slice(0, 8)}`;

    const advanceImport = await feedService.importManualBatch(TENANT, LENDER, { rows: [{ rowType: 'ADVANCE', vin, amount: '20000.00', statementDate: '2026-08-01' }] }, 'tester');
    await matchService.matchRow(TENANT, advanceImport.stagedRows[0].id, 'tester');

    const deliveredAt = new Date(Date.now() - 10 * 86_400_000); // 10 days ago
    await sotService.recordDeliveryEvent(TENANT, { vin, dealNumber: `DEAL-${randomUUID().slice(0, 6)}`, deliveredAt: deliveredAt.toISOString(), idempotencyKey: `deliv-${randomUUID()}`, source: 'MANUAL_FIXTURE' }, 'tester');

    await sotService.evaluate(TENANT, new Date());
    const exceptions = await sotService.listExceptions(TENANT, {});
    const found = exceptions.find((e: any) => e.item.vin === vin);
    expect(found).toBeTruthy();
    expect(found.escalationState).toBe('ESCALATED');

    const history = await prisma.floorplanSotEscalationHistory.findMany({ where: { tenantId: TENANT, sotExceptionId: found.id } });
    expect(history.length).toBeGreaterThan(0);
    expect(history.some((h: any) => h.toState === 'ESCALATED')).toBe(true);
  });

  it('RLS-negative: a restricted role scoped to tenant A cannot see tenant B staged rows', async () => {
    const client = new pg.Client({ connectionString: LIVE_DB_URL });
    await client.connect();
    const restrictedRole = `floorplan_rls_test_${randomUUID().replace(/-/g, '_').slice(0, 20)}`;
    try {
      await client.query(`CREATE ROLE ${restrictedRole} LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${restrictedRole}`);

      const other = `floorplan-live-other-${randomUUID()}`;
      RlsTenantContext.set(other);
      await lenderService.upsertLenderProfile(other, { lenderCode: LENDER, lenderName: 'Other Tenant Lender', adapterStatus: 'CONFIGURED', adapterType: 'FIXTURE_FEED' }, 'test-setup');
      const { batch } = await feedService.importManualBatch(other, LENDER, { rows: [{ rowType: 'ADVANCE', vin: `VIN-${randomUUID().slice(0, 8)}`, amount: '1.00', statementDate: '2026-08-01' }] }, 'tester');

      // CRITICAL: pg.Client silently IGNORES explicit user/password fields
      // when a connectionString with different embedded credentials is also
      // passed — it connects using the connectionString's own credentials,
      // not the override. Passing both (as this test previously did) meant
      // this "restricted" client was actually connecting as LIVE_DB_URL's
      // own user (amacc, a BYPASSRLS superuser in this harness), so the
      // assertion below always passed vacuously regardless of whether RLS
      // was enforced. Fix: embed the restricted role's own credentials
      // directly in the connection string, same pattern as
      // vehicle-accounting-service's tests/live-db/rls-live.test.ts.
      const restrictedUrl = LIVE_DB_URL!.replace(/:\/\/[^:@/]+(:[^@/]*)?@/, `://${restrictedRole}:test@`);
      const restrictedClient = new pg.Client({ connectionString: restrictedUrl });
      await restrictedClient.connect();
      await restrictedClient.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
      const rows = await restrictedClient.query(`SELECT * FROM floorplan_import_batch WHERE id = $1`, [batch.id]);
      expect(rows.rows.length).toBe(0);
      await restrictedClient.end();

      await prisma.floorplanStagedRow.deleteMany({ where: { tenantId: other } });
      await prisma.floorplanImportBatch.deleteMany({ where: { tenantId: other } });
      await prisma.lenderProfile.deleteMany({ where: { tenantId: other } });
    } finally {
      // CE-12 gap-close hardening: some cert environments' LIVE_DATABASE_URL
      // role has CREATEROLE (can create restrictedRole above) but not the
      // ADMIN option on roles it creates (confirmed: DROP ROLE fails there
      // with "Only roles with the CREATEROLE attribute and the ADMIN option
      // on the target roles may drop roles"). That is a role-cleanup
      // hygiene concern, never the RLS assertion itself (which already ran,
      // above, before this block) — don't fail the whole test over it, but
      // don't silently pretend cleanup succeeded either.
      await client.query(`DROP OWNED BY ${restrictedRole}`).catch(() => {});
      await client.query(`DROP ROLE IF EXISTS ${restrictedRole}`).catch((err: unknown) => {
        console.warn(`[floorplan-live.test] could not drop test role ${restrictedRole} (non-fatal, cleanup-only): ${(err as Error).message}`);
      });
      await client.end();
    }
  });
});
