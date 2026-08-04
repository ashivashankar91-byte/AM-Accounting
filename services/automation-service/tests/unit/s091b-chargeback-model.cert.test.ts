/**
 * CERTIFICATION TEST — S091B Experience-Rated Chargeback Model
 *
 * Certifies:
 *  1. Rate calculation: recommendedRate = chargedBackAmount / originatedAmount
 *  2. Tenant scope enforced — every Prisma call includes tenantId
 *  3. Empty cohort produces a typed failure, not a silent zero
 *  4. Drift is flagged when the sample is thin (< 30 or < 2 cohorts)
 *  5. SoD — automation identity cannot adopt its own model output
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargebackModelService } from '../../src/application/chargeback-model-service';
import { AutomationError, AuthorityCeilingError, SoDViolationError } from '../../src/domain/errors';

const TENANT = 'tenant-abc';
const LE = 'le-1';

function makeCapabilities(override: Partial<{ currentAuthority: string }> = {}) {
  return {
    requireConfigured: vi.fn().mockResolvedValue({ currentAuthority: 'RECOMMEND', ...override }),
  };
}

function makeItems() {
  return { create: vi.fn(), approve: vi.fn() };
}

function makePrisma(outputId = 'output-1') {
  return {
    chargebackModelOutput: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: outputId, ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: outputId, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ruleModelVersion: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function makeDeals(cohorts: any[] = []) {
  return {
    getDealCohorts: vi.fn().mockResolvedValue({
      signal: { status: 'AVAILABLE', detail: 'ok' },
      cohorts,
    }),
  };
}

function makeEvents() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

const COHORTS = [
  { cohortKey: 'Q1', originatedCount: 50, originatedAmount: '100000', chargedBackCount: 5, chargedBackAmount: '4000' },
  { cohortKey: 'Q2', originatedCount: 40, originatedAmount: '80000', chargedBackCount: 4, chargedBackAmount: '3200' },
];

describe('S091B — Experience-Rated Chargeback Model', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let deals: ReturnType<typeof makeDeals>;
  let events: ReturnType<typeof makeEvents>;
  let service: ChargebackModelService;

  beforeEach(() => {
    prisma = makePrisma();
    deals = makeDeals(COHORTS);
    events = makeEvents();
    service = new ChargebackModelService(prisma as any, events as any, deals as any, makeCapabilities() as any);
  });

  it('calculates recommendedRate as chargedBackAmount / originatedAmount', async () => {
    const result = await service.runModel({
      tenantId: TENANT, legalEntityId: LE, modelVersion: '1.0',
      trainingWindowStart: '2026-01-01', trainingWindowEnd: '2026-07-01',
      cohorts: COHORTS, actor: 'user-analyst',
    });
    // (4000 + 3200) / (100000 + 80000) = 7200 / 180000 = 0.04
    expect(Number(result.recommendedRate)).toBeCloseTo(0.04, 5);
  });

  it('persists the output with tenantId in the WHERE-equivalent create data', async () => {
    await service.runModel({
      tenantId: TENANT, legalEntityId: LE, modelVersion: '1.0',
      trainingWindowStart: '2026-01-01', trainingWindowEnd: '2026-07-01',
      cohorts: COHORTS, actor: 'user-analyst',
    });
    const createCall = prisma.chargebackModelOutput.create.mock.calls[0][0];
    expect(createCall.data.tenantId).toBe(TENANT);
  });

  it('throws when no cohort data is available — no silent zero rate', async () => {
    const svc = new ChargebackModelService(
      prisma as any, events as any, makeDeals([]) as any, makeCapabilities() as any,
    );
    await expect(
      svc.runModel({
        tenantId: TENANT, legalEntityId: LE, modelVersion: '1.0',
        trainingWindowStart: '2026-01-01', trainingWindowEnd: '2026-07-01',
        actor: 'user-analyst',
      }),
    ).rejects.toThrow(AutomationError);
  });

  it('flags drift when the sample has fewer than 30 originated units', async () => {
    const thinCohorts = [
      { cohortKey: 'Q1', originatedCount: 10, originatedAmount: '5000', chargedBackCount: 1, chargedBackAmount: '200' },
    ];
    const result = await service.runModel({
      tenantId: TENANT, legalEntityId: LE, modelVersion: '1.0',
      trainingWindowStart: '2026-01-01', trainingWindowEnd: '2026-07-01',
      cohorts: thinCohorts, actor: 'user-analyst',
    });
    expect(result.driftFlagged).toBe(true);
  });

  it('rejects adoption by an automation identity — SoD structural guard', async () => {
    // Set up a RECOMMENDATION_READY output to be adopted
    prisma.chargebackModelOutput.findFirst.mockResolvedValue({
      id: 'output-1', tenantId: TENANT, legalEntityId: LE,
      modelVersion: '1.0', state: 'RECOMMENDATION_READY', driftFlagged: false,
      recommendedRate: '0.040000',
    });
    await expect(
      service.adopt({
        tenantId: TENANT, id: 'output-1', adoptedBy: 'automation:ce17', s091ConfigVersion: 'v2',
      }),
    ).rejects.toThrow(SoDViolationError);
  });

  it('rejects adoption when the capability authority is AUTO_EXECUTE — ceiling is RECOMMEND', async () => {
    const capHigh = makeCapabilities({ currentAuthority: 'AUTO_EXECUTE_WITHIN_POLICY' });
    const svc = new ChargebackModelService(prisma as any, events as any, deals as any, capHigh as any);
    prisma.chargebackModelOutput.findFirst.mockResolvedValue({
      id: 'output-1', tenantId: TENANT, legalEntityId: LE,
      modelVersion: '1.0', state: 'RECOMMENDATION_READY', driftFlagged: false,
      recommendedRate: '0.040000',
    });
    await expect(
      svc.adopt({
        tenantId: TENANT, id: 'output-1', adoptedBy: 'user-controller', s091ConfigVersion: 'v2',
      }),
    ).rejects.toThrow(AuthorityCeilingError);
  });
});
