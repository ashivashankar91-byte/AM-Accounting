// S074 — Stock-in cost-buildup domain logic (pure, no I/O).
//
// Design note (why invoice cost is its own event and transport/pack/
// equipment are separate follow-up "cost component added" postings):
// the posting DSL's baseAmountPath resolves exactly ONE dollar figure per
// posting group and coa-service's blueprint generator REJECTS
// (NON_POSITIVE_AMOUNT) a group whose resolved amount is <= 0
// (services/coa-service/src/domain/posting-engine/blueprint.ts,
// resolveBaseAmountCents). Since a rule pack's set of posting groups is
// static per event type — there is no "skip this group if the figure is
// zero" primitive in DSL v1 — a stock-in event that always carries four
// groups (invoice/transport/pack/equipment) would deterministically REJECT
// the moment any one of those legitimately-optional components is $0
// (e.g. no pack fee, in-house transport). Splitting into a mandatory
// primary event (invoice/acquisition cost, always > 0) plus zero-or-more
// individually-submitted `vehicle.cost-component-added.v1` events (one per
// nonzero optional component) keeps every posting group this service ever
// asks coa-service to evaluate strictly positive, while still satisfying
// the epic's "one posting group per distinct dollar figure, each
// individually balanced" instruction. VehicleUnit.bookValue is the
// authoritative running sum across all of these — S074 AC ("cost
// components sum exactly", "unit item balance = unit GL value always") is
// satisfied by this service's own ledger regardless of how many discrete
// postings contributed to it.

import { requireNonNegativeCents, requirePositiveCents, centsToDollarString } from './money';

export type VehicleStatus = 'NEW' | 'USED' | 'DEMO' | 'WHOLESALE';
export type AcquisitionType = 'PURCHASE' | 'TRADE_IN' | 'DEALER_TRADE_IN' | 'FACTORY_RECEIPT';

export const VEHICLE_STATUSES: readonly VehicleStatus[] = ['NEW', 'USED', 'DEMO', 'WHOLESALE'];
export const ACQUISITION_TYPES: readonly AcquisitionType[] = ['PURCHASE', 'TRADE_IN', 'DEALER_TRADE_IN', 'FACTORY_RECEIPT'];

export interface StockInRequest {
  stockNumber: string;
  vin: string;
  entityId: string;
  storeId: string;
  status: VehicleStatus;
  acquisitionType: AcquisitionType;
  invoiceCost: string; // mandatory, > 0
  transportCost?: string; // optional, >= 0
  packCost?: string; // optional, >= 0
  packRole?: 'PACK_INCOME' | 'HOLDBACK_CLEARING'; // required iff packCost > 0
  equipmentCost?: string; // optional, >= 0
}

export interface ValidatedStockIn {
  invoiceCostCents: number;
  transportCostCents: number;
  packCostCents: number;
  packRole: 'PACK_INCOME' | 'HOLDBACK_CLEARING' | null;
  equipmentCostCents: number;
  totalCostCents: number;
}

export class StockInValidationError extends Error {
  readonly status = 400;
  readonly code = 'STOCK_IN_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'StockInValidationError';
  }
}

export function validateStockIn(req: StockInRequest): ValidatedStockIn {
  if (!req.stockNumber?.trim()) throw new StockInValidationError('stockNumber is required.');
  if (!req.vin?.trim()) throw new StockInValidationError('vin is required.');
  if (!req.entityId?.trim()) throw new StockInValidationError('entityId is required.');
  if (!req.storeId?.trim()) throw new StockInValidationError('storeId is required.');
  if (!VEHICLE_STATUSES.includes(req.status)) throw new StockInValidationError(`status must be one of: ${VEHICLE_STATUSES.join(', ')}`);
  if (!ACQUISITION_TYPES.includes(req.acquisitionType)) throw new StockInValidationError(`acquisitionType must be one of: ${ACQUISITION_TYPES.join(', ')}`);

  let invoiceCostCents: number, transportCostCents: number, packCostCents: number, equipmentCostCents: number;
  try {
    invoiceCostCents = requirePositiveCents('invoiceCost', req.invoiceCost);
    transportCostCents = requireNonNegativeCents('transportCost', req.transportCost ?? '0');
    packCostCents = requireNonNegativeCents('packCost', req.packCost ?? '0');
    equipmentCostCents = requireNonNegativeCents('equipmentCost', req.equipmentCost ?? '0');
  } catch (err) {
    // Normalize this module's public error surface to one type — callers
    // (routes, tests) only need to catch StockInValidationError.
    throw new StockInValidationError((err as Error).message);
  }

  if (packCostCents > 0 && !req.packRole) {
    throw new StockInValidationError('packRole is required when packCost > 0 (PACK_INCOME or HOLDBACK_CLEARING).');
  }
  if (packCostCents === 0 && req.packRole) {
    throw new StockInValidationError('packRole must not be supplied when packCost is 0.');
  }

  return {
    invoiceCostCents,
    transportCostCents,
    packCostCents,
    packRole: packCostCents > 0 ? req.packRole! : null,
    equipmentCostCents,
    totalCostCents: invoiceCostCents + transportCostCents + packCostCents + equipmentCostCents,
  };
}

/** The follow-up cost-component-added submissions this stock-in requires (only nonzero components). */
export function followUpComponents(v: ValidatedStockIn): Array<{ componentType: 'TRANSPORT' | 'PACK' | 'EQUIPMENT'; amount: string; packRole?: 'PACK_INCOME' | 'HOLDBACK_CLEARING' }> {
  const out: Array<{ componentType: 'TRANSPORT' | 'PACK' | 'EQUIPMENT'; amount: string; packRole?: 'PACK_INCOME' | 'HOLDBACK_CLEARING' }> = [];
  if (v.transportCostCents > 0) out.push({ componentType: 'TRANSPORT', amount: centsToDollarString(v.transportCostCents) });
  if (v.packCostCents > 0) out.push({ componentType: 'PACK', amount: centsToDollarString(v.packCostCents), packRole: v.packRole! });
  if (v.equipmentCostCents > 0) out.push({ componentType: 'EQUIPMENT', amount: centsToDollarString(v.equipmentCostCents) });
  return out;
}

/** Credit-side role selection for the primary stock-in journal, per acquisitionType (S074: "CR AP (factory/auction via CE-09), trade-allowance clearing, or transfer"). */
export function creditRoleForAcquisition(acquisitionType: AcquisitionType): 'AP_FACTORY_AUCTION_CLEARING' | 'TRADE_ALLOWANCE_CLEARING' | 'DEALER_TRADE_CLEARING' {
  switch (acquisitionType) {
    case 'TRADE_IN':
      return 'TRADE_ALLOWANCE_CLEARING';
    case 'DEALER_TRADE_IN':
      return 'DEALER_TRADE_CLEARING';
    case 'PURCHASE':
    case 'FACTORY_RECEIPT':
    default:
      return 'AP_FACTORY_AUCTION_CLEARING';
  }
}
