import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import pino from 'pino';
import {
  IEventPublisher,
  HttpAuthzClient, AuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';

import { automationRoutes } from './http';

import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { AutomationEventPublisher } from './infrastructure/automation-event-publisher';
import {
  CloseReadinessClient, MigrationBaselineClient, PostingClient, AccountMappingClient,
  AparAdapter, FixedOpsAdapter, VehicleDealAdapter, PayrollAdapter, OemAdapter, UpstreamRegistry,
} from './infrastructure/upstream-clients';

import { AutomationCapabilityService } from './application/capability-service';
import { PolicyGateService } from './application/policy-gate-service';
import { AutomationItemService } from './application/automation-item-service';
import { AutomationHealthService } from './application/health-service';
import { SandboxService } from './application/sandbox-service';
import { IngestionService } from './application/ingestion-service';
import { LockboxService } from './application/lockbox-service';
import { LifoService } from './application/lifo-service';
import { ChargebackModelService } from './application/chargeback-model-service';
import { PortfolioReserveService } from './application/portfolio-reserve-service';
import { CessionService } from './application/cession-service';
import { OemMatchService } from './application/oem-match-service';
import { IncentiveAccrualService } from './application/incentive-accrual-service';
import { CompositeExportService } from './application/composite-export-service';
import { GaapBridgeService } from './application/gaap-bridge-service';
import { DsarService } from './application/dsar-service';
import { UnclaimedPropertyService } from './application/unclaimed-property-service';
import { SoxEvidenceService } from './application/sox-evidence-service';

const logger = pino({ name: 'automation-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'automation-service',
  });
  await eventPublisher.connect();

  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  container.register('ICloseReadinessClient', { useClass: CloseReadinessClient });
  container.register('IMigrationBaselineClient', { useClass: MigrationBaselineClient });
  container.register('IPostingClient', { useClass: PostingClient });
  container.register('IAccountMappingClient', { useClass: AccountMappingClient });
  container.register('IAparAdapter', { useClass: AparAdapter });
  container.register('IFixedOpsAdapter', { useClass: FixedOpsAdapter });
  container.register('IVehicleDealAdapter', { useClass: VehicleDealAdapter });
  container.register('IPayrollAdapter', { useClass: PayrollAdapter });
  container.register('IOemAdapter', { useClass: OemAdapter });
  container.register('IUpstreamRegistry', { useClass: UpstreamRegistry });
  container.register('IAutomationEventPublisher', { useClass: AutomationEventPublisher });

  container.register(AutomationCapabilityService, { useClass: AutomationCapabilityService });
  container.register(PolicyGateService, { useClass: PolicyGateService });
  container.register(AutomationItemService, { useClass: AutomationItemService });
  container.register(AutomationHealthService, { useClass: AutomationHealthService });
  container.register(SandboxService, { useClass: SandboxService });
  container.register(IngestionService, { useClass: IngestionService });
  container.register(LockboxService, { useClass: LockboxService });
  container.register(LifoService, { useClass: LifoService });
  container.register(ChargebackModelService, { useClass: ChargebackModelService });
  container.register(PortfolioReserveService, { useClass: PortfolioReserveService });
  container.register(CessionService, { useClass: CessionService });
  container.register(OemMatchService, { useClass: OemMatchService });
  container.register(IncentiveAccrualService, { useClass: IncentiveAccrualService });
  container.register(CompositeExportService, { useClass: CompositeExportService });
  container.register(GaapBridgeService, { useClass: GaapBridgeService });
  container.register(DsarService, { useClass: DsarService });
  container.register(UnclaimedPropertyService, { useClass: UnclaimedPropertyService });
  container.register(SoxEvidenceService, { useClass: SoxEvidenceService });

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  await app.register(automationRoutes, { prefix: '/api/v1/automation' });

  app.get('/health', async () => ({ status: 'ok', service: 'automation-service' }));

  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'automation-service',
      onFailed: (row: any, err: any, willRetry: boolean) =>
        logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3056', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`automation-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start automation-service');
  process.exit(1);
});
