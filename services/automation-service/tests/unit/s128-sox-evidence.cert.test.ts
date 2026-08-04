/**
 * CERTIFICATION TEST — S128 SOX Evidence Automation
 *
 * Certifies:
 *  1. Binder assembly includes all active controls and is scoped by tenantId
 *  2. A control with no evidence produces EXCEPTION, not a clean binder
 *  3. Assembled binder receives a non-empty binderHash (immutability seal)
 *  4. A hashed binder is immutable — re-assembly skips it
 *  5. SoD — automation identity cannot attest a binder it assembled
 *  6. EXCEPTION binder cannot be attested — missing evidence must be resolved first
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoxEvidenceService } from '../../src/application/sox-evidence-service';
import { AutomationError, SoDViolationError } from '../../src/domain/errors';
import { AUTOMATION_IDENTITY } from '../../src/domain/sod';

const TENANT = 'tenant-sox';
const LE = 'le-5';

function makeCapabilities() {
  return { requireConfigured: vi.fn().mockResolvedValue({ currentAuthority: 'AUTO_EXECUTE_WITHIN_POLICY' }) };
}

function makeClose(closed: boolean | null = true) {
  return { isPeriodClosed: vi.fn().mockResolvedValue(closed) };
}

function makeEvents() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function makeControl(overrides: Partial<{ controlType: string; id: string }> = {}) {
  return { id: 'ctrl-1', controlCode: 'SOD-001', controlName: 'SoD Review', controlType: 'SOD', active: true, ...overrides };
}

function makePrisma(opts: {
  controls?: any[];
  existingBinder?: any;
  grants?: any[];
  approvals?: any[];
  executions?: any[];
} = {}) {
  const controls = opts.controls ?? [makeControl()];
  return {
    controlRegistry: {
      findMany: vi.fn().mockResolvedValue(controls),
      upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'ctrl-1', ...create })),
    },
    evidenceBinder: {
      findFirst: vi.fn().mockResolvedValue(opts.existingBinder ?? null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'binder-1', control: controls[0], ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'binder-1', control: controls[0], ...data })),
    },
    automationGrant: {
      findMany: vi.fn().mockResolvedValue(opts.grants ?? []),
    },
    automationItem: {
      findMany: vi.fn().mockResolvedValue(opts.approvals ?? [
        { id: 'item-1', capabilityCode: 'S096', automationIdentity: 'automation:ce17', approvedBy: 'user-controller', approvedAt: new Date() },
      ]),
    },
    automationExecution: {
      findMany: vi.fn().mockResolvedValue(opts.executions ?? []),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };
}

describe('S128 — SOX Evidence Automation', () => {
  it('assembles a binder per active control, scoped by tenantId', async () => {
    const prisma = makePrisma();
    const service = new SoxEvidenceService(prisma as any, makeEvents() as any, makeClose() as any, makeCapabilities() as any);
    const { items } = await service.assembleBinders({
      tenantId: TENANT, legalEntityId: LE, periodYear: 2026, periodMonth: 7, actor: 'user-ops',
    });
    expect(items).toHaveLength(1);
    const createCall = prisma.evidenceBinder.create.mock.calls[0][0];
    expect(createCall.data.tenantId).toBe(TENANT);
  });

  it('stamps a non-empty binderHash on each assembled binder', async () => {
    const prisma = makePrisma();
    const service = new SoxEvidenceService(prisma as any, makeEvents() as any, makeClose() as any, makeCapabilities() as any);
    const { items } = await service.assembleBinders({
      tenantId: TENANT, legalEntityId: LE, periodYear: 2026, periodMonth: 7, actor: 'user-ops',
    });
    expect(items[0].binderHash).toBeTruthy();
    expect(items[0].binderHash.length).toBeGreaterThan(8);
  });

  it('produces EXCEPTION state when no approvals occurred in the period — no silent clean control', async () => {
    const prisma = makePrisma({ approvals: [] });
    const service = new SoxEvidenceService(prisma as any, makeEvents() as any, makeClose() as any, makeCapabilities() as any);
    const { items } = await service.assembleBinders({
      tenantId: TENANT, legalEntityId: LE, periodYear: 2026, periodMonth: 7, actor: 'user-ops',
    });
    expect(items[0].state).toBe('EXCEPTION');
    expect((items[0].missingEvidenceFlags as any[]).length).toBeGreaterThan(0);
  });

  it('skips re-assembly of a hashed (sealed) binder — immutability guard', async () => {
    const sealed = {
      id: 'binder-sealed', binderHash: 'sha256hash', state: 'COMPLETE',
      control: makeControl(), tenantId: TENANT,
    };
    const prisma = makePrisma({ existingBinder: sealed });
    const service = new SoxEvidenceService(prisma as any, makeEvents() as any, makeClose() as any, makeCapabilities() as any);
    const { items } = await service.assembleBinders({
      tenantId: TENANT, legalEntityId: LE, periodYear: 2026, periodMonth: 7, actor: 'user-ops',
    });
    expect(items[0].id).toBe('binder-sealed');
    expect(prisma.evidenceBinder.create).not.toHaveBeenCalled();
    expect(prisma.evidenceBinder.update).not.toHaveBeenCalled();
  });

  it('rejects attestation by the automation identity that assembled the binder — SoD structural guard', async () => {
    const prisma = makePrisma();
    const service = new SoxEvidenceService(prisma as any, makeEvents() as any, makeClose() as any, makeCapabilities() as any);
    prisma.evidenceBinder.findFirst.mockResolvedValue({
      id: 'binder-1', tenantId: TENANT, state: 'COMPLETE',
      binderHash: 'abc', assembledBy: AUTOMATION_IDENTITY,
      missingEvidenceFlags: [],
      control: makeControl(),
    });
    await expect(
      service.attest({ tenantId: TENANT, id: 'binder-1', attestedBy: AUTOMATION_IDENTITY }),
    ).rejects.toThrow(SoDViolationError);
  });

  it('rejects attestation of an EXCEPTION binder — missing evidence must be resolved first', async () => {
    const prisma = makePrisma();
    const service = new SoxEvidenceService(prisma as any, makeEvents() as any, makeClose() as any, makeCapabilities() as any);
    prisma.evidenceBinder.findFirst.mockResolvedValue({
      id: 'binder-exception', tenantId: TENANT, state: 'EXCEPTION',
      binderHash: 'abc', assembledBy: AUTOMATION_IDENTITY,
      missingEvidenceFlags: ['No approvals occurred in the period.'],
      control: makeControl(),
    });
    await expect(
      service.attest({ tenantId: TENANT, id: 'binder-exception', attestedBy: 'user-controller' }),
    ).rejects.toMatchObject({ code: 'MISSING_EVIDENCE' });
  });
});
