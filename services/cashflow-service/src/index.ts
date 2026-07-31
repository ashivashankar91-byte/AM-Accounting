import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/cashflow-client';
import { CashFlowService } from './application/cashflow-service';
import { cashflowRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { DomainEvent, createTenantRlsMiddleware, tenantContextHook, RlsTenantContext } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'cashflow-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();
  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260730000001_add_rls_policies_cashflow_svc) — previously
  // absent entirely, unlike every other Prisma-backed service in this
  // codebase, leaving cashflow_forecasts/daily_cash_actuals with app-level
  // WHERE-clause scoping only and no DB-level defense-in-depth.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  const cashflowService = new CashFlowService(prisma);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'cashflow-service',
  });
  await eventPublisher.connect();

  // Recalculate forecast on relevant events
  const triggerEvents = [
    'JOURNAL_ENTRY_POSTED',
    'PAYROLL_BATCH_POSTED',
    'CASH_RECEIPT_DETAILED',
    'CREDIT_CARD_BATCH_SETTLED',
  ];

  for (const eventType of triggerEvents) {
    eventPublisher.subscribe(eventType, async (event: DomainEvent) => {
      try {
        // Event-driven forecast recalculation has no HTTP request/preHandler
        // to run tenantContextHook, so app.current_tenant_id must be set
        // explicitly here for the RLS-enforced queries inside
        // generateForecast() to see any rows at all.
        RlsTenantContext.set(event.tenantId);
        await cashflowService.generateForecast(event.tenantId);
        logger.info({ eventType, tenantId: event.tenantId }, 'Cash flow forecast updated');
      } catch (err) {
        logger.error({ eventType, err: (err as Error).message }, 'Failed to update forecast');
      }
    });
  }

  await app.register(cashflowRoutes(cashflowService), { prefix: '/api/v1/cashflow' });
  app.get('/health', async () => ({ status: 'ok', service: 'cashflow-service' }));

  const port = parseInt(process.env['PORT'] ?? '3037', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`cashflow-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start cashflow-service');
  process.exit(1);
});
