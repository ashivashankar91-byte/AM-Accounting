import type { AuthzClient, AuthzCheckRequest, AuthzCheckResult } from '@amacc/shared-kernel';

// Mirrors services/tax-service/tests/support/fake-authz-client.ts (itself
// mirroring services/posting-recovery-service/tests/support/fake-authz-client.ts)
// — an in-memory stand-in for the real S207 AuthzService so route-level
// authorization/HTTP tests don't need a live auth-service over HTTP.
// Deny-by-default: no matching assignment, or a matching role with no
// grant for the permission, both deny.
export interface FakeAssignment {
  userId: string;
  tenantId: string;
  role: string;
  entityId?: string | null;
  storeId?: string | null;
}

export function createFakeAuthzClient(
  assignments: FakeAssignment[],
  rolePermissions: Record<string, ReadonlySet<string>>,
): AuthzClient {
  return {
    async check(req: AuthzCheckRequest): Promise<AuthzCheckResult> {
      const roles = assignments
        .filter((a) => a.userId === req.userId && a.tenantId === req.scope.tenantId)
        .filter((a) => a.entityId == null || a.entityId === req.scope.entityId)
        .filter((a) => a.storeId == null || a.storeId === req.scope.storeId)
        .map((a) => a.role);

      if (roles.length === 0) {
        return { allow: false, reason: 'NO_MATCHING_ROLE' };
      }
      for (const role of roles) {
        if (rolePermissions[role]?.has(req.permissionKey)) {
          return { allow: true, matchedRole: role };
        }
      }
      return { allow: false, reason: 'NO_MATCHING_ROLE' };
    },
  };
}
