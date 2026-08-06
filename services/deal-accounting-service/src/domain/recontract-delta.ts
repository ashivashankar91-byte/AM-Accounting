// S087 — delta computation for the DELTA path (same structure hash between
// recap v1 and v2). One entry per role whose dollar amount actually changed
// (zero-delta roles are omitted — DSL posting groups require a strictly
// positive baseAmountPath, so a no-op role is never submitted as a segment).
//
// direction INCREASE means v2 > v1 (post the same normal-side treatment as
// the original segment, for the difference); DECREASE means v2 < v1 (post
// the mirrored/opposite-side treatment for the difference) — see
// scripts/seed-ce12-rule-packs.ts's deal.recontract_delta.v1 rule pack,
// which defines exactly two rules per role (one per direction).

import { DealRecapPayload } from './recap';
import { BASE_ROLE_IDS, BaseRoleId, baseRoleAmountCents, productRoles, productRoleAmountCents } from './roles';

export type DeltaDirection = 'INCREASE' | 'DECREASE';

export interface RoleDelta {
  role: string; // BaseRoleId or `PRODUCT_INCOME:<code>` / `PRODUCT_REMIT:<code>`
  fromCents: number;
  toCents: number;
  deltaCents: number; // toCents - fromCents, signed
  direction: DeltaDirection;
  magnitudeCents: number; // abs(deltaCents) — what actually gets posted
}

function pushDelta(out: RoleDelta[], role: string, fromCents: number | undefined, toCents: number | undefined): void {
  const from = fromCents ?? 0;
  const to = toCents ?? 0;
  const delta = to - from;
  if (delta === 0) return;
  out.push({
    role,
    fromCents: from,
    toCents: to,
    deltaCents: delta,
    direction: delta > 0 ? 'INCREASE' : 'DECREASE',
    magnitudeCents: Math.abs(delta),
  });
}

/**
 * Computes per-role deltas between two SAME-STRUCTURE-HASH recaps. Callers
 * must verify determineRecontractMode(from, to) === 'DELTA' first — this
 * function does not re-check structural equality itself (it will happily
 * compute deltas even across a structure change; the caller boundary is
 * where D-CE12-01's routing decision belongs, not here, so this stays a
 * pure amount-diff utility reusable by both paths' tests).
 */
export function computeRoleDeltas(fromPayload: DealRecapPayload, toPayload: DealRecapPayload, taxAmountCentsFrom?: number | null, taxAmountCentsTo?: number | null): RoleDelta[] {
  const out: RoleDelta[] = [];
  for (const role of BASE_ROLE_IDS as BaseRoleId[]) {
    const fromCents = baseRoleAmountCents(role, fromPayload, taxAmountCentsFrom);
    const toCents = baseRoleAmountCents(role, toPayload, taxAmountCentsTo);
    pushDelta(out, role, fromCents, toCents);
  }

  const fromProducts = productRoles(fromPayload);
  const toProducts = productRoles(toPayload);
  const allProductRoleIds = new Set([...fromProducts.map((r) => r.roleId), ...toProducts.map((r) => r.roleId)]);
  for (const roleId of allProductRoleIds) {
    const fromRole = fromProducts.find((r) => r.roleId === roleId);
    const toRole = toProducts.find((r) => r.roleId === roleId);
    const fromCents = fromRole ? productRoleAmountCents(fromRole, fromPayload) : undefined;
    const toCents = toRole ? productRoleAmountCents(toRole, toPayload) : undefined;
    pushDelta(out, roleId, fromCents, toCents);
  }

  return out;
}
