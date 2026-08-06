import 'reflect-metadata';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { attachRouteSecurity, GL_PERMISSIONS } from '../src/http/security';
import { resolveAudit, resolvePermission } from '../src/http/routes';

describe('trial-balance/export permission and audit mapping', () => {
  it('requires the same permission as the view endpoint (report.tb.view), not a new export permission', () => {
    expect(resolvePermission('GET', '/reports/trial-balance/export')).toBe(GL_PERMISSIONS.REPORT_TB_VIEW);
    expect(resolvePermission('GET', '/reports/trial-balance/export')).toBe(resolvePermission('GET', '/reports/trial-balance'));
  });

  it('maps to docType GL_LEDGER_REPORT with action EXPORTED (matching the balance-sheet/income-statement export convention, not a new docType)', () => {
    const audit = resolveAudit('GET', '/reports/trial-balance/export');
    expect(audit).not.toBeNull();
    expect(audit?.docType).toBe('GL_LEDGER_REPORT');
    expect(audit?.action).toBe('EXPORTED');
    expect(audit?.docId?.({})).toBe('/reports/trial-balance/export');
  });

  it('the plain view route (no /export) still defaults to VIEWED, unaffected by the new export mapping', () => {
    const audit = resolveAudit('GET', '/reports/trial-balance');
    expect(audit).not.toBeNull();
    expect(audit?.docType).toBe('GL_LEDGER_REPORT');
    expect(audit?.action).toBeUndefined(); // undefined -> attachRouteSecurity defaults to 'VIEWED'
  });
});

describe('trial-balance/export audit wrapping (success vs. failure)', () => {
  afterEach(() => {
    container.clearInstances();
    container.reset();
  });

  async function buildApp(statusCode: number) {
    const auditOutboxCreate = vi.fn().mockResolvedValue({});
    const outboxCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (fn: any) =>
        fn({
          outboxEvent: { create: outboxCreate },
          auditOutboxEvent: { create: auditOutboxCreate },
        }),
      ),
    };

    container.registerInstance('AuthzClient', { check: vi.fn().mockResolvedValue({ allow: true }) } as any);

    const app = Fastify();
    app.addHook('preHandler', async (request: any) => {
      request.user = { sub: 'user-export-1' };
    });

    await app.register(
      async (instance) => {
        attachRouteSecurity(instance, prisma as any, resolvePermission, resolveAudit, 401);
        instance.get('/reports/trial-balance/export', async (_request, reply) => {
          if (statusCode >= 400) {
            return reply.status(statusCode).send({ error: 'STRUCTURAL_IMBALANCE', drSum: 100, crSum: 90, delta: 10 });
          }
          reply.header('Content-Type', 'text/csv; charset=utf-8');
          return reply.status(200).send('Account,Name,Type,Opening,Activity,Ending,Debit,Credit');
        });
      },
      { prefix: '/api/v1/gl' },
    );

    return { app, auditOutboxCreate, outboxCreate };
  }

  it('emits exactly one EXPORTED audit event on a successful export', async () => {
    const { app, auditOutboxCreate, outboxCreate } = await buildApp(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-export-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(auditOutboxCreate).toHaveBeenCalledTimes(1);
    expect(auditOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-export-1',
          docType: 'GL_LEDGER_REPORT',
          docId: '/reports/trial-balance/export',
          action: 'EXPORTED',
          actor: 'user-export-1', // resolved server-side from the JWT, never client-supplied
        }),
      }),
    );

    await app.close();
  });

  it('emits NO audit event when the export fails closed (structural imbalance, 500)', async () => {
    const { app, auditOutboxCreate, outboxCreate } = await buildApp(500);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-export-1' },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe('STRUCTURAL_IMBALANCE');
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(auditOutboxCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it('denies the request (403) and emits no audit event when the actor lacks report.tb.view', async () => {
    const auditOutboxCreate = vi.fn().mockResolvedValue({});
    const prisma = { $transaction: vi.fn() };
    container.registerInstance('AuthzClient', { check: vi.fn().mockResolvedValue({ allow: false }) } as any);

    const app = Fastify();
    app.addHook('preHandler', async (request: any) => {
      request.user = { sub: 'user-no-permission' };
    });
    await app.register(
      async (instance) => {
        attachRouteSecurity(instance, prisma as any, resolvePermission, resolveAudit, 401);
        instance.get('/reports/trial-balance/export', async () => ({ shouldNotReach: true }));
      },
      { prefix: '/api/v1/gl' },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-export-1' },
    });

    expect(response.statusCode).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditOutboxCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 401 with no x-tenant-id header (unauthorized/missing-tenant path)', async () => {
    const { app } = await buildApp(200);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance/export?entity=01&asOf=2026-02',
      // no x-tenant-id header
    });
    // getTenantId() throws with the configured missingTenantStatusCode (401 here).
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
