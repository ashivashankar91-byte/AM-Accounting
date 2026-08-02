import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/close-service-client';
import { closeRoutes } from './http/close-routes';
import { reconciliationRoutes } from './http/reconciliation-routes';
import { scrubRoutes } from './http/scrub-routes';
import { yearEndRoutes } from './http/year-end-routes';
import { kpiRoutes } from './http/kpi-routes';
import { snapshotRoutes } from './http/snapshot-routes';
import { archiveRoutes } from './http/archive-routes';
import { currencyRoutes } from './http/currency-routes';
import { docRoutes } from './http/doc-routes';
import { complianceRoutes } from './http/compliance-routes';
import { taxPackRoutes } from './http/tax-pack-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaCloseRepository } from './infrastructure/close-repository';
import { PrismaReconciliationRepository } from './infrastructure/reconciliation-repository';
import { PrismaScrubRepository } from './infrastructure/scrub-repository';
import { PrismaYearEndRepository } from './infrastructure/year-end-repository';
import { PrismaKpiRepository } from './infrastructure/kpi-repository';
import { PrismaSnapshotRepository } from './infrastructure/snapshot-repository';
import { PrismaArchiveRepository } from './infrastructure/archive-repository';
import { PrismaCurrencyRepository } from './infrastructure/currency-repository';
import { UpstreamModuleClient } from './infrastructure/upstream-module-client';
import { ClosePeriodService } from './application/close-service';
import { ReconciliationService } from './application/reconciliation-service';
import { ScrubService } from './application/scrub-service';
import { YearEndService } from './application/year-end-service';
import { KpiService } from './application/kpi-service';
import { SnapshotService } from './application/snapshot-service';
import { ArchiveService } from './application/archive-service';
import { CurrencyService } from './application/currency-service';
import { DocService } from './application/doc-service';
import { ComplianceServiceCe15 } from './application/compliance-service-ce15';
import { TaxPackService } from './application/tax-pack-service';
import {
  IEventPublisher,
  HttpAuthzClient, AuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'close-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'close-service',
  });
  await eventPublisher.connect();

  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  container.register('ICloseRepository', { useClass: PrismaCloseRepository });
  container.register('IReconciliationRepository', { useClass: PrismaReconciliationRepository });
  container.register('IScrubRepository', { useClass: PrismaScrubRepository });
  container.register('IYearEndRepository', { useClass: PrismaYearEndRepository });
  container.register('IKpiRepository', { useClass: PrismaKpiRepository });
  container.register('ISnapshotRepository', { useClass: PrismaSnapshotRepository });
  container.register('IArchiveRepository', { useClass: PrismaArchiveRepository });
  container.register('ICurrencyRepository', { useClass: PrismaCurrencyRepository });

  container.register(ClosePeriodService, { useClass: ClosePeriodService });
  container.register(ReconciliationService, { useClass: ReconciliationService });
  container.register(ScrubService, { useClass: ScrubService });
  container.register(YearEndService, { useClass: YearEndService });
  container.register(KpiService, { useClass: KpiService });
  container.register(SnapshotService, { useClass: SnapshotService });
  container.register(ArchiveService, { useClass: ArchiveService });
  container.register(CurrencyService, { useClass: CurrencyService });
  container.register(DocService, { useClass: DocService });
  container.register(ComplianceServiceCe15, { useClass: ComplianceServiceCe15 });
  container.register(TaxPackService, { useClass: TaxPackService });
  container.register(UpstreamModuleClient, { useClass: UpstreamModuleClient });

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  await app.register(closeRoutes, { prefix: '/api/v1/close' });
  await app.register(reconciliationRoutes, { prefix: '/api/v1/close' });
  await app.register(scrubRoutes, { prefix: '/api/v1/close' });
  await app.register(yearEndRoutes, { prefix: '/api/v1/close/year-end' });
  await app.register(kpiRoutes, { prefix: '/api/v1/close/kpi' });
  await app.register(snapshotRoutes, { prefix: '/api/v1/close/snapshots' });
  await app.register(archiveRoutes, { prefix: '/api/v1/close/archive' });
  await app.register(currencyRoutes, { prefix: '/api/v1/close/currency' });
  await app.register(docRoutes, { prefix: '/api/v1/close/doc' });
  await app.register(complianceRoutes, { prefix: '/api/v1/close/compliance' });
  await app.register(taxPackRoutes, { prefix: '/api/v1/close/tax-pack' });

  app.get('/health', async () => ({ status: 'ok', service: 'close-service' }));

  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'close-service',
      onFailed: (row: any, err: any, willRetry: boolean) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3052', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`close-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch(err => {
  logger.error(err, 'Failed to start close-service');
  process.exit(1);
});
