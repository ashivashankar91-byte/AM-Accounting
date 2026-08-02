/**
 * CE-12 gap-close — LIVE DATABASE + REAL coa-service/schedule-service HTTP
 * certification proof.
 *
 * Unlike every other tests/live-db/*.test.ts file in this service (which
 * scripts the coa-service boundary via ScriptedPostingEngineClient — see
 * fakes.ts's header comment), this file calls the REAL, already-running
 * coa-service (COA_SERVICE_URL) and REAL, already-running schedule-service
 * (SCHEDULE_SERVICE_URL) over genuine HTTP, exactly as this service's own
 * HttpPostingEngineClient/ScheduleServiceClient production code does. It
 * runs against the shared CE-12 certification tenant this task was handed
 * (`tenant-kunes` / `entity-kunes-delavan` / `STORE-1`), which
 * scripts/seed-ce12-rule-packs.ts --test-tenant must have already
 * provisioned (fixture GL accounts, journal source, 9 activated rule packs,
 * and — the CE-12 gap-close addition — schedules 80/81/82 with scheduleCode
 * wired onto the corresponding fixture accounts).
 *
 * Requires: LIVE_DATABASE_URL, AMACC_JWT_SECRET, COA_SERVICE_URL,
 * SCHEDULE_SERVICE_URL, POSTING_RECOVERY_SERVICE_URL (optional — defaults to
 * http://posting-recovery-service:3049, override for a local run). Skipped
 * entirely (not failed) when any of the first four are unset, so this file
 * never breaks a plain `vitest run` in an environment without the real
 * services up.
 *
 * RESOLVED UPSTREAM FINDINGS (originally discovered by this file's live-db
 * tests during CE-12 gap-closure; both fixed centrally, outside this
 * service's own file tree, and verified via this same suite afterward):
 *
 * 1. schedule-service's ScheduleDetail/ScheduleOpenItem.journalSource
 *    columns were `@db.Char(2)` (legacy COBOL DE-SOURCE PIC XX width).
 *    Every CE-12 sibling service's journalSourceCode is longer ("CE12" = 4,
 *    "FLRPLN" = 6, "DEAL" = 4, "FNI" = 3) — none fit. coa-service's real
 *    JOURNAL_ENTRY_POSTED bridge event set `journalSource: dto.sourceCode`
 *    with no truncation, so OpenItemService.processPostingEvent() threw a
 *    genuine Postgres "value too long for type character(2)" error inside
 *    its own SERIALIZABLE transaction. That error was silently swallowed by
 *    schedule-service's RabbitMQ consumer (infrastructure/event-
 *    publisher.ts's `subscribe()`, which awaits handlers via
 *    `Promise.allSettled` and unconditionally ACKs afterward) — so no
 *    ScheduleDetail/ScheduleOpenItem row was ever created for any CE-12
 *    posting. Fixed by widening both columns to VARCHAR(10)
 *    (services/schedule-service/prisma/migrations/
 *    20260802030000_widen_journal_source_ce12).
 *
 * 2. coa-service's ReversalService.reverse() (services/coa-service/src/
 *    application/reversal-service.ts) hardcoded `callerClass: 'MANUAL'`
 *    when re-posting a mirrored reversal, so BR013-3 (caller class must
 *    match the journal source's own sourceClass) deterministically
 *    rejected every reversal of a SYSTEM-sourced — i.e. every CE-12
 *    posting-engine-originated — journal entry with HTTP 422. Fixed by
 *    looking up the original journal's own source and using its
 *    sourceClass as the reversal's callerClass.
 *
 * Both fixes are proven live below: test 7) reverses a real SYSTEM-sourced
 * CE12 journal successfully, and test 8) asserts a real ScheduleOpenItem
 * row exists after a real stock-in posting, sourced purely from the async
 * JOURNAL_ENTRY_POSTED bridge event this service's own posting call
 * published — no direct write from this service's code.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createServiceToken } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/vehicle-accounting-client';
import { VehicleUnitService } from '../../src/application/vehicle-unit-service';
import { DealerTradeService } from '../../src/application/dealer-trade-service';
import { PostingOrchestrator } from '../../src/application/posting-orchestrator';
import { HttpPostingEngineClient } from '../../src/infrastructure/posting-engine-client';
import { HttpPostingRecoveryClient } from '../../src/infrastructure/posting-recovery-client';
import { ScheduleServiceClient } from '../../src/infrastructure/schedule-client';
import { buildRulePacks, SCHEDULE_NUMBERS, ROLE_FIXTURES } from '../../src/domain/rule-pack-definitions';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
const COA_BASE = (process.env['COA_SERVICE_URL'] ?? '').replace(/\/$/, '');
const SCHEDULE_BASE = (process.env['SCHEDULE_SERVICE_URL'] ?? '').replace(/\/$/, '');

const RUN = Boolean(LIVE_DB_URL && JWT_SECRET && COA_BASE && SCHEDULE_BASE);

// Pre-provisioned CE-12 certification fixtures (see this file's header).
const TENANT = 'tenant-kunes';
const ENTITY = 'entity-kunes-delavan';
const STORE = 'STORE-1';
// Unique per test run so afterAll's cleanup can precisely target only rows
// THIS run created, never another concurrently-running sibling agent's data
// on the same shared cert tenant.
const RUN_ID = randomUUID().slice(0, 8);

function coaToken(actor: string): string {
  return createServiceToken(actor, JWT_SECRET!);
}

async function coaFetch(actor: string, path: string, init?: { method?: string; body?: unknown }) {
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${COA_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': TENANT, Authorization: `Bearer ${coaToken(actor)}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

async function scheduleFetch(path: string) {
  const res = await fetch(`${SCHEDULE_BASE}${path}`, {
    headers: { 'x-tenant-id': TENANT, Authorization: `Bearer ${coaToken('ce12-live-test')}` },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

/** Author + validate + activate a rule-pack version for ce12.vehicle-recon-cost-added
 * — reused to flip this ONE pack between blank/pending and test-fixture mode
 * (item #2/#6's proof), mirroring scripts/seed-ce12-rule-packs.ts's own
 * author/activate flow exactly (same SoD actor split). Only this single
 * packKey is touched, and it is always restored to fixture-mode (the state
 * every other test in this file, and sibling agents' concurrent work on
 * tenant-kunes, expects) in afterAll. */
