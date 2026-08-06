import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { postingRecoveryRoutes } from './http/dead-letter-routes';
import { DeadLetterIntakeService } from './application/dead-letter-intake-service';
import { PostingRecoveryQueryService } from './application/posting-recovery-query-service';
import { FixtureService } from './application/fixture-service';
import { ReplayService } from './application/replay-service';
import { ReplayReaperService } from './application/replay-reaper-service';
import { CH01PostingExecutionPort, HttpCH01PostingExecutionPort } from './domain/ch01-adapter';
import {
  AuthzClient, HttpAuthzClient,
  HttpAuditClient, AuditOutboxDrainer,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { makePostingRecoveryAuditStore } from './infrastructure/audit';
import { PrismaClient } from '.prisma/posting-recovery-client';
import pino from 'pino';

const logger = pino({ name: 'posting-recovery-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting posting-recovery-service.');
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260729010001_add_rls_policies_posting_recovery_svc).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  app.decorate('prisma', prisma);

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.register(DeadLetterIntakeService, { useClass: DeadLetterIntakeService });
  container.register(PostingRecoveryQueryService, { useClass: PostingRecoveryQueryService });
  container.register(FixtureService, { useClass: FixtureService });
  container.register(ReplayService, { useClass: ReplayService });
  container.register(ReplayReaperService, { useClass: ReplayReaperService });
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  // R1 S021-completion — real CH01 (S019/S020) posting-engine adapter.
  // AMACC_JWT_SECRET is already required above (postingRecoveryRoutes'
  // authMiddleware); reused here to sign the service-to-service token this
  // service presents to coa-service (createServiceToken — same pattern
  // eom-service/apar-service use to call gl-service).
  container.registerInstance<CH01PostingExecutionPort>(
    'CH01PostingExecutionPort',
    new HttpCH01PostingExecutionPort(JWT_SECRET),
  );

  await app.register(postingRecoveryRoutes, { prefix: '/posting-recovery/v1' });
  app.get('/health', async () => ({ status: 'ok', service: 'posting-recovery-service' }));

  // Drain posting_recovery_audit_reference to the real S007 audit-service —
  // same pattern as every other service's audit outbox drainer.
  const auditDrainer = new AuditOutboxDrainer(
    makePostingRecoveryAuditStore((prisma as any).postingRecoveryAuditReference),
    new HttpAuditClient(),
    {
      serviceName: 'posting-recovery-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3049', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`posting-recovery-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start posting-recovery-service');
  process.exit(1);
});
