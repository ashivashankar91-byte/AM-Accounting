import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { MovementService } from '../../src/application/movement-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { ValuationConfigService } from '../../src/application/valuation-config-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';
import { FakeGlBalanceClient } from '../../src/infrastructure/gl-balance-client';
import { EVENT_FAMILY_ROLES } from '../../src/domain/event-families';

/**
 * S066 golden test — perpetual-to-GL reconciliation. Fixture: 5+ movements
 * across 3 families for TWO parts at the same store, Accounting-authored
 * quantities/values (fixture account codes are fictitious test tokens):
 *
 *   Part      Family        Qty   Unit   Total
 *   P-TIE-A   RECEIPT       +40   10.00   400.00
 *   P-TIE-A   RO_ISSUE      -15   10.00   150.00  (avg unchanged, single lot)
 *   P-TIE-A   COUNTER_SALE   -5   10.00    50.00
 *   P-TIE-B   RECEIPT       +20   25.00   500.00
 *   P-TIE-B   INTERNAL_ISSUE -4   25.00   100.00
 *   -----------------------------------------------------------
 *   P-TIE-A ending: 20 units @ 200.00   (400 - 150 - 50)
 *   P-TIE-B ending:  16 units @ 400.00   (500 - 100)
 *   Perpetual total (both parts): 600.00
 */
const TENANT = 'ptt1';
const LE = 'ptle1';
const STORE = 'pts1';
// Computed at run time — ValuationConfigService requires effectiveFrom to
// be today-or-future ("prospective-only"), so a fixed past literal would
// eventually fail as real wall-clock time advances past it.
const BUSINESS_DATE = new Date().toISOString().slice(0, 10);

async function setUp() {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  const valuation = new ValuationConfigService(prisma as any);
  const posting = new FakePostingEventProducer((env) => ({
    executionId: 'exec-' + env.eventId, eventId: env.eventId, status: 'POSTED', idempotent: false,
    journalEntryId: 'je-' + env.eventId, journalNumber: 'JN-' + env.eventId.slice(0, 8),
  }));
  const glBalanceBox = { value: 0 };
  const glBalance = new FakeGlBalanceClient(() => glBalanceBox.value);
  const movements = new MovementService(prisma as any, posting, mappings, valuation, glBalance);
  await valuation.create({ tenantId: TENANT, legalEntityId: LE, method: 'AVERAGE', effectiveFrom: BUSINESS_DATE, ceremonyApprovedBy: 'controller-golden' });
  for (const [family, roles] of Object.entries(EVENT_FAMILY_ROLES)) {
    for (const role of roles) await mappings.setAccountNumber(TENANT, LE, family, role, `FIXTURE-${family}-${role}`, 'controller-golden');
  }
  return { prisma, movements, glBalanceBox };
}

async function seedFixtureSequence(movements: MovementService) {
  const dto = (over: any) => ({
    tenantId: TENANT, legalEntityId: LE, storeId: STORE, sourceDocType: 'FIXTURE', sourceDocId: 'FX-1',
    businessDate: BUSINESS_DATE, actor: 'clerk', ...over,
  });
  await movements.postMovement(dto({ partNumber: 'P-TIE-A', movementFamily: 'RECEIPT', movementId: 'tie-a-1', quantity: 40, unitValueOverride: 10.0, correlationId: 'c1' }));
  await movements.postMovement(dto({ partNumber: 'P-TIE-A', movementFamily: 'RO_ISSUE', movementId: 'tie-a-2', quantity: 15, correlationId: 'c2' }));
  await movements.postMovement(dto({ partNumber: 'P-TIE-A', movementFamily: 'COUNTER_SALE', movementId: 'tie-a-3', quantity: 5, correlationId: 'c3' }));
  await movements.postMovement(dto({ partNumber: 'P-TIE-B', movementFamily: 'RECEIPT', movementId: 'tie-b-1', quantity: 20, unitValueOverride: 25.0, correlationId: 'c4' }));
  await movements.postMovement(dto({ partNumber: 'P-TIE-B', movementFamily: 'INTERNAL_ISSUE', movementId: 'tie-b-2', quantity: 4, correlationId: 'c5' }));
}

describe('S066 golden — perpetual-to-GL reconciliation', () => {
  let ctx: Awaited<ReturnType<typeof setUp>>;
  beforeEach(async () => { ctx = await setUp(); });

  it('perpetualTotal exactly equals the sum of movement deltas (200.00 + 400.00 = 600.00) — $0 variance when GL control matches', async () => {
    await seedFixtureSequence(ctx.movements);
    ctx.glBalanceBox.value = 600.0;

    const run = await ctx.movements.runReconciliation({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, asOfDate: BUSINESS_DATE,
      triggeredBy: 'ON_DEMAND', runBy: 'controller-golden',
    });

    expect(Number(run.perpetualTotal)).toBe(600);
    expect(Number(run.glControlTotal)).toBe(600);
    expect(Number(run.varianceAmount)).toBe(0);
    expect(run.status).toBe('BALANCED');

    const runWithLines = await (ctx.movements as any).getReconciliationRun(TENANT, LE, run.id);
    expect(runWithLines.varianceLines).toHaveLength(0); // no drill lines needed when balanced
  });

  it('a deliberately injected variance is caught loudly — never silently zeroed or hidden — with a non-empty drill-down', async () => {
    await seedFixtureSequence(ctx.movements);

    // Inject a variance: GL control total is 75.00 higher than the true
    // perpetual total (600.00), simulating an unexplained GL-side posting.
    ctx.glBalanceBox.value = 675.0;
    const run = await ctx.movements.runReconciliation({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, asOfDate: BUSINESS_DATE,
      triggeredBy: 'ON_DEMAND', runBy: 'controller-golden',
    });

    expect(Number(run.perpetualTotal)).toBe(600);
    expect(Number(run.glControlTotal)).toBe(675);
    expect(Number(run.varianceAmount)).toBe(-75); // perpetual - GL, never hidden or rounded to zero
    expect(run.status).toBe('VARIANCE');

    const runWithLines = await (ctx.movements as any).getReconciliationRun(TENANT, LE, run.id);
    expect(runWithLines.varianceLines.length).toBeGreaterThan(0); // drill-down populated, not silently empty
    // Every seeded movement for this scope is a drill candidate — proves
    // the variance report doesn't hide which movements are in scope.
    const drilledMovementIds = new Set(runWithLines.varianceLines.map((l: any) => l.movementId).filter(Boolean));
    expect(drilledMovementIds.has('tie-a-1')).toBe(true);
    expect(drilledMovementIds.has('tie-b-2')).toBe(true);
  });
});
