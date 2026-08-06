import type { AuthzClient, AuthzCheckRequest, AuthzCheckResult } from '@amacc/shared-kernel';

/**
 * In-memory stand-in for the real S207 AuthzService, used only in tests.
 * Same pattern as services/apar-service/tests/support/fake-authz-client.ts
 * (kept local rather than cross-service-imported — each service's test
 * suite is self-contained in this repo).
 */
export interface FakeAssignment {
  userId: string;
  tenantId: string;
  role: string;
}

export function createFakeAuthzClient(
  assignments: FakeAssignment[],
  rolePermissions: Record<string, ReadonlySet<string>>,
): AuthzClient {
  return {
    async check(req: AuthzCheckRequest): Promise<AuthzCheckResult> {
      const roles = assignments
        .filter((a) => a.userId === req.userId && a.tenantId === req.scope.tenantId)
        .map((a) => a.role);
      if (roles.length === 0) return { allow: false, reason: 'NO_MATCHING_ROLE' };
      for (const role of roles) {
        if (rolePermissions[role]?.has(req.permissionKey)) return { allow: true, matchedRole: role };
      }
      return { allow: false, reason: 'NO_MATCHING_ROLE' };
    },
  };
}
