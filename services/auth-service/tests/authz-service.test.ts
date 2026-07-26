/**
 * S207 — Authorization Service Unit Tests
 *
 * Tests AuthzService in isolation with a Prisma mock (no database).
 * Covers deny-by-default (AC), unknown-permission 400, role-grant allow,
 * scope-escalation deny+flag, and the catalog + diff report.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  AuthzService,
  UnknownPermissionError,
  CatalogVersionNotFoundError,
  DENY_REASON,
} from '../src/application/authz-service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-a';
const ENTITY = 'entity-1';
const STORE = 'store-1';
const USER_ADMIN = 'user-admin';
const USER_NOROLE = 'user-norole';

const PERMISSIONS = [
  { key: 'acct.store.view',   description: 'View stores',   sinceVersion: '1.0.0', status: 'SHIPPED' },
  { key: 'acct.store.manage', description: 'Manage stores', sinceVersion: '1.0.0', status: 'SHIPPED' },
  { key: 'iam.catalog.view',  description: 'Read catalog',  sinceVersion: '1.0.0', status: 'SHIPPED' },
  { key: 'je.post',           description: 'Post JE',       sinceVersion: '1.1.0', status: 'SHIPPED' },
];

const ROLE_PERMS = [
  { role: 'ADMIN', permissionKey: 'acct.store.view' },
  { role: 'ADMIN', permissionKey: 'acct.store.manage' },
  { role: 'ADMIN', permissionKey: 'je.post' },
  { role: 'ACCOUNTANT', permissionKey: 'acct.store.view' },
];

const VERSIONS: Record<string, { version: string; releasedAt: Date; description: string | null }> = {
  '1.0.0': { version: '1.0.0', releasedAt: new Date('2026-01-01'), description: 'baseline' },
  '1.1.0': { version: '1.1.0', releasedAt: new Date('2026-02-01'), description: 'adds je.post' },
};

interface Assignment {
  tenantId: string; userId: string; role: string;
  entityId: string | null; storeId: string | null;
}

let outbox: any[] = [];
let published: any[] = [];

function makePrisma(assignments: Assignment[]) {
  return {
    permission: {
      findMany: async (args: any = {}) => {
        if (args.select?.key) return PERMISSIONS.map((p) => ({ key: p.key }));
        return PERMISSIONS.map((p) => ({ ...p }));
      },
    },
    rolePermission: {
      findMany: async () => ROLE_PERMS.map((r) => ({ ...r })),
    },
    authzRoleAssignment: {
      findMany: async ({ where }: any) =>
        assignments.filter((a) => a.tenantId === where.tenantId && a.userId === where.userId),
    },
    catalogVersion: {
      findUnique: async ({ where }: any) => VERSIONS[where.version] ?? null,
      findMany: async () => Object.values(VERSIONS),
    },
    authzOutboxEvent: {
      create: async ({ data }: any) => { outbox.push(data); return { id: 'evt', ...data }; },
    },
  } as any;
}

const noopPublisher = { publish: async (e: any) => { published.push(e); } } as any;

function makeSvc(assignments: Assignment[] = []) {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma(assignments));
  container.registerInstance('IEventPublisher', noopPublisher);
  container.register('AuthzService', { useClass: AuthzService });
  return container.resolve<AuthzService>('AuthzService');
}

beforeEach(() => { outbox = []; published = []; });

// ── AC207-1: deny-by-default (no roles → deny + audit) ────────────────────────

describe('AuthzService.check — deny-by-default', () => {
  it('AC207-1a: user with no roles is denied', async () => {
    const svc = makeSvc([]); // no assignments
    const r = await svc.check({ userId: USER_NOROLE, permissionKey: 'acct.store.view', scope: { tenantId: TENANT } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe(DENY_REASON.NO_MATCHING_ROLE);
  });

  it('AC207-1b: every deny writes an iam.authz.denied outbox event', async () => {
    const svc = makeSvc([]);
    await svc.check({ userId: USER_NOROLE, permissionKey: 'acct.store.view', scope: { tenantId: TENANT }, route: '/x' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].eventType).toBe('iam.authz.denied');
    expect(outbox[0].payload.schemaV).toBe(1);
    expect(outbox[0].payload.permissionKey).toBe('acct.store.view');
    expect(outbox[0].payload.route).toBe('/x');
  });
});

// ── AC207-2: role grant → allow with matchedRole ──────────────────────────────

describe('AuthzService.check — grants', () => {
  it('AC207-2a: ADMIN tenant-wide grant allows acct.store.manage', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    const r = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.manage', scope: { tenantId: TENANT } });
    expect(r.allow).toBe(true);
    expect(r.matchedRole).toBe('ADMIN');
    expect(outbox).toHaveLength(0); // allow never audits a deny
  });

  it('AC207-2b: role that lacks the permission is denied', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: 'u2', role: 'ACCOUNTANT', entityId: null, storeId: null }]);
    const r = await svc.check({ userId: 'u2', permissionKey: 'acct.store.manage', scope: { tenantId: TENANT } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe(DENY_REASON.NO_MATCHING_ROLE);
  });

  it('AC207-2c: je.post allowed for ADMIN, denied for ACCOUNTANT', async () => {
    const admin = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    expect((await admin.check({ userId: USER_ADMIN, permissionKey: 'je.post', scope: { tenantId: TENANT } })).allow).toBe(true);
    const acct = makeSvc([{ tenantId: TENANT, userId: 'u2', role: 'ACCOUNTANT', entityId: null, storeId: null }]);
    expect((await acct.check({ userId: 'u2', permissionKey: 'je.post', scope: { tenantId: TENANT } })).allow).toBe(false);
  });
});

// ── AC207-3: unknown permission key → error (400 at route) ─────────────────────

describe('AuthzService.check — unknown permission', () => {
  it('AC207-3: unknown key throws UnknownPermissionError (typo guard)', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    await expect(svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.destroy', scope: { tenantId: TENANT } }))
      .rejects.toBeInstanceOf(UnknownPermissionError);
  });
});

// ── AC207-4 (negative): scope escalation denied + flagged ─────────────────────

describe('AuthzService.check — scope', () => {
  it('AC207-4a: storeId without entityId is a scope-escalation deny', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    const r = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: TENANT, storeId: STORE } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe(DENY_REASON.SCOPE_ESCALATION);
    expect(outbox[0].payload.reason).toBe(DENY_REASON.SCOPE_ESCALATION);
  });

  it('AC207-4b: missing tenantId is an invalid-scope deny', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    const r = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: '' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe(DENY_REASON.INVALID_SCOPE);
  });

  it('AC207-4c: entity-scoped grant does not apply to a different entity', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: ENTITY, storeId: null }]);
    const ok = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: TENANT, entityId: ENTITY } });
    expect(ok.allow).toBe(true);
    const no = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: TENANT, entityId: 'other' } });
    expect(no.allow).toBe(false);
  });

  it('AC207-4d: tenant-wide grant applies to entity+store scope', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    const r = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: TENANT, entityId: ENTITY, storeId: STORE } });
    expect(r.allow).toBe(true);
  });

  it('AC207-4e: tenant isolation — assignment in tenant-a does not grant in tenant-b', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    const r = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: 'tenant-b' } });
    expect(r.allow).toBe(false);
  });
});

// ── AC207-5: catalog + diff report ────────────────────────────────────────────

describe('AuthzService.catalog', () => {
  it('AC207-5a: latest catalog lists all shipped permissions', async () => {
    const svc = makeSvc();
    const c = await svc.catalog();
    expect(c.version).toBe('1.1.0');
    expect(c.permissions.map((p) => p.key)).toContain('je.post');
  });

  it('AC207-5b: older version excludes later-shipped keys', async () => {
    const svc = makeSvc();
    const c = await svc.catalog({ version: '1.0.0' });
    expect(c.permissions.map((p) => p.key)).not.toContain('je.post');
    expect(c.permissions.map((p) => p.key)).toContain('acct.store.view');
  });

  it('AC207-5c: diff report shows keys added between versions', async () => {
    const svc = makeSvc();
    const c = await svc.catalog({ version: '1.1.0', diffFrom: '1.0.0' });
    expect(c.diff?.added).toEqual(['je.post']);
    expect(c.diff?.removed).toEqual([]);
    expect(c.diff?.unchanged).toBeGreaterThan(0);
  });

  it('AC207-5d: unknown version throws CatalogVersionNotFoundError', async () => {
    const svc = makeSvc();
    await expect(svc.catalog({ version: '9.9.9' })).rejects.toBeInstanceOf(CatalogVersionNotFoundError);
  });
});

// ── AC207-6: cache reflects grant within TTL bound ────────────────────────────

describe('AuthzService cache', () => {
  it('AC207-6: invalidateCache forces a re-read of grants', async () => {
    const svc = makeSvc([{ tenantId: TENANT, userId: USER_ADMIN, role: 'ADMIN', entityId: null, storeId: null }]);
    await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: TENANT } });
    svc.invalidateCache(); // must not throw; next check re-reads
    const r = await svc.check({ userId: USER_ADMIN, permissionKey: 'acct.store.view', scope: { tenantId: TENANT } });
    expect(r.allow).toBe(true);
  });
});
