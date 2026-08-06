import 'reflect-metadata';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { attachRouteSecurity } from '../src/http/security';
import { resolveAudit, resolvePermission, tbAuditMetadata } from '../src/http/routes';

// S014 audit-metadata correction (Product Checkpoint, 2026-07-28): the
// generic audit payload already carried entity/store/dept/asOf inside a raw
// `query` blob, but had no explicit reportType/entityId/storeId/
// departmentId fields. This is additive -- the existing route/method/params/
// query/statusCode fields are untouched (verified below), and docType stays
// GL_LEDGER_REPORT / action stays VIEWED|EXPORTED (no new document type).

describe('tbAuditMetadata', () => {
  it('always includes reportType=TRIAL_BALANCE, entityId, and asOf', () => {
    const meta = tbAuditMetadata({ query: { entity: '01', asOf: '2026-02' } });
    expect(meta).toEqual({ reportType: 'TRIAL_BALANCE', entityId: '01', asOf: '2026-02' });
  });

  it('resolves entityId from the company alias when entity is absent', () => {
    const meta = tbAuditMetadata({ query: { company: '02', asOf: '2026-03' } });
    expect(meta.entityId).toBe('02');
  });

  it('includes storeId only when store is actually supplied', () => {
    const withStore = tbAuditMetadata({ query: { entity: '01', asOf: '2026-02', store: 'S1' } });
    expect(withStore.storeId).toBe('S1');
    const withoutStore = tbAuditMetadata({ query: { entity: '01', asOf: '2026-02' } });
    expect(withoutStore).not.toHaveProperty('storeId');
  });

  it('includes departmentId only when dept is actually supplied', () => {
    const withDept = tbAuditMetadata({ query: { entity: '01', asOf: '2026-02', dept: 'SRV' } });
    expect(withDept.departmentId).toBe('SRV');
    const withoutDept = tbAuditMetadata({ query: { entity: '01', asOf: '2026-02' } });
    expect(withoutDept).not.toHaveProperty('departmentId');
  });

  it('includes both storeId and departmentId when both are supplied', () => {
    const meta = tbAuditMetadata({ query: { entity: '01', asOf: '2026-02', store: 'S1', dept: 'SRV' } });
    expect(meta).toEqual({ reportType: 'TRIAL_BALANCE', entityId: '01', asOf: '2026-02', storeId: 'S1', departmentId: 'SRV' });
  });
});

describe('/reports/trial-balance and /reports/trial-balance/export audit payload includes the new metadata additively', () => {
  afterEach(() => {
    container.clearInstances();
    container.reset();
  });

  async function buildApp(route: string) {
    const auditOutboxCreate = vi.fn().mockResolvedValue({});
    const outboxCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (fn: any) =>
        fn({ outboxEvent: { create: outboxCreate }, auditOutboxEvent: { create: auditOutboxCreate } }),
      ),
    };
    container.registerInstance('AuthzClient', { check: vi.fn().mockResolvedValue({ allow: true }) } as any);

    const app = Fastify();
    app.addHook('preHandler', async (request: any) => {
      request.user = { sub: 'user-meta-1' };
    });
    await app.register(
      async (instance) => {
        attachRouteSecurity(instance, prisma as any, resolvePermission, resolveAudit, 401);
        instance.get(route, async (_request, reply) => reply.status(200).send({ ok: true }));
      },
      { prefix: '/api/v1/gl' },
    );
    return { app, auditOutboxCreate };
  }

  it('view route: audit after payload gains reportType/entityId/storeId/departmentId without losing route/method/params/query/statusCode', async () => {
    const { app, auditOutboxCreate } = await buildApp('/reports/trial-balance');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance?entity=01&store=S1&dept=SRV&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-meta-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(auditOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          docType: 'GL_LEDGER_REPORT',
          action: 'VIEWED',
          after: expect.objectContaining({
            // pre-existing fields, still present (additive, not a rewrite)
            route: '/reports/trial-balance',
            method: 'GET',
            statusCode: 200,
            query: expect.objectContaining({ entity: '01', store: 'S1', dept: 'SRV', asOf: '2026-02' }),
            // new, additive fields
            reportType: 'TRIAL_BALANCE',
            entityId: '01',
            storeId: 'S1',
            departmentId: 'SRV',
            asOf: '2026-02',
          }),
        }),
      }),
    );
    await app.close();
  });

  it('export route: audit after payload gains the same reportType/entityId metadata, action stays EXPORTED, docType stays GL_LEDGER_REPORT', async () => {
    const { app, auditOutboxCreate } = await buildApp('/reports/trial-balance/export');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance/export?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-meta-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(auditOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          docType: 'GL_LEDGER_REPORT',
          action: 'EXPORTED',
          after: expect.objectContaining({
            reportType: 'TRIAL_BALANCE',
            entityId: '01',
            asOf: '2026-02',
          }),
        }),
      }),
    );
    // No storeId/departmentId supplied on this request -- must not appear.
    const call = auditOutboxCreate.mock.calls[0][0];
    expect(call.data.after).not.toHaveProperty('storeId');
    expect(call.data.after).not.toHaveProperty('departmentId');
    await app.close();
  });

  it('view route without store/dept: metadata omits storeId/departmentId entirely (no null placeholders)', async () => {
    const { app, auditOutboxCreate } = await buildApp('/reports/trial-balance');
    await app.inject({
      method: 'GET',
      url: '/api/v1/gl/reports/trial-balance?entity=01&asOf=2026-02',
      headers: { 'x-tenant-id': 'tenant-meta-1' },
    });
    const call = auditOutboxCreate.mock.calls[0][0];
    expect(call.data.after).not.toHaveProperty('storeId');
    expect(call.data.after).not.toHaveProperty('departmentId');
    await app.close();
  });
});
