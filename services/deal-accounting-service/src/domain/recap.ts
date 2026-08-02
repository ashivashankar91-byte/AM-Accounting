// The deal-recap contract this service owns (Variable Ops' `deal.finalized`
// recap freeze is PUTR per the epic package's DEPENDENCIES register — this
// is deal-accounting-service's own concrete shape of that contract, built
// to satisfy S084's AC list field-for-field). Every amount here is a
// decimal STRING (never a float), matching NUMERIC(15,2) end to end.

export const DEAL_TYPES = ['RETAIL', 'LEASE', 'WHOLESALE', 'DEALER_TRADE'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export interface DealRecapProductLine {
  productCode: string;
  providerRef: string;
  customerPriceAmount: string; // income
  providerCostAmount: string; // remit liability
}

export interface DealRecapPayload {
  dealNumber: string;
  recapVersion: number;
  dealType: DealType;
  vin?: string | null;
  stockNumber: string;
  legalEntityId: string;
  storeId: string;
  businessDate: string; // YYYY-MM-DD — the deal's accounting date

  // Variant-specific "gross" figure — exactly one populated per dealType.
  saleAmount?: string | null; // RETAIL / DEALER_TRADE
  dealerTradeAmount?: string | null; // DEALER_TRADE (alternate to saleAmount if desking uses this field name)
  wholesaleAmount?: string | null; // WHOLESALE
  leaseCapitalizedCostAmount?: string | null; // LEASE
  leaseResidualAmount?: string | null; // LEASE

  unitCostAmount: string;

  hasTradeIn: boolean;
  tradeVin?: string | null;
  tradeAllowanceAmount?: string | null; // D-CE12-02 — must be explicit if hasTradeIn
  tradeAcvAmount?: string | null; // D-CE12-02 — must be explicit if hasTradeIn
  tradePayoffAmount?: string | null;
  tradeLienholderRef?: string | null;

  financedAmount?: string | null; // CIT
  reserveIncomeAmount?: string | null;
  reserveTermsRef?: string | null;

  products?: DealRecapProductLine[];

  feesAmount?: string | null;

  taxResultId?: string | null; // tax-service TaxResult.id — S124 result reference, never a computed amount

  rebateReceivableAmount?: string | null; // CE-14 PUTR boundary
  downPaymentRef?: string | null; // CE-09 PUTR — cash-application leg only

  commissionBasisSnapshot?: Record<string, unknown> | null; // CE-13 PUTR — basis figures only
}

export const MAX_PRODUCT_LINES = 4;
