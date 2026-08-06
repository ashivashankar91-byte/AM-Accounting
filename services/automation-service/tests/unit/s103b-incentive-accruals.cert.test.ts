/**
 * CERTIFICATION TEST — S103B Probability-Weighted Incentive Accruals
 *
 * Certifies:
 *  1. Weighted calculation: amount = Σ(payout × probability) across tiers
 *  2. Probability > 1 total is refused — overstated programs cannot be posted
 *  3. Double-accrual guard blocks a second RECOMMENDATION_READY for same program/period
 *  4. Tenant scope — tenantId in every Prisma write
 *  5. SoD — automation identity cannot approve its own recommendation
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncentiveAccrualService } from '../../src/application/incentive-accrual-service';
import { AutomationError } from '../../src/domain/errors';

const TENANT = 'tenant-incentive';
const LE = 'le-3';

function makeCapabilities() {
  return { requireConfigured: vi.fn().mockResolvedValue({ currentAuthority: 'EXECUTE_WITH_APPROVAL' }) };
}

function makeItems() {
  const item = { id: 'item-accrual-1', tenantId: TENANT };
  return {
    create: vi.fn().mockResolvedValue({ item }),
    approve: vi.fn().mockResolvedValue({ id: 'item-accrual-1' }),
  };
}

function makePrisma() {
  return {
    incentiveAccrualRecommendation: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rec-1', ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rec-1', state: 'APPROVED', ...data })),
    },
  };
}

function makeOem() {
  return { getIncentivePrograms: vi.fn().mockResolvedValue({ signal: { status: 'AVAILABLE' }, programs: [] }) };
}

function makeEvents() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

const BASE_TIERS = [
  { tierCode: 'T1', threshold: 10, payout: 5000, probability: 0.6 },
  { tierCode: 'T2', threshold: 20, payout: 8000, probability: 0.3 },
];

const BASE_INPUT = {
  tenantId: TENANT, legalEntityId: LE,
  programRef: 'FORD-RDR-Q3',
  periodYear: 2026, periodMonth: 7,
  attainmentPace: '0.75',
  weightingMethod: 'HISTORICAL_ATTAINMENT',
  tiers: BASE_TIERS,
  actor: 'user-analyst',
};

describe('S103B — Probability-Weighted Incentive Accruals', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let events: ReturnType<typeof makeEvents>;
  let items: ReturnType<typeof makeItems>;
  let service: IncentiveAccrualService;

  beforeEach(() => {
    prisma = makePrisma();
    events = makeEvents();
    items = makeItems();
    service = new IncentiveAccrualService(
      prisma as any, events as any, makeOem() as any,
      makeCapabilities() as any, items as any,
    );
  });

  it('calculates recommendedAmount as Σ(payout × probability) across tiers', async () => {
    const rec = await service.recommend(BASE_INPUT);
    // 5000×0.6 + 8000×0.3 = 3000 + 2400 = 5400
    expect(Number(rec.recommendedAmount)).toBeCloseTo(5400, 2);
  });

  it('persists the recommendation with tenantId in the create data', async () => {
    await service.recommend(BASE_INPUT);
    const createCall = prisma.incentiveAccrualRecommendation.create.mock.calls[0][0];
    expect(createCall.data.tenantId).toBe(TENANT);
  });

  it('refuses when tier probabilities sum above 1 — overstated accrual guard', async () => {
    const overloaded = [
      { tierCode: 'T1', threshold: 10, payout: 5000, probability: 0.7 },
      { tierCode: 'T2', threshold: 20, payout: 8000, probability: 0.5 },
    ];
    await expect(
      service.recommend({ ...BASE_INPUT, tiers: overloaded }),
    ).rejects.toMatchObject({ code: 'PROBABILITY_MASS_EXCEEDED' });
  });

  it('blocks a second recommendation for the same program/period — double-accrual guard', async () => {
    prisma.incentiveAccrualRecommendation.findFirst.mockResolvedValue({
      id: 'rec-existing', tenantId: TENANT, legalEntityId: LE,
      programRef: 'FORD-RDR-Q3', periodYear: 2026, periodMonth: 7,
      state: 'RECOMMENDATION_READY',
    });
    await expect(service.recommend(BASE_INPUT)).rejects.toMatchObject({ code: 'DOUBLE_ACCRUAL_REFUSED' });
  });

  it('rejects approval by an automation identity — SoD structural guard', async () => {
    prisma.incentiveAccrualRecommendation.findFirst.mockResolvedValue({
      id: 'rec-1', tenantId: TENANT, legalEntityId: LE,
      recommendedAmount: { toString: () => '5400.00' },
      programRef: 'FORD-RDR-Q3', periodYear: 2026, periodMonth: 7,
      weightingMethod: 'HISTORICAL_ATTAINMENT', tierData: BASE_TIERS,
      weightingInputs: {}, attainmentPace: { toString: () => '0.75' },
      ruleVersion: 'ce17.incentive.v1', state: 'RECOMMENDATION_READY',
    });
    await expect(
      service.approve({
        tenantId: TENANT, id: 'rec-1', approver: 'automation:ce17',
        accrualAccountCode: '1400', offsetAccountCode: '4200',
      }),
    ).rejects.toMatchObject({ code: 'SOD_VIOLATION' });
  });
});
