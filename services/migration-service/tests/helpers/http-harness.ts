/**
 * Mounts the real HTTP routes over the in-memory repositories so route-level
 * concerns — RBAC, tenant scope, legal-entity scope, error shape — are tested
 * against the code that actually runs in production, not a stand-in.
 */
import 'reflect-metadata';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe';

import { runRoutes } from '../../src/http/run-routes';
import { sourceRoutes, mappingRoutes } from '../../src/http/source-routes';
import { comparisonRoutes, archiveRoutes, runbookRoutes } from '../../src/http/comparison-routes';

import { MigrationRunService } from '../../src/application/migration-run-service';
import { SourceService } from '../../src/application/source-service';
import { MappingService } from '../../src/application/mapping-service';
import { StagingService } from '../../src/application/staging-service';
import { PromotionService } from '../../src/application/promotion-service';
import { ExceptionService } from '../../src/application/exception-service';
import { ComparisonService } from '../../src/application/comparison-service';
import { CutoverService } from '../../src/application/cutover-service';
import { ArchiveService } from '../../src/application/archive-service';
import { RunbookService } from '../../src/application/runbook-service';

import { makeHarness, TestHarness } from './in-memory-repos';

export const TEST_JWT_SECRET = 'ce16-http-harness-secret';

/**
 * Stands in for the authz service. It holds an explicit grant table so a test
 * can express "this user holds exactly these permissions" and nothing more.
 */
export class GrantTableAuthzClient {
  grants = new Map<string, Set<string>>();
  denials: { userId: string; permissionKey: string }[] = [];
  fail = false;

  grant(userId: string, ...permissions: string[]) {
    const set = this.grants.get(userId) ?? new Set<string>();
    permissions.forEach((p) => set.add(p));
    this.grants.set(userId, set);
    return this;
  }

  revoke(userId: string, permission: string) {
    this.grants.get(userId)?.delete(permission);
    return this;
  }

  async check(request: { userId: string; permissionKey: string; scope?: any; route?: string }) {
    if (this.fail) throw new Error('authz service unreachable');
    const allow = this.grants.get(request.userId)?.has(request.permissionKey) ?? false;
    if (!allow) this.denials.push({ userId: request.userId, permissionKey: request.permissionKey });
    return { allow, reason: allow ? 'GRANTED' : 'PERMISSION_DENIED' };
  }
}

export function signToken(sub: string, tenantId: string, role = 'ACCOUNTANT'): string {
  return jwt.sign({ sub, tenantId, role, email: `${sub}@example.test` }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

export interface HttpHarness {
  app: FastifyInstance;
  authz: GrantTableAuthzClient;
  h: TestHarness;
  close(): Promise<void>;
}

export async function makeHttpHarness(): Promise<HttpHarness> {
  process.env['AMACC_JWT_SECRET'] = TEST_JWT_SECRET;

  container.reset();
  const h = makeHarness();
  const authz = new GrantTableAuthzClient();

  container.registerInstance('IMigrationRunRepository', h.runs);
  container.registerInstance('ISourceRepository', h.sources);
  container.registerInstance('IMappingRepository', h.mappings);
  container.registerInstance('IStagingRepository', h.staging);
  container.registerInstance('IExceptionRepository', h.exceptions);
  container.registerInstance('IGateRepository', h.gates);
  container.registerInstance('IControlTotalRepository', h.controlTotals);
  container.registerInstance('ILineageRepository', h.lineage);
  container.registerInstance('IComparisonRepository', h.comparisons);
  container.registerInstance('ICutoverRepository', h.cutovers);
  container.registerInstance('IArchiveRepository', h.archive);
  container.registerInstance('IRunbookRepository', h.runbooks);
  container.registerInstance('IPostingClient', h.posting);
  container.registerInstance('IScheduleClient', h.schedules);
  container.registerInstance('ICloseReadinessProvider', h.closeReadiness);
  container.registerInstance('IConsolidationHistoryProvider', h.consolidation);
  container.registerInstance('IUpstreamTargetClient', h.upstream);
  container.registerInstance('IEventPublisher', h.events);
  container.registerInstance('IEventPublisherPort', h.events);
  container.registerInstance('AuthzClient', authz as any);

  for (const service of [
    MigrationRunService, SourceService, MappingService, StagingService, PromotionService,
    ExceptionService, ComparisonService, CutoverService, ArchiveService, RunbookService,
  ]) {
    container.register(service as any, { useClass: service as any });
  }

  const app = Fastify({ logger: false });
  await app.register(runRoutes, { prefix: '/api/v1/migration' });
  await app.register(sourceRoutes, { prefix: '/api/v1/migration' });
  await app.register(mappingRoutes, { prefix: '/api/v1/migration' });
  await app.register(comparisonRoutes, { prefix: '/api/v1/migration' });
  await app.register(archiveRoutes, { prefix: '/api/v1/migration' });
  await app.register(runbookRoutes, { prefix: '/api/v1/migration' });
  app.get('/health', async () => ({ status: 'ok', service: 'migration-service' }));
  await app.ready();

  return { app, authz, h, close: () => app.close() };
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  token?: string | null;
  tenantId?: string | null;
  legalEntityId?: string | null;
  payload?: unknown;
}

export function call(harness: HttpHarness, options: CallOptions) {
  const headers: Record<string, string> = {};
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.tenantId) headers['x-tenant-id'] = options.tenantId;
  if (options.legalEntityId) headers['x-legal-entity-id'] = options.legalEntityId;
  return harness.app.inject({
    method: options.method ?? 'GET',
    url: options.url,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload as any }),
  });
}

/** Every permission the CE-16 catalog registers. */
export const ALL_MIGRATION_PERMISSIONS = [
  'migration.source.view', 'migration.source.register',
  'migration.extract.read', 'migration.extract.import',
  'migration.mapping.view', 'migration.mapping.manage', 'migration.mapping.approve',
  'migration.staging.read', 'migration.staging.execute',
  'migration.validation.read', 'migration.validation.execute',
  'migration.exception.view', 'migration.exception.disposition',
  'migration.reconcile.view', 'migration.reconcile.execute',
  'migration.rehearsal.execute',
  'migration.cutover.prepare', 'migration.cutover.approve', 'migration.cutover.execute',
  'migration.rollback.execute',
  'migration.audit.view',
  'migration.sensitive.view',
  'migration.run.read', 'migration.run.create',
] as const;
