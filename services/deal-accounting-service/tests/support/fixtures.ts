import { DealRecapPayload } from '../../src/domain/recap';

export function retailRecapFixture(overrides: Partial<DealRecapPayload> = {}): DealRecapPayload {
  return {
    dealNumber: 'D-1001',
    recapVersion: 1,
    dealType: 'RETAIL',
    vin: '1FTFW1E5XNFA00001',
    stockNumber: 'STK-1001',
    legalEntityId: 'entity-1',
    storeId: 'store-1',
    businessDate: '2026-08-01',
    saleAmount: '32500.00',
    unitCostAmount: '28000.00',
    hasTradeIn: true,
    tradeVin: '1G1ZD5ST0JF123456',
    tradeAllowanceAmount: '9000.00',
    tradeAcvAmount: '7500.00',
    tradePayoffAmount: '4200.00',
    tradeLienholderRef: 'LIEN-778',
    financedAmount: '25000.00',
    reserveIncomeAmount: '650.00',
    reserveTermsRef: 'RES-TERMS-1',
    products: [
      { productCode: 'GAP', providerRef: 'PROV-GAP-1', customerPriceAmount: '795.00', providerCostAmount: '350.00' },
      { productCode: 'VSC', providerRef: 'PROV-VSC-1', customerPriceAmount: '2295.00', providerCostAmount: '1400.00' },
    ],
    feesAmount: '499.00',
    taxResultId: 'tax-result-1',
    rebateReceivableAmount: '500.00',
    downPaymentRef: 'DOWN-1',
    commissionBasisSnapshot: { grossProfit: '4500.00' },
    ...overrides,
  };
}

export function leaseRecapFixture(overrides: Partial<DealRecapPayload> = {}): DealRecapPayload {
  return {
    ...retailRecapFixture(),
    dealType: 'LEASE',
    saleAmount: null,
    leaseCapitalizedCostAmount: '30500.00',
    leaseResidualAmount: '18000.00',
    hasTradeIn: false,
    tradeVin: null,
    tradeAllowanceAmount: null,
    tradeAcvAmount: null,
    tradePayoffAmount: null,
    ...overrides,
  };
}
