/**
 * S101A / S105 — CE-11's S065 warranty-claim items and S071 return-credit
 * items are the "open item" families a statement match session row relieves
 * (package line 20), and S065's original claim item is what a warranty
 * chargeback line lineages back to (package line 26). CE-11 is not
 * implemented in this worktree (confirmed by repo-wide search: no
 * services/*11* directory, no S065/S071 code anywhere) — this is the exact
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION boundary CE-14 must originate,
 * following the identical shape already established by
 * services/tax-service/src/application/reconciliation-service.ts's
 * PostedTaxLineSource / UnwiredPostedTaxLineSource for its own CE-07
 * boundary.
 *
 * This interface lets S101A/S105's match/chargeback logic be fully built and
 * tested now with a test double (tests/support/fake-open-item-source.ts),
 * and wired to the real CE-11 item-type-filtered query API later without a
 * contract change.
 */

export type OemOpenItemTypeKey = 'WARRANTY_CLAIM' | 'PARTS_RETURN_CREDIT' | 'INCENTIVE_ACCRUAL' | 'COOP_CLAIM';

export interface OemOpenItem {
  itemRef: string;
  itemType: OemOpenItemTypeKey;
  tenantId: string;
  storeId: string;
  openAmount: string; // decimal string
  description: string;
  /** Original claim item id — populated only for WARRANTY_CLAIM (S105 lineage). */
  originalClaimItemRef?: string | null;
}

export interface OpenItemSource {
  /**
   * CE-11 S065/S071 item-type-filtered query (package line 20:
   * "[PUTR: item-type filters]"). INCENTIVE_ACCRUAL/COOP_CLAIM items are
   * this service's own tables (see application/match-service.ts), not part
   * of the CE-11 boundary — this source only ever needs to answer for
   * WARRANTY_CLAIM and PARTS_RETURN_CREDIT.
   */
  findOpenItems(tenantId: string, storeId: string, itemType: OemOpenItemTypeKey): Promise<OemOpenItem[]>;
  findOpenItemByRef(tenantId: string, itemRef: string): Promise<OemOpenItem | null>;
}

/**
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — no real CE-11 S065/S071 item
 * source is wired yet (CE-11 not implemented in this worktree). Returns an
 * empty set / null, truthfully, rather than fabricating claim or
 * return-credit data. Every route that depends on this source surfaces the
 * pending-reconciliation state to the UI instead of silently proceeding as
 * if items existed.
 */
export class UnwiredOpenItemSource implements OpenItemSource {
  async findOpenItems(): Promise<OemOpenItem[]> {
    return [];
  }
  async findOpenItemByRef(): Promise<OemOpenItem | null> {
    return null;
  }
}
