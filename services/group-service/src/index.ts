import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/group-client';
import { GroupService } from './application/group-service';
import { ConsolidationService } from './application/consolidation-service';
import { groupRoutes } from './http/routes';
import { consolidationRoutes } from './http/consolidation-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { OutboxProcessor } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'group-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();

  const groupService = new GroupService(prisma);
  const consolidationService = new ConsolidationService(prisma);

  await app.register(groupRoutes(groupService), { prefix: '/api/v1/groups' });
  await app.register(consolidationRoutes(consolidationService), { prefix: '/api/v1/groups' });
  app.get('/health', async () => ({ status: 'ok', service: 'group-service' }));

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

  app.addHook('onClose', async () => {
    outboxProcessor.stop();
  });

  const port = parseInt(process.env['PORT'] ?? '3039', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`group-service listening on :${port}`);
  outboxProcessor.startPolling(5000);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start group-service');
  process.exit(1);
});
