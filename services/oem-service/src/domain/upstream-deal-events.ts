/**
 * S103A — RDR-linked flat incentive accrual triggers on delivery-reported
 * events, sourced from CE-12's deal.finalized RDR/incentive fields (package
 * line 22: "[PUTR: rebate/incentive fields on deal.finalized]"). CE-12 is
 * not implemented in this worktree — this is the exact
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION boundary, same shape as
 * domain/upstream-items.ts's UnwiredOpenItemSource.
 *
 * Deterministic fixture deliveries (tests/support/fake-deal-finalized-
 * source.ts and fixtures/rdr-deliveries.json) exercise the accrual logic now
 * without the real CE-12 event feed.
 */

export interface DealFinalizedRdrEvent {
  tenantId: string;
  storeId: string;
  dealNumber: string;
  make: string;
  programId: string | null; // null = deal not tagged to a registered program
  qualifyingUnitCount: number;
  eventRef: string; // the deal.finalized event id — becomes sourceDealFinalizedRef
  deliveredAt: string; // ISO date
}

export interface DealFinalizedSource {
  findRdrDeliveries(tenantId: string, storeId: string, since: string): Promise<DealFinalizedRdrEvent[]>;
}

/**
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — no real CE-12 deal.finalized
 * event feed is wired yet. Returns an empty set, truthfully, rather than
 * fabricating deliveries.
 */
export class UnwiredDealFinalizedSource implements DealFinalizedSource {
  async findRdrDeliveries(): Promise<DealFinalizedRdrEvent[]> {
    return [];
  }
}
