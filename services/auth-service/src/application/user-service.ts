import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/auth-client';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { randomUUID, createHash } from 'crypto';

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

    let user;
    try {
      user = await this.prisma.user.create({
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

    await this._audit(dto.tenantId, 'user', user.id, 'CREATE', null, this._toView(user), dto.actor);
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', failedLogins: 0, version: { increment: 1 } },
    });
    await this._audit(tenantId, 'user', id, 'ACTIVATE', this._toView(user), this._toView(updated), actor);
    return this._toView(updated);
  }

  // ── Record failed login → lock at threshold ──────────────────────────────────
  async recordFailedLogin(tenantId: string, id: string): Promise<UserView> {
    const user = await this._require(tenantId, id);
    if (user.status === 'INACTIVE' || user.status === 'LOCKED') return this._toView(user);

    const failed = user.failedLogins + 1;
    const lock = failed >= LOCKOUT_THRESHOLD;
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        failedLogins: failed,
        status: lock ? 'LOCKED' : user.status,
        version: { increment: 1 },
      },
    });
    if (lock) {
      await this._audit(tenantId, 'user', id, 'LOCK', this._toView(user), this._toView(updated), 'system');
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: nextStatus, failedLogins: 0, version: { increment: 1 } },
    });
    await this._audit(tenantId, 'user', id, 'UNLOCK', this._toView(user), this._toView(updated), actor);
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

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE', deactivatedAt: new Date(), version: { increment: 1 } },
    });
    const revokedSessions = await this._revokeSessions(tenantId, id);

    await this._audit(tenantId, 'user', id, 'DEACTIVATE', this._toView(user), this._toView(updated), actor);
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        resetTokenHash,
        resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        version: { increment: 1 },
      },
    });
    await this._audit(tenantId, 'user', id, 'RESET', this._toView(user), this._toView(updated), actor);
    return { user: this._toView(updated), resetToken };
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
      // AuditPort write is non-fatal to the business operation.
    }
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
