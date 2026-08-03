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
const THIRD_TENANT = 'tenant-c'; // has no user at all — genuine "not found in this tenant" case
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
  const client: any = {
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
  // fix(integration): UserService.login now wraps its writes in a real
  // $transaction that calls setTenantContextOnConnection(tx, ...), which
  // issues tx.$executeRawUnsafe(...) — a no-op stub here since this mock
  // has no real RLS/session-variable semantics to set.
  client.$executeRawUnsafe = async () => undefined;
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;

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

// ── FINAL-R0 S205 audit-gap closure: every DENIED login attempt is now
// recorded, categorized, and free of credential material. ──────────────────
describe('S205 · failed-login audit trail (audit-gap closure)', () => {
  function lastDenied() {
    return [...state.audit].reverse().find((a: any) => a.action === 'LOGIN_DENIED');
  }

  it('incorrect password: records a DENIED/INVALID_PASSWORD audit event with the attempted email, no secrets', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'active@x.io', 'totally-wrong', { correlationId: 'corr-1', ipAddress: '10.0.0.5' }))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    const entry = lastDenied();
    expect(entry).toMatchObject({
      docType: 'user_login_attempt', docId: 'u-active', action: 'LOGIN_DENIED',
      after: { outcome: 'DENIED', reason: 'INVALID_PASSWORD', attemptedEmail: 'active@x.io', correlationId: 'corr-1', ipAddress: '10.0.0.5' },
    });
  });

  it('unknown user: records a DENIED/USER_NOT_FOUND audit event without revealing non-existence to the caller', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'nobody@x.io', 'whatever')).rejects.toBeInstanceOf(InvalidCredentialsError);
    const entry = lastDenied();
    expect(entry).toMatchObject({
      docType: 'user_login_attempt', docId: 'email:nobody@x.io', action: 'LOGIN_DENIED',
      after: { outcome: 'DENIED', reason: 'USER_NOT_FOUND', attemptedEmail: 'nobody@x.io' },
    });
  });

  it('cross-tenant login denial: attempting a real user/password under a tenant that has no such user is audited as USER_NOT_FOUND (RLS-consistent — indistinguishable from a truly unknown email, by design)', async () => {
    const svc = makeSvc();
    await expect(svc.login(THIRD_TENANT, 'active@x.io', ACTIVE_PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    const entry = lastDenied();
    expect(entry).toMatchObject({
      tenantId: THIRD_TENANT, action: 'LOGIN_DENIED',
      after: { outcome: 'DENIED', reason: 'USER_NOT_FOUND', attemptedEmail: 'active@x.io' },
    });
  });

  it('tenant-mismatch: a header tenant that disagrees with the login body tenant is audited as TENANT_MISMATCH, distinct from USER_NOT_FOUND', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD, { headerTenantId: OTHER_TENANT }))
      .rejects.toBeInstanceOf(InvalidCredentialsError);
    const entry = lastDenied();
    expect(entry).toMatchObject({ action: 'LOGIN_DENIED', after: { reason: 'TENANT_MISMATCH', outcome: 'DENIED' } });
  });

  it('disabled (INACTIVE) user: records a DENIED/ACCOUNT_DISABLED audit event', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'inactive@x.io', ACTIVE_PASSWORD)).rejects.toBeInstanceOf(AccountNotUsableError);
    const entry = lastDenied();
    expect(entry).toMatchObject({ docId: 'u-inactive', action: 'LOGIN_DENIED', after: { reason: 'ACCOUNT_DISABLED', outcome: 'DENIED' } });
  });

  it('locked account: records a DENIED/ACCOUNT_LOCKED audit event', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'locked@x.io', ACTIVE_PASSWORD)).rejects.toBeInstanceOf(AccountNotUsableError);
    const entry = lastDenied();
    expect(entry).toMatchObject({ docId: 'u-locked', action: 'LOGIN_DENIED', after: { reason: 'ACCOUNT_LOCKED', outcome: 'DENIED' } });
  });

  it('sensitive data absence: no denial audit event ever contains a password, password hash, JWT, or session token', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'active@x.io', 'totally-wrong-password-should-not-leak')).rejects.toBeInstanceOf(InvalidCredentialsError);
    const entry = lastDenied();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('totally-wrong-password-should-not-leak');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toMatch(/\$2[aby]\$/); // bcrypt hash shape
    expect(entry.after).not.toHaveProperty('password');
    expect(entry.after).not.toHaveProperty('sessionToken');
    expect(entry.after).not.toHaveProperty('accessToken');
  });

  it('repeated failed attempts correlate: distinct correlationIds thread through to distinct, independently retrievable audit rows', async () => {
    const svc = makeSvc();
    await expect(svc.login(TENANT, 'active@x.io', 'wrong-1', { correlationId: 'corr-A' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(svc.login(TENANT, 'active@x.io', 'wrong-2', { correlationId: 'corr-B' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    const denied = state.audit.filter((a: any) => a.action === 'LOGIN_DENIED');
    expect(denied).toHaveLength(2);
    expect(denied.map((d: any) => d.after.correlationId)).toEqual(['corr-A', 'corr-B']);
    expect(denied.every((d: any) => d.after.reason === 'INVALID_PASSWORD')).toBe(true);
  });

  it('audit service (local outbox write) unavailable: a broken audit sink does not allow login to succeed nor throw a different error', async () => {
    const svc = makeSvc();
    // Simulate an unavailable/erroring local audit store (the outbox INSERT
    // itself, prior to any network delivery) — _audit()'s try/catch must
    // swallow this without changing the (already-decided) deny outcome.
    (svc as any).prisma.auditOutboxEvent.create = async () => { throw new Error('outbox store unavailable'); };
    await expect(svc.login(TENANT, 'active@x.io', 'totally-wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
    // And, symmetrically, a broken audit sink must never turn a genuinely
    // correct login into a failure, nor silently grant access on a bad one.
    await expect(svc.login(TENANT, 'active@x.io', ACTIVE_PASSWORD)).resolves.toMatchObject({ user: { id: 'u-active' } });
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
