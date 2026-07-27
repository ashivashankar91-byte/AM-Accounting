import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/auth-client';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

// ── S205: User Account Lifecycle ────────────────────────────────────────────────
// Security admins create, deactivate, unlock and reset staff logins with entity/store
// scope so only current employees hold access. Users carry NO permissions directly
// (BR205-4) — authorization comes solely from S206 role assignments. Every state
// change emits a §9 event and an AuditPort record (§11). Deactivation revokes sessions
// (BR205-2) and emits iam.user.deactivated, which S206 consumes to auto-revoke roles.

// ── Permission strings enforced by this story (§2) ──────────────────────────────
export const USER_PERMISSIONS = {
  VIEW:   'iam.user.view',
  MANAGE: 'iam.user.manage',
} as const;

/** A role that grants user administration — used for the last-admin guard. */
const ADMIN_MARKER_PERMISSION = USER_PERMISSIONS.MANAGE;

/** Lock a user after this many consecutive failed logins (BR / AC — S223 config). */
export const LOCKOUT_THRESHOLD = 5;

/** Reset-token lifetime. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

/** Session lifetime issued at login (FINAL-R0: S205 login/session capability). */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

// ── DTOs ────────────────────────────────────────────────────────────────────────

export interface CreateUserDTO {
  tenantId:     string;
  email:        string;
  displayName:  string;
  entityScope?: string[];
  storeScope?:  string[];
  actor?:       string;
}

export interface UserView {
  id:           string;
  email:        string;
  displayName:  string;
  status:       string;
  failedLogins: number;
  entityScope:  string[];
  storeScope:   string[];
  version:      number;
}

export interface DeactivateResult {
  user:            UserView;
  revokedSessions: number;
}

export interface ResetResult {
  user:       UserView;
  resetToken: string;
}

export interface LoginResult {
  user:          UserView;
  sessionId:     string;
  sessionToken:  string;   // raw, opaque session token — only ever returned once
  expiresAt:     string;
}

/** FINAL-R0 S205: request-scoped, non-secret metadata for a login attempt --
 * used ONLY to enrich audit evidence. Never contains credential material. */
export interface LoginAttemptContext {
  correlationId?: string;
  ipAddress?:     string;
  headerTenantId?: string; // x-tenant-id header, if the caller sent one pre-auth
}

/** Machine-readable denial reason recorded on every failed login attempt
 * (FINAL-R0 S205 audit-gap closure). Never returned to the API caller --
 * the HTTP response stays the deliberately generic "Invalid email or
 * password" / "Account is X" in all cases, so the audit category itself
 * cannot be used to enumerate accounts. */
export type LoginDenialReason =
  | 'USER_NOT_FOUND'
  | 'INVALID_PASSWORD'
  | 'TENANT_MISMATCH'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_LOCKED';

// ── Errors ────────────────────────────────────────────────────────────────────

export class UserNotFoundError extends Error {
  constructor(id: string) { super(`User not found: ${id}`); this.name = 'UserNotFoundError'; }
}

export class UserValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'UserValidationError';
  }
}

/** Duplicate email within a tenant (BR205-1 → 409). */
export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`A user with this email already exists in the tenant: ${email}`);
    this.name = 'DuplicateEmailError';
  }
}

/** The last active admin attempting to deactivate themselves (AC negative → 422). */
export class LastAdminError extends Error {
  constructor() {
    super('Cannot deactivate the last active administrator');
    this.name = 'LastAdminError';
  }
}

/** Invalid or expired reset token presented to set-password (BR205: reset flow). */
export class InvalidResetTokenError extends Error {
  constructor() { super('Reset token is invalid or expired'); this.name = 'InvalidResetTokenError'; }
}

/** Login rejected — deliberately generic (never reveal whether the email exists). */
export class InvalidCredentialsError extends Error {
  constructor() { super('Invalid email or password'); this.name = 'InvalidCredentialsError'; }
}

/** Login rejected because the account is LOCKED (BR205-3) or INACTIVE (BR205-2). */
export class AccountNotUsableError extends Error {
  constructor(public readonly status: string) {
    super(`Account is ${status} and cannot log in`);
    this.name = 'AccountNotUsableError';
  }
}

/** Session token missing, unknown, revoked, or expired. */
export class InvalidSessionError extends Error {
  constructor() { super('Session is invalid, revoked, or expired'); this.name = 'InvalidSessionError'; }
}

