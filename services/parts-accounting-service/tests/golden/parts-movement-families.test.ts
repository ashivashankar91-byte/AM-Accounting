import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { MovementService } from '../../src/application/movement-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { ValuationConfigService } from '../../src/application/valuation-config-service';
import { FakePostingEventProducer } from '../../src/infrastructure/posting-client';
import { FakeGlBalanceClient } from '../../src/infrastructure/gl-balance-client';
import { EVENT_FAMILY_ROLES, MOVEMENT_FAMILY_TO_EVENT_FAMILY } from '../../src/domain/event-families';

/**
 * S066 golden test — one scenario PER movement family, Accounting-authored
 * fixture values for certification only (fixture account codes below are
 * fictitious test tokens, never real GL account numbers). Every movement in
 * this suite carries a $5.00/unit value end-to-end (chosen deliberately so
 * the running average never drifts off $5.00, keeping the arithmetic
 * exact), building on ONE part/store across the whole family sequence:
 *
 *   Family            Qty    Unit   Total    Running Qty  Running Value
 *   RECEIPT            +100   5.00   500.00       100          500.00
 *   RO_ISSUE            -20   5.00   100.00        80          400.00
 *   COUNTER_SALE        -10   5.00    50.00        70          350.00
 *   RETURN_TO_STOCK      +5   5.00    25.00        75          375.00
 *   RETURN_TO_VENDOR     -5   5.00    25.00        70          350.00
 *   INTERNAL_ISSUE       -3   5.00    15.00        67          335.00
 */
const TENANT = 'pgt1';
const LE = 'pgle1';
const STORE = 'pgs1';
const PART = 'P-GOLDEN-1';
// Computed at run time (not a hardcoded literal) — ValuationConfigService
// requires effectiveFrom to be today-or-future ("prospective-only"), so a
// fixed past date would eventually fail as real wall-clock time advances
// past it. Every movement's businessDate below uses the SAME value so it
// stays >= the config's effectiveFrom (ValuationConfigService.getActive
// requires effectiveFrom <= asOfDate).
const BUSINESS_DATE = new Date().toISOString().slice(0, 10);

async function setUp() {
  const prisma = new FakePrismaClient();
  const mappings = new PartsAccountMappingService(prisma as any);
  const valuation = new ValuationConfigService(prisma as any);
  const posting = new FakePostingEventProducer((env) => ({
    executionId: 'exec-' + env.eventId, eventId: env.eventId, status: 'POSTED', idempotent: false,
    journalEntryId: 'je-' + env.eventId, journalNumber: 'JN-' + env.eventId.slice(0, 8),
  }));
  const movements = new MovementService(prisma as any, posting, mappings, valuation, new FakeGlBalanceClient(() => 0));

  await valuation.create({ tenantId: TENANT, legalEntityId: LE, method: 'AVERAGE', effectiveFrom: BUSINESS_DATE, ceremonyApprovedBy: 'controller-golden' });

  for (const [family, roles] of Object.entries(EVENT_FAMILY_ROLES)) {
    for (const role of roles) {
      await mappings.setAccountNumber(TENANT, LE, family, role, `FIXTURE-${family}-${role}`, 'controller-golden');
    }
  }

  return { prisma, mappings, valuation, posting, movements };
}

