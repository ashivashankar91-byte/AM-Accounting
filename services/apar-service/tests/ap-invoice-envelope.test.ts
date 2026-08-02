import { describe, it, expect } from 'vitest';
import { assertCanonicalEnvelopeShape } from '@amacc/shared-kernel';
import { buildApInvoiceAcceptedEnvelope, buildApInvoicePostedRequestEnvelope, VendorInvoiceForEnvelope } from '../src/application/ap-invoice-envelope';

function invoice(overrides: Partial<VendorInvoiceForEnvelope> = {}): VendorInvoiceForEnvelope {
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    legalEntityId: 'entity-1',
    invoiceNumber: 'INV-1001',
    invoiceDate: new Date('2026-07-15T00:00:00.000Z'),
    totalAmount: 500,
    lines: [{ id: 'line-1', description: 'Parts', lineTotal: 500, glAccountId: 'gl-acct-1' }],
    ...overrides,
  };
}

describe('AP invoice canonical envelope builder — D-S023-06 amendment', () => {
  it('ap.invoice.accepted produces a valid canonical envelope using the invoice business date, never the system clock', () => {
    const env = buildApInvoiceAcceptedEnvelope(invoice());
    expect(() => assertCanonicalEnvelopeShape(env)).not.toThrow();
    expect(env.eventType).toBe('ap.invoice.accepted.v1');
    expect(env.businessDate).toBe('2026-07-15');
    expect(env.tenantId).toBe('tenant-1');
    expect(env.legalEntityId).toBe('entity-1');
  });

  it('ap.invoice.posted-request produces a valid canonical envelope for the same invoice', () => {
    const env = buildApInvoicePostedRequestEnvelope(invoice());
    expect(() => assertCanonicalEnvelopeShape(env)).not.toThrow();
    expect(env.eventType).toBe('ap.invoice.posted-request.v1');
  });

  it('ap.invoice.accepted and ap.invoice.posted-request for the SAME invoice share the same idempotencyIdentity and eventId (dedup contract)', () => {
    const accepted = buildApInvoiceAcceptedEnvelope(invoice());
    const postedRequest = buildApInvoicePostedRequestEnvelope(invoice());
    expect(accepted.idempotencyIdentity).toBe(postedRequest.idempotencyIdentity);
    expect(accepted.eventId).toBe(postedRequest.eventId);
  });

  it('two DIFFERENT invoices never share an idempotencyIdentity', () => {
    const a = buildApInvoiceAcceptedEnvelope(invoice({ id: 'inv-1' }));
    const b = buildApInvoiceAcceptedEnvelope(invoice({ id: 'inv-2' }));
    expect(a.idempotencyIdentity).not.toBe(b.idempotencyIdentity);
  });

  it('carries the invoice number as an accounting reference and the total as an accounting amount', () => {
    const env = buildApInvoiceAcceptedEnvelope(invoice({ totalAmount: 750.5, invoiceNumber: 'INV-9999' }));
    expect(env.accountingReferences).toContainEqual({ kind: 'documentNumber', value: 'INV-9999' });
    expect(env.accountingAmounts[0]).toMatchObject({ amount: 750.5, kind: 'GROSS' });
  });

  it('a distinct correlationId is generated per call when not supplied, so unrelated submissions are traceable independently', () => {
    const a = buildApInvoiceAcceptedEnvelope(invoice());
    const b = buildApInvoiceAcceptedEnvelope(invoice());
    expect(a.correlationId).not.toBe(b.correlationId);
  });
});
