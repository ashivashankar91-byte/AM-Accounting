import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/schedule-client';
import { scheduleRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaScheduleRepository } from './infrastructure/schedule-repository';
import { PrismaScheduleDetailRepository } from './infrastructure/schedule-detail-repository';
import { PrismaSchedulePermissionRepository } from './infrastructure/schedule-permission-repository';
import { ScheduleApplicationService, SCHEDULE_REPO_TOKEN, SCHEDULE_DETAIL_REPO_TOKEN, SCHEDULE_PERMISSION_REPO_TOKEN, EVENT_PUBLISHER_TOKEN } from './application/schedule-service';
import { ScheduleEventHandlers } from './application/event-handlers';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { OutboxProcessor } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'schedule-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Prisma connected');

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();
  logger.info('RabbitMQ connected');

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>(EVENT_PUBLISHER_TOKEN, eventPublisher);
  container.register(SCHEDULE_REPO_TOKEN, { useClass: PrismaScheduleRepository });
  container.register(SCHEDULE_DETAIL_REPO_TOKEN, { useClass: PrismaScheduleDetailRepository });
  container.register(SCHEDULE_PERMISSION_REPO_TOKEN, { useClass: PrismaSchedulePermissionRepository });
  container.register(ScheduleApplicationService, { useClass: ScheduleApplicationService });

  // Wire inbound events
  const eventHandlers = container.resolve(ScheduleEventHandlers);
  eventPublisher.subscribe('JOURNAL_ENTRY_POSTED', async (event) => {
    await eventHandlers.handleJournalEntryPosted(event.payload as any);
  });

  await app.register(scheduleRoutes);

  app.get('/health', async () => ({ status: 'ok', service: 'schedule-service' }));

  const port = parseInt(process.env['PORT'] ?? '3012', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  logger.info(`schedule-service listening on ${host}:${port}`);

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

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down schedule-service...');
    outboxProcessor.stop();
    await app.close();
    await prisma.$disconnect();
    await eventPublisher.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start schedule-service:', err);
  process.exit(1);
});