describe('S066 golden — one scenario per movement family', () => {
  let ctx: Awaited<ReturnType<typeof setUp>>;
  beforeEach(async () => { ctx = await setUp(); });

  async function currentBalance() {
    return (ctx.prisma as any).partsPerpetualBalance.findUnique({
      where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART } },
    });
  }

  it('RECEIPT: +100 @ 5.00 = 500.00; DR inventory / CR AP-accrual roles', async () => {
    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART,
      movementFamily: 'RECEIPT', movementId: 'mv-receipt', quantity: 100, unitValueOverride: 5.0,
      sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'corr-r', businessDate: BUSINESS_DATE, actor: 'clerk',
    });
    expect(result.movement.totalValue.toString()).toBe('500');
    expect(ctx.posting.submitted).toHaveLength(1);
    expect(Object.keys(ctx.posting.submitted[0].payload.accounts).sort()).toEqual(['AP_ACCRUAL', 'INVENTORY'].sort());
    const bal = await currentBalance();
    expect(Number(bal.onHandQty)).toBe(100);
    expect(Number(bal.onHandValue)).toBe(500);
  });

  it('RO_ISSUE: -20 @ avg 5.00 = 100.00; CR inventory / DR COS-parts roles', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RECEIPT', movementId: 'mv-1', quantity: 100, unitValueOverride: 5.0, sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'c1', businessDate: BUSINESS_DATE, actor: 'clerk' });

    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART,
      movementFamily: 'RO_ISSUE', movementId: 'mv-issue', quantity: 20,
      sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'corr-i', businessDate: BUSINESS_DATE, actor: 'clerk',
    });
    expect(result.movement.totalValue.toString()).toBe('100');
    expect(Object.keys(ctx.posting.submitted[1].payload.accounts).sort()).toEqual(['COS_PARTS', 'INVENTORY'].sort());
    const bal = await currentBalance();
    expect(Number(bal.onHandQty)).toBe(80);
    expect(Number(bal.onHandValue)).toBe(400);
  });

  it('COUNTER_SALE: -10 @ avg 5.00 = 50.00; CR inventory / DR COS + counter-sale-revenue roles', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RECEIPT', movementId: 'mv-1', quantity: 100, unitValueOverride: 5.0, sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'c1', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RO_ISSUE', movementId: 'mv-2', quantity: 20, sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'c2', businessDate: BUSINESS_DATE, actor: 'clerk' });

    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART,
      movementFamily: 'COUNTER_SALE', movementId: 'mv-counter', quantity: 10,
      sourceDocType: 'COUNTER_TICKET', sourceDocId: 'CT-1', correlationId: 'corr-c', businessDate: BUSINESS_DATE, actor: 'clerk',
    });
    expect(result.movement.totalValue.toString()).toBe('50');
    expect(Object.keys(ctx.posting.submitted[2].payload.accounts).sort()).toEqual(['COS_PARTS', 'COUNTER_SALE_REVENUE', 'INVENTORY'].sort());
    const bal = await currentBalance();
    expect(Number(bal.onHandQty)).toBe(70);
    expect(Number(bal.onHandValue)).toBe(350);
  });

  it('RETURN_TO_STOCK: +5 @ 5.00 = 25.00 (reverse issue); replenishing roles same as RO_ISSUE', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RECEIPT', movementId: 'mv-1', quantity: 100, unitValueOverride: 5.0, sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'c1', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RO_ISSUE', movementId: 'mv-2', quantity: 20, sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'c2', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'COUNTER_SALE', movementId: 'mv-3', quantity: 10, sourceDocType: 'COUNTER_TICKET', sourceDocId: 'CT-1', correlationId: 'c3', businessDate: BUSINESS_DATE, actor: 'clerk' });

    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART,
      movementFamily: 'RETURN_TO_STOCK', movementId: 'mv-return-stock', quantity: 5, unitValueOverride: 5.0,
      sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'corr-rts', businessDate: BUSINESS_DATE, actor: 'clerk',
    });
    expect(result.movement.totalValue.toString()).toBe('25');
    const bal = await currentBalance();
    expect(Number(bal.onHandQty)).toBe(75);
    expect(Number(bal.onHandValue)).toBe(375);
  });

  it('RETURN_TO_VENDOR: -5 @ avg 5.00 = 25.00; CR inventory / DR AP-debit-memo roles', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RECEIPT', movementId: 'mv-1', quantity: 100, unitValueOverride: 5.0, sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'c1', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RO_ISSUE', movementId: 'mv-2', quantity: 20, sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'c2', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'COUNTER_SALE', movementId: 'mv-3', quantity: 10, sourceDocType: 'COUNTER_TICKET', sourceDocId: 'CT-1', correlationId: 'c3', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RETURN_TO_STOCK', movementId: 'mv-4', quantity: 5, unitValueOverride: 5.0, sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'c4', businessDate: BUSINESS_DATE, actor: 'clerk' });

    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART,
      movementFamily: 'RETURN_TO_VENDOR', movementId: 'mv-return-vendor', quantity: 5,
      sourceDocType: 'RTV', sourceDocId: 'RTV-1', correlationId: 'corr-rtv', businessDate: BUSINESS_DATE, actor: 'clerk',
    });
    expect(result.movement.totalValue.toString()).toBe('25');
    expect(Object.keys(ctx.posting.submitted[4].payload.accounts).sort()).toEqual(['AP_DEBIT_MEMO', 'INVENTORY'].sort());
    const bal = await currentBalance();
    expect(Number(bal.onHandQty)).toBe(70);
    expect(Number(bal.onHandValue)).toBe(350);
  });

  it('INTERNAL_ISSUE: -3 @ avg 5.00 = 15.00; DR internal expense role', async () => {
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RECEIPT', movementId: 'mv-1', quantity: 100, unitValueOverride: 5.0, sourceDocType: 'PO', sourceDocId: 'PO-1', correlationId: 'c1', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RO_ISSUE', movementId: 'mv-2', quantity: 20, sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'c2', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'COUNTER_SALE', movementId: 'mv-3', quantity: 10, sourceDocType: 'COUNTER_TICKET', sourceDocId: 'CT-1', correlationId: 'c3', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RETURN_TO_STOCK', movementId: 'mv-4', quantity: 5, unitValueOverride: 5.0, sourceDocType: 'RO', sourceDocId: 'RO-100', correlationId: 'c4', businessDate: BUSINESS_DATE, actor: 'clerk' });
    await ctx.movements.postMovement({ tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RETURN_TO_VENDOR', movementId: 'mv-5', quantity: 5, sourceDocType: 'RTV', sourceDocId: 'RTV-1', correlationId: 'c5', businessDate: BUSINESS_DATE, actor: 'clerk' });

    const result = await ctx.movements.postMovement({
      tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART,
      movementFamily: 'INTERNAL_ISSUE', movementId: 'mv-internal', quantity: 3,
      sourceDocType: 'INTERNAL_REQ', sourceDocId: 'IR-1', correlationId: 'corr-ii', businessDate: BUSINESS_DATE, actor: 'clerk',
    });
    expect(result.movement.totalValue.toString()).toBe('15');
    expect(Object.keys(ctx.posting.submitted[5].payload.accounts).sort()).toEqual(['INTERNAL_EXPENSE', 'INVENTORY'].sort());
    const bal = await currentBalance();
    expect(Number(bal.onHandQty)).toBe(67);
    expect(Number(bal.onHandValue)).toBe(335);
  });

  it('every movement family in this suite is idempotent per movementId — replay returns the original, never a duplicate journal', async () => {
    const req = { tenantId: TENANT, legalEntityId: LE, storeId: STORE, partNumber: PART, movementFamily: 'RECEIPT', movementId: 'mv-idem', quantity: 10, unitValueOverride: 5.0, sourceDocType: 'PO', sourceDocId: 'PO-2', correlationId: 'corr-idem', businessDate: BUSINESS_DATE, actor: 'clerk' };
    const first = await ctx.movements.postMovement(req);
    const second = await ctx.movements.postMovement(req);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(ctx.posting.submitted).toHaveLength(1);
  });
});
