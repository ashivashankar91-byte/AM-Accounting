import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { coaRoutes } from './http/routes';
import { configRoutes } from './http/config-routes';
import { fiscalRoutes } from './http/fiscal-routes';
import { periodRoutes } from './http/period-routes';
import { accountRoutes } from './http/account-routes';
import { seedRoutes } from './http/seed-routes';
import { sourceRoutes } from './http/source-routes';
import { sequenceRoutes } from './http/sequence-routes';
import { journalRoutes } from './http/journal-routes';
import { draftRoutes } from './http/draft-routes';
import { CoAService } from './application/coa-service';
import { ConfigService } from './application/config-service';
import { FiscalCalendarService } from './application/fiscal-service';
import { PeriodService } from './application/period-service';
import { AccountService } from './application/account-service';
import { SeedService } from './application/seed-service';
import { SourceService } from './application/source-service';
import { SequenceService } from './application/sequence-service';
import { PostingService } from './application/posting-service';
import { JournalViewService } from './application/journal-view-service';
import { ReversalService } from './application/reversal-service';
import { DraftService } from './application/draft-service';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { IEventPublisher, HttpAuthzClient, AuthzClient } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import pino from 'pino';

const logger = pino({ name: 'coa-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // ── DI ──────────────────────────────────────────────────────────────────────
  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  const prisma = new PrismaClient();
  container.registerInstance('PrismaClient', prisma);

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  // S223: typed, scoped, effective-dated configuration registry.
  container.register('ConfigService', { useClass: ConfigService });
  const config = container.resolve<ConfigService>('ConfigService');

  // S208: per-entity fiscal calendar + deterministic date->period resolution.
  container.register('FiscalCalendarService', { useClass: FiscalCalendarService });

  // S209: period FUTURE->OPEN transitions, status board + eligibility API.
  container.register('PeriodService', { useClass: PeriodService });

  // S210: entity-scoped Chart of Accounts CRUD (Prisma-backed).
  container.register('AccountService', { useClass: AccountService });

  // S010: canonical COA skeleton seed (idempotent, merge-by-number).
  container.register('SeedService', { useClass: SeedService });

  // S212: journal source registry (manual GJ + reserved system sources).
  container.register('SourceService', { useClass: SourceService });

  // S213: atomic journal numbering sequences + gap logging/report.
  container.register('SequenceService', { useClass: SequenceService });

  // S013: balanced journal posting API (single point of ledger truth).
  container.register('PostingService', { useClass: PostingService });

  // S217: read-only journal view (header, lines, linkage, masked serialization).
  container.register('JournalViewService', { useClass: JournalViewService });

  // S218: reverse a posted JE (mirrored lines through the single posting door).
  container.register('ReversalService', { useClass: ReversalService });

  // S214: draft manual JE scratchpad (create/save any state + attachments).
  container.register('DraftService', { useClass: DraftService });

  // Cache invalidation on config.changed (belt-and-braces; put() also invalidates
  // in-process). Keeps propagation within the <=60s target across replicas.
  try {
    (eventPublisher as unknown as { subscribe?: (t: string, h: (e: any) => Promise<void>) => void })
      .subscribe?.('config.changed', async () => config.invalidateAll());
  } catch {
    /* subscribe optional — cache also self-expires via TTL */
  }

  // ── Routes ────────────────────────────────────────────────────────────────────
  // Legacy standard-COA / OEM-mapping helper (read-only STANDARD_COA constant).
  // S210 adds the real Prisma-backed account CRUD at /api/v1/coa/accounts; this
  // helper is retained for its /standard, /oem-mapping, /legacy-map endpoints
  // (used by S010 seed) and holds no financial CRUD state.
  const coaService = new CoAService();
  await app.register(coaRoutes(coaService), { prefix: '/api/v1/coa' });

  await app.register(accountRoutes, { prefix: '/api/v1/coa' });

  await app.register(seedRoutes, { prefix: '/api/v1/coa' });

  await app.register(sourceRoutes, { prefix: '/api/v1/coa' });

  await app.register(sequenceRoutes, { prefix: '/api/v1/coa' });

  await app.register(journalRoutes, { prefix: '/api/v1/coa' });

  await app.register(draftRoutes, { prefix: '/api/v1/coa' });

  await app.register(configRoutes, { prefix: '/api/v1/config' });

  await app.register(fiscalRoutes, { prefix: '/api/v1/fiscal' });

  await app.register(periodRoutes, { prefix: '/api/v1/fiscal' });

  app.get('/health', async () => ({ status: 'ok', service: 'coa-service' }));

  const port = parseInt(process.env['PORT'] ?? '3016', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`coa-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start coa-service');
  process.exit(1);
});
