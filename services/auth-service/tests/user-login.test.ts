/**
 * FINAL-R0 Foundation Completion — S205 login/session capability.
 *
 * Prior to this package, S205 covered create/deactivate/unlock/reset but no
 * real user ever authenticated and received a session (MODULE_STATE.json
 * carry-forward: "no real login/session-issuance endpoint exists"). These
 * tests cover the new setPassword/login/logout/validateSession methods on
 * UserService in isolation with an in-memory Prisma mock (no database);
 * the live-stack HTTP walkthrough is proven separately against real Postgres.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { createHash } from 'crypto';
import {
  UserService,
  UserValidationError,
  InvalidResetTokenError,
  InvalidCredentialsError,
  AccountNotUsableError,
  InvalidSessionError,
  LOCKOUT_THRESHOLD,
} from '../src/application/user-service';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const RESET_TOKEN = 'plain-reset-token-abc';
const RESET_HASH = createHash('sha256').update(RESET_TOKEN).digest('hex');

let state: any;
let published: any[];

function seed() {
  state = {
    users: [
      // INVITED, has a live (unexpired) reset token — ready for first setPassword.
      { id: 'u-invited', tenantId: TENANT, email: 'invited@x.io', displayName: 'Invited User',
        status: 'INVITED', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        passwordHash: null, resetTokenHash: RESET_HASH,
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
      // ACTIVE with a password already set — ready to log in.
      { id: 'u-active', tenantId: TENANT, email: 'active@x.io', displayName: 'Active User',
        status: 'ACTIVE', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        passwordHash: '$2a$10$fixturefixturefixturefuFIXTUREHASHXXXXXXXXXXXXXXXXXXXX', // replaced in beforeEach via bcrypt
        resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
      { id: 'u-locked', tenantId: TENANT, email: 'locked@x.io', displayName: 'Locked User',
        status: 'LOCKED', failedLogins: LOCKOUT_THRESHOLD, entityScope: [], storeScope: [], version: 0,
        passwordHash: null, resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
      { id: 'u-inactive', tenantId: TENANT, email: 'inactive@x.io', displayName: 'Inactive User',
        status: 'INACTIVE', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        passwordHash: null, resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: new Date(),
        createdAt: new Date(), updatedAt: new Date() },
      { id: 'u-other-tenant', tenantId: OTHER_TENANT, email: 'active@x.io', displayName: 'Other Tenant Active',
        status: 'ACTIVE', failedLogins: 0, entityScope: [], storeScope: [], version: 0,
        passwordHash: null, resetTokenHash: null, resetTokenExpiresAt: null, deactivatedAt: null,
        createdAt: new Date(), updatedAt: new Date() },
    ],
    sessions: [] as any[],
    assignments: [] as any[],
    roles: [] as any[],
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
      findMany: async ({ where }: any) => state.users.filter((u: any) => matchUser(u, where ?? {})).map((u: any) => ({ ...u })),
      findFirst: async ({ where }: any) => {
        const u = state.users.find((x: any) => matchUser(x, where ?? {}));
        return u ? { ...u } : null;
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
      create: async ({ data }: any) => {
        const row = { status: 'ACTIVE', revokedAt: null, createdAt: new Date(), ...data };
        state.sessions.push(row);
        return { ...row };
      },
      findFirst: async ({ where }: any) => {
        const s = state.sessions.find((x: any) =>
          x.tenantId === where.tenantId && x.tokenHash === where.tokenHash);
        return s ? { ...s } : null;
      },
      update: async ({ where, data }: any) => {
        const s = state.sessions.find((x: any) => x.id === where.id);
        Object.assign(s, data);
        return { ...s };
      },
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
    roleAssignment: { findMany: async () => [] },
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

const ACTIVE_PASSWORD = 'CorrectHorseBattery1';

beforeEach(async () => {
  seed();
  published = [];
  // Real bcrypt hash for the pre-seeded ACTIVE user so login can be exercised genuinely.
  const bcrypt = await import('bcryptjs');
  state.users.find((u: any) => u.id === 'u-active').passwordHash = await bcrypt.hash(ACTIVE_PASSWORD, 10);
});

// ── setPassword (consumes the reset token) ──────────────────────────────────────

describe('S205 · setPassword', () => {
  it('positive: consumes a valid reset token, activates INVITED, sets passwordHash', async () => {
    const svc = makeSvc();
    const u = await svc.setPassword(TENANT, 'u-invited', RESET_TOKEN, 'BrandNewPassw0rd');
    expect(u.status).toBe('ACTIVE');
    expect(state.users.find((x: any) => x.id === 'u-invited').passwordHash).toBeTruthy();
    expect(state.users.find((x: any) => x.id === 'u-invited').resetTokenHash).toBeNull();
    expect(state.audit.at(-1)).toMatchObject({ docType: 'user', action: 'SET_PASSWORD' });
  });

  it('validation: rejects a password shorter than 8 characters (422)', async () => {
    const svc = makeSvc();
    await expect(svc.setPassword(TENANT, 'u-invited', RESET_TOKEN, 'short'))
      .rejects.toBeInstanceOf(UserValidationError);
  });

  it('unauthorized: rejects a wrong reset token', async () => {
    const svc = makeSvc();
    await expect(svc.setPassword(TENANT, 'u-invited', 'wrong-token', 'BrandNewPassw0rd'))
      .rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('unauthorized: rejects an expired reset token', async () => {
    const svc = makeSvc();
    state.users.find((u: any) => u.id === 'u-invited').resetTokenExpiresAt = new Date(Date.now() - 1000);
    await expect(svc.setPassword(TENANT, 'u-invited', RESET_TOKEN, 'BrandNewPassw0rd'))
      .rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('cross-tenant denial: a reset token cannot be consumed against another tenant\'s user id', async () => {
    const svc = makeSvc();
    await expect(svc.setPassword(OTHER_TENANT, 'u-invited', RESET_TOKEN, 'BrandNewPassw0rd'))
      .rejects.toThrow();
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe('S205 · login', () => {
  it('positive: correct email + password issues a real Session row and audit LOGIN', async () => {
    const svc = makeSvc();
    const result = await svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD);
    expect(result.sessionToken).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({ tenantId: TENANT, userId: 'u-active', status: 'ACTIVE' });
    expect(state.audit.at(-1)).toMatchObject({ docType: 'user', action: 'LOGIN' });
    expect(published.map((e) => e.type)).toContain('iam.user.login');
  });

  it('login is case-insensitive on email like createUser (normalizes lowercase)', async () => {
    const svc = makeSvc();
    const result = await svc.login(TENANT, 'ACTIVE@X.IO', ACTIVE_PASSWORD);
    expect(result.user.id).toBe('u-active');
  });

  it('unauthorized: wrong password is rejected generically and increments failedLogins', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'active@x.io', 'totally-wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(state.users.find((u: any) => u.id === 'u-active').failedLogins).toBe(1);
  });

  it('unauthorized: wrong password enough times locks the account (BR205-3)', async () => {
    const svc = makeSvc();
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await expect(svc.login(TENANT, 'active@x.io', 'nope')).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    expect(state.users.find((u: any) => u.id === 'u-active').status).toBe('LOCKED');
  });

  it('unauthorized: unknown email is rejected with the same generic error as wrong password', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'nobody@x.io', 'whatever')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('unauthorized: a LOCKED account cannot log in even with the right password', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'locked@x.io', ACTIVE_PASSWORD)).rejects.toBeInstanceOf(AccountNotUsableError);
  });

  it('unauthorized: an INACTIVE (deactivated) account cannot log in', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'inactive@x.io', ACTIVE_PASSWORD)).rejects.toBeInstanceOf(AccountNotUsableError);
  });

  it('cross-tenant denial: same email exists in another tenant but does not authenticate here without that tenant id', async () => {
    const svc = makeSvc();
    // OTHER_TENANT's user has no passwordHash set (fixture), so this is also a
    // credentials failure — proving tenant scoping (no cross-tenant row leak).
    await expect(svc.login(OTHER_TENANT, 'active@x.io', ACTIVE_PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

// ── validateSession / logout ─────────────────────────────────────────────────

describe('S205 · validateSession & logout', () => {
  it('positive: a session issued by login validates successfully (whoami)', async () => {
    const svc = makeSvc();
    const { sessionToken } = await svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD);
    const user = await svc.validateSession(TENANT, sessionToken);
    expect(user.id).toBe('u-active');
  });

  it('unauthorized: an unknown session token is rejected', async () => {
    const svc = makeSvc();
    await expect(svc.validateSession(TENANT, 'not-a-real-token')).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('cross-tenant denial: a session token is not valid under a different tenant id', async () => {
    const svc = makeSvc();
    const { sessionToken } = await svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD);
    await expect(svc.validateSession(OTHER_TENANT, sessionToken)).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('logout revokes the session; a subsequent validateSession then fails', async () => {
    const svc = makeSvc();
    const { sessionToken } = await svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD);
    await svc.logout(TENANT, sessionToken);
    expect(state.sessions[0].status).toBe('REVOKED');
    await expect(svc.validateSession(TENANT, sessionToken)).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it('idempotency: logging out twice with the same token does not throw', async () => {
    const svc = makeSvc();
    const { sessionToken } = await svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD);
    await svc.logout(TENANT, sessionToken);
    await expect(svc.logout(TENANT, sessionToken)).resolves.toBeUndefined();
  });

  it('idempotency: logging out an unknown token is a no-op, not an error', async () => {
    const svc = makeSvc();
    await expect(svc.logout(TENANT, 'never-issued')).resolves.toBeUndefined();
  });
});
