// Pure, DB-free recap validation. Two jobs:
//   1. Structural completeness per dealType — "recap figures are authoritative
//      inputs; generator computes structure, not deal math" (S084 AC): every
//      field a segment's baseAmountPath will read MUST already be present
//      and a valid positive decimal, or the deal is blocked before any
//      coa-service call (never estimated, never silently skipped).
//   2. D-CE12-02 (mandatory safe interim) — trade-in ACV vs allowance
//      over/under treatment: "Structure per recap fields as delivered by
//      desking (authoritative input); if recap lacks the split, event
//      rejects — never derived." Implemented literally: if hasTradeIn and
//      either tradeAllowanceAmount or tradeAcvAmount is missing/blank/
//      non-positive, this throws before any coa-service submission — this
//      service NEVER computes one from the other.

import { DealRecapPayload, DealRecapProductLine, MAX_PRODUCT_LINES } from './recap';
import { isPositiveDecimalString } from './money';

export class RecapValidationError extends Error {
  readonly code = 'RECAP_VALIDATION_ERROR';
  constructor(readonly fieldErrors: string[]) {
    super(`Recap failed validation: ${fieldErrors.join('; ')}`);
    this.name = 'RecapValidationError';
  }
}

/** D-CE12-02 — thrown standalone so callers can distinguish this specific,
 * named refusal from a generic structural validation error. */
export class TradeInSplitMissingError extends Error {
  readonly code = 'TRADE_IN_SPLIT_MISSING';
  constructor(readonly detail: string) {
    super(`D-CE12-02: trade-in present but recap lacks an explicit allowance/ACV split — ${detail}. This service never derives one from the other; desking must supply both.`);
    this.name = 'TradeInSplitMissingError';
  }
}

function requirePositive(errors: string[], label: string, value: string | null | undefined): void {
  if (!isPositiveDecimalString(value ?? undefined)) {
    errors.push(`${label} is required and must be a positive decimal amount`);
  }
}

/** D-CE12-02 — standalone so it can be called (and its specific error type
 * caught) independently of full structural validation. */
export function assertTradeInSplitPresent(payload: DealRecapPayload): void {
  if (!payload.hasTradeIn) return;
  const missing: string[] = [];
  if (!isPositiveDecimalString(payload.tradeAllowanceAmount ?? undefined)) missing.push('tradeAllowanceAmount');
  if (!isPositiveDecimalString(payload.tradeAcvAmount ?? undefined)) missing.push('tradeAcvAmount');
  if (missing.length > 0) {
    throw new TradeInSplitMissingError(`missing/invalid: ${missing.join(', ')}`);
  }
}

function validateProductLine(errors: string[], index: number, line: DealRecapProductLine): void {
  if (!line.productCode?.trim()) errors.push(`products[${index}].productCode is required`);
  if (!line.providerRef?.trim()) errors.push(`products[${index}].providerRef is required`);
  requirePositive(errors, `products[${index}].customerPriceAmount`, line.customerPriceAmount);
  requirePositive(errors, `products[${index}].providerCostAmount`, line.providerCostAmount);
}

/**
 * Full structural validation for a deal.finalized recap (S084). Throws
 * RecapValidationError (field list) or TradeInSplitMissingError (D-CE12-02)
 * — never silently coerces/derives a missing figure.
 */
export function validateRecapStructural(payload: DealRecapPayload): void {
  const errors: string[] = [];

  if (!payload.dealNumber?.trim()) errors.push('dealNumber is required');
  if (!Number.isInteger(payload.recapVersion) || payload.recapVersion < 1) errors.push('recapVersion must be a positive integer');
  if (!payload.stockNumber?.trim()) errors.push('stockNumber is required (unit relief control reference)');
  if (!payload.legalEntityId?.trim()) errors.push('legalEntityId is required');
  if (!payload.storeId?.trim()) errors.push('storeId is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate ?? '')) errors.push('businessDate is required (YYYY-MM-DD)');
  requirePositive(errors, 'unitCostAmount', payload.unitCostAmount);

  switch (payload.dealType) {
    case 'RETAIL':
      requirePositive(errors, 'saleAmount', payload.saleAmount);
      break;
    case 'DEALER_TRADE':
      if (!isPositiveDecimalString(payload.saleAmount ?? undefined) && !isPositiveDecimalString(payload.dealerTradeAmount ?? undefined)) {
        errors.push('saleAmount or dealerTradeAmount is required for a DEALER_TRADE deal');
      }
      break;
    case 'WHOLESALE':
      requirePositive(errors, 'wholesaleAmount', payload.wholesaleAmount);
      break;
    case 'LEASE':
      requirePositive(errors, 'leaseCapitalizedCostAmount', payload.leaseCapitalizedCostAmount);
      requirePositive(errors, 'leaseResidualAmount', payload.leaseResidualAmount);
      break;
    default:
      errors.push(`Unknown dealType: ${String(payload.dealType)}`);
  }

  if (payload.hasTradeIn) {
    if (!payload.tradeVin?.trim()) errors.push('tradeVin is required when hasTradeIn is true');
    // D-CE12-02 amount-level check is DELIBERATELY NOT folded into this
    // generic field-error list — it is enforced exclusively by
    // assertTradeInSplitPresent() below, as its own named, distinct
    // TradeInSplitMissingError, so callers (and the http layer) can
    // recognize this specific business rule refusal rather than it being
    // buried inside a generic 400 field-errors array.
    if (payload.tradePayoffAmount != null && isPositiveDecimalString(payload.tradePayoffAmount) && !payload.tradeLienholderRef?.trim()) {
      errors.push('tradeLienholderRef is required when tradePayoffAmount is present');
    }
  }

  if (payload.financedAmount != null && payload.financedAmount !== '' && !isPositiveDecimalString(payload.financedAmount)) {
    errors.push('financedAmount, when present, must be a positive decimal amount');
  }
  if (payload.reserveIncomeAmount != null && payload.reserveIncomeAmount !== '' && !isPositiveDecimalString(payload.reserveIncomeAmount)) {
    errors.push('reserveIncomeAmount, when present, must be a positive decimal amount');
  }
  if (payload.feesAmount != null && payload.feesAmount !== '' && !isPositiveDecimalString(payload.feesAmount)) {
    errors.push('feesAmount, when present, must be a positive decimal amount');
  }
  if (payload.rebateReceivableAmount != null && payload.rebateReceivableAmount !== '' && !isPositiveDecimalString(payload.rebateReceivableAmount)) {
    errors.push('rebateReceivableAmount, when present, must be a positive decimal amount');
  }

  if (payload.products) {
    if (payload.products.length > MAX_PRODUCT_LINES) {
      errors.push(`products exceeds the supported maximum of ${MAX_PRODUCT_LINES} lines`);
    }
    const seen = new Set<string>();
    payload.products.forEach((line, i) => {
      validateProductLine(errors, i, line);
      if (line.productCode) {
        if (seen.has(line.productCode)) errors.push(`products[${i}].productCode "${line.productCode}" is a duplicate within this recap`);
        seen.add(line.productCode);
      }
    });
  }

  if (errors.length > 0) throw new RecapValidationError(errors);

  // D-CE12-02 — enforced last, own error type, own message.
  assertTradeInSplitPresent(payload);
}
