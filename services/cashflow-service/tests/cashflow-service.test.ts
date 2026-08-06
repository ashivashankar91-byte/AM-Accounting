import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// cashflow-service service-to-service authentication fix: fetchJSON
// previously sent only x-tenant-id with no Authorization header, so every
// downstream call (gl-service /trial-balance, apar-service /ar /ap,
// payroll-service /batches) was silently rejected 401 by authMiddleware --
// fetchJSON swallowed the failure (`!resp.ok` -> null), currentCash stayed
// 0, and generateForecast always threw GL_SERVICE_UNAVAILABLE. These tests
// cover the fix's actual request shape and its failure modes.
//
// serviceAuthHeaders/JWT_SECRET are read at MODULE LOAD time (module-level
// const, not per-call), so each test that needs a different
// AMACC_JWT_SECRET value re-imports the module fresh via vi.resetModules().
async function freshCashFlowService(jwtSecret: string | undefined) {
  vi.resetModules();
  if (jwtSecret === undefined) delete process.env['AMACC_JWT_SECRET'];
  else process.env['AMACC_JWT_SECRET'] = jwtSecret;
  const mod = await import('../src/application/cashflow-service');
  return mod.CashFlowService;
}

function fakePrisma() {
  return {
    cashFlowForecast: { create: vi.fn(async () => ({})) },
    dailyCashActual: { upsert: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
  } as any;
}

const TRIAL_BALANCE = { accounts: [{ accountCode: '1000', accountName: 'Cash - Checking', debit: 50000, credit: 0 }] };

describe('cashflow-service — service-to-service authentication', () => {
  const originalSecret = process.env['AMACC_JWT_SECRET'];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    process.env['AMACC_JWT_SECRET'] = originalSecret;
    vi.restoreAllMocks();
  });

  it('an authorized call attaches a real Bearer SERVICE token, not just x-tenant-id', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('trial-balance')) return { ok: true, json: async () => TRIAL_BALANCE };
      return { ok: true, json: async () => [] };
    });
    const CashFlowService = await freshCashFlowService('test-secret');
    const service = new CashFlowService(fakePrisma());

    await service.generateForecast('tenant-a');

    const trialBalanceCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('trial-balance'))!;
    const headers = trialBalanceCall[1].headers;
    expect(headers['x-tenant-id']).toBe('tenant-a');
    expect(headers.authorization).toMatch(/^Bearer .+\..+\..+$/); // real JWT shape, not empty
  });

  it('missing AMACC_JWT_SECRET falls back to x-tenant-id only (documented degraded mode, not a crash)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('trial-balance')) return { ok: true, json: async () => TRIAL_BALANCE };
      return { ok: true, json: async () => [] };
    });
    const CashFlowService = await freshCashFlowService(undefined);
    const service = new CashFlowService(fakePrisma());

    await service.generateForecast('tenant-a');

    const trialBalanceCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('trial-balance'))!;
    const headers = trialBalanceCall[1].headers;
    expect(headers['x-tenant-id']).toBe('tenant-a');
    expect(headers.authorization).toBeUndefined();
  });

  it('an invalid/rejected token (upstream 401) is treated as unavailable data, not a thrown parse error', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('trial-balance')) return { ok: false, status: 401 };
      return { ok: true, json: async () => [] };
    });
    const CashFlowService = await freshCashFlowService('test-secret');
    const service = new CashFlowService(fakePrisma());

    await expect(service.generateForecast('tenant-a')).rejects.toThrow('GL_SERVICE_UNAVAILABLE');
  });

  it('an upstream network failure (fetch rejects) propagates as a clear error, not a silent zero forecast', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const CashFlowService = await freshCashFlowService('test-secret');
    const service = new CashFlowService(fakePrisma());

    await expect(service.generateForecast('tenant-a')).rejects.toThrow();
  });

  it('a successful forecast retrieval computes real numbers from GL/AR/AP/payroll and persists both tables', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('trial-balance')) return { ok: true, json: async () => TRIAL_BALANCE };
      if (url.includes('/apar/ar')) return { ok: true, json: async () => [{ amount: 1000, dueDate: new Date().toISOString() }] };
      if (url.includes('/apar/ap')) return { ok: true, json: async () => [{ amount: 500, dueDate: new Date(Date.now() + 5 * 86400000).toISOString() }] };
      if (url.includes('/payroll/batches')) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => [] };
    });
    const CashFlowService = await freshCashFlowService('test-secret');
    const prisma = fakePrisma();
    const service = new CashFlowService(prisma);

    const result = await service.generateForecast('tenant-a');

    expect(result.today).toBe(50000);
    expect(result.forecasts).toHaveLength(3);
    expect(prisma.cashFlowForecast.create).toHaveBeenCalledTimes(3);
    expect(prisma.dailyCashActual.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_date: expect.objectContaining({ tenantId: 'tenant-a' }) } }),
    );
  });

  it('every downstream call and every persisted row is scoped to the requesting tenant only (tenant isolation at the application layer)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('trial-balance')) return { ok: true, json: async () => TRIAL_BALANCE };
      return { ok: true, json: async () => [] };
    });
    const CashFlowService = await freshCashFlowService('test-secret');
    const prisma = fakePrisma();
    const service = new CashFlowService(prisma);

    await service.generateForecast('tenant-isolated-a');

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers['x-tenant-id']).toBe('tenant-isolated-a');
    }
    for (const call of prisma.cashFlowForecast.create.mock.calls) {
      expect(call[0].data.tenantId).toBe('tenant-isolated-a');
    }
  });
});
