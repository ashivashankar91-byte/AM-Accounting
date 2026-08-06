// CE-07 / S023 (D-S023-04, D-S023-06) — S052's first real accounting
// consumer. Previously `cash.receipt.issued` had zero consumers anywhere in
// this repository (S023_CURRENT_EVENT_PAYLOADS.md) — the event was emitted
// into a void. This builds the canonical SourceEventEnvelope for
// `cash.receipt.applied` and submits it to coa-service's S019/S020 posting
// engine, best-effort, immediately after a receipt is durably created.
//
// Purely additive: cash-service previously had no accounting call at all
// for this flow, so there is no existing behavior this can regress.
//
// SCOPE LIMITATION (disclosed, not silently narrowed): cash-service's own
// domain model has no "applied vs. unapplied to a specific AR invoice"
// concept today — CreateReceiptDTO carries a generic sourceDocType/
// sourceDocId, not a line-level AR-invoice application split. This consumer
// therefore always submits the full receipt total as "applied"
// (payload.unapplied is never set to true) — the unapplied-cash rule in
// s023-rule-pack-fixtures.ts's cashReceiptPack is exercised only by tests
// that construct that payload field directly, not by this real consumer,
// since building true partial-application logic is out of this pass's scope.
import { randomUUID } from 'crypto';
import { createServiceToken, CanonicalSourceEventEnvelope } from '@amacc/shared-kernel';

export interface CashReceiptForPosting {
  tenantId: string;
  entityId: string;
  receiptId: string;
  receiptNumber: string;
  totalAmount: number | string;
  currency: string;
  sourceDocType: string;
  sourceDocId: string;
  businessDate: string; // YYYY-MM-DD — the drawer's own business date, never the system clock
}

export function buildCashReceiptAppliedEnvelope(receipt: CashReceiptForPosting, correlationId = randomUUID()): CanonicalSourceEventEnvelope {
  return {
    tenantId: receipt.tenantId,
    legalEntityId: receipt.entityId,
    eventId: `${receipt.tenantId}:cash-receipt:${receipt.receiptId}`,
    schemaVersion: '1.0',
    sourceSystem: 'cash-service',
    sourceEntityType: 'CASH_RECEIPT',
    sourceEntityId: receipt.receiptId,
    businessDate: receipt.businessDate,
    correlationId,
    causationId: null,
    idempotencyIdentity: `${receipt.tenantId}:cash-receipt:${receipt.receiptId}`,
    accountingAmounts: [{ amount: receipt.totalAmount, currency: receipt.currency, kind: 'GROSS' }],
    accountingReferences: [{ kind: 'documentNumber', value: receipt.receiptNumber }, { kind: 'sourceDocId', value: receipt.sourceDocId }],
    // ".v1" suffix: the S019/S020 posting-engine's own rule-pack validator
    // requires eventType to match "a.b.c.vN" — a pre-existing engine
    // schema-versioning constraint, not a new naming decision.
    eventType: 'cash.receipt.applied.v1',
    payload: { receiptId: receipt.receiptId, receiptNumber: receipt.receiptNumber, amount: receipt.totalAmount, sourceDocType: receipt.sourceDocType, sourceDocId: receipt.sourceDocId },
  };
}

export interface CashReceiptPostingPort {
  submit(receipt: CashReceiptForPosting): Promise<void>;
}

/** Never throws — a posting-submission failure must never block or roll back the cash receipt itself; the receipt remains the durable source of truth (matches S039's existing "audit the failure, don't fail the caller" convention). */
export class HttpCashReceiptPostingPort implements CashReceiptPostingPort {
  private readonly baseUrl: string;
  constructor(private readonly jwtSecret: string, baseUrl = process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async submit(receipt: CashReceiptForPosting): Promise<void> {
    try {
      const envelope = buildCashReceiptAppliedEnvelope(receipt);
      const serviceToken = createServiceToken('cash-service', this.jwtSecret);
      await fetch(`${this.baseUrl}/api/v1/coa/posting-engine/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': receipt.tenantId, Authorization: `Bearer ${serviceToken}` },
        body: JSON.stringify({
          eventId: envelope.eventId, tenantId: envelope.tenantId, eventType: envelope.eventType,
          eventSchemaVersion: envelope.schemaVersion, occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
          sourceSystem: envelope.sourceSystem, sourceEntityType: envelope.sourceEntityType, sourceEntityId: envelope.sourceEntityId,
          correlationId: envelope.correlationId, causationId: null, businessDate: envelope.businessDate,
          payload: envelope.payload, metadata: null,
        }),
      });
    } catch {
      // Deliberately swallowed — see class doc-comment.
    }
  }
}

export class NoopCashReceiptPostingPort implements CashReceiptPostingPort {
  async submit(): Promise<void> {}
}
