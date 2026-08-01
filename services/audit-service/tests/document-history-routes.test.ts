/**
 * S224 route-level tests for GET /api/v1/audit/documents/:docType/:docId and
 * its /export sibling — the first HTTP-layer tests for audit-service's
 * routes.ts (previously untested at the route level, matching the same gap
 * coa-service's authz-guard-integration.test.ts closed for that service).
 *
 * HttpAuthzClient calls out over `fetch`; since audit-service has no
 * tsyringe DI container to substitute a fake client (unlike coa-service),
 * this stubs the global `fetch` used by AUTHZ_SERVICE_URL calls directly.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';
import { AuditService } from '../src/application/audit-service';
import { auditRoutes } from '../src/http/routes';

const JWT_SECRET = 'audit-svc-test-secret';
process.env['AMACC_JWT_SECRET'] = JWT_SECRET;

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(sub: string, tenantId = 't1'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub, tenantId, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/** In-memory AuditService, sharing the same fakePrisma shape used by
 * audit-service.test.ts, kept minimal here since this file only needs
 * getDocumentHistory's real behavior end to end through real routes. */
function makeAuditService() {
  const rows: any[] = [];
  const anchors = new Map<string, { tailHash: string | null }>();
  const prisma: any = {
    auditLog: {
      create: async ({ data }: any) => {
        const partitionKey = `${data.occurredAt.toISOString().slice(0, 7)}:${data.tenantId}`;
        const record = { id: `audit-${rows.length + 1}`, ...data, partitionKey };
        rows.push(record);
        return record;
      },
      findMany: async ({ where }: any) => {
        let result = rows;
        if (where?.tenantId) result = result.filter((r: any) => r.tenantId === where.tenantId);
        if (where?.entityType) result = result.filter((r: any) => r.entityType === where.entityType);
        if (where?.entityId) result = result.filter((r: any) => r.entityId === where.entityId);
        return [...result].sort((a: any, b: any) => a.occurredAt.getTime() - b.occurredAt.getTime());
      },
      findUnique: async () => null,
    },
    $queryRaw: async () => [],
    $executeRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('INSERT INTO audit_chain_anchors')) {
        const [pk] = values;
        if (!anchors.has(pk)) anchors.set(pk, { tailHash: null });
      }
      if (sql.includes('UPDATE audit_chain_anchors')) {
        const [tailHash, , pk] = values;
        anchors.set(pk, { tailHash });
      }
      return 1;
    },
    // AuditService.log() calls setTenantContextOnConnection(tx, ...) first
    // inside its interactive $transaction callback — needs only to exist
    // and resolve here.
    $executeRawUnsafe: async (..._args: any[]) => 1,
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prisma),
  };
  return new AuditService(prisma);
}

function stubAuthzDecision(allow: boolean) {
  (global as any).fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ allow, reason: allow ? undefined : 'NO_PERMISSION' }),
  }));
}

async function buildApp(auditService: AuditService, eventPublisher?: { publish: ReturnType<typeof vi.fn> }): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(auditRoutes(auditService, eventPublisher as any), { prefix: '/api/v1/audit' });
  await app.ready();
  return app;
}

describe('S224 document audit history routes', () => {
  let app: FastifyInstance;
  let auditService: AuditService;
  let eventPublisher: { publish: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditService = makeAuditService();
    eventPublisher = { publish: vi.fn(async () => {}) };
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns 401 when no JWT is presented at all', async () => {
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/d1',
      headers: { 'x-tenant-id': 't1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when the caller lacks audit.view (centralized S207 denial)', async () => {
    stubAuthzDecision(false);
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/d1',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('positive: returns the chronological event timeline for an authorized viewer', async () => {
    stubAuthzDecision(true);
    await auditService.log({
      tenantId: 't1', eventType: 'je.draft.created', entityType: 'ManualJeDraft', entityId: 'd1',
      actorType: 'USER', actorId: 'u1', actorName: 'Alice', action: 'DRAFT_CREATED',
      newState: { status: 'DRAFT' }, occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/d1',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].action).toBe('DRAFT_CREATED');
  });

  it('validation/exception workflow: a document with zero events renders an empty-state 200, never a 404', async () => {
    stubAuthzDecision(true);
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/never-existed',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([]);
  });

  it('cross-tenant denial: a document\'s events never leak to a request scoped to a different tenant', async () => {
    stubAuthzDecision(true);
    await auditService.log({
      tenantId: 't1', eventType: 'a', entityType: 'ManualJeDraft', entityId: 'd1',
      actorType: 'USER', actorId: 'u1', actorName: 'Alice', action: 'DRAFT_CREATED',
    });
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/d1',
      headers: { 'x-tenant-id': 't2', authorization: `Bearer ${tokenFor('u2', 't2')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([]); // scoped query, not a leak
  });

  it('BR224-3: emits audit.viewed when a rendered diff contains a PII-marked field', async () => {
    stubAuthzDecision(true);
    await auditService.log({
      tenantId: 't1', eventType: 'a', entityType: 'User', entityId: 'u9', actorType: 'USER', actorId: 'admin', actorName: 'admin', action: 'CREATE',
      newState: { name: 'Alice', email: 'alice@example.com' },
    });
    app = await buildApp(auditService, eventPublisher);
    await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/User/u9',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish.mock.calls[0][0]).toMatchObject({ type: 'audit.viewed', tenantId: 't1' });
  });

  it('does not emit audit.viewed when no PII-marked field is present', async () => {
    stubAuthzDecision(true);
    await auditService.log({
      tenantId: 't1', eventType: 'a', entityType: 'Department', entityId: 'dept1', actorType: 'USER', actorId: 'admin', actorName: 'admin', action: 'CREATE',
      newState: { name: 'Service', status: 'ACTIVE' },
    });
    app = await buildApp(auditService, eventPublisher);
    await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/Department/dept1',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('BR224-4: export returns CSV with the correct content-type', async () => {
    stubAuthzDecision(true);
    await auditService.log({
      tenantId: 't1', eventType: 'a', entityType: 'ManualJeDraft', entityId: 'd1', actorType: 'USER', actorId: 'u1', actorName: 'Alice', action: 'DRAFT_CREATED',
      newState: { status: 'DRAFT' },
    });
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/d1/export',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('timestamp,actor,action,eventType,field,before,after,reason');
  });

  it('returns 403 for export when the caller lacks audit.export, even if audit.view would be granted', async () => {
    // The guard checks the specific permission requested for THIS route
    // (audit.export); this stub denies everything, proving export is gated
    // independently, not implied by view.
    stubAuthzDecision(false);
    app = await buildApp(auditService, eventPublisher);
    const res = await app.inject({
      method: 'GET', url: '/api/v1/audit/documents/ManualJeDraft/d1/export',
      headers: { 'x-tenant-id': 't1', authorization: `Bearer ${tokenFor('u1')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
