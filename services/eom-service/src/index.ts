import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/eom-client';
import { eomRoutes } from './http/routes';
import { thirteenthMonthRoutes } from './http/thirteenth-month-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaEOMCloseRepository } from './infrastructure/eom-close-repository';
import { PrismaEOMStepRepository } from './infrastructure/eom-step-repository';
import { EOMService } from './application/eom-service';
import { EOMOrchestrator } from './domain/orchestrator';
import {
  PreCloseChecklistHandler,
  VerifyOpenItemsHandler,
  PartsInventoryCloseHandler,
  PartsReconHandler,
  ServiceCloseHandler,
  BodyShopCloseHandler,
  VariableOpsHandler,
  FixedOpsHandler,
  MasterCloseHandler,
  FSGenerationHandler,
  FSSubmissionHandler,
  ThirteenthMonthSnapshotHandler,
  ThirteenthMonthFinalHandler,
} from './domain/step-handlers';
import { IEventPublisher, IEOMCloseRepository, IEOMStepRepository, OutboxProcessor } from '@amacc/shared-kernel';
import type { IGLClient } from './application/eom-service';
import { CloseMonitor } from './domain/close-monitor';
import { HttpGLClient } from './infrastructure/gl-client';
import { PrismaYearEndRecordRepository } from './infrastructure/year-end-repository';
import pino from 'pino';

const logger = pino({ name: 'eom-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();

  // Step handlers — Interface Segregation: each handles one step
  const orchestrator = new EOMOrchestrator([
    new PreCloseChecklistHandler(),
    new VerifyOpenItemsHandler(),
    new PartsInventoryCloseHandler(),
    new PartsReconHandler(),
    new ServiceCloseHandler(),
    new BodyShopCloseHandler(),
    new VariableOpsHandler(),
    new FixedOpsHandler(),
    new MasterCloseHandler(),
    new FSGenerationHandler(),
    new FSSubmissionHandler(),
    new ThirteenthMonthSnapshotHandler(),
    new ThirteenthMonthFinalHandler(),
  ]);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.registerInstance('EOMOrchestrator', orchestrator);
  container.registerInstance<IGLClient>('IGLClient', new HttpGLClient());
  container.register<IEOMCloseRepository>('IEOMCloseRepository', { useClass: PrismaEOMCloseRepository });
  container.register<IEOMStepRepository>('IEOMStepRepository', { useClass: PrismaEOMStepRepository });
  container.register('IYearEndRecordRepository', { useClass: PrismaYearEndRecordRepository });
  container.register('EOMService', { useClass: EOMService });

  const closeMonitor = new CloseMonitor(eventPublisher);

  await app.register(eomRoutes, { prefix: '/api/v1/eom' });
  await app.register(thirteenthMonthRoutes, { prefix: '/api/v1/eom' });

  // Close readiness check
  app.get('/api/v1/eom/readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
    const result = await closeMonitor.checkReadiness(tenantId);
    return reply.send(result);
  });

  app.get('/health', async () => ({ status: 'ok', service: 'eom-service' }));

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
    await prisma.$disconnect();
  });

  const port = parseInt(process.env['PORT'] ?? '3011', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`eom-service listening on :${port}`);

  closeMonitor.startScheduledMonitoring('tenant-kunes');
  logger.info('Close monitor started');

  outboxProcessor.startPolling(5000);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start eom-service');
  process.exit(1);
});
