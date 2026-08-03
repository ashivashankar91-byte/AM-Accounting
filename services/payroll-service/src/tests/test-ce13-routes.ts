/**
 * @file test-ce13-routes.ts
 * @coverage CE-13 gap #3 — HTTP-level tests for ce13-routes.ts using
 * Fastify's app.inject (no real network/database). Covers: statutory
 * source-mode config, S025 rule-pack draft/simulate/validate/activate
 * (including author-cannot-activate-own-pack denial via the real
 * PayrollRulePackService against a mocked Prisma), S110 clawback lifecycle,
 * S111 accrual lifecycle (including self-approval denial), and S112 tech
 * flag-hour bridge including RATE_GAP refusal.
 */
import 'reflect-metadata';
import Fastify from 'fastify';
import { container } from 'tsyringe';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ce13Routes } from '../http/ce13-routes';
import { PayrollRulePackService } from '../application/rule-pack-service';

function makePrisma() {
  const rulePackVersions: any[] = [];
  let versionSeq = 0;
  return {
    payrollTenantConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cfg-1', ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cfg-1', ...data })),
    },
    payrollRulePackVersion: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id) return Promise.resolve(rulePackVersions.find((v) => v.id === where.id) ?? null);
        const matches = rulePackVersions.filter((v) => v.tenantId === where.tenantId && v.packKey === where.packKey);
        return Promise.resolve(matches.sort((a, b) => b.version - a.version)[0] ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(rulePackVersions.filter((v) => v.tenantId === where.tenantId && (!where.packKey || v.packKey === where.packKey)))),
      create: vi.fn().mockImplementation(({ data }: any) => {
        versionSeq += 1;
        const row = { id: `version-${versionSeq}`, ...data };
        rulePackVersions.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = rulePackVersions.find((v) => v.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        let count = 0;
        for (const v of rulePackVersions) {
          if (v.tenantId === where.tenantId && v.packKey === where.packKey && v.status === where.status) { Object.assign(v, data); count++; }
        }
        return Promise.resolve({ count });
      }),
      $transaction: undefined,
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn({
      payrollRulePackVersion: {
        updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
          let count = 0;
          for (const v of rulePackVersions) {
            if (v.tenantId === where.tenantId && v.packKey === where.packKey && v.status === where.status) { Object.assign(v, data); count++; }
          }
          return Promise.resolve({ count });
        }),
        update: vi.fn().mockImplementation(({ where, data }: any) => {
          const row = rulePackVersions.find((v) => v.id === where.id);
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
    })),
    clawbackRecord: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'clawback-1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    accrualEntry: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'accrual-1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'accrual-1', ...data })),
    },
    techFlagBridgeEntry: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'bridge-1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

async function buildApp(prisma: any) {
  container.reset();
  container.registerInstance('PrismaClient', prisma);
  container.register('PayrollRulePackService', { useClass: PayrollRulePackService });
  container.registerInstance('PaymentHandoffService', new Proxy({}, { get: () => async () => ({}) }));
  container.registerInstance('PayrollAuditService', new Proxy({}, { get: () => async () => ({ items: [] }) }));
  const app = Fastify();
  await app.register(async (instance) => ce13Routes(instance, prisma));
  return app;
}

