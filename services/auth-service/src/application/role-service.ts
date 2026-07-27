import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/auth-client';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { AuthzService } from './authz-service';
import { randomUUID } from 'crypto';

// ── S206: Basic Role Management ────────────────────────────────────────────────
// Roles are named permission sets (BR206-1). Access is granted only by auditable,
// store-scoped assignment (BR206-3) — never by individual permission grant. This
// service is the write authority; it projects into the S207 read models
// (role_permission, authz_role_assignment) so the real AuthzPort enforces grants,
// and emits §9 events + AuditPort records on every state change (§11).

// ── Permission strings enforced by this story (§2) ──────────────────────────────
export const ROLE_PERMISSIONS = {
  VIEW:   'iam.role.view',
  MANAGE: 'iam.role.manage',
  ASSIGN: 'iam.role.assign',
} as const;

// ── DTOs ────────────────────────────────────────────────────────────────────────

export interface CreateRoleDTO {
  tenantId:    string;
  name:        string;
  permissions: string[];
  actor?:      string;
}

export interface UpdateRoleDTO {
  name?:        string;
  permissions?: string[];
  actor?:       string;
}

export interface GrantAssignmentDTO {
  tenantId:  string;
  userId:    string;
  roleId:    string;
  entityId:  string | null;  // null = tenant-wide (platform/tenant admin) grant
  storeIds?: string[];       // omitted / empty with allStores=true → ALL
  allStores?: boolean;
  actor?:    string;
}

export interface RoleView {
  id:          string;
  key:         string;
  name:        string;
  permissions: string[];
  builtIn:     boolean;
  status:      string;
}

export interface AssignmentView {
  id:        string;
  userId:    string;
  roleId:    string;
  roleKey:   string;
  entityId:  string | null;
  storeIds:  string[];
  allStores: boolean;
  status:    string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class RoleNotFoundError extends Error {
  constructor(id: string) { super(`Role not found: ${id}`); this.name = 'RoleNotFoundError'; }
}

export class RoleValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'RoleValidationError';
  }
}

/** Delete/retire of a role that still has GRANTED assignments (BR206-2 → 409). */
export class RoleInUseError extends Error {
  constructor(id: string) {
    super(`Role is assigned and cannot be retired: ${id}`);
    this.name = 'RoleInUseError';
  }
}

/** Assignment references an entity outside the user's tenant (AC negative → 422). */
export class AssignmentScopeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'AssignmentScopeError';
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

@injectable()
export class RoleService {
  constructor(
    @inject('PrismaClient')     private readonly prisma: PrismaClient,
    @inject('IEventPublisher')  private readonly events: IEventPublisher,
    @inject('AuthzService')     private readonly authz: AuthzService,
  ) {}

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(tenantId: string): Promise<RoleView[]> {
    const rows = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map(this._toRoleView);
  }

