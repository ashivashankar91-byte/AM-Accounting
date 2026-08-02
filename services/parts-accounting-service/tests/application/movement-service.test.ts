import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { MovementService } from '../../src/application/movement-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { ValuationConfigService } from '../../src/application/valuation-config-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';
import { FakeGlBalanceClient, GlBalanceUnavailableError } from '../../src/infrastructure/gl-balance-client';

const TENANT = 'tenant-1';
const LE = 'le-1';
const STORE = 'store-1';
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
  // Mutable so individual reconciliation tests can set the "real" GL
  // balance the fake coa-service inquiry returns, without needing a
  // separate MovementService instance per assertion.
  const glBalanceBox = { value: 0 };
  const glBalance = new FakeGlBalanceClient(() => glBalanceBox.value);
  const movements = new MovementService(prisma as any, posting, mappings, valuation, glBalance);

  // Resolve every role for every family the tests below exercise.
  for (const [family, roles] of Object.entries({
    PARTS_RECEIPT: ['INVENTORY', 'AP_ACCRUAL'],
    PARTS_RO_ISSUE: ['INVENTORY', 'COS_PARTS'],
    PARTS_RECONCILIATION: ['INVENTORY_CONTROL'],
  })) {
    for (const role of roles) await mappings.setAccountNumber(TENANT, LE, family, role, '1000', 'controller-1');
  }
  // Prospective-only guard requires effectiveFrom >= today; movements below
  // are dated the same business date so the config is active for them.
  await valuation.create({ tenantId: TENANT, legalEntityId: LE, method: 'AVERAGE', effectiveFrom: BUSINESS_DATE, ceremonyApprovedBy: 'controller-1' });

  return { prisma, mappings, valuation, posting, movements, glBalanceBox };
}