// RFC5322-ish practical email check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Service ──────────────────────────────────────────────────────────────────

@injectable()
export class UserService {
  constructor(
    @inject('PrismaClient')    private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listUsers(tenantId: string): Promise<UserView[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { email: 'asc' },
    });
    return rows.map(this._toView);
  }

  async getUser(tenantId: string, id: string): Promise<UserView> {
    const row = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!row) throw new UserNotFoundError(id);
    return this._toView(row);
  }

  // ── Create (INVITED) ────────────────────────────────────────────────────────

  async createUser(dto: CreateUserDTO): Promise<UserView> {
    const email = dto.email.trim().toLowerCase();
    this._assertEmail(email);
    this._assertDisplayName(dto.displayName);

    const existing = await this.prisma.user.findFirst({
      where: { tenantId: dto.tenantId, email },
    });
    if (existing) throw new DuplicateEmailError(email);

    // S007 BR7-1/BR7-4 — user create + audit event are one atomic transaction.
    const user = await this.prisma.$transaction(async (tx) => {
      let u;
      try {
        u = await tx.user.create({
          data: {
            id: randomUUID(),
            tenantId: dto.tenantId,
            email,
            displayName: dto.displayName.trim(),
            status: 'INVITED',
            entityScope: dto.entityScope ?? [],
            storeScope: dto.storeScope ?? [],
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') throw new DuplicateEmailError(email); // unique race
        throw e;
      }
      await this._auditTx(tx, dto.tenantId, 'user', u.id, 'CREATE', null, this._toView(u), dto.actor);
      return u;
    });

    await this._emit('iam.user.created', dto.tenantId, user.id, user.email, dto.actor);
    return this._toView(user);
  }

  // ── Activate (INVITED → ACTIVE) ──────────────────────────────────────────────
  // Not a §9 admin endpoint; the transition happens when an invited user first
  // authenticates. Exposed for the lifecycle state machine and tests.
  async activateUser(tenantId: string, id: string, actor?: string): Promise<UserView> {
    const user = await this._require(tenantId, id);
    if (user.status === 'INACTIVE') {
      throw new UserValidationError('INVALID_TRANSITION', 'Cannot activate a deactivated user');
    }
    if (user.status === 'ACTIVE') return this._toView(user);
    // S007 BR7-1/BR7-4 — activate + audit event are one atomic transaction.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { status: 'ACTIVE', failedLogins: 0, version: { increment: 1 } },
      });
      await this._auditTx(tx, tenantId, 'user', id, 'ACTIVATE', this._toView(user), this._toView(u), actor);
      return u;
    });
    return this._toView(updated);
  }

  // ── Record failed login → lock at threshold ──────────────────────────────────
  async recordFailedLogin(tenantId: string, id: string): Promise<UserView> {
    const user = await this._require(tenantId, id);
    if (user.status === 'INACTIVE' || user.status === 'LOCKED') return this._toView(user);

    const failed = user.failedLogins + 1;
    const lock = failed >= LOCKOUT_THRESHOLD;
    // S007 BR7-1/BR7-4 — the failed-login increment (and lock transition, when
    // it occurs) is atomic with its LOCK audit event. A non-locking failed
    // attempt has no audit event to couple, so it is a plain update.
    const updated = lock
      ? await this.prisma.$transaction(async (tx) => {
          const u = await tx.user.update({
            where: { id },
            data: { failedLogins: failed, status: 'LOCKED', version: { increment: 1 } },
          });
          await this._auditTx(tx, tenantId, 'user', id, 'LOCK', this._toView(user), this._toView(u), 'system');
          return u;
        })
      : await this.prisma.user.update({
          where: { id },
          data: { failedLogins: failed, status: user.status, version: { increment: 1 } },
        });
    if (lock) {
      await this._emit('iam.user.locked', tenantId, id, user.email, 'system');
    }
    return this._toView(updated);
  }

  // ── Unlock (LOCKED → ACTIVE) ─────────────────────────────────────────────────
  async unlockUser(tenantId: string, id: string, actor?: string): Promise<UserView> {
    const user = await this._require(tenantId, id);
    if (user.status === 'INACTIVE') {
      throw new UserValidationError('INVALID_TRANSITION', 'Cannot unlock a deactivated user');
    }
    const nextStatus = user.status === 'LOCKED' ? 'ACTIVE' : user.status;
    // S007 BR7-1/BR7-4 — unlock + audit event are one atomic transaction.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { status: nextStatus, failedLogins: 0, version: { increment: 1 } },
      });
      await this._auditTx(tx, tenantId, 'user', id, 'UNLOCK', this._toView(user), this._toView(u), actor);
      return u;
    });
    await this._emit('iam.user.unlocked', tenantId, id, user.email, actor);
    return this._toView(updated);
  }

  // ── Deactivate (→ INACTIVE, revoke sessions) ─────────────────────────────────
  async deactivateUser(tenantId: string, id: string, actor?: string): Promise<DeactivateResult> {
    const user = await this._require(tenantId, id);

    // AC negative: the last active admin cannot deactivate themselves (422).
    if (actor && actor === id && await this._isLastActiveAdmin(tenantId, id)) {
      throw new LastAdminError();
    }

    if (user.status === 'INACTIVE') {
      const revoked = await this._revokeSessions(tenantId, id);
      return { user: this._toView(user), revokedSessions: revoked };
    }

    // S007 BR7-1/BR7-4 — the deactivate transition, its session revocation,
    // and the audit event are one atomic transaction: a failure in any of
    // the three never leaves an active user with revoked sessions (or vice
    // versa) unaudited.
    const { updated, revokedSessions } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { status: 'INACTIVE', deactivatedAt: new Date(), version: { increment: 1 } },
      });
      const res = await tx.session.updateMany({
        where: { tenantId, userId: id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this._auditTx(tx, tenantId, 'user', id, 'DEACTIVATE', this._toView(user), this._toView(u), actor);
      return { updated: u, revokedSessions: res.count };
    });

    await this._emit('iam.user.deactivated', tenantId, id, user.email, actor);
    return { user: this._toView(updated), revokedSessions };
  }

  // ── Reset (issue reset token) ────────────────────────────────────────────────
  async resetUser(tenantId: string, id: string, actor?: string): Promise<ResetResult> {
    const user = await this._require(tenantId, id);
    if (user.status === 'INACTIVE') {
      throw new UserValidationError('INVALID_TRANSITION', 'Cannot reset a deactivated user');
    }
    const resetToken = `rst_${randomUUID().replace(/-/g, '')}`;
    const resetTokenHash = createHash('sha256').update(resetToken).digest('hex');
    // S007 BR7-1/BR7-4 — reset-token issuance + audit event are one atomic
    // transaction.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          resetTokenHash,
          resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          version: { increment: 1 },
        },
      });
      await this._auditTx(tx, tenantId, 'user', id, 'RESET', this._toView(user), this._toView(u), actor);
      return u;
    });
    return { user: this._toView(updated), resetToken };
  }

  // ── Set password (consume reset token → hash + store password) ──────────────
  // FINAL-R0 S205: the one-time resetToken (from createUser's admin-triggered
  // resetUser call, or a self-service "forgot password" reset) is exchanged here
  // for a real, durable credential. Token is single-use: cleared on success.
  async setPassword(tenantId: string, id: string, resetToken: string, newPassword: string): Promise<UserView> {
    const user = await this._require(tenantId, id);
    if (!user.resetTokenHash || !user.resetTokenExpiresAt) throw new InvalidResetTokenError();
    if (user.resetTokenExpiresAt.getTime() < Date.now()) throw new InvalidResetTokenError();
    const presentedHash = createHash('sha256').update(resetToken).digest('hex');
    if (presentedHash !== user.resetTokenHash) throw new InvalidResetTokenError();
    if (!newPassword || newPassword.length < 8) {
      throw new UserValidationError('INVALID_PASSWORD', 'password must be at least 8 characters');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const nextStatus = user.status === 'INVITED' ? 'ACTIVE' : user.status;
    // S007 BR7-1/BR7-4 — set-password + audit event are one atomic
    // transaction.
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          status: nextStatus,
          failedLogins: 0,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          version: { increment: 1 },
        },
      });
      await this._auditTx(tx, tenantId, 'user', id, 'SET_PASSWORD', this._toView(user), this._toView(u), 'user');
      return u;
    });
    if (user.status === 'INVITED') {
      await this._emit('iam.user.activated', tenantId, id, user.email, 'user');
    }
    return this._toView(updated);
  }

  // ── Login (email + password → new Session + JWT-backable session token) ─────
  // FINAL-R0 S205: the previously-missing real login/session-issuance endpoint.
  // Deliberately generic errors (BR: never reveal whether an email exists).
  // Failed attempts flow through the existing recordFailedLogin lockout path.
  //
  // FINAL-R0 S205 audit-gap closure: every denied attempt now records an
  // audit event (see _recordLoginDenied) BEFORE throwing, categorized by
  // reason. The reason is never exposed in the thrown error / HTTP response
  // -- only ever visible in the audit trail -- so this closes the evidence
  // gap without weakening the existing anti-enumeration design.
  async login(
    tenantId: string, email: string, password: string, ctx: LoginAttemptContext = {},
  ): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();

    // A caller that already has a tenant context (e.g. a pre-selected tenant
    // in the UI sending x-tenant-id alongside the login form body) but a
    // mismatched body.tenantId is a distinguishable, non-RLS-bypassing
    // denial category -- unlike "does this email exist in a DIFFERENT
    // tenant", which RLS correctly makes indistinguishable from
    // USER_NOT_FOUND (that indistinguishability is the whole point of
    // tenant-scoped RLS and is preserved below).
    if (ctx.headerTenantId && ctx.headerTenantId !== tenantId) {
      await this._recordLoginDenied(tenantId, normalized, 'TENANT_MISMATCH', ctx);
      throw new InvalidCredentialsError();
    }

    const user = await this.prisma.user.findFirst({ where: { tenantId, email: normalized } });
    if (!user) {
      await this._recordLoginDenied(tenantId, normalized, 'USER_NOT_FOUND', ctx);
      throw new InvalidCredentialsError();
    }

    if (user.status === 'INACTIVE') {
      await this._recordLoginDenied(tenantId, normalized, 'ACCOUNT_DISABLED', ctx, user.id);
      throw new AccountNotUsableError('INACTIVE');
    }
    if (user.status === 'LOCKED') {
      await this._recordLoginDenied(tenantId, normalized, 'ACCOUNT_LOCKED', ctx, user.id);
      throw new AccountNotUsableError('LOCKED');
    }

    if (!user.passwordHash) {
      await this._recordLoginDenied(tenantId, normalized, 'INVALID_PASSWORD', ctx, user.id);
      throw new InvalidCredentialsError();
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this._recordLoginDenied(tenantId, normalized, 'INVALID_PASSWORD', ctx, user.id);
      await this.recordFailedLogin(tenantId, user.id);
      throw new InvalidCredentialsError();
    }

    if (user.status === 'INVITED') {
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', version: { increment: 1 } } });
    }
    const reset = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0 },
    });

    const sessionToken = `sess_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await this.prisma.session.create({
      data: { id: randomUUID(), tenantId, userId: user.id, tokenHash, status: 'ACTIVE', expiresAt },
    });

    await this._audit(tenantId, 'user', user.id, 'LOGIN', null, { sessionId: session.id }, user.id);
    await this._emit('iam.user.login', tenantId, user.id, user.email, user.id);

    return {
      user: this._toView(reset),
      sessionId: session.id,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ── Logout (revoke one session) ──────────────────────────────────────────────
  async logout(tenantId: string, rawSessionToken: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawSessionToken).digest('hex');
    const session = await this.prisma.session.findFirst({ where: { tenantId, tokenHash } });
    if (!session || session.status !== 'ACTIVE') return; // idempotent — already logged out
    await this.prisma.session.update({
      where: { id: session.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this._audit(tenantId, 'user', session.userId, 'LOGOUT', null, { sessionId: session.id }, session.userId);
  }

  // ── Validate a session token (used by the gateway/services to resolve caller) ─
  async validateSession(tenantId: string, rawSessionToken: string): Promise<UserView> {
    const tokenHash = createHash('sha256').update(rawSessionToken).digest('hex');
    const session = await this.prisma.session.findFirst({ where: { tenantId, tokenHash } });
    if (!session || session.status !== 'ACTIVE' || session.expiresAt.getTime() < Date.now()) {
      throw new InvalidSessionError();
    }
    const user = await this.prisma.user.findFirst({ where: { id: session.userId, tenantId } });
    if (!user || user.status !== 'ACTIVE') throw new InvalidSessionError();
    return this._toView(user);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async _require(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new UserNotFoundError(id);
    return user;
  }

  /** True iff the given user is an active admin and no other active admin remains. */
  private async _isLastActiveAdmin(tenantId: string, userId: string): Promise<boolean> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { tenantId, status: 'GRANTED' },
      include: { role: true },
    });
    const adminUserIds = new Set(
      assignments
        .filter((a) => a.role?.permissions?.includes(ADMIN_MARKER_PERMISSION))
        .map((a) => a.userId),
    );
    if (!adminUserIds.has(userId)) return false;

    const activeAdmins = await this.prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', id: { in: Array.from(adminUserIds) } },
      select: { id: true },
    });
    const others = activeAdmins.filter((u) => u.id !== userId);
    return others.length === 0;
  }

  private async _revokeSessions(tenantId: string, userId: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { tenantId, userId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return res.count;
  }

  private _assertEmail(email: string): void {
    if (!EMAIL_RE.test(email)) {
      throw new UserValidationError('INVALID_EMAIL', `Invalid email address: ${email}`);
    }
  }

  private _assertDisplayName(name: string): void {
    const n = name?.trim() ?? '';
    if (n.length < 1 || n.length > 80) {
      throw new UserValidationError('INVALID_DISPLAY_NAME', 'displayName must be 1–80 characters');
    }
  }

  // ── FINAL-R0 S205: failed-login audit trail ──────────────────────────────────
  // Records EVERY denied login attempt (not just the ones that trip the
  // lockout threshold). Never includes password, password hash, JWT, or
  // session material -- only the normalized attempted email (an intentional,
  // explicit exception; this is an identity reference, not credential
  // material), a machine-readable denial category, non-secret request
  // metadata, and the fixed outcome "DENIED". Uses the same fire-and-forget,
  // exception-swallowing _audit() primitive as every other audit call in
  // this service, so a broken/unreachable audit store can never turn a
  // denial into an accidental allow (the caller always still throws
  // immediately after this call, regardless of whether the audit write
  // itself succeeded).
  private async _recordLoginDenied(
    tenantId: string,
    attemptedEmail: string,
    reason: LoginDenialReason,
    ctx: LoginAttemptContext,
    userId?: string,
  ): Promise<void> {
    await this._audit(
      tenantId,
      'user_login_attempt',
      userId ?? `email:${attemptedEmail}`,
      'LOGIN_DENIED',
      null,
      {
        outcome: 'DENIED',
        reason,
        attemptedEmail,
        correlationId: ctx.correlationId,
        ipAddress: ctx.ipAddress,
      },
      'system',
    );
  }

  // ── AuditPort (stub) + event helpers ────────────────────────────────────────

  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: randomUUID(), tenantId, docType, docId, action,
          before: (before ?? undefined) as any, after: (after ?? undefined) as any,
          actor: actor ?? 'user',
        },
      });
    } catch {
      // AuditPort write is non-fatal to the business operation here: this
      // path backs LOGIN/LOGOUT/LOGIN_DENIED, whose deny/allow outcome is
      // already decided before this call and must never flip on a broken
      // audit sink (see tests/user-login.test.ts "audit service unavailable").
    }
  }

  /**
   * S007 BR7-1/BR7-4 — strict, transaction-coupled audit write for the user
   * CRUD/lifecycle mutations (create/activate/lock/unlock/deactivate/reset/
   * set-password). Unlike `_audit` above, this never swallows: a failure
   * here must propagate and roll back the paired domain write, so a broken
   * audit sink can never produce a silently-unaudited state change.
   */
  private async _auditTx(
    tx: Pick<PrismaClient, 'auditOutboxEvent'>,
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: randomUUID(), tenantId, docType, docId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'user',
      },
    });
  }

  private async _emit(
    type: string, tenantId: string, userId: string, email: string, actor?: string,
  ): Promise<void> {
    try {
      await this.events.publish({
        type,
        tenantId,
        payload: {
          eventId: randomUUID(),
          tenantId,
          userId,
          email,
          actor: actor ?? 'user',
          ts: new Date().toISOString(),
          schemaV: 1,
        },
        occurredAt: new Date(),
        correlationId: randomUUID(),
      } as any);
    } catch {
      /* best-effort publish; the row-of-record is already committed */
    }
  }

  private _toView = (u: {
    id: string; email: string; displayName: string; status: string;
    failedLogins: number; entityScope: string[]; storeScope: string[]; version: number;
  }): UserView => ({
    id: u.id, email: u.email, displayName: u.displayName, status: u.status,
    failedLogins: u.failedLogins, entityScope: u.entityScope, storeScope: u.storeScope,
    version: u.version,
  });
}
