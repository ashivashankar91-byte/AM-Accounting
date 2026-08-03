/**
 * @file test-commission-routes.ts
 * @coverage CE-13 gap #1/#3 — HTTP-level tests for commission-routes.ts
 * (S109) using Fastify's app.inject. Covers plan creation with splits/draw/
 * minimum-guarantee, split calculation across employees, draw issuance,
 * dispute create + self-resolution denial + resolve-by-distinct-reviewer,
 * correction/reversal, and chargeback linkage — via the real
 * CommissionService against a mocked Prisma (no live DB).
 */
import 'reflect-metadata';
import Fastify from 'fastify';
import { container } from 'tsyringe';
import { describe, it, expect, vi } from 'vitest';
import { commissionRoutes } from '../http/commission-routes';
import { CommissionService } from '../application/commission-service';

function decimalOf(n: number) {
  return { toNumber: () => n, toString: () => n.toString() };
}

function makePrisma() {
  const plans: any[] = [];
  const records: any[] = [];
  const disputes: any[] = [];
  let planSeq = 0;
  let recordSeq = 0;
  let disputeSeq = 0;

  return {
    commissionPlan: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        planSeq += 1;
        const row = { id: `plan-${planSeq}`, createdAt: new Date(), version: 1, ...data };
        plans.push(row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        if (where.id) return Promise.resolve(plans.find((p) => p.id === where.id) ?? null);
        const matches = plans.filter((p) => p.tenantId === where.tenantId && p.employeeId === where.employeeId && p.isActive);
        return Promise.resolve(matches.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0] ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(plans.filter((p) => p.tenantId === where.tenantId))),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = plans.find((p) => p.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    commissionRecord: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        recordSeq += 1;
        const row = {
          id: `rec-${recordSeq}`, createdAt: new Date(), clawedBackAmount: decimalOf(0), ...data,
          commissionAmount: decimalOf(Number((data.commissionAmount as any)?.toString?.() ?? data.commissionAmount ?? 0)),
          grossProfit: decimalOf(Number((data.grossProfit as any)?.toString?.() ?? data.grossProfit ?? 0)),
        };
        records.push(row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(records.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null)),
      findMany: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(records.filter((r) => r.tenantId === where.tenantId && (!where.employeeId || r.employeeId === where.employeeId)))),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = records.find((r) => r.id === where.id);
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in (value as any)) {
            const current = Number((row[key] as any)?.toNumber?.() ?? row[key] ?? 0);
            const inc = Number((value as any).increment?.toString?.() ?? (value as any).increment);
            row[key] = decimalOf(current + inc);
          } else {
            row[key] = value;
          }
        }
        return Promise.resolve(row);
      }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { commissionAmount: 0 } }),
    },
    commissionDispute: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        disputeSeq += 1;
        const row = { id: `dispute-${disputeSeq}`, createdAt: new Date(), ...data };
        disputes.push(row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(disputes.find((d) => d.id === where.id) ?? null)),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = disputes.find((d) => d.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    clawbackRecord: {
      findFirst: vi.fn().mockResolvedValue({ id: 'clawback-1' }),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

async function buildApp(prisma: any) {
  container.reset();
  container.registerInstance('PrismaClient', prisma);
  container.register('CommissionService', { useClass: CommissionService });
  const app = Fastify();
  await app.register(async (instance) => commissionRoutes(instance, prisma));
  return app;
}

describe('commission-routes — plans', () => {
  it('creates a tenant-configured PERCENTAGE plan with splitRules/drawAmount/minimumGuarantee', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: {
        legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'PERCENTAGE', percentage_rate: 5, department: 'sales',
        split_rules: [{ employeeId: 'emp-1', sharePct: 60 }, { employeeId: 'emp-2', sharePct: 40 }],
        draw_amount: 300, minimum_guarantee: 500, effective_date: '2024-01-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().split_rules).toHaveLength(2);
    expect(res.json().draw_amount).toBe(300);
  });

  it('rejects split rules exceeding 100% with 422 INVALID_SPLIT_RULES', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: {
        legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'PERCENTAGE', percentage_rate: 5,
        split_rules: [{ employeeId: 'emp-1', sharePct: 70 }, { employeeId: 'emp-2', sharePct: 70 }],
        effective_date: '2024-01-01',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INVALID_SPLIT_RULES');
  });
});

describe('commission-routes — calculate with splits + draws + minimum guarantee', () => {
  it('splits gross commission across employees per tenant-configured sharePct', async () => {
    const app = await buildApp(makePrisma());
    await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: {
        legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'PERCENTAGE', percentage_rate: 10,
        split_rules: [{ employeeId: 'emp-1', sharePct: 60 }, { employeeId: 'emp-2', sharePct: 40 }],
        effective_date: '2024-01-01',
      },
    });
    const calcRes = await app.inject({
      method: 'POST', url: '/commissions/calculate', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { deal_id: 'deal-1', employee_id: 'emp-1', deal_type: 'NEW', gross_profit: 1000, deal_date: '2024-06-01' },
    });
    expect(calcRes.statusCode).toBe(201);
    expect(calcRes.json().gross_commission).toBe(100);
    expect(calcRes.json().records).toHaveLength(2);
  });

  it('returns 404 COMMISSION_PLAN_NOT_FOUND when no active plan exists for the employee', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({
      method: 'POST', url: '/commissions/calculate', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { deal_id: 'deal-1', employee_id: 'unknown-emp', deal_type: 'NEW', gross_profit: 1000, deal_date: '2024-06-01' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('COMMISSION_PLAN_NOT_FOUND');
  });

  it('draw issuance creates a PAID DRAW_ADVANCE record', async () => {
    const app = await buildApp(makePrisma());
    const planRes = await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: { legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'FLAT', flat_amount: 50, effective_date: '2024-01-01' },
    });
    const planId = planRes.json().id;
    const drawRes = await app.inject({
      method: 'POST', url: `/commission-plans/${planId}/draws`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'manager-1' },
      payload: { employeeId: 'emp-1', amount: 300 },
    });
    expect(drawRes.statusCode).toBe(201);
    expect(drawRes.json().dealType).toBe('DRAW_ADVANCE');
    expect(drawRes.json().status).toBe('PAID');
  });
});

