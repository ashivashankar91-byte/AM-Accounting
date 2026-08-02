import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { cashDrawerRoutes } from './http/cash-drawer-routes';
import { cashReceiptRoutes } from './http/cash-receipt-routes';
import { DrawerService } from './application/cash-drawer-service';
import { ReceiptSequenceService } from './application/receipt-sequence-service';
import { ReceiptService } from './application/cash-receipt-service';
import { ToleranceService } from './application/tolerance-service';
import { BlindCloseService } from './application/blind-close-service';
import { ReconciliationService } from './application/reconciliation-service';
import { CashReceiptPostingPort, HttpCashReceiptPostingPort, NoopCashReceiptPostingPort } from './application/cash-receipt-posting-consumer';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import {
  IEventPublisher, HttpAuthzClient, AuthzClient,
  HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import pino from 'pino';

const logger = pino({ name: 'cash-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // ── DI ──────────────────────────────────────────────────────────────────────
  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'cash-service',
  });
  await eventPublisher.connect();
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  const prisma = new PrismaClient();

  // Same RLS wiring as every other AMACC service — sets app.current_tenant_id
  // on every query, enforced by RLS policies (see the S052 RLS migration).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  // CE-07/S052 (D-S023-04) — real accounting consumer for cash.receipt.issued.
  // Falls back to a no-op when AMACC_JWT_SECRET isn't configured.
  const postingJwtSecret = process.env['AMACC_JWT_SECRET'];
  container.registerInstance<CashReceiptPostingPort>(
    'CashReceiptPostingPort',
    postingJwtSecret ? new HttpCashReceiptPostingPort(postingJwtSecret) : new NoopCashReceiptPostingPort(),
  );

  container.register('DrawerService', { useClass: DrawerService });
  container.register('ReceiptSequenceService', { useClass: ReceiptSequenceService });
  container.register('ReceiptService', { useClass: ReceiptService });
  container.register('ToleranceService', { useClass: ToleranceService });
  container.register('BlindCloseService', { useClass: BlindCloseService });
  container.register('ReconciliationService', { useClass: ReconciliationService });

  // ── Routes ────────────────────────────────────────────────────────────────────
  await app.register(cashDrawerRoutes, { prefix: '/api/v1/cash' });
  await app.register(cashReceiptRoutes, { prefix: '/api/v1/cash' });

  app.get('/health', async () => ({ status: 'ok', service: 'cash-service' }));

  // Drain audit_outbox to the real S007 audit-service — same pattern as
  // every other AMACC service.
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'cash-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3050', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`cash-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start cash-service');
  process.exit(1);
});
