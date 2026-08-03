import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/payroll-client';
import { payrollRoutes } from './http/routes';
import { payrollPeriodReadinessRoutes } from './http/period-readiness-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PayrollService } from './application/payroll-service';
import { IEventPublisher, OutboxProcessor, createTenantRlsMiddleware, tenantContextHook, AuthzClient, HttpAuthzClient } from '@amacc/shared-kernel';
import { PrismaEmployeeRepository } from './infrastructure/employee-repository';
import { PrismaBatchRepository } from './infrastructure/batch-repository';
import { PrismaPayrollItemRepository } from './infrastructure/payroll-item-repository';
import { PrismaGLMappingRepository } from './infrastructure/gl-mapping-repository';
import { PrismaTaxRateRepository } from './infrastructure/tax-rate-repository';
import { PrismaEmployeeYTDRepository } from './infrastructure/employee-ytd-repository';
import { HttpPostingGateway } from './infrastructure/posting-gateway';
import { HttpCe07RulePackRegistrar } from './infrastructure/ce07-rule-pack-registrar';
import { PayrollSourceRegistry } from './domain/engines/payroll-source-registry';
import { PayrollRulePackService } from './application/rule-pack-service';
import { CommissionService } from './application/commission-service';
import { PaymentHandoffService, HttpCashSettlementVerifier } from './application/payment-handoff-service';
import { PayrollAuditService } from './application/audit-service';
import pino from 'pino';

const logger = pino({ name: 'payroll-service' });

async function bootstrap() {
  if (!process.env['AMACC_JWT_SECRET']) {
    throw new Error('AMACC_JWT_SECRET env var is required');
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // CE-13 gap-closure fix: sets app.current_tenant_id on every query so the
  // FORCE ROW LEVEL SECURITY policies added by migration
  // 20260802000001_add_rls_policies_payroll_svc actually apply (previously
  // unwired here, unlike every other RLS-enabled service — see
  // tax-service/gl-service/coa-service/index.ts for the same pattern). Without
  // this, every payroll query ran with no tenant context and either silently
  // returned zero rows (SELECT) or was rejected by the WITH CHECK policy
  // (INSERT/UPDATE), discovered live during CE-13 Playwright certification.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'payroll-service',
  });
  await eventPublisher.connect();

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  // CE-13 RBAC gap-closure: server-side permission enforcement uses the same
  // auth-service permission catalog / AuthzClient pattern already wired in
  // tax-service and coa-service (see their src/index.ts).
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));
  container.register('IEmployeeRepository', { useClass: PrismaEmployeeRepository });
  container.register('IBatchRepository', { useClass: PrismaBatchRepository });
  container.register('IPayrollItemRepository', { useClass: PrismaPayrollItemRepository });
  container.register('IGLMappingRepository', { useClass: PrismaGLMappingRepository });
  container.register('ITaxRateRepository', { useClass: PrismaTaxRateRepository });
  container.register('IEmployeeYTDRepository', { useClass: PrismaEmployeeYTDRepository });
  container.register('IPostingGateway', { useClass: HttpPostingGateway });
  container.register('ICe07RulePackRegistrar', { useClass: HttpCe07RulePackRegistrar });
  container.registerSingleton('PayrollSourceRegistry', PayrollSourceRegistry);
  container.register('PayrollService', { useClass: PayrollService });
  container.register('PayrollRulePackService', { useClass: PayrollRulePackService });
  container.register('CommissionService', { useClass: CommissionService });
  container.register('ICashSettlementVerifier', { useClass: HttpCashSettlementVerifier });
  container.register('PaymentHandoffService', { useClass: PaymentHandoffService });
  container.register('PayrollAuditService', { useClass: PayrollAuditService });

  // Start outbox processor
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

  app.addHook('onClose', async () => {
    (outboxProcessor as any).stopPolling?.();
    await prisma.$disconnect();
  });

  await app.register(payrollRoutes, { prefix: '/api/v1/payroll' });
  await app.register(payrollPeriodReadinessRoutes, { prefix: '/api/v1/payroll' });
  app.get('/health', async () => ({ status: 'ok', service: 'payroll-service' }));

  const port = parseInt(process.env['PORT'] ?? '3012', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`payroll-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start payroll-service');
  process.exit(1);
});