import { describe, it, expect } from 'vitest';
import { validateRecapStructural, assertTradeInSplitPresent, RecapValidationError, TradeInSplitMissingError } from '../../src/domain/recap-validation';
import { retailRecapFixture, leaseRecapFixture } from '../support/fixtures';

describe('S084 recap structural validation', () => {
  it('accepts a fully-populated retail recap', () => {
    expect(() => validateRecapStructural(retailRecapFixture())).not.toThrow();
  });

  it('accepts a fully-populated lease recap', () => {
    expect(() => validateRecapStructural(leaseRecapFixture())).not.toThrow();
  });

  it('rejects a retail recap missing saleAmount', () => {
    const recap = retailRecapFixture({ saleAmount: null });
    expect(() => validateRecapStructural(recap)).toThrow(RecapValidationError);
  });

  it('rejects a lease recap missing leaseResidualAmount', () => {
    const recap = leaseRecapFixture({ leaseResidualAmount: null });
    expect(() => validateRecapStructural(recap)).toThrow(RecapValidationError);
  });

  it('rejects a recap with more than the supported max product lines', () => {
    const recap = retailRecapFixture({
      products: Array.from({ length: 5 }, (_, i) => ({
        productCode: `P${i}`,
        providerRef: `PR${i}`,
        customerPriceAmount: '100.00',
        providerCostAmount: '50.00',
      })),
    });
    expect(() => validateRecapStructural(recap)).toThrow(/maximum of 4/);
  });

  it('rejects duplicate product codes within one recap', () => {
    const recap = retailRecapFixture({
      products: [
        { productCode: 'GAP', providerRef: 'A', customerPriceAmount: '1.00', providerCostAmount: '1.00' },
        { productCode: 'GAP', providerRef: 'B', customerPriceAmount: '1.00', providerCostAmount: '1.00' },
      ],
    });
    expect(() => validateRecapStructural(recap)).toThrow(/duplicate/);
  });
});

describe('D-CE12-02 — trade-in ACV vs allowance safe interim', () => {
  it('rejects when hasTradeIn is true and tradeAllowanceAmount is missing', () => {
    const recap = retailRecapFixture({ tradeAllowanceAmount: null });
    expect(() => assertTradeInSplitPresent(recap)).toThrow(TradeInSplitMissingError);
  });

  it('rejects when hasTradeIn is true and tradeAcvAmount is missing', () => {
    const recap = retailRecapFixture({ tradeAcvAmount: null });
    expect(() => assertTradeInSplitPresent(recap)).toThrow(TradeInSplitMissingError);
  });

  it('rejects when both are missing', () => {
    const recap = retailRecapFixture({ tradeAllowanceAmount: null, tradeAcvAmount: null });
    expect(() => assertTradeInSplitPresent(recap)).toThrow(TradeInSplitMissingError);
  });

  it('rejects a non-positive (zero) tradeAcvAmount — never silently treated as "no split"', () => {
    const recap = retailRecapFixture({ tradeAcvAmount: '0.00' });
    expect(() => assertTradeInSplitPresent(recap)).toThrow(TradeInSplitMissingError);
  });

  it('never derives one figure from the other — full structural validation also refuses even if only one is present (as the named D-CE12-02 error, not a generic field error)', () => {
    const recap = retailRecapFixture({ tradeAcvAmount: null });
    expect(() => validateRecapStructural(recap)).toThrow(TradeInSplitMissingError);
  });

  it('passes through unaffected when there is no trade-in at all', () => {
    const recap = retailRecapFixture({ hasTradeIn: false, tradeVin: null, tradeAllowanceAmount: null, tradeAcvAmount: null, tradePayoffAmount: null });
    expect(() => assertTradeInSplitPresent(recap)).not.toThrow();
    expect(() => validateRecapStructural(recap)).not.toThrow();
  });

  it('accepts an explicit, fully-specified split', () => {
    const recap = retailRecapFixture({ tradeAllowanceAmount: '9000.00', tradeAcvAmount: '7500.00' });
    expect(() => assertTradeInSplitPresent(recap)).not.toThrow();
  });
});
