// S087 (D-CE12-01) — the fixed set of posting-group "roles" a deal recap can
// produce. A role is present iff its guard passes; its cents amount is read
// by its accessor. This registry is the single source of truth both
// structure-hash.ts (which ROLES are present) and delta.ts (per-role dollar
// deltas between two recap versions) build on — and scripts/seed-ce12-rule-
// packs.ts's deal.recontract_delta.v1 rule generation walks the exact same
// list, so the rule pack and the domain logic can never silently drift.
//
// Product lines are NOT fixed roles (a deal has a variable number of them)
// — see productRoleIds()/productRoleAmountCents() below, keyed by the
// recap's own productCode (stable across recap versions even if array index
// shifts), each product line contributing TWO roles: income and remit.

import { DealRecapPayload } from './recap';
import { toCents } from './money';

export type BaseRoleId =
  | 'GROSS' // sale / lease-cap / wholesale / dealer-trade "gross" figure
  | 'LEASE_RESIDUAL'
  | 'UNIT_COST'
  | 'TRADE_ALLOWANCE'
  | 'TRADE_ACV'
  | 'TRADE_PAYOFF'
  | 'CIT'
  | 'RESERVE_INCOME'
  | 'FEES'
  | 'TAX'
  | 'REBATE_RECEIVABLE';

export const BASE_ROLE_IDS: BaseRoleId[] = [
  'GROSS', 'LEASE_RESIDUAL', 'UNIT_COST', 'TRADE_ALLOWANCE', 'TRADE_ACV',
  'TRADE_PAYOFF', 'CIT', 'RESERVE_INCOME', 'FEES', 'TAX', 'REBATE_RECEIVABLE',
];

/** Resolves the dollar-string field a base role reads from, per dealType where relevant. */
function grossField(payload: DealRecapPayload): string | null | undefined {
  switch (payload.dealType) {
    case 'RETAIL':
      return payload.saleAmount;
    case 'DEALER_TRADE':
      return payload.saleAmount ?? payload.dealerTradeAmount;
    case 'WHOLESALE':
      return payload.wholesaleAmount;
    case 'LEASE':
      return payload.leaseCapitalizedCostAmount;
    default:
      return null;
  }
}

function baseRoleField(role: BaseRoleId, payload: DealRecapPayload): string | null | undefined {
  switch (role) {
    case 'GROSS': return grossField(payload);
    case 'LEASE_RESIDUAL': return payload.dealType === 'LEASE' ? payload.leaseResidualAmount : null;
    case 'UNIT_COST': return payload.unitCostAmount;
    case 'TRADE_ALLOWANCE': return payload.hasTradeIn ? payload.tradeAllowanceAmount : null;
    case 'TRADE_ACV': return payload.hasTradeIn ? payload.tradeAcvAmount : null;
    case 'TRADE_PAYOFF': return payload.hasTradeIn ? payload.tradePayoffAmount : null;
    case 'CIT': return payload.financedAmount;
    case 'RESERVE_INCOME': return payload.reserveIncomeAmount;
    case 'FEES': return payload.feesAmount;
    case 'TAX': return null; // resolved from the fetched tax-service result, not the raw recap field — see recap.taxResultId
    case 'REBATE_RECEIVABLE': return payload.rebateReceivableAmount;
  }
}

/** Cents amount for a base role given the recap payload plus (for TAX) the fetched tax amount cents. Undefined = role not present. */
export function baseRoleAmountCents(role: BaseRoleId, payload: DealRecapPayload, taxAmountCents?: number | null): number | undefined {
  if (role === 'TAX') {
    return taxAmountCents != null && taxAmountCents > 0 ? taxAmountCents : undefined;
  }
  const field = baseRoleField(role, payload);
  if (field == null || field === '') return undefined;
  const cents = toCents(field);
  return Number.isFinite(cents) && cents > 0 ? cents : undefined;
}

export function presentBaseRoles(payload: DealRecapPayload, taxAmountCents?: number | null): BaseRoleId[] {
  return BASE_ROLE_IDS.filter((r) => baseRoleAmountCents(r, payload, taxAmountCents) !== undefined);
}

// ── Product roles (dynamic, keyed by productCode) ───────────────────────────

export type ProductRoleKind = 'PRODUCT_INCOME' | 'PRODUCT_REMIT';

export interface ProductRole {
  kind: ProductRoleKind;
  productCode: string;
  roleId: string; // `${kind}:${productCode}`
}

export function productRoles(payload: DealRecapPayload): ProductRole[] {
  const out: ProductRole[] = [];
  for (const line of payload.products ?? []) {
    if (!line.productCode) continue;
    out.push({ kind: 'PRODUCT_INCOME', productCode: line.productCode, roleId: `PRODUCT_INCOME:${line.productCode}` });
    out.push({ kind: 'PRODUCT_REMIT', productCode: line.productCode, roleId: `PRODUCT_REMIT:${line.productCode}` });
  }
  return out;
}

export function productRoleAmountCents(role: ProductRole, payload: DealRecapPayload): number | undefined {
  const line = (payload.products ?? []).find((p) => p.productCode === role.productCode);
  if (!line) return undefined;
  const field = role.kind === 'PRODUCT_INCOME' ? line.customerPriceAmount : line.providerCostAmount;
  const cents = toCents(field);
  return Number.isFinite(cents) && cents > 0 ? cents : undefined;
}
