import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { tenantRoutes } from './http/routes';
import { legalEntityRoutes } from './http/legal-entity-routes';
import { storeRoutes } from './http/store-routes';
import { departmentRoutes } from './http/department-routes';
import { franchiseRoutes, oemRefRoutes } from './http/franchise-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaTenantRepository } from './infrastructure/tenant-repository';
import { TenantService } from './application/tenant-service';
import { LegalEntityService } from './application/legal-entity-service';
import { StoreService } from './application/store-service';
import { DepartmentService } from './application/department-service';
import { FranchiseService } from './application/franchise-service';
import {
  IEventPublisher, ITenantRepository, HttpAuthzClient, AuthzClient,
  HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tenant-client';
import pino from 'pino';

const logger = pino({ name: 'tenant-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // R0 Stabilization Phase 5 (ADR-001): set app.current_tenant_id on every
  // query, enforced by RLS policies (migration 20260726000003_add_rls_policies).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  // Make Prisma available to route handlers via (app as any).prisma
  app.decorate('prisma', prisma);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'tenant-service',
  });
  await eventPublisher.connect();

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register<ITenantRepository>('ITenantRepository', {
    useClass: PrismaTenantRepository,
  } as any);
  container.register('TenantService', { useClass: TenantService });
  container.register('LegalEntityService', { useClass: LegalEntityService });
  container.register('StoreService', { useClass: StoreService });
  container.register('DepartmentService', { useClass: DepartmentService });
  container.register('FranchiseService', { useClass: FranchiseService });
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  await app.register(tenantRoutes, { prefix: '/api/v1/tenants' });
  await app.register(legalEntityRoutes, { prefix: '/api/v1/legal-entities' });
  await app.register(storeRoutes, { prefix: '/api/v1/stores' });
  await app.register(franchiseRoutes, { prefix: '/api/v1/stores' });
  await app.register(departmentRoutes, { prefix: '/api/v1/entities' });
  await app.register(oemRefRoutes, { prefix: '/api/v1/oems' });
  app.get('/health', async () => ({ status: 'ok', service: 'tenant-service' }));

  // R0 Stabilization Phase 4: drain audit_outbox to the real S007 audit-service.
  // See packages/shared-kernel/src/audit/audit-outbox-drainer.ts for why this
  // is a poller rather than relying on RabbitMQEventPublisher.subscribe().
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'tenant-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3002', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`tenant-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start tenant-service');
  process.exit(1);
});
