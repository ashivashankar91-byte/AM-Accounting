import { describe, it, expect } from 'vitest';
import { segmentsForRecap, segmentEventId, DEAL_FINALIZED_EVENT, PRODUCT_LINE_EVENT, truncateControlNumber, productControlNumber } from '../../src/domain/segments';
import { presentBaseRoles, baseRoleAmountCents, productRoles, productRoleAmountCents } from '../../src/domain/roles';
import { retailRecapFixture, leaseRecapFixture } from '../support/fixtures';

describe('S084 segment decomposition — conservation proof', () => {
  it('produces exactly one segment per present base role plus one per product line', () => {
    const recap = retailRecapFixture();
    const taxCents = 195000; // 1950.00 fixture tax result
    const segments = segmentsForRecap(recap, taxCents);

    // core (GROSS+UNIT_COST bundled) + trade-allowance + trade-acv + trade-payoff + cit + reserve + fees + tax + rebate (9) + 2 products
    expect(segments).toHaveLength(11);
    expect(segments.filter((s) => s.tag === 'product')).toHaveLength(2);
    expect(new Set(segments.map((s) => s.eventType)).has(DEAL_FINALIZED_EVENT)).toBe(true);
    expect(new Set(segments.map((s) => s.eventType)).has(PRODUCT_LINE_EVENT)).toBe(true);
  });

  it('every non-product segment amount equals its role accessor amount exactly (Σ segments = Σ roles, to the cent)', () => {
    const recap = retailRecapFixture();
    const taxCents = 195000;
    const segments = segmentsForRecap(recap, taxCents);

    const roles = presentBaseRoles(recap, taxCents);
    // core segment covers GROSS (and, for lease, LEASE_RESIDUAL is a separate
    // field within the same segment's payload but not its own segment/amount
    // — RETAIL has no LEASE_RESIDUAL role present, so this fixture's core
    // segment amount corresponds 1:1 to the GROSS role only. UNIT_COST is
    // deliberately NOT its own top-level "amountCents" driver of the core
    // segment (the core segment's declared amountCents is the gross figure);
    // UNIT_COST's conservation is proved by the dedicated unit-cost check
    // below, which reads the same recap field directly.
    for (const role of roles) {
      if (role === 'GROSS') {
        const core = segments.find((s) => s.tag === 'core')!;
        expect(core.amountCents).toBe(baseRoleAmountCents('GROSS', recap, taxCents));
        continue;
      }
      if (role === 'UNIT_COST') continue; // proved directly below
      if (role === 'LEASE_RESIDUAL') continue; // LEASE-only, proved in the lease test below
      const tagForRole: Record<string, string> = {
        TRADE_ALLOWANCE: 'trade-allowance', TRADE_ACV: 'trade-acv', TRADE_PAYOFF: 'trade-payoff',
        CIT: 'cit', RESERVE_INCOME: 'reserve', FEES: 'fees', TAX: 'tax', REBATE_RECEIVABLE: 'rebate',
      };
      const seg = segments.find((s) => s.tag === tagForRole[role]);
      expect(seg, `expected a segment for role ${role}`).toBeDefined();
      expect(seg!.amountCents).toBe(baseRoleAmountCents(role, recap, taxCents));
    }

    // UNIT_COST conservation — read directly off the core segment's own payload field.
    const core = segments.find((s) => s.tag === 'core')!;
    expect((core.payload as any).unitCostAmount).toBe(recap.unitCostAmount);

    // Product lines — Σ(income+remit) per line equals the product role sum.
    const prodRoles = productRoles(recap);
    for (const seg of segments.filter((s) => s.tag === 'product')) {
      const incomeRole = prodRoles.find((r) => r.kind === 'PRODUCT_INCOME' && r.productCode === seg.productCode)!;
      const remitRole = prodRoles.find((r) => r.kind === 'PRODUCT_REMIT' && r.productCode === seg.productCode)!;
      const expected = productRoleAmountCents(incomeRole, recap)! + productRoleAmountCents(remitRole, recap)!;
      expect(seg.amountCents).toBe(expected);
    }
  });

  it('lease variant: core segment amount is the capitalized cost; residual is a distinct recap field carried on the core payload', () => {
    const recap = leaseRecapFixture();
    const segments = segmentsForRecap(recap, null);
    const core = segments.find((s) => s.tag === 'core')!;
    expect(core.amountCents).toBe(baseRoleAmountCents('GROSS', recap, undefined));
    expect((core.payload as any).leaseResidualAmount).toBe(recap.leaseResidualAmount);
  });

  it('omits every optional segment when the corresponding recap field is absent', () => {
    const recap = retailRecapFixture({
      hasTradeIn: false, tradeVin: null, tradeAllowanceAmount: null, tradeAcvAmount: null, tradePayoffAmount: null,
      financedAmount: null, reserveIncomeAmount: null, feesAmount: null, rebateReceivableAmount: null, products: [],
    });
    const segments = segmentsForRecap(recap, null);
    expect(segments).toHaveLength(1);
    expect(segments[0].tag).toBe('core');
  });

  it('produces deterministic, idempotent eventIds keyed on deal#+recapVersion+segment', () => {
    expect(segmentEventId('D-1001', 1, 'core')).toBe('D-1001:v1:core');
    expect(segmentEventId('D-1001', 1, 'core')).toBe(segmentEventId('D-1001', 1, 'core'));
    expect(segmentEventId('D-1001', 2, 'core')).not.toBe(segmentEventId('D-1001', 1, 'core'));
  });

  it('product eventId suffix is keyed by productCode, not array index (stable across recontract reordering)', () => {
    const recap = retailRecapFixture();
    const segments = segmentsForRecap(recap, null);
    const gap = segments.find((s) => s.productCode === 'GAP')!;
    expect(gap.eventIdSuffix).toBe('product:GAP');
  });

  // Gap-closure — schedule 94 (PRODUCT_REMIT_LIABILITY) controlNumberPath:
  // schedule-service's ScheduleDetail.controlNumber is VarChar(10).
  it('every product segment carries a <=10-char productControlRef for the schedule-94 bridge', () => {
    const recap = retailRecapFixture();
    const segments = segmentsForRecap(recap, null);
    for (const seg of segments.filter((s) => s.tag === 'product')) {
      const ref = (seg.payload as any).productControlRef as string;
      expect(ref.length).toBeLessThanOrEqual(10);
      expect(ref).toBe(productControlNumber(recap.dealNumber, seg.productIndex!));
    }
  });

  it('truncateControlNumber preserves the most-distinctive (rightmost) suffix when over length', () => {
    expect(truncateControlNumber('SHORT', 10)).toBe('SHORT');
    const long = 'D-0000012345-P1';
    const truncated = truncateControlNumber(long, 10);
    expect(truncated.length).toBe(10);
    expect(truncated).toBe(long.slice(long.length - 10));
    expect(truncated.endsWith('-P1')).toBe(true);
  });
});