  async getRole(tenantId: string, id: string): Promise<RoleView> {
    const row = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!row) throw new RoleNotFoundError(id);
    return this._toRoleView(row);
  }

  async createRole(dto: CreateRoleDTO): Promise<RoleView> {
    this._assertName(dto.name);
    await this._assertPermissionsKnown(dto.permissions);

    const key = this._deriveKey(dto.name);
    const existing = await this.prisma.role.findFirst({
      where: { tenantId: dto.tenantId, OR: [{ name: dto.name }, { key }] },
    });
    if (existing) {
      throw new RoleValidationError('ROLE_EXISTS', `Role name already exists: ${dto.name}`);
    }

    // S007 BR7-1/BR7-4 — role create, its S207 permission projection, and the
    // audit event are one atomic transaction: a failure in any of the three
    // rolls back the whole role-creation, never a partial/unaudited role.
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.create({
        data: {
          id: randomUUID(),
          tenantId: dto.tenantId,
          key,
          name: dto.name,
          permissions: dto.permissions,
          builtIn: false,
          status: 'ACTIVE',
        },
      });
      await this._projectRolePermissions(r.key, r.permissions, tx);
      await this._audit(dto.tenantId, 'role', r.id, 'CREATE', null, this._toRoleView(r), dto.actor, tx);
      return r;
    });

    await this._emit('iam.role.created', dto.tenantId, {
      eventId: randomUUID(), roleId: role.id, roleKey: role.key,
      scope: { tenantId: dto.tenantId }, actor: dto.actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
    this.authz.invalidateCache();
    return this._toRoleView(role);
  }

  // ── S004A support: materialize the real backing Role for a position template ──
  // S004A ("Dealership Position Role Templates") must not create a parallel
  // permission map: applying a template finds-or-creates a real, tenant-scoped
  // Role keyed by the template's position slug and (re-)projects its exact
  // permission set, so AuthzService.check() enforces it through the same S207
  // path already proven for S206. The key is passed explicitly (not derived
  // from the display name via _deriveKey) because template keys are fixed
  // position slugs (e.g. OFFICE_MGR, SALESPERSON_RO) that do not always match
  // what _deriveKey would compute from a human-friendly template name.
  async ensureRoleForPositionTemplate(dto: {
    tenantId: string; key: string; name: string; permissions: string[]; actor?: string;
  }): Promise<RoleView> {
    await this._assertPermissionsKnown(dto.permissions);
    const existing = await this.prisma.role.findFirst({ where: { tenantId: dto.tenantId, key: dto.key } });
    if (existing) {
      if (existing.status !== 'ACTIVE') {
        throw new RoleValidationError('ROLE_RETIRED', `Backing role for position ${dto.key} has been retired`);
      }
      const same = JSON.stringify([...existing.permissions].sort())
        === JSON.stringify([...dto.permissions].sort());
      if (same) return this._toRoleView(existing);
      // Template permissions changed since the last apply: re-project so the
      // backing role (and every user already assigned it) reflects the
      // template's *current* permission set (AC: "permission set... takes
      // effect"). This never touches other tenants' clones/roles.
      return this.updateRole(dto.tenantId, existing.id, { permissions: dto.permissions, actor: dto.actor });
    }

    let role;
    try {
      role = await this.prisma.$transaction(async (tx) => {
        const r = await tx.role.create({
          data: {
            id: randomUUID(), tenantId: dto.tenantId, key: dto.key, name: dto.name,
            permissions: dto.permissions, builtIn: false, status: 'ACTIVE',
          },
        });
        await this._projectRolePermissions(r.key, r.permissions, tx);
        await this._audit(dto.tenantId, 'role', r.id, 'CREATE', null, this._toRoleView(r), dto.actor, tx);
        return r;
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new RoleValidationError(
          'ROLE_EXISTS',
          `A role named "${dto.name}" already exists for this tenant under a different key`,
        );
      }
      throw err;
    }

    await this._emit('iam.role.created', dto.tenantId, {
      eventId: randomUUID(), roleId: role.id, roleKey: role.key,
      scope: { tenantId: dto.tenantId }, actor: dto.actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
    this.authz.invalidateCache();
    return this._toRoleView(role);
  }

  async updateRole(tenantId: string, id: string, dto: UpdateRoleDTO): Promise<RoleView> {
    const current = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!current) throw new RoleNotFoundError(id);
    if (current.status === 'RETIRED') {
      throw new RoleValidationError('ROLE_RETIRED', 'Cannot edit a retired role');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      this._assertName(dto.name);
      const clash = await this.prisma.role.findFirst({
        where: { tenantId, name: dto.name, NOT: { id } },
      });
      if (clash) throw new RoleValidationError('ROLE_EXISTS', `Role name already exists: ${dto.name}`);
      data['name'] = dto.name;
    }
    if (dto.permissions !== undefined) {
      await this._assertPermissionsKnown(dto.permissions);
      data['permissions'] = dto.permissions;
    }

    const before = this._toRoleView(current);
    // S007 BR7-1/BR7-4 — update, its permission re-projection, and the audit
    // event are one atomic transaction.
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.update({ where: { id }, data });
      // Re-project permissions so affected users change within 5 s (AC).
      if (dto.permissions !== undefined) {
        await this._projectRolePermissions(r.key, r.permissions, tx);
      }
      await this._audit(tenantId, 'role', r.id, 'UPDATE', before, this._toRoleView(r), dto.actor, tx);
      return r;
    });

    await this._emit('iam.role.updated', tenantId, {
      eventId: randomUUID(), roleId: role.id, roleKey: role.key,
      scope: { tenantId }, actor: dto.actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
    this.authz.invalidateCache();
    return this._toRoleView(role);
  }

  /** Retire a role. Blocked while any GRANTED assignment exists (BR206-2 → 409). */
  async retireRole(tenantId: string, id: string, actor?: string): Promise<void> {
    const current = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!current) throw new RoleNotFoundError(id);

    const assignedCount = await this.prisma.roleAssignment.count({
      where: { tenantId, roleId: id, status: 'GRANTED' },
    });
    if (assignedCount > 0) throw new RoleInUseError(id);

    const before = this._toRoleView(current);
    // S007 BR7-1/BR7-4 — retire, permission-projection removal, and audit
    // event are one atomic transaction.
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { status: 'RETIRED' } });
      // A retired role grants nothing: drop its permission projection.
      await tx.rolePermission.deleteMany({ where: { role: current.key } });
      await this._audit(tenantId, 'role', id, 'RETIRE', before, { ...before, status: 'RETIRED' }, actor, tx);
    });

    await this._emit('iam.role.retired', tenantId, {
      eventId: randomUUID(), roleId: id, roleKey: current.key,
      scope: { tenantId }, actor: actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
    this.authz.invalidateCache();
  }

  // ── Assignments ─────────────────────────────────────────────────────────────

  async listAssignments(tenantId: string, userId?: string): Promise<AssignmentView[]> {
    const rows = await this.prisma.roleAssignment.findMany({
      where: { tenantId, ...(userId ? { userId } : {}), status: 'GRANTED' },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => this._toAssignmentView(a, a.role.key));
  }

  async grantAssignment(dto: GrantAssignmentDTO): Promise<AssignmentView> {
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, tenantId: dto.tenantId } });
    if (!role) throw new RoleNotFoundError(dto.roleId);
    if (role.status !== 'ACTIVE') {
      throw new RoleValidationError('ROLE_RETIRED', 'Cannot assign a retired role');
    }

    // AC negative: assign a role for an entity outside the user's tenant → 422.
    await this._assertEntityInTenant(dto.tenantId, dto.entityId);

    const allStores = dto.allStores ?? false;
    const storeIds = allStores ? [] : (dto.storeIds ?? []);
    if (!allStores && storeIds.length === 0) {
      throw new AssignmentScopeError('SCOPE_REQUIRED', 'Provide storeIds or set allStores = true');
    }
    if (!allStores) {
      if (!dto.entityId) {
        throw new AssignmentScopeError('ENTITY_REQUIRED', 'entityId is required for a store-scoped assignment');
      }
      await this._assertStoresInEntity(dto.entityId, storeIds);
    }

    // S007 BR7-1/BR7-4 — assignment create, S207 projection, and audit event
    // are one atomic transaction.
    const assignment = await this.prisma.$transaction(async (tx) => {
      const a = await tx.roleAssignment.create({
        data: {
          id: randomUUID(),
          tenantId: dto.tenantId,
          userId: dto.userId,
          roleId: dto.roleId,
          entityId: dto.entityId,
          storeIds,
          allStores,
          status: 'GRANTED',
        },
      });

      await this._projectAssignment(a.tenantId, a.userId, role.key,
        a.entityId, allStores, storeIds, tx);
      await this._audit(dto.tenantId, 'role_assignment', a.id, 'GRANT', null,
        this._toAssignmentView(a, role.key), dto.actor, tx);
      return a;
    });

    await this._emit('iam.assignment.granted', dto.tenantId, {
      eventId: randomUUID(), roleId: dto.roleId, userId: dto.userId,
      scope: { tenantId: dto.tenantId, entityId: dto.entityId, storeIds, allStores },
      actor: dto.actor ?? 'user', ts: new Date().toISOString(), schemaV: 1,
    });
    this.authz.invalidateCache();
    return this._toAssignmentView(assignment, role.key);
  }

  async revokeAssignment(tenantId: string, id: string, actor?: string): Promise<void> {
    const current = await this.prisma.roleAssignment.findFirst({
      where: { id, tenantId }, include: { role: true },
    });
    if (!current) throw new RoleNotFoundError(id);
    if (current.status === 'REVOKED') return;

    const before = this._toAssignmentView(current, current.role.key);
    // S007 BR7-1/BR7-4 — revoke, its projection removal, and audit event are
    // one atomic transaction.
    await this.prisma.$transaction(async (tx) => {
      await tx.roleAssignment.update({
        where: { id }, data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this._unprojectAssignment(tenantId, current.userId, current.role.key,
        current.entityId, current.allStores, current.storeIds, tx);
      await this._audit(tenantId, 'role_assignment', id, 'REVOKE', before,
        { ...before, status: 'REVOKED' }, actor, tx);
    });

    await this._emit('iam.assignment.revoked', tenantId, {
      eventId: randomUUID(), roleId: current.roleId, userId: current.userId,
      scope: { tenantId, entityId: current.entityId,
        storeIds: current.storeIds, allStores: current.allStores },
      actor: actor ?? 'user', ts: new Date().toISOString(), schemaV: 1,
    });
    this.authz.invalidateCache();
  }

  /** Consumed from iam.user.deactivated: auto-revoke all of a user's assignments. */
  async handleUserDeactivated(tenantId: string, userId: string): Promise<void> {
    const rows = await this.prisma.roleAssignment.findMany({
      where: { tenantId, userId, status: 'GRANTED' },
    });
    for (const a of rows) {
      await this.revokeAssignment(tenantId, a.id, 'system:user-deactivated');
    }
  }

  // ── Projection into the S207 read models ─────────────────────────────────────

  /** role.permissions is the source of truth; sync role_permission for its key. */
  private async _projectRolePermissions(
    roleKey: string, permissions: string[],
    tx: Pick<PrismaClient, 'rolePermission'> = this.prisma,
  ): Promise<void> {
    await tx.rolePermission.deleteMany({ where: { role: roleKey } });
    await tx.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({ role: roleKey, permissionKey })),
      skipDuplicates: true,
    });
  }

  private async _projectAssignment(
    tenantId: string, userId: string, roleKey: string,
    entityId: string | null, allStores: boolean, storeIds: string[],
    tx: Pick<PrismaClient, 'authzRoleAssignment'> = this.prisma,
  ): Promise<void> {
    const rows = allStores
      ? [{ entityId, storeId: null as string | null }]
      : storeIds.map((storeId) => ({ entityId, storeId }));
    for (const r of rows) {
      // Prisma's compound-unique input (authz_assignment_unique) requires
      // non-null values for every key column, but entityId/storeId are
      // legitimately null for tenant-wide / all-store grants — and Postgres
      // unique indexes never treat NULL = NULL, so an upsert keyed on that
      // compound constraint could never find a null-valued row and would
      // insert a fresh duplicate on every re-assignment. find-then-create
      // against the plain (nullable-safe) where filter is idempotent in
      // every case, matching _unprojectAssignment's filter shape below.
      const existing = await tx.authzRoleAssignment.findFirst({
        where: { tenantId, userId, role: roleKey, entityId: r.entityId, storeId: r.storeId },
      });
      if (!existing) {
        await tx.authzRoleAssignment.create({
          data: { id: randomUUID(), tenantId, userId, role: roleKey, entityId: r.entityId, storeId: r.storeId },
        });
      }
    }
  }

  private async _unprojectAssignment(
    tenantId: string, userId: string, roleKey: string,
    entityId: string | null, allStores: boolean, storeIds: string[],
    tx: Pick<PrismaClient, 'authzRoleAssignment'> = this.prisma,
  ): Promise<void> {
    if (entityId == null || allStores) {
      await tx.authzRoleAssignment.deleteMany({
        where: { tenantId, userId, role: roleKey, entityId, storeId: null },
      });
    } else {
      await tx.authzRoleAssignment.deleteMany({
        where: { tenantId, userId, role: roleKey, entityId, storeId: { in: storeIds } },
      });
    }
  }

  // ── Validation helpers ────────────────────────────────────────────────────────

  private _assertName(name: string): void {
    const n = name?.trim() ?? '';
    if (n.length < 1 || n.length > 60) {
      throw new RoleValidationError('INVALID_NAME', 'Role name must be 1–60 characters');
    }
  }

  private async _assertPermissionsKnown(permissions: string[]): Promise<void> {
    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new RoleValidationError('EMPTY_PERMISSIONS', 'A role must grant at least one permission');
    }
    const known = await this.prisma.permission.findMany({ select: { key: true } });
    const set = new Set(known.map((p) => p.key));
    const bad = permissions.filter((p) => !set.has(p));
    if (bad.length > 0) {
      throw new RoleValidationError('UNKNOWN_PERMISSION', `Unknown permission keys: ${bad.join(', ')}`);
    }
  }

  private async _assertEntityInTenant(tenantId: string, entityId: string | null | undefined): Promise<void> {
    // FINAL-R0 defect fix: entityId == null is the documented tenant-wide
    // (platform/tenant admin) grant shape (schema.prisma RoleAssignment.entityId
    // comment: "null = tenant-wide (platform/tenant admin)"). The previous
    // unconditional "entityId required" check made that shape unreachable via
    // the real grantAssignment() path, contradicting the schema's own contract
    // and blocking legitimate tenant-admin bootstrap. Only validate membership
    // when an entityId is actually supplied.
    if (!entityId) return;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "legal_entities" WHERE "id" = ${entityId} AND "tenant_id" = ${tenantId} LIMIT 1`;
    if (rows.length === 0) {
      throw new AssignmentScopeError(
        'ENTITY_OUTSIDE_TENANT',
        `Cannot assign a role for an entity outside the user's tenant: ${entityId}`,
      );
    }
  }

  private async _assertStoresInEntity(entityId: string, storeIds: string[]): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "stores" WHERE "entity_id" = ${entityId} AND "id" = ANY(${storeIds})`;
    const found = new Set(rows.map((r) => r.id));
    const bad = storeIds.filter((s) => !found.has(s));
    if (bad.length > 0) {
      throw new AssignmentScopeError(
        'STORE_OUTSIDE_ENTITY',
        `Stores not in entity ${entityId}: ${bad.join(', ')}`,
      );
    }
  }

  // ── AuditPort (stub) + event helpers ────────────────────────────────────────

  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: randomUUID(), tenantId, docType, docId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'user',
      },
    });
  }

  private async _emit(type: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.events.publish({
        type, tenantId, payload,
        occurredAt: new Date(), correlationId: randomUUID(),
      } as any);
    } catch {
      /* best-effort publish; the outbox/read-model is already consistent */
    }
  }

  private _toRoleView = (r: {
    id: string; key: string; name: string; permissions: string[]; builtIn: boolean; status: string;
  }): RoleView => ({
    id: r.id, key: r.key, name: r.name,
    permissions: r.permissions, builtIn: r.builtIn, status: r.status,
  });

  private _toAssignmentView(a: {
    id: string; userId: string; roleId: string; entityId: string | null;
    storeIds: string[]; allStores: boolean; status: string;
  }, roleKey: string): AssignmentView {
    return {
      id: a.id, userId: a.userId, roleId: a.roleId, roleKey,
      entityId: a.entityId, storeIds: a.storeIds, allStores: a.allStores, status: a.status,
    };
  }

  private _deriveKey(name: string): string {
    return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  }
}
