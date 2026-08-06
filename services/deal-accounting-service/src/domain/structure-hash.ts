// S087 — D-CE12-01 mandatory safe interim: "Deterministic conservative rule
// shipped: structure-hash change ⇒ reverse+repost; else delta."
//
// The hash is computed over WHICH posting-group/account roles a recap would
// produce (dealType + the set of present base roles + the sorted list of
// product codes) — never over dollar amounts. Two recaps with identical
// structure but different amounts hash identically (-> DELTA path); two
// recaps where a role's PRESENCE changed (e.g. v2 adds a trade-in v1 didn't
// have, or a product line is added/removed) hash differently (-> REVERSE_
// REPOST path). This is pure and DB-free — fully unit-testable.

import crypto from 'crypto';
import { DealRecapPayload } from './recap';
import { presentBaseRoles } from './roles';

export interface StructureSignature {
  dealType: string;
  roles: string[]; // sorted base role ids present
  productCodes: string[]; // sorted product codes present
}

/**
 * taxAmountCents is intentionally NOT threaded in here — the TAX role's
 * presence follows solely from whether the recap carries a taxResultId at
 * all (a structural fact known before any tax-service call), not from the
 * fetched amount. This keeps the structure hash computable purely from the
 * recap payload, with no I/O and no dependency on tax-service being
 * reachable — exactly the "pure, testable right now without a DB" property
 * required of this module.
 */
export function computeStructureSignature(payload: DealRecapPayload): StructureSignature {
  // Mirror presentBaseRoles()'s TAX handling using presence-of-reference
  // (not a fetched amount) as the structural signal.
  const roles = presentBaseRoles(payload, payload.taxResultId ? 1 : undefined);
  const productCodes = (payload.products ?? []).map((p) => p.productCode).filter(Boolean).sort();
  return {
    dealType: payload.dealType,
    roles: [...roles].sort(),
    productCodes,
  };
}

export function computeStructureHash(payload: DealRecapPayload): string {
  const sig = computeStructureSignature(payload);
  return crypto.createHash('sha256').update(JSON.stringify(sig)).digest('hex');
}

export type RecontractMode = 'DELTA' | 'REVERSE_REPOST';

/** D-CE12-01's deterministic rule, applied. */
export function determineRecontractMode(fromPayload: DealRecapPayload, toPayload: DealRecapPayload): RecontractMode {
  return computeStructureHash(fromPayload) === computeStructureHash(toPayload) ? 'DELTA' : 'REVERSE_REPOST';
}
