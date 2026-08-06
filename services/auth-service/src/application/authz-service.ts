import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/auth-client';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { randomUUID } from 'crypto';

// ── S207: Permission Catalog & Check API ───────────────────────────────────────
// Deny-by-default authorization provider. Real AuthzPort — replaces the static
// ROLE_PERMISSIONS stub maps used by S200–S204.

export const CATALOG_READ_PERMISSION = 'iam.catalog.view';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Scope {
  tenantId: string;
  entityId?: string | null;
  storeId?: string | null;
}

export interface CheckRequest {
  userId: string;
  permissionKey: string;
  scope: Scope;
  /** Route the check guards — recorded on the deny event for traceability. */
  route?: string;
}

export interface CheckResult {
  allow: boolean;
  matchedRole?: string;
  reason: string;
}

export interface CatalogPermission {
  key: string;
  description: string;
  sinceVersion: string;
  status: string;
}

export interface CatalogResult {
  version: string;
  releasedAt: string;
  permissions: CatalogPermission[];
  diff?: CatalogDiff;
}

export interface CatalogDiff {
  fromVersion: string;
  toVersion: string;
  added: string[];
  removed: string[];
  unchanged: number;
}

// ── Errors ──────────────────────────────────────────────────────────────────────

/** Thrown when a check references a permission key not in the catalog (→ 400).
 *  Catches call-site typos (AC §3). */
export class UnknownPermissionError extends Error {
  constructor(public readonly permissionKey: string) {
    super(`Unknown permission key: ${permissionKey}`);
    this.name = 'UnknownPermissionError';
  }
}

export class CatalogVersionNotFoundError extends Error {
  constructor(version: string) {
    super(`Catalog version not found: ${version}`);
    this.name = 'CatalogVersionNotFoundError';
  }
}

// Deny reason codes.
export const DENY_REASON = {
  NO_MATCHING_ROLE:  'NO_MATCHING_ROLE',
  SCOPE_ESCALATION:  'SCOPE_ESCALATION',
  INVALID_SCOPE:     'INVALID_SCOPE',
} as const;

// ── Cache ────────────────────────────────────────────────────────────────────
// Deny-by-default is never cached as an allow. We cache the (role -> permission)
// map and per-user assignments; invalidated on iam.role.* / iam.assignment.*.

const CACHE_TTL_MS = 5_000; // AC: "role grant reflects within 5s" — bound staleness.

interface Cached<T> { value: T; expires: number; }

@injectable()
export class AuthzService {
  private permKeyCache: Cached<Set<string>> | null = null;
  private rolePermCache: Cached<Map<string, Set<string>>> | null = null;

  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  /** Drop cached catalog/grant data. Call on iam.role.* / iam.assignment.* events. */
  invalidateCache(): void {
    this.permKeyCache = null;
    this.rolePermCache = null;
  }

  // ── check(user, permission, scope) — the gatekeeper ─────────────────────────

  async check(req: CheckRequest): Promise<CheckResult> {
    // 1. Unknown permission key → hard error (400 at the route). Typo guard.
    const known = await this._knownPermissionKeys();
    if (!known.has(req.permissionKey)) {
      throw new UnknownPermissionError(req.permissionKey);
    }

    // 2. Scope shape validation. tenant->entity->store hierarchy (BR207-4).
    //    A storeId without an entityId, or any scope without a tenantId, is an
    //    escalation/invalid attempt → deny + flag (AC negative).
    const scopeError = this._validateScope(req.scope);
    if (scopeError) {
      const result: CheckResult = {
        allow: false,
        reason: scopeError,
      };
      await this._emitDeny(req, result);
      return result;
    }

    // 3. Resolve the user's roles that apply within the requested scope.
    const roles = await this._rolesForUserInScope(req.userId, req.scope);

    // 4. Deny-by-default: user with no applicable roles → deny + audit (AC).
    if (roles.length === 0) {
      const result: CheckResult = { allow: false, reason: DENY_REASON.NO_MATCHING_ROLE };
      await this._emitDeny(req, result);
      return result;
    }

    // 5. Does any role grant the permission?
    const grants = await this._rolePermissionMap();
    for (const role of roles) {
      if (grants.get(role)?.has(req.permissionKey)) {
        return { allow: true, matchedRole: role, reason: 'GRANTED' };
      }
    }

    // 6. Roles exist but none grant this permission → deny + audit.
    const result: CheckResult = { allow: false, reason: DENY_REASON.NO_MATCHING_ROLE };
    await this._emitDeny(req, result);
    return result;
  }

