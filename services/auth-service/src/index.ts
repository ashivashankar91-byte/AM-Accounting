import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { authRoutes } from './http/routes';
import { developerRoutes } from './http/developer-routes';
import { authzRoutes } from './http/authz-routes';
import { roleRoutes } from './http/role-routes';
import { roleTemplateRoutes } from './http/role-template-routes';
import { userRoutes } from './http/user-routes';
import { AuthzService } from './application/authz-service';
import { RoleService } from './application/role-service';
import { RoleTemplateService } from './application/role-template-service';
import { UserService } from './application/user-service';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import {
  IEventPublisher, HttpAuditClient, AuditOutboxDrainer,
  makePrismaAuditOutboxStore, makePrismaGenericEventOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/auth-client';
import pino from 'pino';

const logger = pino({ name: 'auth-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // DI registrations
  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'auth-service',
  });
  await eventPublisher.connect();
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  // S207: authorization provider (permission catalog + check API)
  const prisma = new PrismaClient();

  // R0 Stabilization Phase 5 (ADR-001): set app.current_tenant_id on every
  // query, enforced by RLS policies (migration 20260726000003_add_rls_policies).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);
  container.register('AuthzService', { useClass: AuthzService });

  // S206: basic role management (write authority; projects into S207 read models)
  container.register('RoleService', { useClass: RoleService });

  // S004A: dealership position role templates (delegates to RoleService — no
  // separate local permission map; see role-template-service.ts header).
  container.register('RoleTemplateService', { useClass: RoleTemplateService });

  // S205: user account lifecycle (create/deactivate/unlock/reset; emits iam.user.*)
  container.register('UserService', { useClass: UserService });

  // Cache invalidation on role/assignment changes (S206 events).
  const authz = container.resolve<AuthzService>('AuthzService');
  for (const evt of ['iam.role.created', 'iam.role.updated', 'iam.role.retired',
                     'iam.assignment.granted', 'iam.assignment.revoked']) {
    try {
      (eventPublisher as unknown as { subscribe?: (t: string, h: (e: unknown) => Promise<void>) => void })
        .subscribe?.(evt, async () => authz.invalidateCache());
    } catch {
      /* subscribe optional — cache also self-expires via TTL */
    }
  }

  // S206: consume iam.user.deactivated → auto-revoke that user's assignments.
  try {
    (eventPublisher as unknown as { subscribe?: (t: string, h: (e: any) => Promise<void>) => void })
      .subscribe?.('iam.user.deactivated', async (e: any) => {
        const tenantId = e?.tenantId ?? e?.payload?.tenantId;
        const userId = e?.payload?.userId ?? e?.userId;
        if (tenantId && userId) {
          await container.resolve<RoleService>('RoleService').handleUserDeactivated(tenantId, userId);
        }
      });
  } catch {
    /* subscribe optional */
  }

  // Register routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(authzRoutes, { prefix: '/api/v1/authz' });
  await app.register(roleRoutes, { prefix: '/api/v1/iam' });
  await app.register(roleTemplateRoutes, { prefix: '/api/v1/iam' });
  await app.register(userRoutes, { prefix: '/api/v1/iam' });
  if (process.env['NODE_ENV'] === 'development') {
    await app.register(developerRoutes);
  }

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'auth-service' }));
  app.get('/api/v1/auth/health', async () => ({ status: 'ok', service: 'auth-service' }));

  // R0 Stabilization Phase 4: drain audit_outbox to the real S007 audit-service.
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'auth-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  // authz_outbox_events (iam.authz.denied) is a compliance-critical audit
  // trail in its own right — drained separately since it uses the generic
  // eventType/aggregateId/payload outbox shape, not audit_outbox's shape.
  const authzDenialDrainer = new AuditOutboxDrainer(
    makePrismaGenericEventOutboxStore((prisma as any).authzOutboxEvent, () => 'AuthzDenial'),
    new HttpAuditClient(),
    {
      serviceName: 'auth-service-authz-denial',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'authz denial audit delivery failed'),
    },
  );
  const stopAuthzDenialDrainer = authzDenialDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`auth-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); stopAuthzDenialDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start auth-service');
  process.exit(1);
});
