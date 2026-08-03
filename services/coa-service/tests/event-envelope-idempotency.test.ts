/**
 * fix(integration) — regression coverage for the CE-07 retry-idempotency
 * fix (event-envelope.ts's hashEnvelope no longer includes `occurredAt`).
 *
 * Root cause (confirmed live against a real Postgres database before this
 * fix, see the CE-13 integration report): every current producer sets
 * `occurredAt: new Date().toISOString()` at HTTP-call time — apar-service's
 * posting-engine-port.ts (CE-09) and payroll-service's posting-gateway.ts
 * (CE-13) at minimum — so a legitimate retry of an unchanged financial
 * event (after a transport timeout, a connection reset, a broker
 * redelivery) always carried a new `occurredAt` and was hashed as a
 * *different* event under the same eventId, permanently deadlocking the
 * retry with EVENT_IDENTITY_CONFLICT rather than returning the original
 * execution as a safe duplicate.
 *
 * This suite exercises hashEnvelope directly (pure function, no database)
 * with one representative envelope shape per already-integrated epic that
 * calls coa-service's posting-engine — CE-09 (apar-service AP invoice),
 * CE-11 (fixedops-service labor posting), CE-12 (deal-accounting-service
 * deal finalization), and CE-13 (payroll-service batch posting) — proving
 * the fix is correct at the shared boundary regardless of which service
 * submits the event, without needing to modify those other services.
 */
import { describe, it, expect } from 'vitest';
import { hashEnvelope, SourceEventEnvelope } from '../src/domain/posting-engine/event-envelope';

function baseEnvelope(overrides: Partial<SourceEventEnvelope>): SourceEventEnvelope {
  const now = '2026-08-03T12:00:00.000Z';
  return {
    eventId: 'evt-fixed-id',
    tenantId: 'tenant-cert',
    legalEntityId: 'entity-cert',
    eventType: 'test.event.v1',
    eventSchemaVersion: '1.0',
    occurredAt: now,
    publishedAt: now,
    sourceSystem: 'test-producer',
    sourceEntityType: 'TestEntity',
    sourceEntityId: 'entity-1',
    correlationId: 'corr-1',
    causationId: null,
    businessDate: '2026-08-01',
    payload: { amount: 100 },
    metadata: null,
    ...overrides,
  };
}

const PRODUCER_ENVELOPES: Array<{ epic: string; envelope: SourceEventEnvelope }> = [
  {
    epic: 'CE-09 (apar-service ap.invoice.accepted.v1)',
    envelope: baseEnvelope({
      eventType: 'ap.invoice.accepted.v1',
      sourceSystem: 'apar-service',
      sourceEntityType: 'AP_INVOICE',
      sourceEntityId: 'inv-1',
      payload: { invoiceNumber: 'INV-1', totalAmount: 500 },
    }),
  },
  {
    epic: 'CE-11 (fixedops-service labor posting)',
    envelope: baseEnvelope({
      eventType: 'fixedops.ro.labor-posted.v1',
      sourceSystem: 'fixedops-service',
      sourceEntityType: 'REPAIR_ORDER',
      sourceEntityId: 'ro-1',
      payload: { roNumber: 'RO-1', laborAmount: 250 },
    }),
  },
  {
    epic: 'CE-12 (deal-accounting-service deal.finalized.v1)',
    envelope: baseEnvelope({
      eventType: 'deal.finalized.v1',
      sourceSystem: 'deal-accounting-service',
      sourceEntityType: 'DEAL',
      sourceEntityId: 'deal-1',
      payload: { dealNumber: 'D-1', saleAmount: 30000 },
    }),
  },
  {
    epic: 'CE-13 (payroll-service payroll.batch.posted.v1)',
    envelope: baseEnvelope({
      eventType: 'payroll.batch.posted.v1',
      sourceSystem: 'payroll-service',
      sourceEntityType: 'PayrollBatch',
      sourceEntityId: 'batch-1',
      payload: { batchNumber: 'PR-1', totalAmount: 2773.75, debitLines: [{ accountNumber: '61000', storeId: 'S1', amount: 2500 }], creditLines: [{ accountNumber: '21000', storeId: 'S1', amount: 2500 }] },
    }),
  },
];

describe('hashEnvelope — retry idempotency (occurredAt excluded from identity)', () => {
  for (const { epic, envelope } of PRODUCER_ENVELOPES) {
    describe(epic, () => {
      it('sequential retry: same eventId + unchanged financial payload, different occurredAt/publishedAt -> identical hash (safe duplicate, never EVENT_IDENTITY_CONFLICT)', () => {
        const attempt1 = hashEnvelope(envelope);
        // Simulates a retry minted seconds later after a transport timeout —
        // occurredAt/publishedAt are wall-clock at call time, so they differ.
        const retry = hashEnvelope({ ...envelope, occurredAt: '2026-08-03T12:00:07.123Z', publishedAt: '2026-08-03T12:00:07.456Z' });
        expect(retry).toBe(attempt1);
      });

      it('concurrent retry: two in-flight submissions of the identical event (different occurredAt each) both hash identically', () => {
        const a = hashEnvelope({ ...envelope, occurredAt: '2026-08-03T12:00:01.000Z' });
        const b = hashEnvelope({ ...envelope, occurredAt: '2026-08-03T12:00:01.900Z' });
        expect(a).toBe(b);
      });

      it('timeout-after-success: a client that timed out waiting for the response, then retries, hashes identically to the original (server already recorded it)', () => {
        const original = hashEnvelope(envelope);
        // Client never saw the response (timeout), retries with a fresh
        // wall-clock occurredAt believing the first attempt may have failed.
        const clientRetryAfterPerceivedTimeout = hashEnvelope({
          ...envelope,
          occurredAt: new Date(Date.parse(envelope.occurredAt) + 30_000).toISOString(),
          publishedAt: new Date(Date.parse(envelope.publishedAt) + 30_000).toISOString(),
        });
        expect(clientRetryAfterPerceivedTimeout).toBe(original);
      });

      it('a genuinely different financial payload under the SAME eventId still produces a different hash (real EVENT_IDENTITY_CONFLICT is preserved)', () => {
        const original = hashEnvelope(envelope);
        const differentAmount = hashEnvelope({ ...envelope, payload: { ...(envelope.payload as object), amount: 999999 } });
        expect(differentAmount).not.toBe(original);
      });

      it('a different businessDate under the same eventId still produces a different hash (business-fact identity, not transport timing, still governs)', () => {
        const original = hashEnvelope(envelope);
        const differentBusinessDate = hashEnvelope({ ...envelope, businessDate: '2026-09-01' });
        expect(differentBusinessDate).not.toBe(original);
      });

      it('a different legalEntityId under the same eventId still produces a different hash (cross-entity payload substitution is still caught)', () => {
        const original = hashEnvelope(envelope);
        const differentEntity = hashEnvelope({ ...envelope, legalEntityId: 'entity-other' });
        expect(differentEntity).not.toBe(original);
      });
    });
  }

  it('reversal envelopes have their own independent identity (different eventId/eventType) even when occurredAt matches the original', () => {
    const original = baseEnvelope({ eventType: 'payroll.batch.posted.v1', sourceEntityId: 'batch-1', eventId: 'evt-original' });
    const reversal = baseEnvelope({ eventType: 'payroll.batch.reversed.v1', sourceEntityId: 'batch-1', eventId: 'evt-reversal', causationId: 'evt-original' });
    expect(hashEnvelope(reversal)).not.toBe(hashEnvelope(original));
  });
});
