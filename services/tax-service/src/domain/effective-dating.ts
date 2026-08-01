// CE-10 / S124 — effective-dating helpers, used everywhere a configuration
// object (engine connection, jurisdiction registrations, exemption certs,
// fee tables) must resolve "as of businessDate" rather than "as of today".
//
// Backdated transactions must resolve configuration effective at their
// businessDate — never today's (S124 AC5 / S125 AC4, the "history-proof"
// requirement).

export interface EffectiveDated {
  effectiveFrom: string | Date;
  effectiveTo?: string | Date | null;
}

function toDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.length > 10 ? value.slice(0, 10) : value;
}

/**
 * Returns the row(s) effective at `businessDate` (YYYY-MM-DD or Date). When
 * multiple rows are found (should never happen if assertNoOverlap was
 * enforced at save time), the caller decides how to handle it — this
 * helper does not silently pick one.
 */
export function resolveEffective<T extends EffectiveDated>(rows: readonly T[], businessDate: string | Date): T[] {
  const target = toDateOnly(businessDate);
  return rows.filter((row) => {
    const from = toDateOnly(row.effectiveFrom);
    const to = row.effectiveTo ? toDateOnly(row.effectiveTo) : null;
    return from <= target && (to === null || to >= target);
  });
}

/** Convenience — the single effective row, or null. */
export function resolveEffectiveOne<T extends EffectiveDated>(rows: readonly T[], businessDate: string | Date): T | null {
  const matches = resolveEffective(rows, businessDate);
  return matches[0] ?? null;
}

function rangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/**
 * Save-time validator: rejects a new/updated row whose active date range
 * overlaps any OTHER existing active row sharing the same scope key
 * (tenantId, legalEntityId, and whatever scope key the caller has already
 * filtered `existingRows` down to — e.g. jurisdictionRef, or feeCode).
 * Never runs at calculation/resolution time — ambiguity is a configuration
 * validation error at save, not a runtime decision (S124/S125 pattern).
 *
 * `excludeId` lets an UPDATE compare against every OTHER row (not itself).
 */
export function assertNoOverlap<T extends EffectiveDated & { id: string }>(
  existingRows: readonly T[],
  newRow: EffectiveDated,
  excludeId?: string,
): T | null {
  const newFrom = toDateOnly(newRow.effectiveFrom);
  const newTo = newRow.effectiveTo ? toDateOnly(newRow.effectiveTo) : null;
  for (const row of existingRows) {
    if (excludeId && row.id === excludeId) continue;
    const from = toDateOnly(row.effectiveFrom);
    const to = row.effectiveTo ? toDateOnly(row.effectiveTo) : null;
    if (rangesOverlap(newFrom, newTo, from, to)) return row;
  }
  return null;
}
