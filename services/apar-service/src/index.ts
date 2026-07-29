import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/apar-client';
import { aparRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaAREntryRepository } from './infrastructure/ar-repository';
import { PrismaAPEntryRepository } from './infrastructure/ap-repository';
import { APARService } from './application/apar-service';
import { VendorService } from './application/vendor-service';
import {
  IEventPublisher, IAREntryRepository, IAPEntryRepository, OutboxProcessor,
  HttpAuthzClient, AuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'apar-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  const prisma = new PrismaClient();
  await prisma.$connect();

  // AMACC-CH04 S036A: set app.current_tenant_id on every query, enforced by
  // RLS policies on vendors/ap_vendor_number_counters/
  // ap_vendor_duplicate_acknowledgements (migration
  // 20260729010001_add_rls_policies_apar_svc). Harmless no-op for this
  // service's other, non-RLS tables.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  app.decorate('prisma', prisma);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register<IAREntryRepository>('IAREntryRepository', { useClass: PrismaAREntryRepository });
  container.register<IAPEntryRepository>('IAPEntryRepository', { useClass: PrismaAPEntryRepository });
  container.register('APARService', { useClass: APARService });
  container.register('VendorService', { useClass: VendorService });
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: unknown, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  app.get('/health', async () => ({ status: 'ok', service: 'apar-service' }));

  // AMACC-CH04 S036A: apar-service had no audit mechanism at all before
  // this — drain audit_outbox to the real S007 audit-service (same pattern
  // as tenant-service/auth-service/coa-service).
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'apar-service',
      onFailed: (row: any, err: unknown, willRetry: boolean) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  app.addHook('onClose', async () => {
    stopAuditDrainer();
    outboxProcessor.stop();
    await prisma.$disconnect();
  });

  const port = parseInt(process.env['PORT'] ?? '3013', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`apar-service listening on :${port}`);

  const outboxProcessor = new OutboxProcessor(
    eventPublisher,
    async () => {
      const records = await prisma.outboxEvent.findMany({
        where: { publishedAt: null, retryCount: { lt: 10 } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      return records.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        tenantId: r.tenantId,
        payload: r.payload as Record<string, unknown>,
        correlationId: r.correlationId,
        publishedAt: r.publishedAt,
        retryCount: r.retryCount,
        lastError: r.lastError,
      }));
    },
    async (id: string) => {
      await prisma.outboxEvent.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async (id: string, error?: string) => {
      await prisma.outboxEvent.update({
        where: { id },
        data: { retryCount: { increment: 1 }, lastError: error ?? null },
      });
    },
  );
  outboxProcessor.startPolling(5000);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start apar-service');
  process.exit(1);
});
