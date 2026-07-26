/**
 * S205 — User Account Lifecycle Service Unit Tests
 *
 * Tests UserService in isolation with an in-memory Prisma mock (no database).
 * Covers BR205-1..4 and the §3 acceptance criteria including the negatives:
 * duplicate-email (409), last-admin-self-deactivation (422), lockout at 5 failed
 * logins, session revocation on deactivation, and the §9 events / §11 audit records.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  UserService,
  UserValidationError,
  DuplicateEmailError,
  LastAdminError,
  UserNotFoundError,
  LOCKOUT_THRESHOLD,
} from '../src/application/user-service';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

let state: any;
let published: any[];

function seed() {
  state = {
    users: [
      { id: 'admin-1', tenantId: TENANT, email: 'admin@x.io', displayName: 'Admin One',
        status: 'ACTIVE', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
      { id: 'clerk-1', tenantId: TENANT, email: 'clerk@x.io', displayName: 'Clerk One',
        status: 'ACTIVE', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
      { id: 'other-tenant-user', tenantId: OTHER_TENANT, email: 'x@y.io', displayName: 'Other',
        status: 'ACTIVE', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
    ],
    sessions: [] as any[],
    roles: [
      { id: 'r-admin', tenantId: TENANT, key: 'ADMIN', permissions: ['iam.user.manage', 'iam.user.view'] },
      { id: 'r-acct', tenantId: TENANT, key: 'ACCOUNTANT', permissions: ['acct.store.view'] },
    ],
    assignments: [
      { id: 'a-admin1', tenantId: TENANT, userId: 'admin-1', roleId: 'r-admin', status: 'GRANTED' },
      { id: 'a-clerk1', tenantId: TENANT, userId: 'clerk-1', roleId: 'r-acct', status: 'GRANTED' },
    ],
    audit: [] as any[],
  };
}

function matchUser(u: any, where: any): boolean {
  if (where.id?.in) { if (!where.id.in.includes(u.id)) return false; }
  else if (where.id && u.id !== where.id) return false;
  if (where.tenantId && u.tenantId !== where.tenantId) return false;
  if (where.email && u.email !== where.email) return false;
  if (where.status && u.status !== where.status) return false;
  return true;
}

function makePrisma() {
  return {
    user: {
      findMany: async ({ where, orderBy }: any) => {
        let rows = state.users.filter((u: any) => matchUser(u, where ?? {}));
        if (orderBy?.email) rows = [...rows].sort((a, b) => a.email.localeCompare(b.email));
        return rows.map((u: any) => ({ ...u }));
      },
      findFirst: async ({ where }: any) => {
        const u = state.users.find((x: any) => matchUser(x, where ?? {}));
        return u ? { ...u } : null;
      },
      create: async ({ data }: any) => {
        const row = { failedLogins: 0, entityScope: [], storeScope: [], version: 0,
          resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
          createdAt: new Date(), updatedAt: new Date(), ...data };
        state.users.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const u = state.users.find((x: any) => x.id === where.id);
        for (const [k, v] of Object.entries<any>(data)) {
          if (v && typeof v === 'object' && 'increment' in v) u[k] = (u[k] ?? 0) + v.increment;
          else u[k] = v;
        }
        u.updatedAt = new Date();
        return { ...u };
      },
    },
    session: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const s of state.sessions) {
          if (s.tenantId === where.tenantId && s.userId === where.userId && s.status === where.status) {
            Object.assign(s, data); count++;
          }
        }
        return { count };
      },
    },
    roleAssignment: {
      findMany: async ({ where, include }: any) => {
        const rows = state.assignments.filter((a: any) =>
          a.tenantId === where.tenantId && (!where.status || a.status === where.status));
        return rows.map((a: any) => include?.role
          ? { ...a, role: { ...state.roles.find((r: any) => r.id === a.roleId) } }
          : { ...a });
      },
    },
    auditOutboxEvent: {
      create: async ({ data }: any) => { state.audit.push({ ...data }); return { ...data }; },
    },
  } as any;
}

const publisher = { publish: async (e: any) => { published.push(e); } } as any;

function makeSvc() {
  container.clearInstances();
  container.registerInstance('PrismaClient', makePrisma());
  container.registerInstance('IEventPublisher', publisher);
  container.register('UserService', { useClass: UserService });
  return container.resolve<UserService>('UserService');
}

beforeEach(() => { seed(); published = []; });

// ── Create ────────────────────────────────────────────────────────────────────

describe('S205 · create', () => {
  it('creates a user in INVITED status, emits iam.user.created + audit CREATE', async () => {
    const svc = makeSvc();
    const u = await svc.createUser({ tenantId: TENANT, email: 'New@X.io', displayName: 'New Hire', actor: 'admin-1' });
    expect(u.status).toBe('INVITED');
    expect(u.email).toBe('new@x.io'); // normalized lowercase
    expect(published.map((e) => e.type)).toContain('iam.user.created');
    expect(state.audit.at(-1)).toMatchObject({ docType: 'user', action: 'CREATE', actor: 'admin-1' });
  });

  it('rejects a duplicate email within the tenant (BR205-1 → 409)', async () => {
    const svc = makeSvc();
    await expect(svc.createUser({ tenantId: TENANT, email: 'admin@x.io', displayName: 'Dup' }))
      .rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('allows the same email in a different tenant (tenant isolation)', async () => {
    const svc = makeSvc();
    const u = await svc.createUser({ tenantId: OTHER_TENANT, email: 'admin@x.io', displayName: 'Diff Tenant' });
    expect(u.status).toBe('INVITED');
  });

  it('rejects an invalid email', async () => {
    const svc = makeSvc();
    await expect(svc.createUser({ tenantId: TENANT, email: 'not-an-email', displayName: 'X' }))
      .rejects.toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('rejects a displayName longer than 80 chars', async () => {
    const svc = makeSvc();
    await expect(svc.createUser({ tenantId: TENANT, email: 'ok@x.io', displayName: 'a'.repeat(81) }))
      .rejects.toBeInstanceOf(UserValidationError);
  });

  it('users carry no permissions directly — view exposes only scope (BR205-4)', async () => {
    const svc = makeSvc();
    const u = await svc.createUser({ tenantId: TENANT, email: 'scoped@x.io', displayName: 'Scoped',
      entityScope: ['e1'], storeScope: ['s1'] });
    expect(u).not.toHaveProperty('permissions');
    expect(u.entityScope).toEqual(['e1']);
  });
});

// ── Activate / lockout / unlock ─────────────────────────────────────────────────

describe('S205 · lockout & unlock', () => {
  it('activates an INVITED user (INVITED → ACTIVE)', async () => {
    const svc = makeSvc();
    const created = await svc.createUser({ tenantId: TENANT, email: 'inv@x.io', displayName: 'Invited' });
    const active = await svc.activateUser(TENANT, created.id);
    expect(active.status).toBe('ACTIVE');
  });

  it('locks a user after 5 failed logins and emits iam.user.locked', async () => {
    const svc = makeSvc();
    let u;
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) u = await svc.recordFailedLogin(TENANT, 'clerk-1');
    expect(u!.status).toBe('LOCKED');
    expect(u!.failedLogins).toBe(LOCKOUT_THRESHOLD);
    expect(published.map((e) => e.type)).toContain('iam.user.locked');
  });

  it('does not lock before the threshold', async () => {
    const svc = makeSvc();
    let u;
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) u = await svc.recordFailedLogin(TENANT, 'clerk-1');
    expect(u!.status).toBe('ACTIVE');
    expect(published.map((e) => e.type)).not.toContain('iam.user.locked');
  });

  it('unlocks a LOCKED user → ACTIVE, failedLogins 0, emits iam.user.unlocked', async () => {
    const svc = makeSvc();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) await svc.recordFailedLogin(TENANT, 'clerk-1');
    const u = await svc.unlockUser(TENANT, 'clerk-1', 'admin-1');
    expect(u.status).toBe('ACTIVE');
    expect(u.failedLogins).toBe(0);
    expect(published.map((e) => e.type)).toContain('iam.user.unlocked');
    expect(state.audit.at(-1)).toMatchObject({ docType: 'user', action: 'UNLOCK' });
  });
});

// ── Deactivate ──────────────────────────────────────────────────────────────────

describe('S205 · deactivate', () => {
  it('deactivates a user, revokes active sessions (BR205-2) and emits iam.user.deactivated', async () => {
    const svc = makeSvc();
    state.sessions.push(
      { id: 's1', tenantId: TENANT, userId: 'clerk-1', status: 'ACTIVE' },
      { id: 's2', tenantId: TENANT, userId: 'clerk-1', status: 'ACTIVE' },
    );
    const res = await svc.deactivateUser(TENANT, 'clerk-1', 'admin-1');
    expect(res.user.status).toBe('INACTIVE');
    expect(res.revokedSessions).toBe(2);
    expect(state.sessions.every((s: any) => s.status === 'REVOKED')).toBe(true);
    expect(published.map((e) => e.type)).toContain('iam.user.deactivated');
    expect(state.audit.at(-1)).toMatchObject({ docType: 'user', action: 'DEACTIVATE', actor: 'admin-1' });
  });

  it('blocks the last active admin from deactivating themselves (AC negative → 422)', async () => {
    const svc = makeSvc();
    await expect(svc.deactivateUser(TENANT, 'admin-1', 'admin-1'))
      .rejects.toBeInstanceOf(LastAdminError);
  });

  it('allows self-deactivation when another active admin exists', async () => {
    const svc = makeSvc();
    // promote clerk-1 to admin
    state.assignments.push({ id: 'a-admin2', tenantId: TENANT, userId: 'clerk-1', roleId: 'r-admin', status: 'GRANTED' });
    const res = await svc.deactivateUser(TENANT, 'admin-1', 'admin-1');
    expect(res.user.status).toBe('INACTIVE');
  });

  it('allows an admin to deactivate a different admin (only self-deactivation is guarded)', async () => {
    const svc = makeSvc();
    state.assignments.push({ id: 'a-admin2', tenantId: TENANT, userId: 'clerk-1', roleId: 'r-admin', status: 'GRANTED' });
    const res = await svc.deactivateUser(TENANT, 'clerk-1', 'admin-1');
    expect(res.user.status).toBe('INACTIVE');
  });

  it('emits iam.user.deactivated with the §9 payload shape', async () => {
    const svc = makeSvc();
    await svc.deactivateUser(TENANT, 'clerk-1', 'admin-1');
    const evt = published.find((e) => e.type === 'iam.user.deactivated');
    expect(evt.tenantId).toBe(TENANT);
    expect(evt.payload).toMatchObject({ userId: 'clerk-1', email: 'clerk@x.io', actor: 'admin-1', schemaV: 1 });
    expect(evt.payload.eventId).toBeTruthy();
    expect(evt.payload.ts).toBeTruthy();
  });
});

// ── Reset ────────────────────────────────────────────────────────────────────────

describe('S205 · reset', () => {
  it('issues a reset token (202) and audits RESET', async () => {
    const svc = makeSvc();
    const res = await svc.resetUser(TENANT, 'clerk-1', 'admin-1');
    expect(res.resetToken).toMatch(/^rst_/);
    const stored = state.users.find((u: any) => u.id === 'clerk-1');
    expect(stored.resetTokenHash).toBeTruthy();
    expect(stored.resetTokenHash).not.toBe(res.resetToken); // stored hashed, not raw
    expect(state.audit.at(-1)).toMatchObject({ docType: 'user', action: 'RESET' });
  });

  it('refuses to reset a deactivated user (INVALID_TRANSITION)', async () => {
    const svc = makeSvc();
    await svc.deactivateUser(TENANT, 'clerk-1', 'admin-1');
    await expect(svc.resetUser(TENANT, 'clerk-1', 'admin-1'))
      .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────────

describe('S205 · reads', () => {
  it('lists only the tenant users (isolation)', async () => {
    const svc = makeSvc();
    const users = await svc.listUsers(TENANT);
    expect(users.map((u) => u.id).sort()).toEqual(['admin-1', 'clerk-1']);
  });

  it('throws UserNotFoundError for an unknown id', async () => {
    const svc = makeSvc();
    await expect(svc.getUser(TENANT, 'nope')).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