let reconPackVersionCounter = 0;
async function activateReconPackVersion(testFixtureMode: boolean): Promise<string> {
  const [def] = buildRulePacks({ tenantId: TENANT, entityId: ENTITY, storeId: STORE, testFixtureMode }).filter(
    (p) => (p as any).packKey === 'ce12.vehicle-recon-cost-added',
  );
  // Every activateReconPackVersion() call must author a genuinely NEW
  // version — coa-service's rule-pack-versions are content-addressed, and
  // buildRulePacks() otherwise hardcodes semver "1.0.0" for every call
  // (including this test's own toggling AND the already-activated fixture
  // version scripts/seed-ce12-rule-packs.ts --test-tenant authored earlier
  // in this same run), which collides on a (packKey, contentHash-derived)
  // unique constraint. Bump semver's patch component per call so each
  // author() call is unambiguously a new, distinct version.
  reconPackVersionCounter += 1;
  // Date.now()-seeded, not just a small in-process counter — a small
  // counter alone repeats across separate `vitest run` invocations (each
  // starts reconPackVersionCounter back at 0), which re-collides with a
  // version this same suite authored on a PRIOR run. Date.now() makes every
  // process run's semvers disjoint from every other run's.
  (def as any).semver = `1.${Date.now()}.${reconPackVersionCounter}`;
  const created = await coaFetch('ce12-rulepack-author', '/api/v1/coa/posting-engine/rule-packs', {
    method: 'POST',
    body: { packKey: (def as any).packKey, sourceText: JSON.stringify(def) },
  });
  if (!created.ok) throw new Error(`author failed: HTTP ${created.status} ${JSON.stringify(created.body)}`);
  const versionId = created.body.id;
  const validated = await coaFetch('ce12-rulepack-author', `/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/validate`, { method: 'POST' });
  if (!validated.ok || !validated.body.valid) throw new Error(`validate failed: ${JSON.stringify(validated.body)}`);
  const activated = await coaFetch('ce12-rulepack-activator', `/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/activate`, { method: 'POST' });
  if (!activated.ok) throw new Error(`activate failed: HTTP ${activated.status} ${JSON.stringify(activated.body)}`);
  return versionId;
}

