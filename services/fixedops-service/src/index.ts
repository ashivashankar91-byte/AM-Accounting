import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { fixedOpsRoutes } from './http/routes';
import { fixedopsPeriodReadinessRoutes } from './http/period-readiness-routes';
import { RoCloseService } from './application/ro-close-service';
import { RoReversalService } from './application/ro-reversal-service';
import { RoReportService } from './application/ro-report-service';
import { WipModeService } from './application/wip-mode-service';
import { SubletService } from './application/sublet-service';
import { TechTimeService } from './application/tech-time-service';
import { DeferredMaintenanceService } from './application/deferred-maintenance-service';
import { WarrantyClaimService } from './application/warranty-claim-service';
import { ExceptionService } from './application/exception-service';
import { AccountMappingService } from './application/account-mapping-service';
import { LaborRateService } from './application/labor-rate-service';
import { HttpPostingEventProducer, PostingEventProducer } from './infrastructure/posting-client';
import { HttpTaxClient, TaxClient } from './infrastructure/tax-client';
import { makeFixedOpsAuditStore } from './infrastructure/audit';
import {
  AuthzClient, HttpAuthzClient, HttpAuditClient, AuditOutboxDrainer,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/fixedops-client';
import pino from 'pino';

const logger = pino({ name: 'fixedops-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  app.decorate('prisma', prisma);

  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<PostingEventProducer>('PostingEventProducer', new HttpPostingEventProducer(JWT_SECRET));
  container.registerInstance<TaxClient>('TaxClient', new HttpTaxClient(JWT_SECRET));
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  container.register(AccountMappingService, { useClass: AccountMappingService });
  container.register(ExceptionService, { useClass: ExceptionService });
  container.register(WipModeService, { useClass: WipModeService });
  container.register(RoCloseService, { useClass: RoCloseService });
  container.register(RoReversalService, { useClass: RoReversalService });
  container.register(RoReportService, { useClass: RoReportService });
  container.register(SubletService, { useClass: SubletService });
  container.register(TechTimeService, { useClass: TechTimeService });
  container.register(LaborRateService, { useClass: LaborRateService });
  container.register(DeferredMaintenanceService, { useClass: DeferredMaintenanceService });
  container.register(WarrantyClaimService, { useClass: WarrantyClaimService });

  await app.register(fixedOpsRoutes, { prefix: '/api/v1/fixedops' });
  await app.register(fixedopsPeriodReadinessRoutes, { prefix: '/api/v1/fixedops' });
  app.get('/health', async () => ({ status: 'ok', service: 'fixedops-service' }));

  const auditDrainer = new AuditOutboxDrainer(
    makeFixedOpsAuditStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'fixedops-service',
      onFailed: (row: any, err: any, willRetry: any) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3060', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`fixedops-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start fixedops-service');
  process.exit(1);
});
