// CE-07 / S023 (D-S023-03) — canonical SourceEventEnvelope builder for the
// manual vendor payment AP-relief posting (S043A).
//
// WIRED into manual-payment-service.ts's live `_postPaymentReversal` call
// site (CE-07 Requirement C, single authoritative ledger decision): the
// posting engine evaluates the tenant's rule pack and posts the resulting
// balanced journal (Dr the vendor's AP control account, Cr the bank
// account) through gl-service's EXISTING PENDING_REVIEW/agent-review gate
// (PO-DEC-001) — never bypassed.
//
// Both the debit (vendor AP control) and credit (bank) accounts are
// per-occurrence (a vendor's default GL account and the paying bank
// account both vary), so `payload.debitLines`/`payload.creditLines` carry
// RESOLVED account NUMBERS shaped for the posting engine's
// debitLineItemsPath/creditLineItemsPath DSL feature — never gl-service's
// internal glAccountId UUIDs, never coa-service's own gl_account.id. The
// caller (manual-payment-service.ts) resolves those before calling this
// builder.
import { randomUUID } from 'crypto';
import { apPaymentReliefIdempotencyIdentity, CanonicalSourceEventEnvelope } from '@amacc/shared-kernel';

export interface ManualPaymentForEnvelope {
  paymentId: string;
  tenantId: string;
  /** See ap-invoice-envelope.ts's VendorInvoiceForEnvelope doc-comment — same single-entity-per-tenant default. */
  legalEntityId: string;
  /**
   * The invoice's own id — gl-service derives a posted journal's schedule
   * open-item `itemNumber` from the journal's `sourceRef` (truncated to 8
   * chars), and ap-invoice-envelope.ts's S039 liability posting sets
   * sourceRef = invoiceId.slice(0,8) (see posting-engine-service.ts's
   * evaluateAndPost). This payment's relief line must reference that SAME
   * truncated value as its applyNumber for schedule-service to match it to
   * the invoice's open item — see open-item-service.ts's isApplication
   * matching logic (applyCd='#' + applyNumber === itemNumber).
   */
  invoiceId: string;
  invoiceNumber: string;
  /** The payment's own business/document date — D-S023-13: never the system clock. */
  paymentDate: Date;
  amount: number | string;
  currency?: string;
  /** Vendor's AP control account NUMBER — resolved by the caller. */
  apControlAccountNumber: string;
  /** Paying bank account's GL account NUMBER — resolved by the caller. */
  bankAccountNumber: string;
  storeId: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildApPaymentPostedEnvelope(payment: ManualPaymentForEnvelope, correlationId: string = randomUUID()): CanonicalSourceEventEnvelope {
  const idempotencyIdentity = apPaymentReliefIdempotencyIdentity(payment.tenantId, payment.paymentId);
  return {
    tenantId: payment.tenantId,
    legalEntityId: payment.legalEntityId,
    eventId: idempotencyIdentity,
    schemaVersion: '1.0',
    sourceSystem: 'apar-service',
    sourceEntityType: 'AP_MANUAL_PAYMENT',
    sourceEntityId: payment.paymentId,
    businessDate: isoDate(payment.paymentDate),
    correlationId,
    causationId: null,
    idempotencyIdentity,
    accountingAmounts: [{ amount: payment.amount, currency: payment.currency ?? 'USD', kind: 'GROSS' }],
    accountingReferences: [{ kind: 'documentNumber', value: payment.invoiceNumber }],
    // ".v1" suffix: the S019/S020 posting-engine's own rule-pack validator
    // requires eventType to match "a.b.c.vN" — a pre-existing engine
    // schema-versioning constraint, not a new naming decision.
    eventType: 'ap.payment.posted.v1',
    storeId: payment.storeId,
    payload: {
      paymentId: payment.paymentId,
      invoiceNumber: payment.invoiceNumber,
      amount: payment.amount,
      debitLines: [{ accountNumber: payment.apControlAccountNumber, storeId: payment.storeId, amount: payment.amount, applyNumber: payment.invoiceId.slice(0, 8) }],
      creditLines: [{ accountNumber: payment.bankAccountNumber, storeId: payment.storeId, amount: payment.amount }],
      sourceDocId: payment.invoiceNumber,
    },
  };
}