describe.skipIf(!RUN)('Live database + REAL coa-service/schedule-service HTTP — CE-12 gap-close certification', () => {
  let prisma: PrismaClient;
  let unitSvc: VehicleUnitService;
  let tradeSvc: DealerTradeService;
  let scheduleClient: ScheduleServiceClient;
  let engine: HttpPostingEngineClient;
  const stockNumbers: string[] = [];
  const tradeNumbers: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    engine = new HttpPostingEngineClient(JWT_SECRET!, COA_BASE);
    const recovery = new HttpPostingRecoveryClient(JWT_SECRET!, process.env['POSTING_RECOVERY_SERVICE_URL'] ?? 'http://posting-recovery-service:3049');
    const orchestrator = new PostingOrchestrator(engine, recovery);
    scheduleClient = new ScheduleServiceClient(SCHEDULE_BASE);
    unitSvc = new VehicleUnitService(prisma, orchestrator, scheduleClient);
    tradeSvc = new DealerTradeService(prisma, orchestrator, scheduleClient);
  });

  afterAll(async () => {
    // Only rows THIS run created (unique RUN_ID-prefixed business keys) —
    // never touches tenant-kunes's shared fixture accounts/schedules/rule
    // packs, nor any other concurrently-running sibling agent's data.
    await prisma.dealerTradeSettlement.deleteMany({ where: { tenantId: TENANT, trade: { tradeNumber: { in: tradeNumbers } } } }).catch(() => null);
    await prisma.dealerTrade.deleteMany({ where: { tenantId: TENANT, tradeNumber: { in: tradeNumbers } } }).catch(() => null);
    await prisma.vehicleCostComponent.deleteMany({ where: { tenantId: TENANT, unit: { stockNumber: { in: stockNumbers } } } }).catch(() => null);
    await prisma.vehicleCostComponentEvent.deleteMany({ where: { tenantId: TENANT, unit: { stockNumber: { in: stockNumbers } } } }).catch(() => null);
    await prisma.vehicleStockInEvent.deleteMany({ where: { tenantId: TENANT, unit: { stockNumber: { in: stockNumbers } } } }).catch(() => null);
    await prisma.vehicleReconCostEvent.deleteMany({ where: { tenantId: TENANT, unit: { stockNumber: { in: stockNumbers } } } }).catch(() => null);
    await prisma.vehicleUnit.deleteMany({ where: { tenantId: TENANT, stockNumber: { in: stockNumbers } } }).catch(() => null);
    // Always leave ce12.vehicle-recon-cost-added back in fixture (real-account)
    // mode — the state every other test here, and any concurrent sibling
    // agent inspecting tenant-kunes, expects.
    await activateReconPackVersion(true).catch(() => null);
    await prisma.$disconnect();
  });

  function newStock(): string {
    // schedule-service's ScheduleDetail.controlNumber is VarChar(10) — kept
    // short deliberately so this run's stock numbers are never truncated.
    const s = `S${RUN_ID.slice(0, 6)}${stockNumbers.length}`;
    stockNumbers.push(s);
    return s;
  }
  function newTrade(): string {
    const t = `T${RUN_ID.slice(0, 6)}${tradeNumbers.length}`;
    tradeNumbers.push(t);
    return t;
  }

  it('1) accepted versioned canonical event posts (real coa-service HTTP)', async () => {
    const stockNumber = newStock();
    const result = await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00600', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '9500.00',
    });
    expect(result.idempotent).toBe(false);
    expect(result.postingResult!.status).toBe('POSTED');
    expect(result.postingResult!.journalNumber).toMatch(/^CE12-/);
    expect(result.unit!.bookValue.toString()).toBe('9500');
  });

  it('3) balanced authoritative journal — real GET /journals/:number shows totalDebits === totalCredits', async () => {
    const stockNumber = newStock();
    const result = await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00601', entityId: ENTITY, storeId: STORE,
      status: 'NEW', acquisitionType: 'PURCHASE', invoiceCost: '12000.00', transportCost: '300.00',
    });
    expect(result.postingResult!.status).toBe('POSTED');
    const view = await coaFetch('ce12-live-test', `/api/v1/coa/journals/${result.postingResult!.journalNumber}`);
    expect(view.ok).toBe(true);
    expect(view.body.totalDebits).toBe(view.body.totalCredits);
    expect(view.body.totalDebits).toBeGreaterThan(0);
  });

  it('4) posting execution + rule-pack version pinned — rulePackVersionId is real and non-null', async () => {
    const stockNumber = newStock();
    const result = await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00602', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '5000.00',
    });
    expect(result.postingResult!.rulePackVersionId).toBeTruthy();
    expect(typeof result.postingResult!.rulePackVersionId).toBe('string');
    expect(result.postingResult!.ruleId).toBeTruthy();
  });

  it('5) idempotent duplicate handling — same eventId posted twice yields one journal, idempotent:true the 2nd time (real coa-service)', async () => {
    const stockNumber = newStock();
    const eventId = randomUUID();
    const input = {
      eventId, stockNumber, vin: '1FTFW1E5XNFA00603', entityId: ENTITY, storeId: STORE,
      status: 'USED' as const, acquisitionType: 'PURCHASE' as const, invoiceCost: '6500.00',
    };
    const first = await unitSvc.stockIn(TENANT, 'live-test-actor', input);
    const second = await unitSvc.stockIn(TENANT, 'live-test-actor', input);
    expect(first.idempotent).toBe(false);
    expect((second as any).idempotent).toBe(true);
    expect(second.unit!.id).toBe(first.unit!.id);
    expect(second.stockInEvent!.journalNumber).toBe(first.stockInEvent!.journalNumber);
  });

  it('2 & 6) tenant-configurable mapping: pending-sentinel version deterministically REJECTS with no partial journal; fixture-mapped version POSTS', async () => {
    // Flip ce12.vehicle-recon-cost-added to blank/pending mode (real author +
    // validate + activate against coa-service — SAME REST flow
    // scripts/seed-ce12-rule-packs.ts uses).
    await activateReconPackVersion(false);

    const stockNumber = newStock();
    await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00604', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '4000.00',
    });
    const rejected = await unitSvc.addReconCost(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, roNumber: 'RO-LIVE-1', amount: '250.00',
    });
    expect(rejected.event!.status).toBe('REJECTED');
    expect(rejected.postingResult!.failureReason).toMatch(/could not be resolved/i);
    // No partial journal: coa-service's own atomic transaction never
    // created a journal entry for the rejected posting.
    expect(rejected.postingResult!.journalEntryId ?? null).toBeNull();
    expect(rejected.postingResult!.status).not.toBe('POSTED');

    // Restore fixture (real-account) mode and prove the SAME rule now POSTS.
    await activateReconPackVersion(true);
    const posted = await unitSvc.addReconCost(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, roNumber: 'RO-LIVE-2', amount: '250.00',
    });
    expect(posted.event!.status).toBe('POSTED');
    expect(posted.postingResult!.journalEntryId).toBeTruthy();
  });

  it('7) reversal (S218) — real HTTP call against the real journal; SYSTEM-sourced CE-12 postings now reverse cleanly', async () => {
    // FIXED (coa-service, out of this file's own scope but a proven blocker
    // for CE-12 gap-closure item 3): ReversalService.reverse() (services/
    // coa-service/src/application/reversal-service.ts) used to re-post the
    // mirrored reversal via `this.posting.post({...})` with `callerClass`
    // hardcoded to 'MANUAL', so BR013-3 (caller class must match the
    // journal source's own sourceClass) deterministically rejected every
    // reversal of a SYSTEM-sourced entry — i.e. every CE-12 posting-engine-
    // originated journal, from any of the 4 sibling CE-12 services. Fixed by
    // looking up the original journal's own source and using ITS
    // sourceClass as the reversal's callerClass. Reproduced directly below
    // over real HTTP: a real CE12-sourced (SYSTEM class) journal now
    // reverses successfully, with its own reversal number and reversalOf
    // linkage back to the original.
    const stockNumber = newStock();
    const result = await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00605', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '3300.00',
    });
    expect(result.postingResult!.status).toBe('POSTED');
    const reversal = await engine.reverseJournal(
      TENANT,
      result.postingResult!.journalEntryId!,
      'CE-12 gap-close live-db certification reversal proof',
    );
    expect(reversal.originalId).toBe(result.postingResult!.journalEntryId);
    expect(reversal.reversalNumber).not.toBe(reversal.originalNumber);
    expect(reversal.reinstatement).toBe(false);
  });

  it('9) a rejected posting does not mutate local VehicleUnit.bookValue or any schedule-service balance', async () => {
    await activateReconPackVersion(false);
    const stockNumber = newStock();
    const result = await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00606', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '2000.00',
    });
    // PURCHASE stock-in still uses ce12.vehicle-stocked (untouched, fixture
    // mode) so this leg POSTS — the pending-mode pack under test here is
    // ce12.vehicle-recon-cost-added, exercised next.
    expect(result.postingResult!.status).toBe('POSTED');

    const before = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    const rejected = await unitSvc.addReconCost(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, roNumber: 'RO-LIVE-9', amount: '999.00',
    });
    expect(rejected.event!.status).toBe('REJECTED');
    const after = await prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId: TENANT, stockNumber } } });
    expect(after!.bookValue.toString()).toBe(before!.bookValue.toString()); // unchanged by the rejected recon-cost add

    const scheduleBalance = await scheduleClient.getOpenItemsBalance(TENANT, SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY, stockNumber);
    // The unit's own OPEN (PURCHASE, posted) leg creates a real schedule
    // balance (see file header — the upstream bridge fix); the REJECTED
    // recon-cost add must never have contributed to it either way.
    expect(scheduleBalance).not.toBeNull();
    expect(scheduleBalance!.remainingBalanceCents).toBe(200000); // $2000.00 PURCHASE leg only, recon-cost add rejected

    await activateReconPackVersion(true);
  });

  it('8) schedule effects: real schedule-service open-item creation end-to-end (source transaction → governed posting → authoritative journal → JOURNAL_ENTRY_POSTED → real ScheduleOpenItem)', async () => {
    const stockNumber = newStock();
    const result = await unitSvc.stockIn(TENANT, 'live-test-actor', {
      eventId: randomUUID(), stockNumber, vin: '1FTFW1E5XNFA00607', entityId: ENTITY, storeId: STORE,
      status: 'USED', acquisitionType: 'PURCHASE', invoiceCost: '9500.00',
    });
    expect(result.postingResult!.status).toBe('POSTED');

    // (a) The fixture GL account this rule posts to (19001, VEHICLE_INVENTORY)
    // really carries scheduleCode "80" in coa-service, over real HTTP.
    const accounts = await coaFetch('ce12-live-test', `/api/v1/coa/accounts?entity=${encodeURIComponent(ENTITY)}`);
    expect(accounts.ok).toBe(true);
    const vehicleInventoryAccount = accounts.body.accounts.find((a: any) => a.accountNumber === ROLE_FIXTURES.VEHICLE_INVENTORY.accountNumber);
    expect(vehicleInventoryAccount).toBeTruthy();
    expect(vehicleInventoryAccount.scheduleCode).toBe(SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY);

    // (b) Schedule 80 really exists in schedule-service, over real HTTP,
    // pointed at that same GL account number.
    const schedules = await scheduleFetch('/api/v1/schedules');
    expect(schedules.ok).toBe(true);
    const schedule80 = schedules.body.find((s: any) => s.scheduleNumber === SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY);
    expect(schedule80).toBeTruthy();
    expect(schedule80.glAccountNumbers).toContain(ROLE_FIXTURES.VEHICLE_INVENTORY.accountNumber);

    // (c) This service's tie-out inquiry (VehicleUnitService.getUnit) really
    // calls schedule-service over HTTP for the authoritative balance — a
    // real 200 response with a real (possibly empty, per this file's header
    // finding) array, never a fabricated/independently-recomputed number.
    const detail = await unitSvc.getUnit(TENANT, stockNumber);
    expect(detail.tieOut.schedule).not.toBeNull();
    expect(detail.tieOut.schedule!.scheduleNumber).toBe(SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY);
    expect(detail.tieOut.schedule!.controlNumber).toBe(stockNumber);
    expect(typeof detail.tieOut.schedule!.remainingBalanceCents).toBe('number');

    // (d) Direct real GET against schedule-service's own open-items route —
    // the literal call this task asked to be captured as proof. The
    // upstream bridge defect that used to make this route return an empty
    // array (schedule-service's journal_source column too narrow for
    // CE-12's journalSourceCode, silently swallowed by the RabbitMQ
    // consumer's Promise.allSettled+unconditional-ack) is fixed — a real
    // ScheduleOpenItem row now exists, created purely by the async
    // JOURNAL_ENTRY_POSTED bridge event this service's own posting call
    // published, with no direct write from this service's code.
    const openItems = await scheduleFetch(`/api/v1/schedules/${SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY}/open-items?controlNumber=${encodeURIComponent(stockNumber)}`);
    expect(openItems.ok).toBe(true);
    expect(Array.isArray(openItems.body)).toBe(true);
    expect(openItems.body.length).toBeGreaterThanOrEqual(1);
    const item = openItems.body[0];
    expect(item.controlNumber).toBe(stockNumber);
    expect(item.scheduleNumber).toBe(SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY);
    expect(Number(item.remainingBalance)).toBeCloseTo(9500.0, 2);
    expect(Number(item.remainingBalance) * 100).toBeCloseTo(detail.tieOut.schedule!.remainingBalanceCents, 0);
  });
});
