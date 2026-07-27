import 'reflect-metadata';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { attachRouteSecurity, GL_PERMISSIONS } from '../src/http/security';

describe('attachRouteSecurity audit wrapping', () => {
  afterEach(() => {
    container.clearInstances();
    container.reset();
  });

  it('audits prefixed S014 routes after normalizing the /api/v1/gl prefix', async () => {
    const auditOutboxCreate = vi.fn().mockResolvedValue({});
    const outboxCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (fn: any) => fn({
        outboxEvent: { create: outboxCreate },
        auditOutboxEvent: { create: auditOutboxCreate },
      })),
    };

    container.registerInstance('AuthzClient', {
      check: vi.fn().mockResolvedValue({ allow: true }),
    } as any);

    const app = Fastify();
    app.addHook('preHandler', async (request: any) => {
      request.user = { sub: 'user-1' };
    });

    await app.register(async (instance) => {
      attachRouteSecurity(
        instance,
        prisma as any,
        (_method, url) => (url === '/reports/trial-balance' ? GL_PERMISSIONS.REPORT_TB_VIEW : null),
        (_method, url) => (url === '/reports/trial-balance' ? { docType: 'GL_LEDGER_REPORT' } : null),
        401,
      );

      instance.get('/reports/trial-balance', async () => ({ ok: true }));
    }, { prefix: '/api/v1/gl' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance?entity=01&asOf=2026-02',
      headers: {
        'x-tenant-id': 'tenant-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(auditOutboxCreate).toHaveBeenCalledTimes(1);
    expect(auditOutboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        docType: 'GL_LEDGER_REPORT',
        docId: '/reports/trial-balance',
        action: 'VIEWED',
        actor: 'user-1',
        after: expect.objectContaining({
          route: '/reports/trial-balance',
          method: 'GET',
          statusCode: 200,
        }),
      }),
    }));

    await app.close();
  });
});
