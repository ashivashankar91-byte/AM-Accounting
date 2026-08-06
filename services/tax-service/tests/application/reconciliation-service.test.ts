import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { FakePrismaClient } from '../support/fake-prisma';
import { FakePostedTaxLineSource } from '../support/fake-posted-tax-line-source';
import { ReconciliationService } from '../../src/application/reconciliation-service';

function makeService() {
  const prisma = new FakePrismaClient();
  const postedSource = new FakePostedTaxLineSource();
  return { prisma, postedSource, service: new ReconciliationService(prisma as any, postedSource) };
}

async function seedResult(prisma: FakePrismaClient, opts: { id?: string; documentId: string; jurisdictionId: string; taxAmount: string; businessDate: string; status?: string }) {
  return prisma.taxResult.create({
    data: {
      id: opts.id,
      tenantId: 'tenant-1',
      legalEntityId: 'entity-1',
      documentType: 'COUNTER_SALE',
      documentId: opts.documentId,
      documentVersion: 1,
      idempotencyKey: `${opts.documentId}-v1`,
      status: opts.status ?? 'CALCULATED',
      engineType: 'TEST_FIXTURE_ENGINE',
      currency: 'USD',
      totalTaxableBase: '100.00',
      totalTax: opts.taxAmount,
      requestSnapshot: {},
      responseSnapshot: {},
      correlationId: 'corr-1',
      businessDate: new Date(opts.businessDate),
      lines: {
        create: [{ tenantId: 'tenant-1', lineId: 'l1', jurisdictionId: opts.jurisdictionId, taxType: 'SALES_TAX', taxableBase: '100.00', taxAmount: opts.taxAmount }],
      },
    },
    include: { lines: true },
  });
}

describe('ReconciliationService', () => {
  it('three-way tie balances when engine sum matches posted sum on fixtures', async () => {
    const { prisma, postedSource, service } = makeService();
    const created = await seedResult(prisma, { documentId: 'doc-1', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-06-15' });
    postedSource.seed('tenant-1', 'entity-1', '2025-06', [
      { documentId: 'doc-1', documentType: 'COUNTER_SALE', jurisdictionId: 'STATE-XX', taxAmount: '10.00', taxResultId: created.id },
    ]);

    const report = await service.threeWayTie('tenant-1', 'entity-1', '2025-06');
    expect(report.overallBalanced).toBe(true);
    expect(report.ties[0]?.balanced).toBe(true);
    expect(report.orphanedResults).toEqual([]);
    expect(report.glMovementSourceIsPending).toBe(true); // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION marker
  });

  it('detects an injected variance between engine results and posted tax lines', async () => {
    const { prisma, postedSource, service } = makeService();
    await seedResult(prisma, { documentId: 'doc-1', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-06-15' });
    postedSource.seed('tenant-1', 'entity-1', '2025-06', [
      { documentId: 'doc-1', documentType: 'COUNTER_SALE', jurisdictionId: 'STATE-XX', taxAmount: '7.50', taxResultId: null },
    ]);

    const report = await service.threeWayTie('tenant-1', 'entity-1', '2025-06');
    expect(report.overallBalanced).toBe(false);
    expect(report.ties[0]?.balanced).toBe(false);
    expect(report.ties[0]?.variance).toBe('2.50');
  });

  it('excludes non-proceedable results (e.g. ENGINE_REJECTED) from the engine sum', async () => {
    const { prisma, service } = makeService();
    await seedResult(prisma, { documentId: 'doc-1', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-06-15', status: 'ENGINE_REJECTED' });
    const report = await service.threeWayTie('tenant-1', 'entity-1', '2025-06');
    expect(report.ties).toHaveLength(0); // no proceedable result, no posted line -> no jurisdiction surfaced
  });

  it('flags an orphaned posted tax line with no matching stored result', async () => {
    const { prisma, postedSource, service } = makeService();
    postedSource.seed('tenant-1', 'entity-1', '2025-06', [
      { documentId: 'doc-orphan', documentType: 'COUNTER_SALE', jurisdictionId: 'STATE-XX', taxAmount: '5.00', taxResultId: 'not-a-real-result-id' },
    ]);
    const report = await service.threeWayTie('tenant-1', 'entity-1', '2025-06');
    expect(report.orphanedPostedLines).toEqual([{ documentId: 'doc-orphan', jurisdictionId: 'STATE-XX' }]);
  });

  it('flags an orphaned engine result with no linked posted tax line', async () => {
    const { prisma, service } = makeService();
    const created = await seedResult(prisma, { documentId: 'doc-1', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-06-15' });
    const report = await service.threeWayTie('tenant-1', 'entity-1', '2025-06');
    expect(report.orphanedResults).toEqual([{ taxResultId: created.id, documentId: 'doc-1' }]);
  });

  it('empty period truthfully reports balanced-with-nothing, not a fabricated tie', async () => {
    const { service } = makeService();
    const report = await service.threeWayTie('tenant-1', 'entity-1', '2099-01');
    expect(report.ties).toEqual([]);
    expect(report.overallBalanced).toBe(true);
  });

  it('jurisdictionLiabilityReport aggregates taxable base and tax by jurisdiction+taxType', async () => {
    const { prisma, service } = makeService();
    await seedResult(prisma, { documentId: 'doc-1', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-06-15' });
    const report = await service.jurisdictionLiabilityReport('tenant-1', 'entity-1', '2025-06');
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ jurisdictionId: 'STATE-XX', taxType: 'SALES_TAX', tax: '10.00' });
    expect(report.glMovementSourceIsPending).toBe(true);
  });

  it('closePeriodGate signals BALANCED when tied, VARIANCE_DETECTED when not', async () => {
    const { prisma, postedSource, service } = makeService();
    const created = await seedResult(prisma, { documentId: 'doc-1', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-06-15' });
    postedSource.seed('tenant-1', 'entity-1', '2025-06', [
      { documentId: 'doc-1', documentType: 'COUNTER_SALE', jurisdictionId: 'STATE-XX', taxAmount: '10.00', taxResultId: created.id },
    ]);
    const balanced = await service.closePeriodGate('tenant-1', 'entity-1', '2025-06');
    expect(balanced.gateStatus).toBe('BALANCED');

    postedSource.seed('tenant-1', 'entity-1', '2025-07', []);
    await seedResult(prisma, { documentId: 'doc-2', jurisdictionId: 'STATE-XX', taxAmount: '10.00', businessDate: '2025-07-15' });
    const variant = await service.closePeriodGate('tenant-1', 'entity-1', '2025-07');
    expect(variant.gateStatus).toBe('VARIANCE_DETECTED');
  });
});
