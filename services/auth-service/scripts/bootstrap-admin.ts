/**
 * FINAL-R0 bootstrap-admin script (Priority 2 prerequisite).
 *
 * Seeds the very first ADMIN role, permission grants, tenant-wide role
 * assignment, and a real password-enabled user for a freshly-created tenant
 * -- via auth-service's OWN real application-layer classes (UserService,
 * RoleService), not raw SQL and not a bypass of business logic. This is the
 * standard "bootstrap the first admin" pattern every deny-by-default authz
 * system needs (there is, by design, no user who can grant the first grant
 * through the permission-gated HTTP API). Every subsequent request still
 * goes through the real S207 authz check exactly as before.
 *
 * Usage:
 *   AMACC_TENANT_ID=<uuid> AMACC_ADMIN_EMAIL=... npx tsx scripts/bootstrap-admin.ts
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
  const email = process.env['AMACC_ADMIN_EMAIL'] ?? 'admin@kunes-final-r0.test';
  const displayName = process.env['AMACC_ADMIN_NAME'] ?? 'Final R0 Bootstrap Admin';
  const password = process.env['AMACC_ADMIN_PASSWORD'] ?? 'Final-R0-Bootstrap-Passw0rd!';
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

  // 1. All cataloged permissions, granted to a real ADMIN role (idempotent).
  const allPermissions = (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key);
  const existingRole = await prisma.role.findFirst({ where: { tenantId, key: 'ADMIN' } });
  const role = existingRole
    ? await roleService.updateRole(tenantId, existingRole.id, { permissions: allPermissions, actor: 'bootstrap' })
    : await roleService.createRole({ tenantId, name: 'ADMIN', permissions: allPermissions, actor: 'bootstrap' });
  console.log('role:', role.id, role.name, role.permissions.length, 'permissions');

  // 2. Real user, created then password-enabled via the real reset-token flow
  //    (UserService.createUser -> resetUser -> setPassword) -- the same path
  //    S205 certifies for any other user, just invoked in-process instead of
  //    over HTTP, since no permission exists yet to call the HTTP route with.
  let user = await prisma.user.findFirst({ where: { tenantId, email } });
  if (!user) {
    const created = await userService.createUser({ tenantId, email, displayName, actor: 'bootstrap' });
    user = await prisma.user.findUnique({ where: { id: created.id } });
  }
  if (!user) throw new Error('user creation failed');
  const reset = await userService.resetUser(tenantId, user.id, 'bootstrap');
  await userService.setPassword(tenantId, user.id, reset.resetToken, password);
  console.log('user:', user.id, email);

  // 3. Tenant-wide (entityId=null) ADMIN assignment via the real RoleService
  //    write path -- projects into both role_assignment (S206) and
  //    authz_role_assignment (S207 read model) exactly like a normal grant.
  const existingAssignment = await prisma.authzRoleAssignment.findFirst({
    where: { tenantId, userId: user.id, role: 'ADMIN', entityId: null },
  });
  if (!existingAssignment) {
    await roleService.grantAssignment({
      tenantId, userId: user.id, roleId: role.id, entityId: null, allStores: true, actor: 'bootstrap',
    });
  }
  console.log('assignment: ADMIN granted tenant-wide to', user.id);

  console.log(JSON.stringify({ tenantId, userId: user.id, email, password, roleId: role.id }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