describe('ce13-routes — S108 statutory source-mode config', () => {
  it('GET /config/source-mode defaults to NOT_CONFIGURED', async () => {
    const prisma = makePrisma();
    const app = await buildApp(prisma);
    const res = await app.inject({ method: 'GET', url: '/config/source-mode', headers: { 'x-tenant-id': 't1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().payrollSourceMode).toBe('NOT_CONFIGURED');
  });

  it('PUT /config/source-mode requires a valid enum value', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({ method: 'PUT', url: '/config/source-mode', headers: { 'x-tenant-id': 't1' }, payload: { payrollSourceMode: 'BOGUS' } });
    expect(res.statusCode).toBe(500);
  });

  it('missing x-tenant-id header is rejected', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({ method: 'GET', url: '/config/source-mode' });
    expect(res.statusCode).toBe(400);
  });
});

describe('ce13-routes — S025 rule-pack governance (author cannot activate own pack)', () => {
  it('draft → validate → activate (distinct user) succeeds', async () => {
    const app = await buildApp(makePrisma());
    const draftRes = await app.inject({
      method: 'POST', url: '/rule-packs', headers: { 'x-tenant-id': 't1', 'x-user-id': 'author-1' },
      payload: { legalEntityId: 'entity-test', packKey: 'payroll-gl-mapping', rows: [{ family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: '5000', isDebit: true }] },
    });
    expect(draftRes.statusCode).toBe(201);
    const versionId = draftRes.json().id;

    const validateRes = await app.inject({ method: 'POST', url: `/rule-packs/${versionId}/validate`, headers: { 'x-tenant-id': 't1' } });
    expect(validateRes.json().valid).toBe(true);

    const activateRes = await app.inject({ method: 'POST', url: `/rule-packs/${versionId}/activate`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'activator-1' } });
    expect(activateRes.statusCode).toBe(200);
    expect(activateRes.json().status).toBe('ACTIVE');
  });

  it('activation by the same user who authored the draft is denied (403 RULE_PACK_SOD_VIOLATION)', async () => {
    const app = await buildApp(makePrisma());
    const draftRes = await app.inject({
      method: 'POST', url: '/rule-packs', headers: { 'x-tenant-id': 't1', 'x-user-id': 'same-user' },
      payload: { legalEntityId: 'entity-test', packKey: 'payroll-gl-mapping', rows: [{ family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: '5000', isDebit: true }] },
    });
    const versionId = draftRes.json().id;
    await app.inject({ method: 'POST', url: `/rule-packs/${versionId}/validate`, headers: { 'x-tenant-id': 't1' } });
    const activateRes = await app.inject({ method: 'POST', url: `/rule-packs/${versionId}/activate`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'same-user' } });
    expect(activateRes.statusCode).toBe(403);
    expect(activateRes.json().error).toBe('RULE_PACK_SOD_VIOLATION');
  });

  it('GET /rule-packs/:id/simulate returns pendingMappingCount for blank rows', async () => {
    const app = await buildApp(makePrisma());
    const draftRes = await app.inject({
      method: 'POST', url: '/rule-packs', headers: { 'x-tenant-id': 't1', 'x-user-id': 'author-1' },
      payload: { legalEntityId: 'entity-test', packKey: 'k', rows: [{ family: 'EARNINGS', department: 'sales', payComponent: 'X', glAccountCode: null, isDebit: true }] },
    });
    const versionId = draftRes.json().id;
    const simRes = await app.inject({ method: 'GET', url: `/rule-packs/${versionId}/simulate`, headers: { 'x-tenant-id': 't1' } });
    expect(simRes.json().pendingMappingCount).toBe(1);
  });
});

describe('ce13-routes — S110 clawback lifecycle', () => {
  it('creates a clawback and resolves it', async () => {
    const app = await buildApp(makePrisma());
    const createRes = await app.inject({
      method: 'POST', url: '/clawbacks', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { legalEntityId: 'entity-test', employeeId: 'emp-1', dealId: 'deal-1', method: 'RECEIVABLE', clawbackAmount: 100 },
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().id;

    const resolveRes = await app.inject({ method: 'POST', url: `/clawbacks/${id}/resolve`, headers: { 'x-tenant-id': 't1' } });
    expect(resolveRes.json().status).toBe('RESOLVED');
  });

  it('resolving an unknown clawback returns 404', async () => {
    const prisma = makePrisma();
    prisma.clawbackRecord.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const app = await buildApp(prisma);
    const res = await app.inject({ method: 'POST', url: '/clawbacks/nope/resolve', headers: { 'x-tenant-id': 't1' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('ce13-routes — S111 accrual lifecycle (self-approval denial)', () => {
  it('creates a PREVIEW accrual and approves via a distinct user', async () => {
    const prisma = makePrisma();
    const app = await buildApp(prisma);
    const createRes = await app.inject({
      method: 'POST', url: '/accruals', headers: { 'x-tenant-id': 't1', 'x-user-id': 'preparer-1' },
      payload: { legalEntityId: 'entity-test', periodYear: 2024, periodMonth: 1, accrualType: 'BONUS_ACCRUAL', amount: 500 },
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().id;
    prisma.accrualEntry.findFirst = vi.fn().mockResolvedValue({ id, previewedBy: 'preparer-1' });

    const approveRes = await app.inject({ method: 'POST', url: `/accruals/${id}/approve`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'approver-1' } });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe('APPROVED');
  });

  it('denies self-approval: the preparer cannot also approve the accrual', async () => {
    const prisma = makePrisma();
    prisma.accrualEntry.findFirst = vi.fn().mockResolvedValue({ id: 'accrual-1', previewedBy: 'same-user' });
    const app = await buildApp(prisma);
    const res = await app.inject({ method: 'POST', url: '/accruals/accrual-1/approve', headers: { 'x-tenant-id': 't1', 'x-user-id': 'same-user' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('ce13-routes — S112 tech flag-hour bridge (RATE_GAP refusal)', () => {
  it('with a configured flagRate, computes earnings and status RATE_RESOLVED', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({
      method: 'POST', url: '/tech-bridge', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { legalEntityId: 'entity-test', employeeId: 'emp-1', periodStart: '2024-01-01', periodEnd: '2024-01-14', flagHours: 40, flagRate: 25 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('RATE_RESOLVED');
    expect(res.json().earningsAmount).toBe(1000);
  });

  it('with no configured flagRate, refuses deterministically as RATE_GAP (never a silent estimate)', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({
      method: 'POST', url: '/tech-bridge', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { legalEntityId: 'entity-test', employeeId: 'emp-1', periodStart: '2024-01-01', periodEnd: '2024-01-14', flagHours: 40 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('RATE_GAP');
    expect(res.json().earningsAmount).toBe(0);
  });
});