describe('commission-routes — correction, reversal, chargeback', () => {
  it('correct + reverse a commission record (original-to-reversal linkage)', async () => {
    const app = await buildApp(makePrisma());
    await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: { legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'FLAT', flat_amount: 50, effective_date: '2024-01-01' },
    });
    const calcRes = await app.inject({
      method: 'POST', url: '/commissions/calculate', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { deal_id: 'deal-1', employee_id: 'emp-1', deal_type: 'NEW', gross_profit: 1000, deal_date: '2024-06-01' },
    });
    const recordId = calcRes.json().records[0].id;

    const correctRes = await app.inject({
      method: 'POST', url: `/commissions/${recordId}/correct`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'reviewer-1' },
      payload: { adjustedAmount: 60, reason: 'tier misapplied' },
    });
    expect(correctRes.json().status).toBe('ADJUSTED');

    const reverseRes = await app.inject({
      method: 'POST', url: `/commissions/${recordId}/reverse`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'reviewer-1' },
      payload: { reason: 'deal cancelled' },
    });
    expect(reverseRes.statusCode).toBe(201);
    expect(reverseRes.json().deal_type).toBe(`REVERSAL_OF:${recordId}`);
  });

  it('applies a chargeback linked to an existing clawback record', async () => {
    const app = await buildApp(makePrisma());
    await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: { legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'FLAT', flat_amount: 50, effective_date: '2024-01-01' },
    });
    const calcRes = await app.inject({
      method: 'POST', url: '/commissions/calculate', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { deal_id: 'deal-1', employee_id: 'emp-1', deal_type: 'NEW', gross_profit: 1000, deal_date: '2024-06-01' },
    });
    const recordId = calcRes.json().records[0].id;
    const chargebackRes = await app.inject({
      method: 'POST', url: `/commissions/${recordId}/chargeback`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'reviewer-1' },
      payload: { clawbackRecordId: 'clawback-1', amount: 20 },
    });
    expect(chargebackRes.statusCode).toBe(200);
    expect(chargebackRes.json().clawed_back_amount).toBe(20);
  });
});

describe('commission-routes — disputes (SoD)', () => {
  it('creates a dispute then denies self-resolution by the raiser', async () => {
    const app = await buildApp(makePrisma());
    await app.inject({
      method: 'POST', url: '/commission-plans', headers: { 'x-tenant-id': 't1', 'x-user-id': 'admin-1' },
      payload: { legal_entity_id: 'entity-test', employee_id: 'emp-1', plan_type: 'FLAT', flat_amount: 50, effective_date: '2024-01-01' },
    });
    const calcRes = await app.inject({
      method: 'POST', url: '/commissions/calculate', headers: { 'x-tenant-id': 't1', 'x-user-id': 'user-1' },
      payload: { deal_id: 'deal-1', employee_id: 'emp-1', deal_type: 'NEW', gross_profit: 1000, deal_date: '2024-06-01' },
    });
    const recordId = calcRes.json().records[0].id;

    const disputeRes = await app.inject({
      method: 'POST', url: `/commissions/${recordId}/disputes`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'raiser-1' },
      payload: { reason: 'incorrect tier', adjustedAmount: 60 },
    });
    expect(disputeRes.statusCode).toBe(201);
    const disputeId = disputeRes.json().id;

    const selfResolveRes = await app.inject({
      method: 'POST', url: `/commission-disputes/${disputeId}/resolve`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'raiser-1' },
      payload: { resolution: 'APPROVE_ADJUSTMENT' },
    });
    expect(selfResolveRes.statusCode).toBe(403);
    expect(selfResolveRes.json().error).toBe('SEGREGATION_OF_DUTIES_VIOLATION');

    const resolveRes = await app.inject({
      method: 'POST', url: `/commission-disputes/${disputeId}/resolve`, headers: { 'x-tenant-id': 't1', 'x-user-id': 'reviewer-1' },
      payload: { resolution: 'APPROVE_ADJUSTMENT' },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().status).toBe('RESOLVED');
  });
});

describe('commission-routes — permissions / headers', () => {
  it('missing x-tenant-id header is rejected with 400', async () => {
    const app = await buildApp(makePrisma());
    const res = await app.inject({ method: 'GET', url: '/commission-plans' });
    expect(res.statusCode).toBe(400);
  });
});
