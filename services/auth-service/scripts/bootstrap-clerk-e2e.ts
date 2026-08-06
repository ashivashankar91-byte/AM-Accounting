/**
 * CE-07 closing pass — one-off script (not part of any production seed path)
 * that creates a real user with a role holding NO posting-engine permissions,
 * so the certification Playwright journey can prove real, backend-enforced
 * unauthorized/forbidden behavior (not a mocked 403). Modeled directly on
 * bootstrap-admin.ts's real UserService/RoleService write path.
 *
 * Usage:
 *   AMACC_TENANT_ID=<uuid> AMACC_CLERK_EMAIL=... npx tsx scripts/bootstrap-clerk-e2e.ts
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/auth-client';
import { RlsTenantContext, IEventPublisher, createTenantRlsMiddleware } from '@amacc/shared-kernel';
import { AuthzService } from '../src/application/authz-service';
import { RoleService } from '../src/application/role-service';
import { UserService } from '../src/application/user-service';

class NoopEventPublisher implements IEventPublisher {
  async publish(): Promise<void> {}
  subscribe(): void {}
}

async function main() {
  const tenantId = process.env['AMACC_TENANT_ID'];
  const email = process.env['AMACC_CLERK_EMAIL'] ?? 'clerk@ce07-cert.test';
  const displayName = process.env['AMACC_CLERK_NAME'] ?? 'CE07 Cert Clerk (no posting-engine access)';
  const password = process.env['AMACC_CLERK_PASSWORD'] ?? 'Ce07-Cert-Clerk-Pass-2026!';
  if (!tenantId) throw new Error('AMACC_TENANT_ID is required');

  const prisma = new PrismaClient();
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  RlsTenantContext.set(tenantId);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', new NoopEventPublisher());
  container.register('AuthzService', { useClass: AuthzService });
  container.register('RoleService', { useClass: RoleService });
  container.register('UserService', { useClass: UserService });

  const roleService = container.resolve<RoleService>('RoleService');
  const userService = container.resolve<UserService>('UserService');

  // A role with a couple of harmless, unrelated permissions (never
  // posting_engine.* or posting-recovery.*) — proves the UI's unauthorized
  // states are driven by real authz denial, not an empty-permission-set edge case.
  const restrictedPermissions = (
    await prisma.permission.findMany({
      where: { key: { contains: '.view' }, AND: [{ key: { not: { contains: 'posting' } } }] },
      select: { key: true },
      take: 2,
    })
  ).map((p) => p.key);
  if (restrictedPermissions.length === 0) throw new Error('No non-posting-engine .view permission found in the catalog to seed a restricted role with.');

  const roleName = 'CE07-Cert-Restricted-Clerk';
  const existingRole = await prisma.role.findFirst({ where: { tenantId, key: roleName.toUpperCase().replace(/-/g, '_') } });
  const role = existingRole
    ? await roleService.updateRole(tenantId, existingRole.id, { permissions: restrictedPermissions, actor: 'bootstrap-clerk-e2e' })
    : await roleService.createRole({ tenantId, name: roleName, permissions: restrictedPermissions, actor: 'bootstrap-clerk-e2e' });
  console.log('role:', role.id, role.name, role.permissions.length, 'permissions (no posting-engine access)');

  let user = await prisma.user.findFirst({ where: { tenantId, email } });
  if (!user) {
    const created = await userService.createUser({ tenantId, email, displayName, actor: 'bootstrap-clerk-e2e' });
    user = await prisma.user.findUnique({ where: { id: created.id } });
  }
  if (!user) throw new Error('user creation failed');
  const reset = await userService.resetUser(tenantId, user.id, 'bootstrap-clerk-e2e');
  await userService.setPassword(tenantId, user.id, reset.resetToken, password);
  console.log('user:', user.id, email);

  const existingAssignment = await prisma.authzRoleAssignment.findFirst({
    where: { tenantId, userId: user.id, role: role.name, entityId: null },
  });
  if (!existingAssignment) {
    await roleService.grantAssignment({ tenantId, userId: user.id, roleId: role.id, entityId: null, allStores: true, actor: 'bootstrap-clerk-e2e' });
  }
  console.log('assignment: restricted role granted tenant-wide to', user.id);

  console.log(JSON.stringify({ tenantId, userId: user.id, email, password, roleId: role.id }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
