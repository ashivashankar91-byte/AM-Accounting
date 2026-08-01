import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { TaxCalculationService } from '../../src/application/tax-calculation-service';
import { TaxExceptionService } from '../../src/application/tax-exception-service';
import { EngineRegistry } from '../../src/domain/engines/engine-registry';
import { TaxCalculationRequest } from '../../src/domain/tax-adapter-contract';
import { TEST_TENANT_CE10_CERTIFICATION_ONLY } from '../../src/domain/tax-attachment';

function baseRequest(overrides: Partial<TaxCalculationRequest> = {}): TaxCalculationRequest {
  return {
    tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY,
    legalEntityId: 'entity-1',
    documentType: 'COUNTER_SALE',
    documentId: 'doc-1',
    documentVersion: 1,
    lines: [{ lineId: 'l1', itemClassCode: 'TEST-UNAVAILABLE', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
    currency: 'USD',
    correlationId: 'corr-1',
    idempotencyKey: 'doc-1-v1-recover',
    businessDate: '2025-06-01',
    ...overrides,
  };
}

function makeServices() {
  const prisma = new FakePrismaClient();
  const engines = new EngineRegistry();
  const calc = new TaxCalculationService(prisma as any, engines);
  const exceptions = new TaxExceptionService(prisma as any, calc);
  return { prisma, calc, exceptions };
}

describe('TaxExceptionService', () => {
  it('re-request that still cannot proceed remains PARKED (still ENGINE_UNAVAILABLE)', async () => {
    const { prisma, calc, exceptions } = makeServices();
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });
    const outcome = await calc.calculate(baseRequest());
    const parkedId = outcome.parkedExceptionId!;
    expect(parkedId).toBeTruthy();

    const reReqOutcome = await exceptions.reRequest(TEST_TENANT_CE10_CERTIFICATION_ONLY, parkedId, 'tester');
    expect(reReqOutcome.resolved).toBe(false);

    const exceptionRow = await exceptions.getById(TEST_TENANT_CE10_CERTIFICATION_ONLY, parkedId);
    expect(exceptionRow.status).toBe('PARKED');
    expect(exceptionRow.dispositions.length).toBeGreaterThanOrEqual(3); // PARKED, RE_REQUEST_IN_PROGRESS, PARKED
  });

  it('re-request resolves and transitions to RESOLVED once the underlying cause is fixed', async () => {
    const { prisma, calc, exceptions } = makeServices();
    // Deliberately NOT configuring an engine so the first calculate parks NOT_CONFIGURED.
    const outcome = await calc.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'PARTS', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
      idempotencyKey: 'doc-1-v1-fix',
    }));
    expect(outcome.result.status).toBe('NOT_CONFIGURED');
    const parkedId = outcome.parkedExceptionId!;

    // Fix the root cause: configure the engine.
    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });

    const reReqOutcome = await exceptions.reRequest(TEST_TENANT_CE10_CERTIFICATION_ONLY, parkedId, 'tester');
    expect(reReqOutcome.resolved).toBe(true);
    expect(reReqOutcome.result.status).toBe('CALCULATED');

    const exceptionRow = await exceptions.getById(TEST_TENANT_CE10_CERTIFICATION_ONLY, parkedId);
    expect(exceptionRow.status).toBe('RESOLVED');
  });

  it('bulk re-request resolves what it can and reports per-item outcomes', async () => {
    const { prisma, calc, exceptions } = makeServices();
    const out1 = await calc.calculate(baseRequest({
      lines: [{ lineId: 'l1', itemClassCode: 'PARTS', amount: '100.00', quantity: 1, jurisdictionInputs: {} }],
      idempotencyKey: 'doc-1-v1-bulk-a',
    }));
    const out2 = await calc.calculate(baseRequest({
      documentId: 'doc-2',
      idempotencyKey: 'doc-1-v1-bulk-b', // still ENGINE_UNAVAILABLE (TEST-UNAVAILABLE line)
    }));

    await prisma.taxEngineConfig.create({
      data: { tenantId: TEST_TENANT_CE10_CERTIFICATION_ONLY, legalEntityId: 'entity-1', engineType: 'TEST_FIXTURE_ENGINE', effectiveFrom: '2025-01-01', effectiveTo: null, createdBy: 'test' },
    });

    const results = await exceptions.bulkReRequest(TEST_TENANT_CE10_CERTIFICATION_ONLY, [out1.parkedExceptionId!, out2.parkedExceptionId!], 'tester');
    expect(results.find((r) => r.id === out1.parkedExceptionId)?.resolved).toBe(true);
    expect(results.find((r) => r.id === out2.parkedExceptionId)?.resolved).toBe(false);
  });
});
