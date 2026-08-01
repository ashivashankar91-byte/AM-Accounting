import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { taxRoutes } from './http/routes';
import { EngineRegistry } from './domain/engines/engine-registry';
import { TaxCalculationService } from './application/tax-calculation-service';
import { TaxEngineConfigService } from './application/tax-engine-config-service';
import { JurisdictionRegistrationService } from './application/jurisdiction-registration-service';
import { ExemptionCertificateService } from './application/exemption-certificate-service';
import { TaxResultQueryService, TaxAuditQueryService } from './application/tax-result-query-service';
import { TaxExceptionService } from './application/tax-exception-service';
import { ReconciliationService, PostedTaxLineSource, UnwiredPostedTaxLineSource } from './application/reconciliation-service';
import { FeeTableService } from './application/fee-table-service';
import { TaxAccountMappingService } from './application/tax-account-mapping-service';
import { makeTaxAuditStore } from './infrastructure/audit';
import {
  AuthzClient, HttpAuthzClient, HttpAuditClient, AuditOutboxDrainer,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tax-client';
import pino from 'pino';

const logger = pino({ name: 'tax-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260801010001_add_rls_policies_tax_svc). Legal-entity
  // scoping is enforced at the application layer (see
  // src/domain/legal-entity-scope.ts) — RLS stays tenant_id-keyed.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  app.decorate('prisma', prisma);

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance('EngineRegistry', new EngineRegistry());
  // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — CE-07's posting engine is a
  // separate, not-yet-finalized service; wire the real posted-tax-line
  // source here once available, without changing ReconciliationService's
  // contract.
  container.registerInstance<PostedTaxLineSource>('PostedTaxLineSource', new UnwiredPostedTaxLineSource());
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  container.register(TaxCalculationService, { useClass: TaxCalculationService });
  container.register(TaxEngineConfigService, { useClass: TaxEngineConfigService });
  container.register(JurisdictionRegistrationService, { useClass: JurisdictionRegistrationService });
  container.register(ExemptionCertificateService, { useClass: ExemptionCertificateService });
  container.register(TaxResultQueryService, { useClass: TaxResultQueryService });
  container.register(TaxAuditQueryService, { useClass: TaxAuditQueryService });
  container.register(TaxExceptionService, { useClass: TaxExceptionService });
  container.register(ReconciliationService, { useClass: ReconciliationService });
  container.register(FeeTableService, { useClass: FeeTableService });
  container.register(TaxAccountMappingService, { useClass: TaxAccountMappingService });

  await app.register(taxRoutes, { prefix: '/api/v1/tax' });
  app.get('/health', async () => ({ status: 'ok', service: 'tax-service' }));

  // Drain tax_audit_reference to the real S007 audit-service — same
  // pattern as every other service's audit outbox drainer.
  const auditDrainer = new AuditOutboxDrainer(
    makeTaxAuditStore((prisma as any).taxAuditReference),
    new HttpAuditClient(),
    {
      serviceName: 'tax-service',
      onFailed: (row: any, err: any, willRetry: any) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3051', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`tax-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start tax-service');
  process.exit(1);
});
