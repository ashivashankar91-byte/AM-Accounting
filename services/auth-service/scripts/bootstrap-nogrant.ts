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
  const email = process.env['AMACC_USER_EMAIL'] ?? 'nogrant@s036a-cert.test';
  const displayName = process.env['AMACC_USER_NAME'] ?? 'S036A No-Grant User';
  const password = process.env['AMACC_USER_PASSWORD'] ?? 'S036aCert-NoGrant-Passw0rd!';
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

  // A role with a single unrelated permission (iam.catalog.view) — enough to
  // prove authentication works, deliberately excludes every ap.vendor.* key.
  const existingRole = await prisma.role.findFirst({ where: { tenantId, key: 'NOGRANT' } });
  const role = existingRole
    ? await roleService.updateRole(tenantId, existingRole.id, { permissions: ['iam.catalog.view'], actor: 'bootstrap' })
    : await roleService.createRole({ tenantId, name: 'NOGRANT', permissions: ['iam.catalog.view'], actor: 'bootstrap' });
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
    where: { tenantId, userId: user.id, role: 'NOGRANT', entityId: null },
  });
  if (!existingAssignment) {
    await roleService.grantAssignment({
      tenantId, userId: user.id, roleId: role.id, entityId: null, allStores: true, actor: 'bootstrap',
    });
  }
  console.log('assignment: NOGRANT granted tenant-wide to', user.id);
  console.log(JSON.stringify({ tenantId, userId: user.id, email, password, roleId: role.id }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
