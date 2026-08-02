import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import pino from 'pino';
import {
  IEventPublisher,
  HttpAuthzClient, AuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';

import { runRoutes } from './http/run-routes';
import { sourceRoutes, mappingRoutes } from './http/source-routes';
import { comparisonRoutes, archiveRoutes, runbookRoutes } from './http/comparison-routes';

import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { MigrationEventPublisher } from './infrastructure/migration-event-publisher';
import { PrismaMigrationRunRepository } from './infrastructure/migration-run-repository';
import { PrismaSourceRepository } from './infrastructure/source-repository';
import { PrismaMappingRepository } from './infrastructure/mapping-repository';
import { PrismaStagingRepository } from './infrastructure/staging-repository';
import {
  PrismaExceptionRepository, PrismaGateRepository, PrismaControlTotalRepository, PrismaLineageRepository,
} from './infrastructure/evidence-repositories';
import { PrismaComparisonRepository } from './infrastructure/comparison-repository';
import {
  PrismaCutoverRepository, PrismaArchiveRepository, PrismaRunbookRepository,
} from './infrastructure/ceremony-repositories';
import {
  PostingClient, ScheduleClient, CloseReadinessClient, ConsolidationHistoryClient, UpstreamTargetClient,
} from './infrastructure/upstream-clients';

import { MigrationRunService } from './application/migration-run-service';
import { SourceService } from './application/source-service';
import { MappingService } from './application/mapping-service';
import { StagingService } from './application/staging-service';
import { PromotionService } from './application/promotion-service';
import { ExceptionService } from './application/exception-service';
import { ComparisonService } from './application/comparison-service';
import { CutoverService } from './application/cutover-service';
import { ArchiveService } from './application/archive-service';
import { RunbookService } from './application/runbook-service';

const logger = pino({ name: 'migration-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'migration-service',
  });
  await eventPublisher.connect();

  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  container.register('IMigrationRunRepository', { useClass: PrismaMigrationRunRepository });
  container.register('ISourceRepository', { useClass: PrismaSourceRepository });
  container.register('IMappingRepository', { useClass: PrismaMappingRepository });
  container.register('IStagingRepository', { useClass: PrismaStagingRepository });
  container.register('IExceptionRepository', { useClass: PrismaExceptionRepository });
  container.register('IGateRepository', { useClass: PrismaGateRepository });
  container.register('IControlTotalRepository', { useClass: PrismaControlTotalRepository });
  container.register('ILineageRepository', { useClass: PrismaLineageRepository });
  container.register('IComparisonRepository', { useClass: PrismaComparisonRepository });
  container.register('ICutoverRepository', { useClass: PrismaCutoverRepository });
  container.register('IArchiveRepository', { useClass: PrismaArchiveRepository });
  container.register('IRunbookRepository', { useClass: PrismaRunbookRepository });

  container.register('IPostingClient', { useClass: PostingClient });
  container.register('IScheduleClient', { useClass: ScheduleClient });
  container.register('ICloseReadinessProvider', { useClass: CloseReadinessClient });
  container.register('IConsolidationHistoryProvider', { useClass: ConsolidationHistoryClient });
  container.register('IUpstreamTargetClient', { useClass: UpstreamTargetClient });
  container.register('IEventPublisherPort', { useClass: MigrationEventPublisher });

  container.register(MigrationRunService, { useClass: MigrationRunService });
  container.register(SourceService, { useClass: SourceService });
  container.register(MappingService, { useClass: MappingService });
  container.register(StagingService, { useClass: StagingService });
  container.register(PromotionService, { useClass: PromotionService });
  container.register(ExceptionService, { useClass: ExceptionService });
  container.register(ComparisonService, { useClass: ComparisonService });
  container.register(CutoverService, { useClass: CutoverService });
  container.register(ArchiveService, { useClass: ArchiveService });
  container.register(RunbookService, { useClass: RunbookService });

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  await app.register(runRoutes, { prefix: '/api/v1/migration' });
  await app.register(sourceRoutes, { prefix: '/api/v1/migration' });
  await app.register(mappingRoutes, { prefix: '/api/v1/migration' });
  await app.register(comparisonRoutes, { prefix: '/api/v1/migration' });
  await app.register(archiveRoutes, { prefix: '/api/v1/migration' });
  await app.register(runbookRoutes, { prefix: '/api/v1/migration' });

  app.get('/health', async () => ({ status: 'ok', service: 'migration-service' }));

  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'migration-service',
      onFailed: (row: any, err: any, willRetry: boolean) =>
        logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3060', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`migration-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start migration-service');
  process.exit(1);
});
