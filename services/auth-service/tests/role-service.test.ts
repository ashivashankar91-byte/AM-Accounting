/**
 * S206 — Role Management Service Unit Tests
 *
 * Tests RoleService in isolation with an in-memory Prisma mock (no database).
 * Covers BR206-1..4 and the §3 acceptance criteria including the negative paths:
 * retire-while-assigned (409), assign-outside-entity (422), store scoping, and
 * the projection into the S207 read models + AuditPort/event emission (§11).
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  RoleService,
  RoleValidationError,
  RoleInUseError,
  AssignmentScopeError,
} from '../src/application/role-service';

const TENANT = 'tenant-a';
const ENTITY = 'entity-1';
const STORE_01 = 'store-01';
const STORE_02 = 'store-02';

const KNOWN_PERMS = [
  'acct.entity.view', 'acct.store.view', 'acct.store.manage',
  'acct.dept.view', 'acct.franchise.view', 'iam.catalog.view',
  'iam.role.view', 'iam.role.manage', 'iam.role.assign', 'je.post',
];

let state: any;
let published: any[];
let invalidated: number;

function seed() {
  state = {
    roles: [
      { id: 'r-admin', tenantId: TENANT, key: 'ADMIN', name: 'Administrator',
        permissions: ['acct.store.manage', 'iam.role.manage'], builtIn: true, status: 'ACTIVE',
        createdAt: new Date(), updatedAt: new Date() },
      { id: 'r-acct', tenantId: TENANT, key: 'ACCOUNTANT', name: 'Accountant',
        permissions: ['acct.store.view'], builtIn: true, status: 'ACTIVE',
        createdAt: new Date(), updatedAt: new Date() },
    ],
    assignments: [] as any[],
    rolePermission: [] as any[],
    authz: [] as any[],
    audit: [] as any[],
    entities: [{ id: ENTITY, tenantId: TENANT }],
    stores: [{ id: STORE_01, entityId: ENTITY }, { id: STORE_02, entityId: ENTITY }],
  };
}

function makePrisma() {
  const p: any = {
    role: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = state.roles.filter((r: any) => r.tenantId === where.tenantId);
        if (orderBy?.name) rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        return rows.map((r: any) => ({ ...r }));
      },
      findFirst: async ({ where }: any) => {
        return state.roles.find((r: any) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.id && r.id !== where.id) return false;
          if (where.name && r.name !== where.name) return false;
          if (where.NOT?.id && r.id === where.NOT.id) return false;
          if (where.OR) {
            return where.OR.some((c: any) => (c.name && r.name === c.name) || (c.key && r.key === c.key));
          }
          return true;
        }) ?? null;
      },
      create: async ({ data }: any) => { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; state.roles.push(row); return { ...row }; },
      update: async ({ where, data }: any) => {
        const row = state.roles.find((r: any) => r.id === where.id);
        Object.assign(row, data); return { ...row };
      },
    },
    roleAssignment: {
      findMany: async ({ where }: any) => state.assignments.filter((a: any) =>
        a.tenantId === where.tenantId &&
        (!where.userId || a.userId === where.userId) &&
        (!where.status || a.status === where.status)),
      count: async ({ where }: any) => state.assignments.filter((a: any) =>
        a.tenantId === where.tenantId && a.roleId === where.roleId &&
        (!where.status || a.status === where.status)).length,
      findFirst: async ({ where }: any) => {
        const a = state.assignments.find((x: any) => x.id === where.id && x.tenantId === where.tenantId);
        if (!a) return null;
        const role = state.roles.find((r: any) => r.id === a.roleId);
        return { ...a, role: { ...role } };
      },
      create: async ({ data }: any) => { const row = { ...data, createdAt: new Date() }; state.assignments.push(row); return { ...row }; },
      update: async ({ where, data }: any) => {
        const a = state.assignments.find((x: any) => x.id === where.id);
        Object.assign(a, data); return { ...a };
      },
    },
    permission: {
      findMany: async () => KNOWN_PERMS.map((key) => ({ key })),
    },
    rolePermission: {
      deleteMany: async ({ where }: any) => {
        const before = state.rolePermission.length;
        state.rolePermission = state.rolePermission.filter((rp: any) => rp.role !== where.role);
        return { count: before - state.rolePermission.length };
      },
      createMany: async ({ data }: any) => {
        for (const d of data) {
          if (!state.rolePermission.some((rp: any) => rp.role === d.role && rp.permissionKey === d.permissionKey)) {
            state.rolePermission.push({ ...d });
          }
        }
        return { count: data.length };
      },
    },
    authzRoleAssignment: {
      upsert: async ({ where, create }: any) => {
        const k = where.authz_assignment_unique;
        const existing = state.authz.find((a: any) =>
          a.tenantId === k.tenantId && a.userId === k.userId && a.role === k.role &&
          a.entityId === k.entityId && a.storeId === k.storeId);
        if (existing) return { ...existing };
        state.authz.push({ ...create }); return { ...create };
      },
      findFirst: async ({ where }: any) => {
        return state.authz.find((a: any) =>
          a.tenantId === where.tenantId && a.userId === where.userId && a.role === where.role &&
          a.entityId === where.entityId && a.storeId === where.storeId) ?? null;
      },
      create: async ({ data }: any) => {
        state.authz.push({ ...data });
        return { ...data };
      },
      deleteMany: async ({ where }: any) => {
        const before = state.authz.length;
        state.authz = state.authz.filter((a: any) => {
          if (a.tenantId !== where.tenantId || a.userId !== where.userId || a.role !== where.role || a.entityId !== where.entityId) return true;
          if (where.storeId === null) return a.storeId !== null;
          if (where.storeId?.in) return !where.storeId.in.includes(a.storeId);
          return true;
        });
        return { count: before - state.authz.length };
      },
    },
    auditOutboxEvent: {
      create: async ({ data }: any) => { state.audit.push({ ...data }); return { ...data }; },
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join(' ');
      if (sql.includes('legal_entities')) {
        const [entityId, tenantId] = values;
        return state.entities.filter((e: any) => e.id === entityId && e.tenantId === tenantId).map((e: any) => ({ id: e.id }));
      }
      if (sql.includes('stores')) {
        const [entityId, storeIds] = values;
        return state.stores.filter((s: any) => s.entityId === entityId && storeIds.includes(s.id)).map((s: any) => ({ id: s.id }));
      }
      return [];
    },
  };
  return p;
}

const publisher = { publish: async (e: any) => { published.push(e); } } as any;
const fakeAuthz = { invalidateCache: () => { invalidated++; } } as any;

function makeSvc() {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma());
  container.registerInstance('IEventPublisher', publisher);
  container.registerInstance('AuthzService', fakeAuthz);
  container.register('RoleService', { useClass: RoleService });
  return container.resolve<RoleService>('RoleService');
}

beforeEach(() => { seed(); published = []; invalidated = 0; });

// ── BR206-4: starter roles ──────────────────────────────────────────────────

describe('S206 · roles', () => {
  it('lists builtIn starter roles (BR206-4)', async () => {
    const roles = await makeSvc().listRoles(TENANT);
    expect(roles.map((r) => r.key).sort()).toEqual(['ACCOUNTANT', 'ADMIN']);
    expect(roles.every((r) => r.builtIn)).toBe(true);
  });

  // ── BR206-1: role = set of catalog permissions ──────────────────────────────

  it('creates a role and projects its permissions + emits event + audit (BR206-1)', async () => {
    const svc = makeSvc();
    const role = await svc.createRole({
      tenantId: TENANT, name: 'Sales Manager',
      permissions: ['acct.store.view', 'acct.store.manage'], actor: 'admin',
    });
    expect(role.key).toBe('SALES_MANAGER');
    expect(role.builtIn).toBe(false);
    // projection into S207 role_permission
    const projected = state.rolePermission.filter((rp: any) => rp.role === 'SALES_MANAGER').map((rp: any) => rp.permissionKey).sort();
    expect(projected).toEqual(['acct.store.manage', 'acct.store.view']);
    // §9 event + §11 audit + cache invalidation
    expect(published.map((e) => e.type)).toContain('iam.role.created');
    expect(state.audit.at(-1)).toMatchObject({ docType: 'role', action: 'CREATE', actor: 'admin' });
    expect(invalidated).toBeGreaterThan(0);
  });

  it('rejects unknown permission keys', async () => {
    await expect(makeSvc().createRole({
      tenantId: TENANT, name: 'Bad Role', permissions: ['acct.store.view', 'not.a.perm'],
    })).rejects.toMatchObject({ code: 'UNKNOWN_PERMISSION' });
  });

  it('rejects an empty permission set (BR206-1)', async () => {
    await expect(makeSvc().createRole({ tenantId: TENANT, name: 'Empty', permissions: [] }))
      .rejects.toMatchObject({ code: 'EMPTY_PERMISSIONS' });
  });

  it('rejects a duplicate role name (unique per tenant)', async () => {
    await expect(makeSvc().createRole({
      tenantId: TENANT, name: 'Administrator', permissions: ['acct.store.view'],
    })).rejects.toMatchObject({ code: 'ROLE_EXISTS' });
  });

  it('rejects a name longer than 60 chars', async () => {
    await expect(makeSvc().createRole({
      tenantId: TENANT, name: 'x'.repeat(61), permissions: ['acct.store.view'],
    })).rejects.toBeInstanceOf(RoleValidationError);
  });

  // ── AC: role edit removing a permission → affected users change within 5s ────

  it('updates permissions, re-projects, and invalidates the authz cache (AC)', async () => {
    const svc = makeSvc();
    await svc.updateRole(TENANT, 'r-admin', { permissions: ['acct.store.view'], actor: 'admin' });
    const projected = state.rolePermission.filter((rp: any) => rp.role === 'ADMIN').map((rp: any) => rp.permissionKey);
    expect(projected).toEqual(['acct.store.view']);          // manage removed
    expect(published.map((e) => e.type)).toContain('iam.role.updated');
    expect(invalidated).toBeGreaterThan(0);                  // propagation ≤ 5s
    expect(state.audit.at(-1)).toMatchObject({ action: 'UPDATE' });
  });

  // ── BR206-2: deletion blocked while assigned ────────────────────────────────

  it('blocks retiring a role that is still assigned (BR206-2 → 409)', async () => {
    const svc = makeSvc();
    state.assignments.push({ id: 'a1', tenantId: TENANT, userId: 'u1', roleId: 'r-acct',
      entityId: ENTITY, storeIds: [], allStores: true, status: 'GRANTED' });
    await expect(svc.retireRole(TENANT, 'r-acct', 'admin')).rejects.toBeInstanceOf(RoleInUseError);
    expect(state.roles.find((r: any) => r.id === 'r-acct').status).toBe('ACTIVE');
  });

  it('retires an unassigned role and drops its permission projection', async () => {
    const svc = makeSvc();
    state.rolePermission.push({ role: 'ACCOUNTANT', permissionKey: 'acct.store.view' });
    await svc.retireRole(TENANT, 'r-acct', 'admin');
    expect(state.roles.find((r: any) => r.id === 'r-acct').status).toBe('RETIRED');
    expect(state.rolePermission.some((rp: any) => rp.role === 'ACCOUNTANT')).toBe(false);
    expect(published.map((e) => e.type)).toContain('iam.role.retired');
  });
});

// ── Assignments ───────────────────────────────────────────────────────────────

describe('S206 · assignments', () => {
  it('grants an all-stores assignment: one entity-wide read-model row (BR206-3)', async () => {
    const svc = makeSvc();
    const a = await svc.grantAssignment({
      tenantId: TENANT, userId: 'u1', roleId: 'r-acct', entityId: ENTITY, allStores: true, actor: 'admin',
    });
    expect(a.allStores).toBe(true);
    const rows = state.authz.filter((x: any) => x.userId === 'u1' && x.role === 'ACCOUNTANT');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: ENTITY, storeId: null });
    expect(published.map((e) => e.type)).toContain('iam.assignment.granted');
    expect(state.audit.at(-1)).toMatchObject({ docType: 'role_assignment', action: 'GRANT' });
  });

  it('projects a tenant-wide (null entityId) assignment idempotently — regression: Prisma compound-unique keys cannot match NULL=NULL, so re-projection must not accumulate duplicate rows', async () => {
    const svc: any = makeSvc();
    await svc._projectAssignment(TENANT, 'u-bootstrap-admin', 'ADMIN', null, true, []);
    await svc._projectAssignment(TENANT, 'u-bootstrap-admin', 'ADMIN', null, true, []);
    const rows = state.authz.filter((x: any) => x.userId === 'u-bootstrap-admin');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: null, storeId: null, role: 'ADMIN' });
  });

  it('grants a store-scoped assignment: one read-model row per store (AC cross-store)', async () => {
    const svc = makeSvc();
    await svc.grantAssignment({
      tenantId: TENANT, userId: 'u2', roleId: 'r-acct', entityId: ENTITY, storeIds: [STORE_01], actor: 'admin',
    });
    const rows = state.authz.filter((x: any) => x.userId === 'u2');
    expect(rows.map((r: any) => r.storeId)).toEqual([STORE_01]);   // store-01 only → denied elsewhere
  });

  it('rejects an assignment for an entity outside the tenant (AC negative → 422)', async () => {
    await expect(makeSvc().grantAssignment({
      tenantId: TENANT, userId: 'u3', roleId: 'r-acct', entityId: 'entity-other', allStores: true,
    })).rejects.toMatchObject({ code: 'ENTITY_OUTSIDE_TENANT' });
  });

  it('rejects a store not belonging to the entity', async () => {
    await expect(makeSvc().grantAssignment({
      tenantId: TENANT, userId: 'u3', roleId: 'r-acct', entityId: ENTITY, storeIds: ['store-x'],
    })).rejects.toMatchObject({ code: 'STORE_OUTSIDE_ENTITY' });
  });

  it('requires a scope (storeIds or allStores)', async () => {
    await expect(makeSvc().grantAssignment({
      tenantId: TENANT, userId: 'u3', roleId: 'r-acct', entityId: ENTITY,
    })).rejects.toBeInstanceOf(AssignmentScopeError);
  });

  it('rejects assigning a retired role', async () => {
    const svc = makeSvc();
    state.roles.find((r: any) => r.id === 'r-acct').status = 'RETIRED';
    await expect(svc.grantAssignment({
      tenantId: TENANT, userId: 'u3', roleId: 'r-acct', entityId: ENTITY, allStores: true,
    })).rejects.toMatchObject({ code: 'ROLE_RETIRED' });
  });

  it('revokes an assignment and removes its read-model rows', async () => {
    const svc = makeSvc();
    const a = await svc.grantAssignment({
      tenantId: TENANT, userId: 'u4', roleId: 'r-acct', entityId: ENTITY, storeIds: [STORE_01, STORE_02], actor: 'admin',
    });
    expect(state.authz.filter((x: any) => x.userId === 'u4')).toHaveLength(2);
    await svc.revokeAssignment(TENANT, a.id, 'admin');
    expect(state.assignments.find((x: any) => x.id === a.id).status).toBe('REVOKED');
    expect(state.authz.filter((x: any) => x.userId === 'u4')).toHaveLength(0);
    expect(published.map((e) => e.type)).toContain('iam.assignment.revoked');
  });

  // ── consume iam.user.deactivated → auto-revoke ──────────────────────────────

  it('auto-revokes every assignment when a user is deactivated', async () => {
    const svc = makeSvc();
    await svc.grantAssignment({ tenantId: TENANT, userId: 'u5', roleId: 'r-acct', entityId: ENTITY, allStores: true });
    await svc.grantAssignment({ tenantId: TENANT, userId: 'u5', roleId: 'r-admin', entityId: ENTITY, storeIds: [STORE_01] });
    await svc.handleUserDeactivated(TENANT, 'u5');
    expect(state.assignments.filter((a: any) => a.userId === 'u5' && a.status === 'GRANTED')).toHaveLength(0);
    expect(state.authz.filter((x: any) => x.userId === 'u5')).toHaveLength(0);
  });
});
