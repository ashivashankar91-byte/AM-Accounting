// S055 — Merchant Settlement Reconciliation domain rules. Pure functions.

export function assertGrossFeeNetProves(grossCents: number, feeCents: number, netCents: number): void {
  if (grossCents - feeCents !== netCents) {
    throw new SettlementConservationError(grossCents, feeCents, netCents);
  }
}

export class SettlementConservationError extends Error {
  readonly status = 409;
  readonly code = 'SETTLEMENT_CONSERVATION_FAILED';
  constructor(readonly grossCents: number, readonly feeCents: number, readonly netCents: number) {
    super(`gross(${grossCents}) - fee(${feeCents}) != net(${netCents})`);
    this.name = 'SettlementConservationError';
  }
}

export type ChargebackDispositionAction = 'CUSTOMER_RESPONSIBILITY' | 'MERCHANT_ABSORBED';

export function isValidDispositionAction(action: string): action is ChargebackDispositionAction {
  return action === 'CUSTOMER_RESPONSIBILITY' || action === 'MERCHANT_ABSORBED';
}
