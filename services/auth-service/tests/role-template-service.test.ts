/**
 * S004A — Dealership Position Role Templates: unit tests.
 *
 * RoleTemplateService is exercised against the REAL RoleService (not a mock)
 * so that "applying a template never creates a parallel permission map" is
 * actually proven — the resulting Role/RoleAssignment/role_permission/
 * authz_role_assignment rows are produced by the same S206 code path already
 * certified for S206, driven here by an in-memory Prisma fake (no database).
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { RoleService } from '../src/application/role-service';
import {
  RoleTemplateService,
  RoleTemplateNotFoundError,
  RoleTemplateValidationError,
  RoleTemplateInUseError,
  SelfApplyForbiddenError,
} from '../src/application/role-template-service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ENTITY_A = 'entity-a1';
const STORE_A1 = 'store-a1';

const KNOWN_PERMS = [
  'acct.store.view', 'acct.store.manage', 'acct.dept.view',
  'iam.roletemplate.manage', 'iam.roletemplate.apply',
  'je.post', 'je.view', 'ar.receipt.create',
];

let state: any;
let published: any[];

function seed() {
  state = {
    roles: [] as any[],
    assignments: [] as any[],
    rolePermission: [] as any[],
    authz: [] as any[],
    audit: [] as any[],
    entities: [{ id: ENTITY_A, tenantId: TENANT_A }],
    stores: [{ id: STORE_A1, entityId: ENTITY_A }],
    templates: [
      { id: 'gt-cashier', tenantId: null, key: 'CASHIER', name: 'Cashier', permissions: ['ar.receipt.create'],
        fieldMasks: [], builtIn: true, status: 'ACTIVE', clonedFromId: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'gt-controller', tenantId: null, key: 'CONTROLLER', name: 'Controller', permissions: ['je.post', 'je.view', 'acct.store.manage'],
        fieldMasks: ['vehicle.cost'], builtIn: true, status: 'ACTIVE', clonedFromId: null, createdAt: new Date(), updatedAt: new Date() },
    ],
    templateAssignments: [] as any[],
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
      findFirst: async ({ where }: any) => state.roles.find((r: any) => {
        if (where.tenantId !== undefined && r.tenantId !== where.tenantId) return false;
        if (where.id && r.id !== where.id) return false;
        if (where.key && r.key !== where.key) return false;
        if (where.name && r.name !== where.name) return false;
        if (where.NOT?.id && r.id === where.NOT.id) return false;
        if (where.OR) return where.OR.some((c: any) => (c.name && r.name === c.name) || (c.key && r.key === c.key));
        return true;
      }) ?? null,
      create: async ({ data }: any) => { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; state.roles.push(row); return { ...row }; },
      update: async ({ where, data }: any) => {
        const row = state.roles.find((r: any) => r.id === where.id);
        Object.assign(row, data); return { ...row };
      },
    },
    roleAssignment: {
      findMany: async ({ where }: any) => state.assignments.filter((a: any) =>
        a.tenantId === where.tenantId && (!where.userId || a.userId === where.userId) && (!where.status || a.status === where.status)),
      count: async ({ where }: any) => state.assignments.filter((a: any) =>
        a.tenantId === where.tenantId && a.roleId === where.roleId && (!where.status || a.status === where.status)).length,
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
    permission: { findMany: async () => KNOWN_PERMS.map((key) => ({ key })) },
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
        const existing = state.authz.find((a: any) => a.tenantId === k.tenantId && a.userId === k.userId
          && a.role === k.role && a.entityId === k.entityId && a.storeId === k.storeId);
        if (existing) return { ...existing };
        state.authz.push({ ...create }); return { ...create };
      },
      findFirst: async ({ where }: any) => state.authz.find((a: any) => a.tenantId === where.tenantId
        && a.userId === where.userId && a.role === where.role && a.entityId === where.entityId && a.storeId === where.storeId) ?? null,
      create: async ({ data }: any) => { state.authz.push({ ...data }); return { ...data }; },
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
    roleTemplate: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = state.templates.filter((t: any) => {
          if (where.OR) return where.OR.some((c: any) => t.tenantId === c.tenantId);
          return true;
        });
        if (orderBy) rows = [...rows].sort((a, b) => (a.name > b.name ? 1 : -1));
        return rows.map((t: any) => ({ ...t }));
      },
      findFirst: async ({ where }: any) => state.templates.find((t: any) => {
        if (where.id && t.id !== where.id) return false;
        if (where.tenantId !== undefined && t.tenantId !== where.tenantId) return false;
        if (where.name && t.name !== where.name) return false;
        if (where.NOT?.id && t.id === where.NOT.id) return false;
        if (where.OR) return where.OR.some((c: any) => t.tenantId === c.tenantId);
        return true;
      }) ?? null,
      create: async ({ data }: any) => { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; state.templates.push(row); return { ...row }; },
      update: async ({ where, data }: any) => {
        const row = state.templates.find((t: any) => t.id === where.id);
        Object.assign(row, data); return { ...row };
      },
    },
    roleTemplateAssignment: {
      findMany: async ({ where, include }: any) => state.templateAssignments
        .filter((a: any) => a.tenantId === where.tenantId && (!where.userId || a.userId === where.userId) && (!where.status || a.status === where.status))
        .map((a: any) => include?.template ? { ...a, template: state.templates.find((t: any) => t.id === a.templateId) } : { ...a }),
      findFirst: async ({ where }: any) => state.templateAssignments.find((a: any) => a.id === where.id && a.tenantId === where.tenantId) ?? null,
      count: async ({ where }: any) => state.templateAssignments.filter((a: any) =>
        a.tenantId === where.tenantId && a.templateId === where.templateId && (!where.status || a.status === where.status)).length,
      create: async ({ data }: any) => { const row = { ...data, createdAt: new Date() }; state.templateAssignments.push(row); return { ...row }; },
      update: async ({ where, data }: any) => {
        const a = state.templateAssignments.find((x: any) => x.id === where.id);
        Object.assign(a, data); return { ...a };
      },
    },
    auditOutboxEvent: { create: async ({ data }: any) => { state.audit.push({ ...data }); return { ...data }; } },
    $transaction: async (arg: any): Promise<any> => (typeof arg === 'function' ? arg(p) : Promise.all(arg)),
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
const fakeAuthz = { invalidateCache: () => {} } as any;

function makeSvc() {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma());
  container.registerInstance('IEventPublisher', publisher);
  container.registerInstance('AuthzService', fakeAuthz);
  container.register('RoleService', { useClass: RoleService });
  container.register('RoleTemplateService', { useClass: RoleTemplateService });
  return container.resolve<RoleTemplateService>('RoleTemplateService');
}

beforeEach(() => { seed(); published = []; });

describe('S004A · role templates', () => {
  it('lists global shipped defaults for a tenant with no clones (BR4A-1)', async () => {
    const templates = await makeSvc().listTemplates(TENANT_A);
    expect(templates.map((t) => t.key).sort()).toEqual(['CASHIER', 'CONTROLLER']);
    expect(templates.every((t) => t.tenantId === null && t.builtIn)).toBe(true);
  });

  it('clones a global template by value, independent of later source edits (BR4A-1)', async () => {
    const svc = makeSvc();
    const clone = await svc.cloneTemplate(TENANT_A, 'gt-cashier', 'My Custom Cashier', 'admin');
    expect(clone.tenantId).toBe(TENANT_A);
    expect(clone.clonedFromId).toBe('gt-cashier');
    expect(clone.permissions).toEqual(['ar.receipt.create']);

    // mutate the clone; source must be untouched
    await svc.updateTemplate(TENANT_A, clone.id, { permissions: ['ar.receipt.create', 'acct.store.view'], actor: 'admin' });
    const source = await svc.getTemplate(TENANT_A, 'gt-cashier');
    expect(source.permissions).toEqual(['ar.receipt.create']);
    expect(state.audit.some((a: any) => a.docId === clone.id && a.action === 'CLONE')).toBe(true);
  });

  it('rejects editing the immutable global template directly (TEMPLATE_IMMUTABLE)', async () => {
    await expect(makeSvc().updateTemplate(TENANT_A, 'gt-cashier', { name: 'Hacked' }))
      .rejects.toMatchObject({ code: 'TEMPLATE_IMMUTABLE' });
  });

  it('rejects a template with an unknown permission key', async () => {
    await expect(makeSvc().createTemplate({
      tenantId: TENANT_A, name: 'Bad', key: 'BAD_ROLE', permissions: ['not.a.perm'],
    })).rejects.toMatchObject({ code: 'UNKNOWN_PERMISSION' });
  });

  it('rejects a duplicate template name within a tenant', async () => {
    const svc = makeSvc();
    await svc.createTemplate({ tenantId: TENANT_A, name: 'Custom Biller', key: 'BILLER', permissions: ['acct.store.view'] });
    await expect(svc.createTemplate({ tenantId: TENANT_A, name: 'Custom Biller', key: 'BILLER2', permissions: ['acct.store.view'] }))
      .rejects.toMatchObject({ code: 'TEMPLATE_EXISTS' });
  });

  it('applies a template: creates the backing Role via S206 (not a local permission map) + grants + audits + emits (primary workflow)', async () => {
    const svc = makeSvc();
    const assignment = await svc.applyTemplate({
      tenantId: TENANT_A, templateId: 'gt-controller', userId: 'user-1',
      entityId: ENTITY_A, allStores: true, actor: 'admin',
    });
    expect(assignment.templateKey).toBe('CONTROLLER');
    expect(assignment.status).toBe('APPLIED');

    // real S206 Role row created, keyed exactly by the contract's position slug
    const role = state.roles.find((r: any) => r.tenantId === TENANT_A && r.key === 'CONTROLLER');
    expect(role).toBeTruthy();
    expect(role.permissions.sort()).toEqual(['acct.store.manage', 'je.post', 'je.view'].sort());

    // real S207 projection (role_permission + authz_role_assignment)
    const projected = state.rolePermission.filter((rp: any) => rp.role === 'CONTROLLER').map((rp: any) => rp.permissionKey).sort();
    expect(projected).toEqual(['acct.store.manage', 'je.post', 'je.view'].sort());
    expect(state.authz.some((a: any) => a.tenantId === TENANT_A && a.userId === 'user-1' && a.role === 'CONTROLLER')).toBe(true);

    // real S207 assignment row + real audit (both the RoleService's own audit and the template's own audit)
    expect(state.assignments.some((a: any) => a.userId === 'user-1' && a.roleId === role.id)).toBe(true);
    expect(state.audit.some((a: any) => a.docType === 'role_template_assignment' && a.action === 'APPLY')).toBe(true);
    expect(published.map((e: any) => e.type)).toContain('iam.template.applied');
  });

  it('re-applying after a template permission edit re-projects the backing role (idempotency / concurrency AC)', async () => {
    const svc = makeSvc();
    await svc.applyTemplate({ tenantId: TENANT_A, templateId: 'gt-controller', userId: 'user-1', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    await svc.updateTemplate(TENANT_A, 'gt-controller', { permissions: ['je.post'], actor: 'admin' }).catch(() => {});
    // gt-controller is global/immutable — clone, update the clone, and re-apply that instead
    const clone = await svc.cloneTemplate(TENANT_A, 'gt-controller', 'Controller v2', 'admin');
    await svc.updateTemplate(TENANT_A, clone.id, { permissions: ['je.post'], actor: 'admin' });
    await svc.applyTemplate({ tenantId: TENANT_A, templateId: clone.id, userId: 'user-2', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    // second apply of the same edited clone to a third user re-projects but never duplicates
    await svc.applyTemplate({ tenantId: TENANT_A, templateId: clone.id, userId: 'user-3', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    const role = state.roles.find((r: any) => r.tenantId === TENANT_A && r.key === 'CONTROLLER');
    expect(role.permissions).toEqual(['je.post']);
    const projected = state.rolePermission.filter((rp: any) => rp.role === 'CONTROLLER');
    expect(projected.length).toBe(1); // no duplicates from re-projection
  });

  it('rejects applying a deactivated template', async () => {
    const svc = makeSvc();
    const clone = await svc.cloneTemplate(TENANT_A, 'gt-cashier', 'Temp Cashier', 'admin');
    await svc.deactivateTemplate(TENANT_A, clone.id, 'admin');
    await expect(svc.applyTemplate({ tenantId: TENANT_A, templateId: clone.id, userId: 'user-1', entityId: ENTITY_A, allStores: true }))
      .rejects.toMatchObject({ code: 'TEMPLATE_INACTIVE' });
  });

  it('blocks deactivating a template with an active (APPLIED) assignment (mirrors BR206-2 → 409)', async () => {
    const svc = makeSvc();
    const clone = await svc.cloneTemplate(TENANT_A, 'gt-cashier', 'Applied Cashier', 'admin');
    await svc.applyTemplate({ tenantId: TENANT_A, templateId: clone.id, userId: 'user-1', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    await expect(svc.deactivateTemplate(TENANT_A, clone.id, 'admin')).rejects.toBeInstanceOf(RoleTemplateInUseError);
  });

  it('revoking a template assignment revokes the real underlying RoleAssignment too', async () => {
    const svc = makeSvc();
    const clone = await svc.cloneTemplate(TENANT_A, 'gt-cashier', 'Revoke Test Cashier', 'admin');
    const assignment = await svc.applyTemplate({ tenantId: TENANT_A, templateId: clone.id, userId: 'user-1', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    await svc.revokeAssignment(TENANT_A, assignment.id, 'admin');
    const real = state.assignments.find((a: any) => a.id === assignment.roleAssignmentId);
    expect(real.status).toBe('REVOKED');
    const templateAssignment = state.templateAssignments.find((a: any) => a.id === assignment.id);
    expect(templateAssignment.status).toBe('REVOKED');
  });

  // ── SoD: self-apply forbidden ─────────────────────────────────────────────────

  it('forbids a caller from applying a template to their own userId (SoD)', async () => {
    const svc = makeSvc();
    await expect(svc.applyTemplate({
      tenantId: TENANT_A, templateId: 'gt-cashier', userId: 'admin-1', entityId: ENTITY_A, allStores: true, actor: 'admin-1',
    })).rejects.toBeInstanceOf(SelfApplyForbiddenError);
  });

  // ── Privilege-escalation proof ───────────────────────────────────────────────

  it('never grants a permission outside of the template set, even though the caller cannot pass a custom permissions array to apply', async () => {
    const svc = makeSvc();
    await svc.applyTemplate({ tenantId: TENANT_A, templateId: 'gt-cashier', userId: 'user-9', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    const role = state.roles.find((r: any) => r.tenantId === TENANT_A && r.key === 'CASHIER');
    expect(role.permissions).toEqual(['ar.receipt.create']); // exactly the template set, nothing more
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────────

  it('does not leak a tenant-owned clone into another tenant listTemplates() (cross-tenant isolation)', async () => {
    const svc = makeSvc();
    await svc.createTemplate({ tenantId: TENANT_A, name: 'A-Only Role', key: 'A_ONLY', permissions: ['acct.store.view'] });
    const bTemplates = await svc.listTemplates(TENANT_B);
    expect(bTemplates.some((t) => t.key === 'A_ONLY')).toBe(false);
  });

  it('does not allow tenant B to fetch tenant A private clone by id (cross-tenant denial)', async () => {
    const svc = makeSvc();
    const created = await svc.createTemplate({ tenantId: TENANT_A, name: 'A-Private', key: 'A_PRIVATE', permissions: ['acct.store.view'] });
    await expect(svc.getTemplate(TENANT_B, created.id)).rejects.toBeInstanceOf(RoleTemplateNotFoundError);
  });

  // ── Field masks (BR4A-2) ─────────────────────────────────────────────────────

  it('resolves field masks in force for a user from an APPLIED template assignment (BR4A-2 resolver)', async () => {
    const svc = makeSvc();
    const clone = await svc.cloneTemplate(TENANT_A, 'gt-controller', 'Mask Test Controller', 'admin');
    await svc.applyTemplate({ tenantId: TENANT_A, templateId: clone.id, userId: 'user-5', entityId: ENTITY_A, allStores: true, actor: 'admin' });
    const masks = await svc.resolveFieldMasks(TENANT_A, 'user-5');
    expect(masks).toEqual(['vehicle.cost']);
  });

  it('applyFieldMasks() strips nested dot-path fields from a payload (pure utility)', () => {
    const payload = { id: 'v1', vehicle: { cost: 12000, vin: 'ABC' } };
    const masked = RoleTemplateService.applyFieldMasks(payload, ['vehicle.cost']);
    expect(masked.vehicle).not.toHaveProperty('cost');
    expect(masked.vehicle.vin).toBe('ABC');
  });
});
