import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/recon-client';
import { reconRoutes } from './http/routes';
import { reconSessionRoutes } from './http/recon-session-routes';
import { autoMatchRoutes } from './http/auto-match-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaBankReconRepository } from './infrastructure/recon-repository';
import { PrismaBankTransactionRepository } from './infrastructure/transaction-repository';
import { CashServiceBookItemAdapter, AparServiceBookItemAdapter } from './infrastructure/book-item-source-adapter';
import { ReconService } from './application/recon-service';
import { ReconSessionService } from './application/recon-session-service';
import { AutoMatchService } from './application/auto-match-service';
import {
  IEventPublisher, IBankReconRepository, IBankTransactionRepository,
  HttpAuthzClient, AuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'recon-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  const prisma = new PrismaClient();
  await prisma.$connect();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672', serviceName: 'recon-service' });
  await eventPublisher.connect();

  // S054A — same RLS wiring as every other AMACC service (cash-service,
  // coa-service, etc.): sets app.current_tenant_id on every query,
  // enforced by RLS policies on recon_session/recon_statement_line/
  // recon_book_item (see the S054A RLS migration).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register<IBankReconRepository>('IBankReconRepository', { useClass: PrismaBankReconRepository });
  container.register<IBankTransactionRepository>('IBankTransactionRepository', { useClass: PrismaBankTransactionRepository });
  container.register('ReconService', { useClass: ReconService });

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));
  container.registerInstance('CashServiceBookItemAdapter', new CashServiceBookItemAdapter());
  container.registerInstance('AparServiceBookItemAdapter', new AparServiceBookItemAdapter());
  container.register('ReconSessionService', { useClass: ReconSessionService });
  container.register('AutoMatchService', { useClass: AutoMatchService });

  await app.register(reconRoutes, { prefix: '/api/v1/recon' });
  await app.register(reconSessionRoutes, { prefix: '/api/v1/recon' });
  await app.register(autoMatchRoutes, { prefix: '/api/v1/recon' });
  app.get('/health', async () => ({ status: 'ok', service: 'recon-service' }));

  // S054A — drain audit_outbox to the real S007 audit-service, same
  // pattern as every other AMACC service (e.g. cash-service's index.ts).
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'recon-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3014', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`recon-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start recon-service');
  process.exit(1);
});
