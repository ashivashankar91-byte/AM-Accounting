import { describe, it, expect } from 'vitest';
import { computeRoleDeltas } from '../../src/domain/recontract-delta';
import { determineRecontractMode } from '../../src/domain/structure-hash';
import { toCents } from '../../src/domain/money';
import { retailRecapFixture } from '../support/fixtures';

describe('S087 — recontract delta math', () => {
  it('produces exactly one delta row for a single changed role', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, saleAmount: '32500.00' });
    const v2 = retailRecapFixture({ recapVersion: 2, saleAmount: '33000.00' });
    expect(determineRecontractMode(v1, v2)).toBe('DELTA');
    const deltas = computeRoleDeltas(v1, v2);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].role).toBe('GROSS');
    expect(deltas[0].deltaCents).toBe(50000); // 500.00 increase
    expect(deltas[0].direction).toBe('INCREASE');
    expect(deltas[0].magnitudeCents).toBe(50000);
  });

  it('computes a DECREASE direction correctly', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, feesAmount: '499.00' });
    const v2 = retailRecapFixture({ recapVersion: 2, feesAmount: '399.00' });
    const deltas = computeRoleDeltas(v1, v2);
    const fees = deltas.find((d) => d.role === 'FEES')!;
    expect(fees.direction).toBe('DECREASE');
    expect(fees.deltaCents).toBe(-10000);
    expect(fees.magnitudeCents).toBe(10000);
  });

  it('omits roles whose amount did not change', () => {
    const v1 = retailRecapFixture({ recapVersion: 1 });
    const v2 = retailRecapFixture({ recapVersion: 2, saleAmount: '33000.00' });
    const deltas = computeRoleDeltas(v1, v2);
    expect(deltas.map((d) => d.role)).toEqual(['GROSS']);
  });

  it('computes per-product deltas keyed by productCode, stable across index reordering', () => {
    const v1 = retailRecapFixture({ recapVersion: 1 }); // GAP 795/350, VSC 2295/1400
    const v2 = retailRecapFixture({
      recapVersion: 2,
      products: [
        { productCode: 'VSC', providerRef: 'PROV-VSC-1', customerPriceAmount: '2395.00', providerCostAmount: '1400.00' }, // price +100
        { productCode: 'GAP', providerRef: 'PROV-GAP-1', customerPriceAmount: '795.00', providerCostAmount: '350.00' }, // unchanged
      ],
    });
    const deltas = computeRoleDeltas(v1, v2);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].role).toBe('PRODUCT_INCOME:VSC');
    expect(deltas[0].deltaCents).toBe(10000);
  });

  it('proves net(v1 + delta) === v2 for every changed base role, to the cent', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, saleAmount: '32500.00', feesAmount: '499.00', financedAmount: '25000.00' });
    const v2 = retailRecapFixture({ recapVersion: 2, saleAmount: '33100.00', feesAmount: '549.00', financedAmount: '25000.00' });
    const deltas = computeRoleDeltas(v1, v2);
    for (const d of deltas) {
      expect(d.fromCents + d.deltaCents).toBe(d.toCents);
    }
    // financedAmount unchanged -> no delta row emitted, and its v1/v2 cents are equal.
    expect(deltas.find((d) => d.role === 'CIT')).toBeUndefined();
    expect(toCents(v1.financedAmount!)).toBe(toCents(v2.financedAmount!));
  });

  it('handles a role that is newly introduced within a still-same-structure recap (0 -> N is impossible without a structure change for base roles, but a product line PRICE from an already-present product to 0 is invalid input) — new product line addition is instead a structure change', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, products: [retailRecapFixture().products![0]] });
    const v2 = retailRecapFixture({ recapVersion: 2 }); // adds VSC back
    expect(determineRecontractMode(v1, v2)).toBe('REVERSE_REPOST');
  });
});