describe('MovementService (S066)', () => {
  let ctx: Awaited<ReturnType<typeof setUp>>;
  beforeEach(async () => { ctx = await setUp(); });

  it('posts a RECEIPT movement and increases the perpetual balance', async () => {
    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-100',
      movementFamily: 'RECEIPT', movementId: 'mv-1', quantity: 10, unitValueOverride: 5.00,
      sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'corr-1', businessDate: BUSINESS_DATE, actor: 'clerk-1',
    });
    expect(result.idempotent).toBe(false);
    expect(result.postingStatus).toBe('POSTED');
    const balance = await ctx.prisma.partsPerpetualBalance.findUnique({ where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-100' } } });
    expect(Number(balance!.onHandQty)).toBe(10);
    expect(Number(balance!.onHandValue)).toBe(50);
  });

  it('a movement the posting engine rejects (NO_RULE_MATCH) does NOT mutate the perpetual balance', async () => {
    // Regression: the perpetual balance is the authoritative side of the
    // tie-out — a rejected/unposted movement must never move quantity or
    // value, exactly like a rejected RO close never partially posts.
    const rejecting = new FakePostingEventProducer(() => ({
      executionId: 'exec-rejected', eventId: 'evt-rejected', status: 'NO_RULE_MATCH', idempotent: false,
    }));
    const movements = new MovementService(ctx.prisma as any, rejecting, ctx.mappings, ctx.valuation);
    const result = await movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-500',
      movementFamily: 'RECEIPT', movementId: 'mv-rejected', quantity: 25, unitValueOverride: 9.00,
      sourceDocType: 'PO', sourceDocId: 'PO-9', correlationId: 'corr-9', businessDate: BUSINESS_DATE, actor: 'clerk-1',
    } as any);
    expect(result.postingStatus).toBe('NO_RULE_MATCH');
    expect(result.movement.status).toBe('EXCEPTION');
    const balance = await ctx.prisma.partsPerpetualBalance.findUnique({ where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-500' } } });
    expect(balance).toBeNull();
    const exceptions = await ctx.prisma.partsPostingException.findMany({ where: { tenantId: TENANT, reasonCode: 'RULE_NOT_FOUND' } });
    expect(exceptions.length).toBe(1);
  });

  it('replaying the same movementId is idempotent — one movement = one journal, never re-posted', async () => {
    const dto = { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-100', movementFamily: 'RECEIPT', movementId: 'mv-dup', quantity: 5, unitValueOverride: 2, sourceDocType: 'PO', sourceDocId: 'PO-2', correlationId: 'corr-2', businessDate: BUSINESS_DATE, actor: 'clerk-1' };
    const first = await ctx.movements.postMovement(dto as any);
    const second = await ctx.movements.postMovement(dto as any);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(ctx.posting.submitted.length).toBe(1); // posting engine called exactly once
  });

  it('D-CE11-02: a relieving movement that drives on-hand negative still POSTS, flagged loudly, never silently and never hard-blocked', async () => {
    // No prior receipt — issuing against zero on-hand.
    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-200',
      movementFamily: 'RO_ISSUE', movementId: 'mv-neg', quantity: 3, unitValueOverride: 4,
      sourceDocType: 'RO', sourceDocId: 'RO-1', correlationId: 'corr-3', businessDate: BUSINESS_DATE, actor: 'tech-1',
    });
    expect(result.negativeOnHand).toBe(true);
    expect(result.postingStatus).toBe('POSTED'); // never hard-blocked
    const exceptions = await ctx.prisma.partsPostingException.findMany({ where: { tenantId: TENANT, reasonCode: 'NEGATIVE_ON_HAND' } });
    expect(exceptions.length).toBe(1); // loud, never silent
  });

  it('refuses direct ADJUSTMENT posting — only reachable via the S069 physical-count ceremony', async () => {
    await expect(ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-100', movementFamily: 'ADJUSTMENT',
      movementId: 'mv-adj', quantity: 1, sourceDocType: 'X', sourceDocId: 'X-1', correlationId: 'c', businessDate: BUSINESS_DATE, actor: 'a',
    } as any)).rejects.toThrow(/physical-inventory approval ceremony/);
  });

  it('perpetual-to-GL reconciliation: $0 variance is BALANCED (GL side is the real coa-service ending balance, never a manual figure)', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-300', movementFamily: 'RECEIPT', movementId: 'mv-r1', quantity: 20, unitValueOverride: 3, sourceDocType: 'PO', sourceDocId: 'PO-3', correlationId: 'c1', businessDate: BUSINESS_DATE, actor: 'clerk-1' } as any);
    ctx.glBalanceBox.value = 60;
    const run = await ctx.movements.runReconciliation({ tenantId: TENANT, legalEntityId: LE, asOfDate: BUSINESS_DATE, triggeredBy: 'ON_DEMAND' });
    expect(run.status).toBe('BALANCED');
    expect(Number(run.varianceAmount)).toBe(0);
  });

  it('perpetual-to-GL reconciliation: a nonzero variance is caught loudly, never hidden, with drill lines', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: 'P-400', movementFamily: 'RECEIPT', movementId: 'mv-r2', quantity: 10, unitValueOverride: 5, sourceDocType: 'PO', sourceDocId: 'PO-4', correlationId: 'c2', businessDate: BUSINESS_DATE, actor: 'clerk-1' } as any);
    ctx.glBalanceBox.value = 40;
    const run = await ctx.movements.runReconciliation({ tenantId: TENANT, legalEntityId: LE, asOfDate: BUSINESS_DATE, triggeredBy: 'ON_DEMAND' });
    expect(run.status).toBe('VARIANCE');
    expect(Number(run.varianceAmount)).toBe(10);
    const withLines = await ctx.movements.getReconciliationRun(TENANT, LE, run.id);
    expect(withLines.varianceLines.length).toBeGreaterThan(0);
  });

  it('perpetual-to-GL reconciliation: unavailable GL balance (mapping pending) never fabricates a run — throws explicitly', async () => {
    const prisma = new FakePrismaClient();
    const mappings = new PartsAccountMappingService(prisma as any);
    const valuation = new ValuationConfigService(prisma as any);
    const posting = new FakePostingEventProducer((env) => ({ executionId: 'e', eventId: env.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je', journalNumber: 'JN' }));
    // Deliberately do NOT resolve PARTS_RECONCILIATION.INVENTORY_CONTROL.
    const movements = new MovementService(prisma as any, posting, mappings, valuation, new FakeGlBalanceClient(() => 0));
    await expect(movements.runReconciliation({ tenantId: TENANT, legalEntityId: LE, asOfDate: BUSINESS_DATE, triggeredBy: 'ON_DEMAND' }))
      .rejects.toMatchObject({ code: 'ACCOUNT_MAPPING_VALUES_PENDING' });
    const runs = await prisma.partsReconciliationRun.findMany({ where: { tenantId: TENANT } });
    expect(runs.length).toBe(0); // no run row created for an unavailable GL balance
  });

  it('perpetual-to-GL reconciliation: coa-service unreachable never fabricates a run — throws GL_BALANCE_UNAVAILABLE', async () => {
    const failing = new FakeGlBalanceClient(() => new GlBalanceUnavailableError('coa-service unreachable'));
    const movements = new MovementService(ctx.prisma as any, ctx.posting, ctx.mappings, ctx.valuation, failing);
    await expect(movements.runReconciliation({ tenantId: TENANT, legalEntityId: LE, asOfDate: BUSINESS_DATE, triggeredBy: 'ON_DEMAND' }))
      .rejects.toMatchObject({ code: 'GL_BALANCE_UNAVAILABLE' });
  });
});
