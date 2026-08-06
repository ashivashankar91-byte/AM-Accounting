import { describe, it, expect } from 'vitest';
import { assertCanonicalEnvelopeShape, CanonicalEnvelopeShapeError } from '../src/posting/canonical-event-envelope';
import { apInvoiceLiabilityIdempotencyIdentity } from '../src/posting/idempotency-identity';

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    legalEntityId: 'entity-1',
    eventId: 'evt-1',
    schemaVersion: '1.0',
    sourceSystem: 'apar-service',
    sourceEntityType: 'AP_INVOICE',
    sourceEntityId: 'inv-1',
    businessDate: '2026-08-01',
    correlationId: 'corr-1',
    idempotencyIdentity: 'idem-1',
    eventType: 'ap.invoice.accepted',
    payload: { invoiceNumber: 'INV-1' },
    accountingAmounts: [{ amount: 100, currency: 'USD', kind: 'NET' }],
    accountingReferences: [{ kind: 'documentNumber', value: 'INV-1' }],
    ...overrides,
  };
}

describe('CanonicalSourceEventEnvelope — D-S023-06', () => {
  it('accepts a fully-formed envelope', () => {
    const env = assertCanonicalEnvelopeShape(validEnvelope());
    expect(env.tenantId).toBe('tenant-1');
    expect(env.accountingAmounts).toHaveLength(1);
  });

  it('rejects a non-object candidate', () => {
    expect(() => assertCanonicalEnvelopeShape(null)).toThrow(CanonicalEnvelopeShapeError);
    expect(() => assertCanonicalEnvelopeShape('x')).toThrow(CanonicalEnvelopeShapeError);
    expect(() => assertCanonicalEnvelopeShape([])).toThrow(CanonicalEnvelopeShapeError);
  });

  for (const field of ['tenantId', 'legalEntityId', 'eventId', 'schemaVersion', 'sourceSystem', 'sourceEntityType', 'sourceEntityId', 'businessDate', 'correlationId', 'idempotencyIdentity', 'eventType', 'payload']) {
    it(`deterministically rejects when required field "${field}" is missing`, () => {
      const bad = validEnvelope({ [field]: undefined });
      try {
        assertCanonicalEnvelopeShape(bad);
        expect.fail(`expected rejection for missing ${field}`);
      } catch (e) {
        expect(e).toBeInstanceOf(CanonicalEnvelopeShapeError);
        expect((e as CanonicalEnvelopeShapeError).message).toContain(field);
      }
    });
  }

  it('never derives businessDate from the system clock — a missing businessDate is a hard rejection, not a default', () => {
    const bad = validEnvelope({ businessDate: undefined });
    expect(() => assertCanonicalEnvelopeShape(bad)).toThrow(/businessDate/);
  });

  it('rejects a malformed (non ISO-8601) businessDate', () => {
    const bad = validEnvelope({ businessDate: '08/01/2026' });
    expect(() => assertCanonicalEnvelopeShape(bad)).toThrow(/businessDate/);
  });

  it('rejects payload that is an array instead of an object', () => {
    const bad = validEnvelope({ payload: [] });
    expect(() => assertCanonicalEnvelopeShape(bad)).toThrow(/payload/);
  });

  it('rejects an accountingAmounts entry missing amount/currency/kind', () => {
    expect(() => assertCanonicalEnvelopeShape(validEnvelope({ accountingAmounts: [{ currency: 'USD', kind: 'NET' }] }))).toThrow(/amount/);
    expect(() => assertCanonicalEnvelopeShape(validEnvelope({ accountingAmounts: [{ amount: 1, kind: 'NET' }] }))).toThrow(/currency/);
    expect(() => assertCanonicalEnvelopeShape(validEnvelope({ accountingAmounts: [{ amount: 1, currency: 'USD' }] }))).toThrow(/kind/);
  });

  it('rejects an accountingReferences entry missing kind/value', () => {
    expect(() => assertCanonicalEnvelopeShape(validEnvelope({ accountingReferences: [{ value: 'X' }] }))).toThrow(/kind/);
    expect(() => assertCanonicalEnvelopeShape(validEnvelope({ accountingReferences: [{ kind: 'documentNumber' }] }))).toThrow(/value/);
  });

  it('accepts optional storeId/departmentCode/causationId when present, defaults them to null when absent', () => {
    const env = assertCanonicalEnvelopeShape(validEnvelope());
    expect(env.storeId).toBeNull();
    expect(env.departmentCode).toBeNull();
    expect(env.causationId).toBeNull();
    const withDims = assertCanonicalEnvelopeShape(validEnvelope({ storeId: 'STORE-1', departmentCode: 'DEPT-1' }));
    expect(withDims.storeId).toBe('STORE-1');
    expect(withDims.departmentCode).toBe('DEPT-1');
  });
});

describe('apInvoiceLiabilityIdempotencyIdentity — D-S023-06 amendment (AP tax dedup)', () => {
  it('produces the same identity for the same tenant+invoice regardless of caller', () => {
    const a = apInvoiceLiabilityIdempotencyIdentity('tenant-1', 'inv-1');
    const b = apInvoiceLiabilityIdempotencyIdentity('tenant-1', 'inv-1');
    expect(a).toBe(b);
  });

  it('produces a different identity for a different invoice', () => {
    const a = apInvoiceLiabilityIdempotencyIdentity('tenant-1', 'inv-1');
    const b = apInvoiceLiabilityIdempotencyIdentity('tenant-1', 'inv-2');
    expect(a).not.toBe(b);
  });

  it('produces a different identity for a different tenant with the same invoice id', () => {
    const a = apInvoiceLiabilityIdempotencyIdentity('tenant-1', 'inv-1');
    const b = apInvoiceLiabilityIdempotencyIdentity('tenant-2', 'inv-1');
    expect(a).not.toBe(b);
  });
});
