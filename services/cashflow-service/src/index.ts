import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/cashflow-client';
import { CashFlowService } from './application/cashflow-service';
import { cashflowRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { DomainEvent } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'cashflow-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const cashflowService = new CashFlowService(prisma);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
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