  /// @net-new fix(integration) — CE-13 UI closure: the frontend's
  /// client-side permission gating (disabling/hiding actions a user has no
  /// server-side grant for anyway) had no real data source — nothing ever
  /// populated it, so every gated button/nav item rendered disabled for
  /// every user regardless of role. This mirrors check()'s own
  /// roles-in-scope → role_permission expansion but returns the FULL
  /// effective set for the caller instead of testing one key, so the UI can
  /// self-configure once at login without N round-trips. Never the sole
  /// enforcement point — every route this gates still runs check() itself.
  async myPermissions(userId: string, scope: Scope): Promise<string[]> {
    const scopeError = this._validateScope(scope);
    if (scopeError) return [];
    const roles = await this._rolesForUserInScope(userId, scope);
    if (roles.length === 0) return [];
    const grants = await this._rolePermissionMap();
    const keys = new Set<string>();
    for (const role of roles) {
      for (const key of grants.get(role) ?? []) keys.add(key);
    }
    return [...keys].sort();
  }

  // ── catalog — versioned list + optional diff report ─────────────────────────

  async catalog(opts: { version?: string; diffFrom?: string } = {}): Promise<CatalogResult> {
    const version = opts.version ?? (await this._latestVersion());
    const versionRow = await this.prisma.catalogVersion.findUnique({ where: { version } });
    if (!versionRow) throw new CatalogVersionNotFoundError(version);

    // Permissions shipped up to and including the requested version.
    const all = await this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
    const permissions: CatalogPermission[] = all
      .filter((p: any) => this._versionLte(p.sinceVersion, version))
      .map((p: any) => ({
        key: p.key,
        description: p.description,
        sinceVersion: p.sinceVersion,
        status: p.status,
      }));

    const result: CatalogResult = {
      version,
      releasedAt: versionRow.releasedAt.toISOString(),
      permissions,
    };

    if (opts.diffFrom) {
      result.diff = await this._diff(opts.diffFrom, version);
    }
    return result;
  }

