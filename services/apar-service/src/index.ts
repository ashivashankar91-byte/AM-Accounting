import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/apar-client';
import { aparRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaAREntryRepository } from './infrastructure/ar-repository';
import { PrismaAPEntryRepository } from './infrastructure/ap-repository';
import { APARService } from './application/apar-service';
import { VendorService } from './application/vendor-service';
import { VendorComplianceService } from './application/vendor-compliance-service';
import { ComplianceVerificationAdapter, ManualComplianceAdapter } from './application/compliance-adapter';
import { InsuranceCertificateService } from './application/insurance-certificate-service';
import { CustomerService } from './application/customer-service';
import { InvoiceMatchService } from './application/invoice-match-service';
import { InvoiceService } from './application/invoice-service';
import { GoodsReceiptService } from './application/goods-receipt-service';
import { ApprovalRuleService } from './application/approval-rule-service';
import { InvoiceApprovalService } from './application/invoice-approval-service';
import { ManualPaymentService } from './application/manual-payment-service';
import { PostingEnginePort, HttpPostingEnginePort } from './application/posting-engine-port';
import {
  IEventPublisher, IAREntryRepository, IAPEntryRepository, OutboxProcessor,
  HttpAuthzClient, AuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'apar-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  const prisma = new PrismaClient();
  await prisma.$connect();

  // AMACC-CH04 S036A: set app.current_tenant_id on every query, enforced by
  // RLS policies on vendors/ap_vendor_number_counters/
  // ap_vendor_duplicate_acknowledgements (migration
  // 20260729010001_add_rls_policies_apar_svc). Harmless no-op for this
  // service's other, non-RLS tables.
  // S038 extends RLS coverage to vendor_insurance_certificates — see
  // migration 20260730000002_s038_vendor_insurance_certificates. S046
  // extends it further to customers/ar_customer_number_counters/
  // ar_customer_duplicate_acknowledgements — see migration
  // 20260730000004_add_rls_policies_customers_apar_svc.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672', serviceName: 'apar-service' });
  await eventPublisher.connect();

  app.decorate('prisma', prisma);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register<IAREntryRepository>('IAREntryRepository', { useClass: PrismaAREntryRepository });
  container.register<IAPEntryRepository>('IAPEntryRepository', { useClass: PrismaAPEntryRepository });
  container.register('APARService', { useClass: APARService });
  container.register('VendorService', { useClass: VendorService });
  // AMACC-CH04 S036B: no external compliance-verification provider exists
  // repository-wide — ManualComplianceAdapter is registered as the only
  // adapter. Swapping in a real provider later means registering a different
  // ComplianceVerificationAdapter implementation here; nothing else changes.
  container.registerInstance<ComplianceVerificationAdapter>('ComplianceVerificationAdapter', new ManualComplianceAdapter());
  container.register('VendorComplianceService', { useClass: VendorComplianceService });
  container.register('InsuranceCertificateService', { useClass: InsuranceCertificateService });
  container.register('CustomerService', { useClass: CustomerService });
  container.register(InvoiceMatchService, { useClass: InvoiceMatchService });
  container.register('InvoiceService', { useClass: InvoiceService });
  container.register('GoodsReceiptService', { useClass: GoodsReceiptService });
  // Registered under both the class token (for @inject(ApprovalRuleService)
  // in InvoiceApprovalService's constructor) and a string token (for the
  // routes.ts string-resolve convention used throughout this file).
  container.register(ApprovalRuleService, { useClass: ApprovalRuleService });
  container.register('ApprovalRuleService', { useClass: ApprovalRuleService });

  // CE-07 (single authoritative ledger decision): InvoiceApprovalService's
  // (S039) outbound seam to coa-service's S019/S020 posting engine. No safe
  // no-op fallback — posting is the whole point of this seam, so a missing
  // AMACC_JWT_SECRET fails loudly at startup rather than silently accepting
  // approvals it can never post (matches coa-service's own GlPostingBridge
  // registration precedent).
  const aparJwtSecret = process.env['AMACC_JWT_SECRET'];
  if (!aparJwtSecret) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required for the AP invoice liability posting seam.');
  }
  container.registerInstance<PostingEnginePort>('PostingEnginePort', new HttpPostingEnginePort(aparJwtSecret));

  container.register('InvoiceApprovalService', { useClass: InvoiceApprovalService });
  container.register('ManualPaymentService', { useClass: ManualPaymentService });
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: unknown, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  await app.register(aparRoutes, { prefix: '/api/v1/apar' });
  app.get('/health', async () => ({ status: 'ok', service: 'apar-service' }));

  // AMACC-CH04 S036A: apar-service had no audit mechanism at all before
  // this — drain audit_outbox to the real S007 audit-service (same pattern
  // as tenant-service/auth-service/coa-service).
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'apar-service',
      onFailed: (row: any, err: unknown, willRetry: boolean) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  app.addHook('onClose', async () => {
    stopAuditDrainer();
    outboxProcessor.stop();
    await prisma.$disconnect();
  });

  const port = parseInt(process.env['PORT'] ?? '3013', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`apar-service listening on :${port}`);

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
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start apar-service');
  process.exit(1);
});
