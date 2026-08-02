import type { AuthzClient } from './authz-client';

/**
 * Route-scope extractor: given the incoming request, return the tenant/entity/
 * store scope to check the permission against. Most routes only have a
 * tenantId at guard time (the resource being acted on doesn't carry an
 * entity/store id, or isn't loaded yet); routes nested under an entity/store
 * path param can supply it so scope-escalation (BR207-4) is enforced, not
 * just tenant membership.
 */
export type AuthzScopeExtractor = (request: any) =>
  | { entityId?: string | null; storeId?: string | null }
  | Promise<{ entityId?: string | null; storeId?: string | null }>;

export interface AuthzGuardOptions {
  getTenantId: (request: any) => string;
  scope?: AuthzScopeExtractor;
}

/**
 * Factory mirroring the shape of the local `requireXPermission(permission)`
 * stubs it replaces, so call sites in route files barely change: same
 * `{ preHandler: requirePermission(SOME_PERMISSIONS.X) }` usage, now backed by
 * the one central S207 engine instead of a per-file duplicated role→Set map.
 */
export function createAuthzGuard(client: AuthzClient, options: AuthzGuardOptions) {
  return function requirePermission(permission: string) {
    return async function checkPermission(request: any, reply: any) {
      const userId = request.user?.sub as string | undefined;
      if (!userId) {
        return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'No authenticated user on request' });
      }
      // Trusted service-to-service calls (createServiceToken) carry role
      // 'SERVICE' and are only issuable by a backend process holding
      // AMACC_JWT_SECRET -- never reachable from a browser/end user. These
      // represent internal automation (e.g. cashflow-service reading GL
      // trial balance, eom-service restoring GL accounts), not a human
      // acting under a role, so they are not looked up in the per-user RBAC
      // engine (which has no role assignment for a serviceId and would
      // always deny with NO_MATCHING_ROLE). authMiddleware/verifyJWT above
      // this guard already enforced signature + expiry, so this is not a
      // bypass of authentication -- only of the human-role permission
      // lookup for already-authenticated internal callers.
      if (request.user?.role === 'SERVICE') {
        return;
      }
      const tenantId = options.getTenantId(request);
      // CE-07 legal-entity isolation defect — scope may now need to resolve
      // entityId from an already-persisted resource (e.g. a rule-pack
      // version's own entityId), not just the request shape, so this
      // extractor may be async. Awaiting a plain (non-Promise) return value
      // is a no-op, so every pre-existing synchronous scope extractor is
      // unaffected.
      const extra = (await options.scope?.(request)) ?? {};
      const result = await client.check({
        userId,
        permissionKey: permission,
        scope: { tenantId, entityId: extra.entityId ?? null, storeId: extra.storeId ?? null },
        route: request.routeOptions?.url ?? request.routerPath ?? request.url,
      });
      if (!result.allow) {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: `Missing required permission: ${permission}`,
          reason: result.reason,
        });
      }
    };
  };
}
