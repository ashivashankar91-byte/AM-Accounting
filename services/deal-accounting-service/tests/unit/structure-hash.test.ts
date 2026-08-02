import { describe, it, expect } from 'vitest';
import { computeStructureHash, determineRecontractMode } from '../../src/domain/structure-hash';
import { retailRecapFixture, leaseRecapFixture } from '../support/fixtures';

describe('S087 / D-CE12-01 — structure hash', () => {
  it('is stable across two calls on the identical payload', () => {
    const recap = retailRecapFixture();
    expect(computeStructureHash(recap)).toBe(computeStructureHash(recap));
  });

  it('is unchanged when only dollar amounts change (same roles present)', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, saleAmount: '32500.00' });
    const v2 = retailRecapFixture({ recapVersion: 2, saleAmount: '33000.00' });
    expect(computeStructureHash(v1)).toBe(computeStructureHash(v2));
    expect(determineRecontractMode(v1, v2)).toBe('DELTA');
  });

  it('changes when a trade-in is added that v1 did not have', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, hasTradeIn: false, tradeVin: null, tradeAllowanceAmount: null, tradeAcvAmount: null, tradePayoffAmount: null });
    const v2 = retailRecapFixture({ recapVersion: 2, hasTradeIn: true });
    expect(computeStructureHash(v1)).not.toBe(computeStructureHash(v2));
    expect(determineRecontractMode(v1, v2)).toBe('REVERSE_REPOST');
  });

  it('changes when a product line is added', () => {
    const v1 = retailRecapFixture({ recapVersion: 1, products: [{ productCode: 'GAP', providerRef: 'P', customerPriceAmount: '795.00', providerCostAmount: '350.00' }] });
    const v2 = retailRecapFixture({ recapVersion: 2, products: [
      { productCode: 'GAP', providerRef: 'P', customerPriceAmount: '795.00', providerCostAmount: '350.00' },
      { productCode: 'VSC', providerRef: 'P2', customerPriceAmount: '2295.00', providerCostAmount: '1400.00' },
    ] });
    expect(computeStructureHash(v1)).not.toBe(computeStructureHash(v2));
    expect(determineRecontractMode(v1, v2)).toBe('REVERSE_REPOST');
  });

  it('changes when a product line is removed', () => {
    const v1 = retailRecapFixture({ recapVersion: 1 }); // has GAP + VSC
    const v2 = retailRecapFixture({ recapVersion: 2, products: [retailRecapFixture().products![0]] });
    expect(computeStructureHash(v1)).not.toBe(computeStructureHash(v2));
    expect(determineRecontractMode(v1, v2)).toBe('REVERSE_REPOST');
  });

  it('is independent of product array order (canonical sort)', () => {
    const base = retailRecapFixture();
    const reordered = retailRecapFixture({ products: [...base.products!].reverse() });
    expect(computeStructureHash(base)).toBe(computeStructureHash(reordered));
  });

  it('differs between dealType variants even with otherwise-similar fields', () => {
    const retail = retailRecapFixture();
    const lease = leaseRecapFixture();
    expect(computeStructureHash(retail)).not.toBe(computeStructureHash(lease));
  });

  it('changes when reserve income is removed entirely (role disappears)', () => {
    const v1 = retailRecapFixture({ recapVersion: 1 });
    const v2 = retailRecapFixture({ recapVersion: 2, reserveIncomeAmount: null });
    expect(determineRecontractMode(v1, v2)).toBe('REVERSE_REPOST');
  });
});
