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
  AcctBackupHandler,
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
    new AcctBackupHandler(prisma),
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
  app.get('/api/v1/eom/status', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    const closes = await prisma.eOMClose.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    }).catch(() => []);
    const latest = closes[0] ?? null;
    return reply.send({
      tenantId,
      hasActiveClose: !!latest,
      currentClose: latest,
      status: latest?.status ?? 'NO_CLOSE_IN_PROGRESS',
    });
  });

  app.get('/api/v1/eom/readiness', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    const result = await closeMonitor.checkReadiness(tenantId);
    return reply.send(result);
  });

  app.get('/health', async () => ({ status: 'ok', service: 'eom-service' }));

  // ── Service Day-End stubs (NS-004 / CF-001) ────────────────────────────────
  // Service Program 6 day-end is a separate domain from accounting EOM close.
  // These stubs satisfy the frontend until a dedicated service-day-end-service exists.
  app.get('/api/v1/service/day-end/readiness', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    return reply.send({
      tenantId,
      ready: true,
      checks: [
        { name: 'Open ROs', passed: true, count: 0 },
        { name: 'Unposted Cash', passed: true, count: 0 },
        { name: 'Parts Inventory', passed: true, count: 0 },
      ],
      lastClose: null,
      message: 'Service day-end service not yet deployed — stub response',
    });
  });

  app.get('/api/v1/service/day-end/history', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    return reply.send({ data: [], total: 0, page: 1, limit: 10 });
  });

  app.post('/api/v1/service/day-end/close', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header is required' });
    return reply.status(503).send({ error: 'Service day-end service not yet deployed' });
  });

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

  // Scheduled monitoring tenant is configured via env var (no hardcoded tenant)
  const monitorTenantId = process.env['MONITOR_TENANT_ID'];
  if (monitorTenantId) {
    closeMonitor.startScheduledMonitoring(monitorTenantId);
    logger.info('Close monitor started');
  } else {
    logger.warn('MONITOR_TENANT_ID not set — scheduled close monitoring disabled');
  }

  outboxProcessor.startPolling(5000);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start eom-service');
  process.exit(1);
});
