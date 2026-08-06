import type { AuthzClient, AuthzCheckRequest, AuthzCheckResult } from '@amacc/shared-kernel';

/**
 * In-memory stand-in for the real S207 AuthzService, used only in tests.
 * Copied from services/tenant-service/tests/support/fake-authz-client.ts
 * (kept local rather than cross-service-imported — each service's test
 * suite is self-contained in this repo).
 */
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
