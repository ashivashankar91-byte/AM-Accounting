/**
 * S203 — Department Cross-Tenant Isolation Tests (ISO203)
 *
 * Verifies that tenant-B cannot read or mutate tenant-A's departments at the
 * service layer, even when bypassing the HTTP auth middleware.
 *
 * Strategy: inject a Prisma mock that returns null/empty whenever a query
 * includes tenantId !== TENANT_A. The service uses findFirst({ where: { id,
 * tenantId, entityId } }) for all single-record operations, so any cross-tenant
 * lookup will see null and throw DepartmentNotFoundError — exactly as required.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  DepartmentService,
  DepartmentNotFoundError,
} from '../src/application/department-service';

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_A  = 'tenant-iso-a';
const TENANT_B  = 'tenant-iso-b';
const ENTITY_A  = 'entity-iso-a';
const DEPT_ID   = 'dept-iso-001';

const DEPT_A = {
  id:                 DEPT_ID,
  tenantId:           TENANT_A,
  entityId:           ENTITY_A,
  code:               '25',
  name:               'ISO Test Dept',
  canonical:          false,
  status:             'ACTIVE',
  version:            1,
  deactivatedAt:      null,
  deactivatedBy:      null,
  deactivationReason: null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
};

/**
 * Prisma mock enforcing isolation:
 * - findFirst returns data only when tenantId === TENANT_A
 * - findMany/count return empty when tenantId !== TENANT_A
 */
function isolatingPrisma() {
  const client: any = {
    department: {
      findFirst: async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return DEPT_A;
        return null;
      },
      findMany: async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return [DEPT_A];
        return [];
      },
      count: async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return 1;
        return 0;
      },
      create: async ({ data }: any) => ({
        ...data,
        id: DEPT_ID,
        canonical: false,
        status: 'ACTIVE',
        version: 1,
        deactivatedAt: null,
        deactivatedBy: null,
        deactivationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: async ({ data }: any) => ({ ...DEPT_A, ...data }),
    },
    legalEntity: {
      findFirst: async ({ where }: any) => {
        if (where.tenantId === TENANT_A) return { id: ENTITY_A, tenantId: TENANT_A };
        return null;
      },
    },
    tenantOutboxEvent: {
      create: async () => ({}),
    },
    auditOutboxEvent: {
      create: async () => ({}),
    },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;
}

function noopPublisher() { return { publish: async () => {} }; }

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('DepartmentService — cross-tenant isolation (ISO203)', () => {
  let svc: DepartmentService;

  beforeEach(() => {
    container.clearInstances();
    container.registerInstance('PrismaClient', isolatingPrisma());
    container.registerInstance('IEventPublisher', noopPublisher());
    svc = container.resolve(DepartmentService);
  });

  // ── List isolation ────────────────────────────────────────────────────────

  it('ISO203-1: list returns 0 items for tenant-B when tenant-A has departments', async () => {
    const result = await svc.list({ tenantId: TENANT_B, entityId: ENTITY_A });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('ISO203-2: list returns correct departments for tenant-A', async () => {
    const result = await svc.list({ tenantId: TENANT_A, entityId: ENTITY_A });
    expect(result.total).toBe(1);
    expect(result.items[0]!.id).toBe(DEPT_ID);
  });

  // ── GetById isolation ─────────────────────────────────────────────────────

  it('ISO203-3: getById throws DepartmentNotFoundError when tenant-B requests tenant-A dept', async () => {
    await expect(svc.getById(TENANT_B, ENTITY_A, DEPT_ID)).rejects.toThrow(DepartmentNotFoundError);
  });

  it('ISO203-4: getById resolves successfully for tenant-A', async () => {
    const dept = await svc.getById(TENANT_A, ENTITY_A, DEPT_ID);
    expect(dept.id).toBe(DEPT_ID);
    expect(dept.tenantId).toBe(TENANT_A);
  });

  // ── Update isolation ──────────────────────────────────────────────────────

  it('ISO203-5: update throws DepartmentNotFoundError when tenant-B tries to update tenant-A dept', async () => {
    await expect(
      svc.update(TENANT_B, ENTITY_A, DEPT_ID, { version: 1, name: 'Malicious Name' }),
    ).rejects.toThrow(DepartmentNotFoundError);
  });

  it('ISO203-6: update succeeds for tenant-A', async () => {
    const dept = await svc.update(TENANT_A, ENTITY_A, DEPT_ID, { version: 1, name: 'Renamed' });
    expect(dept.tenantId).toBe(TENANT_A);
  });

  // ── Deactivate isolation ──────────────────────────────────────────────────

  it('ISO203-7: deactivate throws DepartmentNotFoundError when tenant-B tries to deactivate tenant-A dept', async () => {
    await expect(
      svc.deactivate(TENANT_B, ENTITY_A, DEPT_ID, { version: 1, reason: 'Attack', deactivatedBy: 'hacker' }),
    ).rejects.toThrow(DepartmentNotFoundError);
  });

  it('ISO203-8: deactivate succeeds for tenant-A', async () => {
    const dept = await svc.deactivate(TENANT_A, ENTITY_A, DEPT_ID, {
      version: 1, reason: 'Consolidation', deactivatedBy: 'admin',
    });
    expect(dept.status).toBe('INACTIVE');
  });

  // ── Create isolation (entity check) ──────────────────────────────────────

  it('ISO203-9: create throws ORPHAN_DEPARTMENT when tenant-B tries to create dept under tenant-A entity', async () => {
    // legalEntity.findFirst returns null for tenant-B → ORPHAN_DEPARTMENT
    await expect(
      svc.create({ tenantId: TENANT_B, entityId: ENTITY_A, code: '30', name: 'Shadow Dept' }),
    ).rejects.toMatchObject({ code: 'ORPHAN_DEPARTMENT' });
  });
});
