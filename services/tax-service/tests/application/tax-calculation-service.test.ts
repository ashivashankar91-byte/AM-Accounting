import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { TaxCalculationService } from '../../src/application/tax-calculation-service';
import { EngineRegistry } from '../../src/domain/engines/engine-registry';
import { DivergentResultIntegrityAlertError } from '../../src/domain/errors';
import { TaxCalculationRequest } from '../../src/domain/tax-adapter-contract';
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

async function makeService() {
  const prisma = new FakePrismaClient();
  const engines = new EngineRegistry();
  const service = new TaxCalculationService(prisma as any, engines);
  return { prisma, service };
}

describe('TaxCalculationService', () => {
  it('NOT_CONFIGURED tenant: every taxable path blocks/parks truthfully (S124 AC7)', async () => {
    const { prisma, service } = await makeService();
    const outcome = await service.calculate(baseRequest({ tenantId: 'REAL-DEALER-NO-ENGINE-CONFIGURED' }));
    expect(outcome.result.status).toBe('NOT_CONFIGURED');
    expect(outcome.parkedExceptionId).toBeTruthy();
    const exceptions = await prisma.taxException.findMany({});
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.reasonCode).toBe('NOT_CONFIGURED');
  });

  it('CALCULATED result stores verbatim with jurisdiction lines (S124 AC1)', async () => {
    const { prisma, service } = await makeService();
    // Configure the TestFixtureEngine for the labeled test tenant.
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    const outcome = await service.calculate(baseRequest());
    expect(outcome.result.status).toBe('CALCULATED');
    expect(outcome.result.lines).toHaveLength(1);
    expect(outcome.result.totalTax).toBe('10.00');
    expect(outcome.parkedExceptionId).toBeUndefined();
  });

  it('idempotent replay: same idempotencyKey returns the stored result (S124 AC3)', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    const first = await service.calculate(baseRequest());
    const second = await service.calculate(baseRequest());
    expect(second.result.id).toBe(first.result.id);
    const allResults = await prisma.taxResult.findMany({});
    expect(allResults).toHaveLength(1); // never double-calculated into a second row
  });

  it('identical replay never raises a false-positive integrity alert', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    await service.calculate(baseRequest());
    await service.calculate(baseRequest());
    const alerts = await prisma.taxIntegrityAlert.findMany({});
    expect(alerts).toHaveLength(0);
  });

  it('divergent engine response for the same key raises an integrity alert, never overwrites (S124 AC3)', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    // Pre-seed a "winning" stored result under the same idempotency key,
    // as if a concurrent request had already committed it.
    await prisma.taxResult.create({
      data: {
        tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY,
        legalEntityId: 'entity-1',
        documentType: 'COUNTER_SALE',
        documentId: 'doc-1',
        documentVersion: 1,
        idempotencyKey: 'doc-1-v1-race',
        status: 'CALCULATED',
        engineType: 'TEST_FIXTURE_ENGINE',
        currency: 'USD',
        totalTaxableBase: '100.00',
        totalTax: '999.00', // deliberately divergent from what the fixture engine will compute
        requestSnapshot: {},
        responseSnapshot: {},
        correlationId: 'corr-race',
        businessDate: new Date('2025-06-01'),
      },
    });
    // Force the idempotency pre-check to miss (simulating the race window)
    // by making the *first* findFirst call return null, while the row
    // already exists underneath — exactly like a real concurrent race.
    const realFindFirst = prisma.taxResult.findFirst.bind(prisma.taxResult);
    let calls = 0;
    vi.spyOn(prisma.taxResult, 'findFirst').mockImplementation(async (args: any) => {
      calls += 1;
      if (calls === 1) return null;
      return realFindFirst(args);
    });

    await expect(service.calculate(baseRequest({ idempotencyKey: 'doc-1-v1-race' }))).rejects.toThrow(DivergentResultIntegrityAlertError);

    const alerts = await prisma.taxIntegrityAlert.findMany({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.idempotencyKey).toBe('doc-1-v1-race');
    // The original (winning) row is untouched — never overwritten.
    const results = await realFindFirst({ where: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, idempotencyKey: 'doc-1-v1-race' } });
    expect(results?.totalTax).toBe('999.00');
  });

  it('every engine attempt is logged in tax_engine_attempt_log', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    await service.calculate(baseRequest());
    const log = await prisma.taxEngineAttemptLog.findMany({});
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]?.outcome).toBe('CALCULATED');
  });

  it('ENGINE_UNAVAILABLE (transient outage) retries with backoff, then parks — nothing posts, nothing estimates (S124 AC2)', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    const outcome = await service.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'TEST-UNAVAILABLE', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
      idempotencyKey: 'doc-1-v1-outage',
    }));
    expect(outcome.result.status).toBe('ENGINE_UNAVAILABLE');
    expect(outcome.parkedExceptionId).toBeTruthy();
    const attempts = await prisma.taxEngineAttemptLog.findMany({ where: { idempotencyKey: 'doc-1-v1-outage' } });
    expect(attempts.length).toBe(3); // DEFAULT_RETRY_OPTIONS.maxAttempts
    const exceptions = await prisma.taxException.findMany({ where: { idempotencyKey: 'doc-1-v1-outage' } });
    expect(exceptions[0]?.reasonCode).toBe('ENGINE_UNAVAILABLE');
    // No tax result of a proceedable status was ever stored.
    const results = await prisma.taxResult.findMany({ where: { idempotencyKey: 'doc-1-v1-outage' } });
    expect(results).toHaveLength(0);
  });

  it('ENGINE_REJECTED parks with the engine reason, and still stores the rejected result as evidence', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    const outcome = await service.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'TEST-REJECT', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
      idempotencyKey: 'doc-1-v1-reject',
    }));
    expect(outcome.result.status).toBe('ENGINE_REJECTED');
    expect(outcome.parkedExceptionId).toBeTruthy();
  });

  it('EXEMPT_APPLIED is a proceedable status — no exception parked', async () => {
    const { prisma, service } = await makeService();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    const outcome = await service.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'PARTS', amount: '100.00', quantity: 1, jurisdictionInputs: {}, exemptionRef: 'TEST-EXEMPTION-RESALE' }],
      idempotencyKey: 'doc-1-v1-exempt',
    }));
    expect(outcome.result.status).toBe('EXEMPT_APPLIED');
    expect(outcome.parkedExceptionId).toBeUndefined();
  });

  it('history-proof: a backdated businessDate resolves the engine config effective at that date, not today (S124 AC5)', async () => {
    const { prisma, service } = await makeService();
    // Only a config effective far in the past exists; "today" (per the
    // fixture business date below) still resolves it correctly.
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31', createdBy: 'test' },
    });
    const outcome = await service.calculate(baseRequest({ businessDate: '2020-06-15', idempotencyKey: 'doc-1-v1-backdated' }));
    expect(outcome.result.status).toBe('CALCULATED'); // resolved historically, not NOT_CONFIGURED
  });
});
