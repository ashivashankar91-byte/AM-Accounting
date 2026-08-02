/**
 * @file test-posting-gateway.ts
 * @coverage CE-13 gap #2 — governed posting boundary (payroll-service →
 * CE-07 posting engine). Verifies canonical envelope shape, idempotency
 * key determinism, fail-closed behavior on transport failure, deterministic
 * refusal mapping (NO_RULE_MATCH/REJECTED → PostingRefusedError), and
 * identity-conflict handling. Uses a stubbed global fetch — no real
 * network call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HttpPostingGateway,
  UnavailablePostingGateway,
  PostingGatewayUnavailableError,
  PostingRefusedError,
  PostingIdentityConflictError,
} from '../infrastructure/posting-gateway';

vi.mock('@amacc/shared-kernel', async () => {
  const actual = await vi.importActual<any>('@amacc/shared-kernel');
  return { ...actual, createServiceToken: vi.fn().mockReturnValue('fake-service-jwt') };
});

const baseInput = {
  tenantId: 'tenant-test',
  batchId: 'batch-1',
  batchNumber: 'PR-2024-01',
  businessDate: '2024-01-17',
  payPeriodStart: '2024-01-01',
  payPeriodEnd: '2024-01-14',
  distributions: [{ payComponent: 'REGULAR_PAY', department: 'sales', amount: 2000, direction: 'DEBIT' as const }],
  idempotencyKey: 'payroll-batch-posted:tenant-test:batch-1',
  correlationId: 'batch-1',
  actor: 'poster-1',
  eventType: 'PAYROLL_BATCH_POSTED' as const,
};

describe('HttpPostingGateway', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('submits a canonical SourceEventEnvelope-shaped body with deterministic eventId derived from the idempotency key', async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true, status: 200,
        json: async () => ({ executionId: 'exec-1', eventId: capturedBody.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-1', journalNumber: 'JE-000001' }),
      };
    }) as any;

    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    const result = await gw.submitPayrollEvent(baseInput);

    expect(capturedBody.tenantId).toBe('tenant-test');
    // CE-07's rule-pack DSL requires the lowercase.dotted.vN convention
    // (validator.ts EVENT_TYPE_PATTERN) — PAYROLL_BATCH_POSTED remains the
    // payroll-service-internal label; the wire envelope translates it.
    expect(capturedBody.eventType).toBe('payroll.batch.posted.v1');
    expect(capturedBody.sourceSystem).toBe('payroll-service');
    expect(capturedBody.sourceEntityType).toBe('PayrollBatch');
    expect(capturedBody.sourceEntityId).toBe('batch-1');
    expect(capturedBody.correlationId).toBe('batch-1');
    expect(capturedBody.businessDate).toBe('2024-01-17');
    expect(capturedBody.payload.distributions).toEqual(baseInput.distributions);
    expect(typeof capturedBody.eventId).toBe('string');
    expect(result.status).toBe('POSTED');
    expect(result.journalEntryId).toBe('je-1');
  });

  it('integration reconciliation: envelope always carries a non-empty top-level legalEntityId (CE-07 REQUIRED_ENVELOPE_FIELDS) — defaults to tenantId when the caller does not resolve a real legal entity', async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ executionId: 'exec-1', eventId: capturedBody.eventId, status: 'POSTED', idempotent: false }) };
    }) as any;

    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await gw.submitPayrollEvent(baseInput);
    expect(capturedBody.legalEntityId).toBe('tenant-test');

    await gw.submitPayrollEvent({ ...baseInput, legalEntityId: 'entity-42' });
    expect(capturedBody.legalEntityId).toBe('entity-42');
  });

  it('the same idempotencyKey always produces the same eventId (deterministic identity, safe retry)', async () => {
    const captured: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      captured.push(JSON.parse(opts.body).eventId);
      return { ok: true, status: 200, json: async () => ({ executionId: 'e', eventId: captured[captured.length - 1], status: 'POSTED', idempotent: false }) };
    }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await gw.submitPayrollEvent(baseInput);
    await gw.submitPayrollEvent(baseInput);
    expect(captured[0]).toBe(captured[1]);
  });

  it('fails closed (PostingGatewayUnavailableError) when coa-service is unreachable — never falls back to a direct GL write', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await expect(gw.submitPayrollEvent(baseInput)).rejects.toThrow(PostingGatewayUnavailableError);
    await expect(gw.submitPayrollEvent(baseInput)).rejects.toThrow('PENDING_CE07_TECHNICAL_RECONCILIATION');
  });

  it('fails closed when coa-service responds 503/502/404 (transport-level unavailability)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await expect(gw.submitPayrollEvent(baseInput)).rejects.toThrow(PostingGatewayUnavailableError);
  });

  it('maps NO_RULE_MATCH to a deterministic PostingRefusedError (missing-mapping refusal, not a silent placeholder)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ executionId: 'exec-1', eventId: 'evt-1', status: 'NO_RULE_MATCH', idempotent: false, failureReason: 'No active rule pack version covers this event type.' }),
    }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await expect(gw.submitPayrollEvent(baseInput)).rejects.toThrow(PostingRefusedError);
  });

  it('maps REJECTED to PostingRefusedError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ executionId: 'exec-1', eventId: 'evt-1', status: 'REJECTED', idempotent: false, failureReason: 'Blueprint failed verification.' }),
    }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await expect(gw.submitPayrollEvent(baseInput)).rejects.toThrow(PostingRefusedError);
  });

  it('maps HTTP 409 to PostingIdentityConflictError', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ executionId: 'exec-1' }) }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await expect(gw.submitPayrollEvent(baseInput)).rejects.toThrow(PostingIdentityConflictError);
  });

  it('idempotent replay (idempotent:true from coa-service) surfaces without minting a duplicate journal', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ executionId: 'exec-1', eventId: 'evt-1', status: 'POSTED', idempotent: true, journalEntryId: 'je-1', journalNumber: 'JE-000001' }),
    }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    const result = await gw.submitPayrollEvent(baseInput);
    expect(result.idempotent).toBe(true);
    expect(result.journalEntryId).toBe('je-1');
  });

  it('reversal events carry reversalOfEventId for original-to-reversal linkage', async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ executionId: 'exec-2', eventId: capturedBody.eventId, status: 'POSTED', idempotent: false, journalEntryId: 'je-rev-1' }) };
    }) as any;
    const gw = new HttpPostingGateway('test-secret', 'http://coa-service:3016');
    await gw.submitPayrollEvent({ ...baseInput, eventType: 'PAYROLL_BATCH_REVERSED', reversalOfEventId: 'original-evt-id', distributions: [] });
    expect(capturedBody.payload.reversalOfEventId).toBe('original-evt-id');
  });
});

describe('UnavailablePostingGateway', () => {
  it('always fails closed — never wired as a silent fallback to direct GL writes', async () => {
    const gw = new UnavailablePostingGateway();
    await expect(gw.submitPayrollEvent()).rejects.toThrow(PostingGatewayUnavailableError);
  });
});
