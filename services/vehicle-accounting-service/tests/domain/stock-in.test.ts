import { describe, it, expect } from 'vitest';
import { validateStockIn, followUpComponents, creditRoleForAcquisition, StockInValidationError, StockInRequest } from '../../src/domain/stock-in';

function baseReq(overrides: Partial<StockInRequest> = {}): StockInRequest {
  return {
    stockNumber: 'STK-1001',
    vin: '1FTFW1E5XNFA00001',
    entityId: 'entity-1',
    storeId: 'store-1',
    status: 'NEW',
    acquisitionType: 'PURCHASE',
    invoiceCost: '25000.00',
    ...overrides,
  };
}

describe('stock-in domain', () => {
  it('validates a minimal request (invoice only) and sums correctly', () => {
    const v = validateStockIn(baseReq());
    expect(v.invoiceCostCents).toBe(2_500_000);
    expect(v.transportCostCents).toBe(0);
    expect(v.packCostCents).toBe(0);
    expect(v.equipmentCostCents).toBe(0);
    expect(v.totalCostCents).toBe(2_500_000);
  });

  it('sums all four cost components exactly (S074 AC)', () => {
    const v = validateStockIn(baseReq({ transportCost: '350.00', packCost: '150.00', packRole: 'PACK_INCOME', equipmentCost: '899.99' }));
    expect(v.totalCostCents).toBe(2_500_000 + 35_000 + 15_000 + 89_999);
  });

  it('rejects a zero or missing invoiceCost', () => {
    expect(() => validateStockIn(baseReq({ invoiceCost: '0.00' }))).toThrow(StockInValidationError);
  });

  it('rejects an unknown status/acquisitionType', () => {
    expect(() => validateStockIn(baseReq({ status: 'BOGUS' as any }))).toThrow(StockInValidationError);
    expect(() => validateStockIn(baseReq({ acquisitionType: 'BOGUS' as any }))).toThrow(StockInValidationError);
  });

  it('requires packRole when packCost > 0, and forbids it when packCost is 0', () => {
    expect(() => validateStockIn(baseReq({ packCost: '100.00' }))).toThrow(StockInValidationError);
    expect(() => validateStockIn(baseReq({ packRole: 'PACK_INCOME' }))).toThrow(StockInValidationError);
  });

  it('followUpComponents omits zero-value components (never a $0 posting group)', () => {
    const v = validateStockIn(baseReq());
    expect(followUpComponents(v)).toEqual([]);
  });

  it('followUpComponents includes exactly the nonzero components with correct dollar strings', () => {
    const v = validateStockIn(baseReq({ transportCost: '350.00', equipmentCost: '10.50' }));
    const fu = followUpComponents(v);
    expect(fu).toEqual([
      { componentType: 'TRANSPORT', amount: '350.00' },
      { componentType: 'EQUIPMENT', amount: '10.50' },
    ]);
  });

  it('followUpComponents carries packRole only for the PACK component', () => {
    const v = validateStockIn(baseReq({ packCost: '75.00', packRole: 'HOLDBACK_CLEARING' }));
    expect(followUpComponents(v)).toEqual([{ componentType: 'PACK', amount: '75.00', packRole: 'HOLDBACK_CLEARING' }]);
  });

  it('creditRoleForAcquisition maps each acquisitionType to its matrix role', () => {
    expect(creditRoleForAcquisition('PURCHASE')).toBe('AP_FACTORY_AUCTION_CLEARING');
    expect(creditRoleForAcquisition('FACTORY_RECEIPT')).toBe('AP_FACTORY_AUCTION_CLEARING');
    expect(creditRoleForAcquisition('TRADE_IN')).toBe('TRADE_ALLOWANCE_CLEARING');
    expect(creditRoleForAcquisition('DEALER_TRADE_IN')).toBe('DEALER_TRADE_CLEARING');
  });
});
