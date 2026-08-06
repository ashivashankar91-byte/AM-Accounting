// CE-07 / S023 — canonical SourceEventEnvelope builder for the AP vendor-
// invoice liability posting (D-S023-06, D-S023-02).
//
// WIRED into invoice-approval-service.ts's live `_postApprovalLiability`
// call site (CE-07, single authoritative ledger decision): the posting
// engine evaluates the rule pack and submits the resulting balanced journal
// through GlPostingBridge to gl-service's EXISTING PENDING_REVIEW/agent-
// review gate (PO-DEC-001) — that gate is never bypassed. gl-service's own
// JOURNAL_ENTRY_POSTED -> schedule-service linkage is unchanged; it now
// fires only once gl-service (not this posting) actually approves the entry.
//
// `payload.lines`/`payload.creditLines` carry RESOLVED account NUMBERS
// (never gl-service's internal glAccountId UUIDs, never coa-service's own
// gl_account.id) — shaped for the posting engine's debitLineItemsPath/
// creditLineItemsPath DSL feature (dsl.ts's PostingGroup doc-comment),
// because both an invoice's expense/asset lines AND its AP-control credit
// account (Vendor.defaultGlAccount, which varies per vendor) are inherently
// per-occurrence, not a fixed rule-authored account set. The caller
// (invoice-approval-service.ts) resolves gl-service account ids to account-
// number strings before calling this builder.
//
// D-S023-06 amendment (S023_DECISION_REGISTER.md): ap.invoice.accepted is
// the single authoritative event; ap.invoice.posted-request is normalized
// to the SAME idempotencyIdentity. Both builders below derive their
// idempotencyIdentity from apInvoiceLiabilityIdempotencyIdentity(tenantId,
// invoiceId) — never from a raw per-occurrence eventId — so the posting
// engine's existing, unmodified tenantId+eventId dedup naturally treats a
// second alias event for the same invoice as a duplicate.

import { randomUUID } from 'crypto';
import { apInvoiceLiabilityIdempotencyIdentity, CanonicalSourceEventEnvelope } from '@amacc/shared-kernel';

export interface ResolvedInvoiceLineForEnvelope {
  id: string;
  description: string;
  lineTotal: number | string;
  /** The GL account NUMBER (e.g. "60000") this line resolves to — resolved by the caller, never a raw id. */
  accountNumber: string;
  storeId: string;
}

export interface VendorInvoiceForEnvelope {
  id: string;
  tenantId: string;
  /**
   * NARROW SCOPE SIMPLIFICATION (disclosed, not silently assumed): apar-
   * service's VendorInvoice has no entityId/legalEntityId column today (no
   * multi-rooftop/multi-legal-entity concept anywhere in this service's
   * schema) and gl-service itself has no entity dimension either
   * (GLAccount is tenant-scoped only). Until a real multi-entity model is
   * added to apar-service, `legalEntityId` defaults to `tenantId`
   * (single-entity-per-tenant) — the same convention every S023 rule-pack
   * test fixture in this repository already uses.
   */
  legalEntityId: string;
  invoiceNumber: string;
  /** The approved invoice's own business/document date — D-S023-13: never the system clock. */
  invoiceDate: Date;
  totalAmount: number | string;
  currency?: string;
  lines: ResolvedInvoiceLineForEnvelope[];
  /** The vendor's AP-control account NUMBER (resolved from Vendor.defaultGlAccount by the caller) — varies per vendor, never a fixed tenant-wide account. */
  creditAccountNumber: string;
  storeId: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the canonical envelope for `ap.invoice.accepted` — the single
 * authoritative event for this invoice's liability journal.
 */
export function buildApInvoiceAcceptedEnvelope(invoice: VendorInvoiceForEnvelope, correlationId: string = randomUUID()): CanonicalSourceEventEnvelope {
  const idempotencyIdentity = apInvoiceLiabilityIdempotencyIdentity(invoice.tenantId, invoice.id);
  return {
    tenantId: invoice.tenantId,
    legalEntityId: invoice.legalEntityId,
    eventId: idempotencyIdentity,
    schemaVersion: '1.0',
    sourceSystem: 'apar-service',
    sourceEntityType: 'AP_INVOICE',
    sourceEntityId: invoice.id,
    businessDate: isoDate(invoice.invoiceDate),
    correlationId,
    causationId: null,
    idempotencyIdentity,
    accountingAmounts: [{ amount: invoice.totalAmount, currency: invoice.currency ?? 'USD', kind: 'GROSS' }],
    accountingReferences: [{ kind: 'documentNumber', value: invoice.invoiceNumber }],
    // ".v1" suffix: the S019/S020 posting-engine's own rule-pack validator
    // requires eventType to match "a.b.c.vN" — a pre-existing engine
    // schema-versioning constraint, not a new naming decision. The
    // conceptual/business event name remains ap.invoice.accepted.
    eventType: 'ap.invoice.accepted.v1',
    storeId: invoice.storeId,
    payload: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.totalAmount,
      lines: invoice.lines.map((l) => ({ accountNumber: l.accountNumber, storeId: l.storeId, amount: l.lineTotal })),
      creditLines: [{ accountNumber: invoice.creditAccountNumber, storeId: invoice.storeId, amount: invoice.totalAmount }],
      sourceDocId: invoice.invoiceNumber,
    },
  };
}

/**
 * Builds the canonical envelope for `ap.invoice.posted-request` — normalized
 * to the SAME idempotencyIdentity as ap.invoice.accepted for the same
 * invoice (D-S023-06 amendment). Never produces a second tax journal; the
 * posting engine's own tenantId+eventId idempotency dedups a second
 * submission under this identity to the original result.
 */
export function buildApInvoicePostedRequestEnvelope(invoice: VendorInvoiceForEnvelope, correlationId: string = randomUUID()): CanonicalSourceEventEnvelope {
  const envelope = buildApInvoiceAcceptedEnvelope(invoice, correlationId);
  return { ...envelope, eventType: 'ap.invoice.posted-request.v1' };
}
