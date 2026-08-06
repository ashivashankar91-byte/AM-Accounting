/**
 * S005 — HR-Event Provisioning Hooks — Certification Tests
 *
 * Proves all canonical acceptance criteria:
 *   AC1:  Joiner (HR_USER_CREATED) provisions user + accounting roles via auth-service
 *   AC2:  Mover (HR_USER_ROLE_CHANGED) updates role assignments
 *   AC3:  Leaver (HR_USER_TERMINATED) deactivates and revokes all access
 *   AC4:  Duplicate sourceCorrelationId → DUPLICATE, no repeat mutation
 *   AC5:  Unknown job code → IGNORED (fail-closed, no roles assigned)
 *   AC6:  auth-service 5xx → FAILED_RETRYABLE, persisted and retryable
 *   AC7:  Cross-tenant denial → CrossTenantDeniedError thrown
 *   AC8:  Cross-legal-entity is scoped: legalEntityId stored and passed to auth-service
 *   AC9:  Unauthorized service identity → UnauthorizedServiceIdentityError
 *   AC10: Persisted status survives (all events stored regardless of outcome)
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HrProvisioningService,
  HrEvent,
  UnauthorizedServiceIdentityError,
  CrossTenantDeniedError,
} from '../../src/application/hr-provisioning-service';
import type { IAuthServiceClient } from '../../src/infrastructure/auth-service-client';

const TENANT = 'tenant-s005-cert';
const ENTITY = 'entity-le-001';
const OTHER_TENANT = 'tenant-other';

// ── Fake auth-service client ──────────────────────────────────────────────────
function makeAuthClient(overrides: Partial<IAuthServiceClient> = {}): IAuthServiceClient {
  return {
    provisionUser: vi.fn().mockResolvedValue({ userId: 'auth-u-1', email: 'alice@co.test', assignedRoles: ['accounting.post', 'accounting.view', 'gl.journal.create'] }),
    updateUserRoles: vi.fn().mockResolvedValue(undefined),
    deprovisionUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Fake Prisma ───────────────────────────────────────────────────────────────
let persisted: any[];

function makePrisma(opts: { existingCorrelationId?: string } = {}) {
  persisted = [];
  const p: any = {
    hrProvisioningEvent: {
      findFirst: vi.fn(({ where }: any) => {
        if (where.sourceCorrelationId && where.sourceCorrelationId === opts.existingCorrelationId) {
          return Promise.resolve({ id: 'existing-evt', accountingAction: 'PROVISIONED', status: 'PROCESSED' });
        }
        return Promise.resolve(null);
      }),
      create: vi.fn(({ data }: any) => {
        const row = { id: `evt-${persisted.length + 1}`, ...data };
        persisted.push(row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
  };
  return p;
}

function makeEvent(overrides: Partial<HrEvent> = {}): HrEvent {
  return {
    tenantId: TENANT,
    legalEntityId: ENTITY,
    hrEventType: 'HR_USER_CREATED',
    hrUserId: 'hr-emp-001',
    hrSystem: 'workday',
    sourceCorrelationId: 'corr-001',
    requestedByServiceIdentity: 'hr-connector:workday',
    payload: { email: 'alice@co.test', firstName: 'Alice', lastName: 'Smith', jobCode: 'ACCOUNTANT' },
    ...overrides,
  };
}

describe('S005 — HR-Event Provisioning Hooks', () => {
  let svc: HrProvisioningService;
  let auth: ReturnType<typeof makeAuthClient>;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    auth = makeAuthClient();
    prisma = makePrisma();
    svc = new HrProvisioningService(prisma, auth);
  });

  // ── AC1: Joiner ────────────────────────────────────────────────────────────
  it('AC1: HR_USER_CREATED provisions user with mapped roles via auth-service', async () => {
    const result = await svc.processHrEvent(makeEvent(), TENANT);

    expect(result.status).toBe('PROCESSED');
    expect(result.accountingAction).toBe('PROVISIONED');
    expect(auth.provisionUser).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      legalEntityId: ENTITY,
      email: 'alice@co.test',
      externalHrId: 'hr-emp-001',
      roles: expect.arrayContaining(['accounting.post', 'gl.journal.create']),
    }));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].accountingAction).toBe('PROVISIONED');
    expect(persisted[0].legalEntityId).toBe(ENTITY);
    expect(persisted[0].tenantId).toBe(TENANT);
  });

  // ── AC2: Mover ────────────────────────────────────────────────────────────
  it('AC2: HR_USER_ROLE_CHANGED updates role assignments via auth-service', async () => {
    const result = await svc.processHrEvent(
      makeEvent({ hrEventType: 'HR_USER_ROLE_CHANGED', sourceCorrelationId: 'corr-002',
                   payload: { jobCode: 'CONTROLLER' } }),
      TENANT,
    );

    expect(result.status).toBe('PROCESSED');
    expect(result.accountingAction).toBe('ROLE_UPDATED');
    expect(auth.updateUserRoles).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      legalEntityId: ENTITY,
      externalHrId: 'hr-emp-001',
      roles: expect.arrayContaining(['period.close', 'gl.journal.approve']),
    }));
  });

  // ── AC3: Leaver ────────────────────────────────────────────────────────────
  it('AC3: HR_USER_TERMINATED deprovisions user via auth-service', async () => {
    const result = await svc.processHrEvent(
      makeEvent({ hrEventType: 'HR_USER_TERMINATED', sourceCorrelationId: 'corr-003',
                   payload: { reason: 'voluntary-resignation' } }),
      TENANT,
    );

    expect(result.status).toBe('PROCESSED');
    expect(result.accountingAction).toBe('DEPROVISIONED');
    expect(auth.deprovisionUser).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      legalEntityId: ENTITY,
      externalHrId: 'hr-emp-001',
    }));
    expect(persisted[0].accountingRoles).toEqual([]);
  });

  // ── AC4: Duplicate correlationId ──────────────────────────────────────────
  it('AC4: duplicate sourceCorrelationId returns DUPLICATE with no repeat mutation', async () => {
    prisma = makePrisma({ existingCorrelationId: 'corr-dup' });
    svc = new HrProvisioningService(prisma, auth);

    const result = await svc.processHrEvent(makeEvent({ sourceCorrelationId: 'corr-dup' }), TENANT);

    expect(result.status).toBe('DUPLICATE');
    expect(auth.provisionUser).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);   // no new record created
  });

  // ── AC5: Unknown job code — fail closed ───────────────────────────────────
  it('AC5: unknown job code → IGNORED, no roles assigned (fail-closed)', async () => {
    const result = await svc.processHrEvent(
      makeEvent({ sourceCorrelationId: 'corr-005',
                   payload: { email: 'bob@co.test', jobCode: 'UNKNOWN_CODE_XYZ' } }),
      TENANT,
    );

    expect(result.accountingAction).toBe('IGNORED');
    expect(auth.provisionUser).not.toHaveBeenCalled();
    expect(persisted[0].accountingRoles).toEqual([]);
  });

  // ── AC6: auth-service 5xx → FAILED_RETRYABLE ──────────────────────────────
  it('AC6: auth-service 5xx error → status FAILED_RETRYABLE, persisted with errorMessage', async () => {
    const retryableErr = Object.assign(new Error('upstream 503'), { retryable: true });
    auth = makeAuthClient({ provisionUser: vi.fn().mockRejectedValue(retryableErr) });
    svc = new HrProvisioningService(prisma, auth);

    const result = await svc.processHrEvent(makeEvent({ sourceCorrelationId: 'corr-006' }), TENANT);

    expect(result.status).toBe('FAILED_RETRYABLE');
    expect(result.retryable).toBe(true);
    expect(result.errorMessage).toContain('upstream 503');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('FAILED_RETRYABLE');
    expect(persisted[0].errorMessage).toContain('upstream 503');
  });

  // ── AC6b: auth-service 4xx → FAILED_TERMINAL ──────────────────────────────
  it('AC6b: auth-service 4xx error → status FAILED_TERMINAL, not retryable', async () => {
    const terminalErr = Object.assign(new Error('auth-service 422: email conflict'), { retryable: false });
    auth = makeAuthClient({ provisionUser: vi.fn().mockRejectedValue(terminalErr) });
    svc = new HrProvisioningService(prisma, auth);

    const result = await svc.processHrEvent(makeEvent({ sourceCorrelationId: 'corr-006b' }), TENANT);

    expect(result.status).toBe('FAILED_TERMINAL');
    expect(result.retryable).toBe(false);
    expect(persisted[0].status).toBe('FAILED_TERMINAL');
  });

  // ── AC7: Cross-tenant denial ──────────────────────────────────────────────
  it('AC7: event tenantId !== context tenantId → CrossTenantDeniedError', async () => {
    await expect(
      svc.processHrEvent(makeEvent({ tenantId: OTHER_TENANT }), TENANT),
    ).rejects.toThrow(CrossTenantDeniedError);
    expect(auth.provisionUser).not.toHaveBeenCalled();
  });

  // ── AC8: legalEntityId stored separately, passed to auth-service ──────────
  it('AC8: legalEntityId stored separately and forwarded to auth-service (not aliased to tenantId)', async () => {
    await svc.processHrEvent(makeEvent({ legalEntityId: 'le-xyz-999' }), TENANT);

    expect(persisted[0].legalEntityId).toBe('le-xyz-999');
    expect(persisted[0].tenantId).toBe(TENANT);
    expect(persisted[0].legalEntityId).not.toBe(TENANT);  // never aliased
    expect(auth.provisionUser).toHaveBeenCalledWith(expect.objectContaining({ legalEntityId: 'le-xyz-999' }));
  });

  // ── AC9: Unauthorized service identity ────────────────────────────────────
  it('AC9: unknown service identity → UnauthorizedServiceIdentityError, no mutation', async () => {
    await expect(
      svc.processHrEvent(
        makeEvent({ requestedByServiceIdentity: 'rogue-service:evil' }),
        TENANT,
      ),
    ).rejects.toThrow(UnauthorizedServiceIdentityError);
    expect(auth.provisionUser).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  // ── AC10: Persisted status survives (immutable audit) ────────────────────
  it('AC10: every event outcome is persisted including ERROR — immutable audit lineage', async () => {
    const err = Object.assign(new Error('network failure'), { retryable: true });
    auth = makeAuthClient({ provisionUser: vi.fn().mockRejectedValue(err) });
    svc = new HrProvisioningService(prisma, auth);

    await svc.processHrEvent(makeEvent({ sourceCorrelationId: 'corr-010' }), TENANT);

    expect(prisma.hrProvisioningEvent.create).toHaveBeenCalledTimes(1);
    const stored = persisted[0];
    expect(stored.accountingAction).toBe('ERROR');
    expect(stored.tenantId).toBe(TENANT);
    expect(stored.correlationId).toBeDefined();
    expect(stored.sourceCorrelationId).toBe('corr-010');
  });
});
