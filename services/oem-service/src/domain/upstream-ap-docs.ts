/**
 * S106 — co-op claim spend items are entered/imported invoices with evidence
 * references from CE-09's AP-document linkage (package line 28: "[PUTR: AP
 * doc reference]"). CE-09 is "finalizing" per the package's GLOBAL RULES
 * (line 12) but not implemented in this worktree — this is the exact
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION boundary, same shape as
 * domain/upstream-items.ts's UnwiredOpenItemSource.
 *
 * Co-op claim lines still require an evidenceRef and description from the
 * caller (S106 AC: "claim package totals = selected spend exactly") — this
 * source is only consulted to VALIDATE/enrich a spendItemRef against a real
 * AP document once CE-09 is wired; until then the entered evidenceRef is
 * the sole evidence, recorded truthfully as manually-entered rather than
 * AP-system-verified.
 */

export interface ApDocumentRef {
  apDocumentId: string;
  tenantId: string;
  storeId: string;
  vendorName: string;
  amount: string;
  documentDate: string;
}

export interface ApDocumentSource {
  findApDocument(tenantId: string, apDocumentId: string): Promise<ApDocumentRef | null>;
}

/**
 * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — no real CE-09 AP-document
 * source is wired yet. Returns null, truthfully, rather than fabricating a
 * vendor/amount match.
 */
export class UnwiredApDocumentSource implements ApDocumentSource {
  async findApDocument(): Promise<ApDocumentRef | null> {
    return null;
  }
}
