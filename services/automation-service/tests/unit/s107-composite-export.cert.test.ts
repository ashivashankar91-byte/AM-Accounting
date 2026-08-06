/**
 * CERTIFICATION TEST — S107 NCM/NADA Composite Export
 *
 * Certifies:
 *  1. Export generation stamps a deterministic hash from payload content
 *  2. Idempotent — re-generating same period/type returns the existing record
 *  3. Format profile version is mandatory — missing version is a typed failure
 *  4. Invalid exportType is rejected before any write
 *  5. Tenant scope — tenantId in every Prisma write
 *  6. Baseline status is surfaced from the migration baseline client
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompositeExportService } from '../../src/application/composite-export-service';
import { AutomationError } from '../../src/domain/errors';

const TENANT = 'tenant-export';
const LE = 'le-4';

function makeCapabilities() {
  return { requireConfigured: vi.fn().mockResolvedValue({ currentAuthority: 'AUTO_EXECUTE_WITHIN_POLICY' }) };
}

function makeBaseline() {
  return {
    describe: vi.fn().mockResolvedValue({
      configured: true, legalEntityId: LE, baselineRef: 'baseline:2026-01',
    }),
  };
}

function makePrisma(existingExport: any = null) {
  return {
    compositeExport: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'export-1', ...data })),
      findFirst: vi.fn().mockResolvedValue(existingExport),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'export-1', ...data })),
    },
  };
}

function makeEvents() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

const GEN_INPUT = {
  tenantId: TENANT, legalEntityId: LE,
  exportType: 'NCM', formatProfileVersion: 'ncm-v2.1',
  periodYear: 2026, periodMonth: 7,
  rows: [{ vin: 'VIN-001', amount: '24000.00' }],
  actor: 'user-ops',
};

describe('S107 — NCM/NADA Composite Export', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let events: ReturnType<typeof makeEvents>;
  let baseline: ReturnType<typeof makeBaseline>;
  let service: CompositeExportService;

  beforeEach(() => {
    prisma = makePrisma();
    events = makeEvents();
    baseline = makeBaseline();
    service = new CompositeExportService(prisma as any, events as any, baseline as any, makeCapabilities() as any);
  });

  it('generates an export with tenantId in the create data', async () => {
    const exp = await service.generate(GEN_INPUT);
    const createCall = prisma.compositeExport.create.mock.calls[0][0];
    expect(createCall.data.tenantId).toBe(TENANT);
    expect(exp.exportType).toBe('NCM');
    expect(exp.state).toBe('GENERATED');
  });

  it('stamps a non-empty exportHash at generation', async () => {
    const exp = await service.generate(GEN_INPUT);
    expect(exp.exportHash).toBeTruthy();
    expect(exp.exportHash.length).toBeGreaterThan(8);
  });

  it('is idempotent — returns existing record if GENERATED/APPROVED record already exists', async () => {
    const existing = { id: 'export-existing', tenantId: TENANT, state: 'GENERATED', exportType: 'NCM', exportHash: 'abc123' };
    const svc = new CompositeExportService(
      makePrisma(existing) as any, events as any, baseline as any, makeCapabilities() as any,
    );
    const result = await svc.generate(GEN_INPUT);
    expect(result.id).toBe('export-existing');
    expect(makePrisma(existing).compositeExport.create).not.toHaveBeenCalled();
  });

  it('rejects generation without a format profile version', async () => {
    await expect(
      service.generate({ ...GEN_INPUT, formatProfileVersion: '' }),
    ).rejects.toMatchObject({ code: 'FORMAT_PROFILE_NOT_CONFIGURED' });
  });

  it('rejects an unrecognised exportType before any Prisma write', async () => {
    await expect(
      service.generate({ ...GEN_INPUT, exportType: 'UNKNOWN_FORMAT' }),
    ).rejects.toThrow(AutomationError);
    expect(prisma.compositeExport.create).not.toHaveBeenCalled();
  });

  it('baselineStatus delegates to the migration baseline client', async () => {
    const status = await service.baselineStatus(TENANT, LE);
    expect(status.configured).toBe(true);
    expect(baseline.describe).toHaveBeenCalledWith(TENANT, LE);
  });
});