  /** Migration report: keys added/removed between two catalog versions (AC). */
  async _diff(fromVersion: string, toVersion: string): Promise<CatalogDiff> {
    const [from, to] = await Promise.all([
      this.prisma.catalogVersion.findUnique({ where: { version: fromVersion } }),
      this.prisma.catalogVersion.findUnique({ where: { version: toVersion } }),
    ]);
    if (!from) throw new CatalogVersionNotFoundError(fromVersion);
    if (!to) throw new CatalogVersionNotFoundError(toVersion);

    const all = await this.prisma.permission.findMany();
    const fromKeys = new Set(all.filter((p: any) => this._versionLte(p.sinceVersion, fromVersion)).map((p: any) => p.key));
    const toKeys = new Set(all.filter((p: any) => this._versionLte(p.sinceVersion, toVersion)).map((p: any) => p.key));

    const added = [...toKeys].filter((k) => !fromKeys.has(k)).sort();
    const removed = [...fromKeys].filter((k) => !toKeys.has(k)).sort();
    const unchanged = [...toKeys].filter((k) => fromKeys.has(k)).length;
    return { fromVersion, toVersion, added, removed, unchanged };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _validateScope(scope: Scope): string | null {
    if (!scope.tenantId) return DENY_REASON.INVALID_SCOPE;
    // store implies entity implies tenant. A store without an entity is an
    // attempt to reference a narrower scope than the hierarchy allows.
    if (scope.storeId && !scope.entityId) return DENY_REASON.SCOPE_ESCALATION;
    return null;
  }

  private async _rolesForUserInScope(userId: string, scope: Scope): Promise<string[]> {
    // An assignment applies when it is at or above the requested scope:
    //  - tenant-wide grant (entity/store null) applies to any entity/store
    //  - entity-scoped grant applies to that entity and its stores
    //  - store-scoped grant applies only to that store
    //
    // Wrapped in an interactive $transaction so the `app.current_tenant_id`
    // RLS session variable (set via setTenantContextOnConnection) lands on
    // the SAME physical connection as the findMany below — the base
    // `this.prisma` client's own $use middleware sets that variable on
    // whichever pooled connection its raw SET happens to run on, which is
    // not guaranteed to be the same connection the next query runs on under
    // concurrency (see rls-middleware.ts's disclosed limitation). Without
    // this, authz_role_assignment's RLS policy intermittently sees no
    // current_tenant_id set and silently returns zero rows for a user who
    // genuinely has a role assignment, producing a flaky NO_MATCHING_ROLE
    // deny (observed here as an intermittent 403 on gl.dashboard.view).
    const rows = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, scope.tenantId);
      return tx.authzRoleAssignment.findMany({
        where: { tenantId: scope.tenantId, userId },
      });
    });
    const roles = new Set<string>();
    for (const a of rows) {
      const entityOk = a.entityId == null || a.entityId === (scope.entityId ?? null);
      const storeOk = a.storeId == null || a.storeId === (scope.storeId ?? null);
      if (entityOk && storeOk) roles.add(a.role);
    }
    return [...roles];
  }

  private async _knownPermissionKeys(): Promise<Set<string>> {
    if (this.permKeyCache && this.permKeyCache.expires > Date.now()) return this.permKeyCache.value;
    const rows = await this.prisma.permission.findMany({ select: { key: true } });
    const set = new Set(rows.map((r: any) => r.key));
    this.permKeyCache = { value: set, expires: Date.now() + CACHE_TTL_MS };
    return set;
  }

  private async _rolePermissionMap(): Promise<Map<string, Set<string>>> {
    if (this.rolePermCache && this.rolePermCache.expires > Date.now()) return this.rolePermCache.value;
    const rows = await this.prisma.rolePermission.findMany();
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!map.has(r.role)) map.set(r.role, new Set());
      map.get(r.role)!.add(r.permissionKey);
    }
    this.rolePermCache = { value: map, expires: Date.now() + CACHE_TTL_MS };
    return map;
  }

  private async _latestVersion(): Promise<string> {
    const rows = await this.prisma.catalogVersion.findMany();
    if (rows.length === 0) return '0.0.0';
    return rows.map((r: any) => r.version).sort(this._compareVersion).at(-1)!;
  }

  private _versionLte(a: string, b: string): boolean {
    return this._compareVersion(a, b) <= 0;
  }

  private _compareVersion(a: string, b: string): number {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }

  /** Every deny writes the §9 event to the outbox AND emits it (best-effort). */
  private async _emitDeny(req: CheckRequest, result: CheckResult): Promise<void> {
    const payload = {
      eventId: randomUUID(),
      userId: req.userId,
      permissionKey: req.permissionKey,
      scope: {
        tenantId: req.scope.tenantId,
        entityId: req.scope.entityId ?? null,
        storeId: req.scope.storeId ?? null,
      },
      route: req.route ?? null,
      reason: result.reason,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.authzOutboxEvent.create({
        data: {
          tenantId: req.scope.tenantId,
          eventType: 'iam.authz.denied',
          aggregateId: req.userId,
          payload,
        },
      });
    } catch {
      // Outbox write is non-fatal to the check decision (deny already returned).
    }
    try {
      await this.events.publish({
        type: 'iam.authz.denied',
        aggregateId: req.userId,
        tenantId: req.scope.tenantId,
        payload,
      } as any);
    } catch {
      /* best-effort publish */
    }
  }
}
