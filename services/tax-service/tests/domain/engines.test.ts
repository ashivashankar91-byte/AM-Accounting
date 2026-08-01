import { describe, it, expect } from 'vitest';
import { NullEngine } from '../../src/domain/engines/null-engine';
import { TestFixtureEngine } from '../../src/domain/engines/test-fixture-engine';
import { NonTestTenantRefusedError } from '../../src/domain/errors';
import { EngineTransientError, TaxCalculationRequest } from '../../src/domain/tax-adapter-contract';
import { TEST_TENANT_CE10_CERTIFICATION_ONLY } from '../../src/domain/tax-attachment';

function baseRequest(overrides: Partial<TaxCalculationRequest> = {}): TaxCalculationRequest {
  return {
    tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY,
    legalEntityId: 'entity-1',
    documentType: 'COUNTER_SALE',
    documentId: 'doc-1',
    documentVersion: 1,
    lines: [{ lineId: 'l1', itemClassCode: 'PARTS', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
    currency: 'USD',
    correlationId: 'corr-1',
    idempotencyKey: 'doc-1-v1',
    businessDate: '2025-06-01',
    ...overrides,
  };
}

describe('NullEngine', () => {
  it('always truthfully returns NOT_CONFIGURED, never estimates', async () => {
    const engine = new NullEngine();
    const result = await engine.calculate(baseRequest({ tenantId: 'ANY-REAL-TENANT' }));
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.totalTax).toBe('0.00');
    expect(result.lines).toEqual([]);
  });

  it('getStatus reports configured: false', async () => {
    const status = await (new NullEngine()).getStatus();
    expect(status.configured).toBe(false);
  });
});

describe('TestFixtureEngine', () => {
  it('refuses to run for any tenant that is not the labeled TEST-TENANT', async () => {
    const engine = new TestFixtureEngine();
    await expect(engine.calculate(baseRequest({ tenantId: 'SOME-REAL-DEALER-TENANT' }))).rejects.toThrow(NonTestTenantRefusedError);
  });

  it('deterministically calculates for the labeled test tenant', async () => {
    const engine = new TestFixtureEngine();
    const result = await engine.calculate(baseRequest());
    expect(result.status).toBe('CALCULATED');
    expect(result.totalTax).toBe('10.00'); // 100.00 * 0.10 fixture rate
    expect(result.lines[0]?.rate).toBe('0.100000');
  });

  it('returns EXEMPT_APPLIED when a line carries an exemptionRef', async () => {
    const engine = new TestFixtureEngine();
    const result = await engine.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'PARTS', amount: '100.00', quantity: 1, jurisdictionInputs: {}, exemptionRef: 'TEST-EXEMPTION-RESALE' }],
    }));
    expect(result.status).toBe('EXEMPT_APPLIED');
    expect(result.totalTax).toBe('0.00');
  });

  it('returns ENGINE_REJECTED for the TEST-REJECT fixture line', async () => {
    const engine = new TestFixtureEngine();
    const result = await engine.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'TEST-REJECT', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
    }));
    expect(result.status).toBe('ENGINE_REJECTED');
    expect(result.engineRejectReason).toBeTruthy();
  });

  it('throws EngineTransientError for the TEST-UNAVAILABLE fixture line (simulated outage)', async () => {
    const engine = new TestFixtureEngine();
    await expect(engine.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'TEST-UNAVAILABLE', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
    }))).rejects.toThrow(EngineTransientError);
  });

  it('is deterministic — same request produces the same result twice', async () => {
    const engine = new TestFixtureEngine();
    const r1 = await engine.calculate(baseRequest());
    const r2 = await engine.calculate(baseRequest());
    expect(r1.totalTax).toBe(r2.totalTax);
    expect(r1.lines[0]?.taxAmount).toBe(r2.lines[0]?.taxAmount);
  });
});
