/**
 * S019/S020 certification helper — generalization of bootstrap-admin.ts for
 * seeding a user with an ARBITRARY role/permission set (e.g. a CLERK fixture
 * with zero posting_engine.* grants, for the negative/forbidden browser
 * journey step). Same real application-layer path (RoleService/UserService),
 * not raw SQL.
 *
 * Usage:
 *   AMACC_TENANT_ID=<uuid> AMACC_ROLE_KEY=CLERK AMACC_PERMISSIONS="je.view,je.draft.create" \
 *     AMACC_USER_EMAIL=... AMACC_USER_PASSWORD=... npx tsx scripts/bootstrap-role-user.ts
 * AMACC_PERMISSIONS may be empty/unset for a role with no grants at all.
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
  const roleKey = process.env['AMACC_ROLE_KEY'] ?? 'CLERK';
  const permissions = (process.env['AMACC_PERMISSIONS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const email = process.env['AMACC_USER_EMAIL'];
  const displayName = process.env['AMACC_USER_NAME'] ?? `${roleKey} certification fixture`;
  const password = process.env['AMACC_USER_PASSWORD'];
  if (!tenantId) throw new Error('AMACC_TENANT_ID is required');
  if (!email) throw new Error('AMACC_USER_EMAIL is required');
  if (!password) throw new Error('AMACC_USER_PASSWORD is required');

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

  const existingRole = await prisma.role.findFirst({ where: { tenantId, key: roleKey } });
  const role = existingRole
    ? await roleService.updateRole(tenantId, existingRole.id, { permissions, actor: 'bootstrap' })
    : await roleService.createRole({ tenantId, name: roleKey, permissions, actor: 'bootstrap' });
  console.log('role:', role.id, role.name, role.permissions.length, 'permissions');

  let user = await prisma.user.findFirst({ where: { tenantId, email } });
  if (!user) {
    const created = await userService.createUser({ tenantId, email, displayName, actor: 'bootstrap' });
    user = await prisma.user.findUnique({ where: { id: created.id } });
  }
  if (!user) throw new Error('user creation failed');
  const reset = await userService.resetUser(tenantId, user.id, 'bootstrap');
  await userService.setPassword(tenantId, user.id, reset.resetToken, password);
  console.log('user:', user.id, email);

  const existingAssignment = await prisma.authzRoleAssignment.findFirst({
    where: { tenantId, userId: user.id, role: roleKey, entityId: null },
  });
  if (!existingAssignment) {
    await roleService.grantAssignment({
      tenantId, userId: user.id, roleId: role.id, entityId: null, allStores: true, actor: 'bootstrap',
    });
  }
  console.log('assignment:', roleKey, 'granted tenant-wide to', user.id);

  console.log(JSON.stringify({ tenantId, userId: user.id, email, password, roleId: role.id }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
