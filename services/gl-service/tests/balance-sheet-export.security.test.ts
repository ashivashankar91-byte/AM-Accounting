import 'reflect-metadata';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { attachRouteSecurity, GL_PERMISSIONS } from '../src/http/security';
import { resolveAudit, resolvePermission } from '../src/http/routes';

// Balance Sheet checkpoint (Golden R0 UI convergence, 2026-07-28): the export
// route reuses the SAME generic attachRouteSecurity mechanism already proven
// for Trial Balance export (trial-balance-export.security.test.ts) -- these
// tests exist to prove the mapping and audit-on-success/no-audit-on-failure
// behavior specifically for /reports/balance-sheet/export, including the
// newly-fixed StructuralImbalanceError (TB-level shape) failure path.

describe('balance-sheet/export permission and audit mapping', () => {
  it('requires the same permission as the view endpoint (report.fs.view or gl.ledger.view), not a new export permission', () => {
    expect(resolvePermission('GET', '/reports/balance-sheet/export')).toBe(
      resolvePermission('GET', '/reports/balance-sheet'),
    );
  });

  it('maps to docType GL_LEDGER_REPORT with action EXPORTED (same convention as trial-balance/export, not a new docType)', () => {
    const audit = resolveAudit('GET', '/reports/balance-sheet/export');
    expect(audit).not.toBeNull();
    expect(audit?.docType).toBe('GL_LEDGER_REPORT');
    expect(audit?.action).toBe('EXPORTED');
    expect(audit?.docId?.({})).toBe('/reports/balance-sheet/export');
  });

  it('the plain view route (no /export) still defaults to VIEWED, unaffected by the export mapping', () => {
    const audit = resolveAudit('GET', '/reports/balance-sheet');
    expect(audit).not.toBeNull();
    expect(audit?.docType).toBe('GL_LEDGER_REPORT');
    expect(audit?.action).toBeUndefined(); // undefined -> attachRouteSecurity defaults to 'VIEWED'
  });
});

describe('balance-sheet/export audit wrapping (success vs. failure)', () => {
  afterEach(() => {
    container.clearInstances();
    container.reset();
  });

  async function buildApp(statusCode: number, errorBody?: Record<string, unknown>) {
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
      request.user = { sub: 'user-bs-export-1' };
    });

    await app.register(
      async (instance) => {
        attachRouteSecurity(instance, prisma as any, resolvePermission, resolveAudit, 401);
        instance.get('/reports/balance-sheet/export', async (_request, reply) => {
          if (statusCode >= 400) {
            return reply.status(statusCode).send(errorBody);
          }
          reply.header('Content-Type', 'text/csv; charset=utf-8');
          return reply.status(200).send('Section,Account,Name,Amount');
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
      url: '/api/v1/gl/reports/balance-sheet/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-bs-export-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(auditOutboxCreate).toHaveBeenCalledTimes(1);
    expect(auditOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-bs-export-1',
          docType: 'GL_LEDGER_REPORT',
          docId: '/reports/balance-sheet/export',
          action: 'EXPORTED',
          actor: 'user-bs-export-1',
        }),
      }),
    );

    await app.close();
  });

  it('emits NO audit event when the export fails closed on the TB-level StructuralImbalanceError (the gap this checkpoint fixed)', async () => {
    const { app, auditOutboxCreate, outboxCreate } = await buildApp(500, {
      error: 'STRUCTURAL_IMBALANCE',
      drSum: 75,
      crSum: 0,
      delta: 75,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/balance-sheet/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-bs-export-1' },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe('STRUCTURAL_IMBALANCE');
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(auditOutboxCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it('emits NO audit event when the export fails closed on the FS-level FSStructuralImbalanceError (assets != liabilities+equity)', async () => {
    const { app, auditOutboxCreate, outboxCreate } = await buildApp(500, {
      error: 'STRUCTURAL_IMBALANCE',
      totalAssets: 1000,
      totalLiabilitiesAndEquity: 900,
      delta: 100,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/balance-sheet/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-bs-export-1' },
    });

    expect(response.statusCode).toBe(500);
    expect(outboxCreate).not.toHaveBeenCalled();
    expect(auditOutboxCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it('denies the request (403) and emits no audit event when the actor lacks permission', async () => {
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
        instance.get('/reports/balance-sheet/export', async () => ({ shouldNotReach: true }));
      },
      { prefix: '/api/v1/gl' },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/balance-sheet/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-bs-export-1' },
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
      url: '/api/v1/gl/reports/balance-sheet/export?entity=01&asOf=2026-02',
      // no x-tenant-id header
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
