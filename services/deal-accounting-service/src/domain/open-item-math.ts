// Pure cents-integer open-item application math for this service's own
// DealOpenItem local sub-ledger (see the schema.prisma doc comment for why
// this ledger exists instead of a real services/schedule-service
// ScheduleOpenItem). Deliberately mirrors services/schedule-service/src/
// domain/open-item.ts's applyAmount/deriveStatus semantics (same over-
// application guard, same status derivation), just in whole-cent integers
// instead of Prisma.Decimal, since this module must stay DB/Prisma-free for
// pure unit testing.

export type DealOpenItemStatus = 'OPEN' | 'PARTIALLY_APPLIED' | 'CLOSED';

export function deriveOpenItemStatus(originalCents: number, remainingCents: number): DealOpenItemStatus {
  if (remainingCents === 0) return 'CLOSED';
  if (remainingCents === originalCents) return 'OPEN';
  return 'PARTIALLY_APPLIED';
}

export class OverApplicationError extends Error {
  constructor() {
    super('Application amount would over-apply the open item (exceed its original amount or flip its sign).');
    this.name = 'OverApplicationError';
  }
}

/** Returns the new remaining balance (cents) after applying applicationCents, or throws OverApplicationError. */
export function applyOpenItemAmountCents(originalCents: number, remainingCents: number, applicationCents: number): number {
  const next = remainingCents - applicationCents;
  const overApplied = originalCents >= 0 ? (next < 0 || next > originalCents) : (next > 0 || next < originalCents);
  if (overApplied) throw new OverApplicationError();
  return next;
}
