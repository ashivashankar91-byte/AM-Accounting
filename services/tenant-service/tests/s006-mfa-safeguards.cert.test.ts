/**
 * S006 — MFA & Safeguards Evidence — Certification Tests
 *
 * AC1: MFA policy CRUD — create, read, update enforcement level
 * AC2: Missing x-tenant-id → 400 on all endpoints
 * AC3: Safeguards evidence records with SHA-256 tamper-detection hash
 * AC4: Evidence query is tenant-scoped (CLAUDE.md rule)
 * AC5: DEMO_FIXTURE mode is clearly labeled — not presented as real TOTP
 * AC6: MFA_VERIFIED evidence persisted with correlationId
 * AC7: Policy enforcement levels: OPTIONAL, REQUIRED_FOR_FINANCE, REQUIRED_ALL
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { mfaRoutes } from '../src/http/mfa-routes';

const TENANT = 'tenant-s006-cert';
const OTHER_TENANT = 'tenant-other-s006';

let state: any;

function makePrisma() {
  state = { policies: [] as any[], evidence: [] as any[] };
  return {
    mfaPolicy: {
      findUnique: vi.fn(({ where }: any) =>
        Promise.resolve(state.policies.find((p: any) => p.tenantId === where.tenantId) ?? null)
      ),
      upsert: vi.fn(({ where, create, update }: any) => {
        const existing = state.policies.find((p: any) => p.tenantId === where.tenantId);
        if (existing) { Object.assign(existing, update); return Promise.resolve({ ...existing }); }
        const row = { id: `mp-${Date.now()}`, ...create, createdAt: new Date(), updatedAt: new Date() };
        state.policies.push(row);
        return Promise.resolve({ ...row });
      }),
    },
    safeguardsEvidence: {
      create: vi.fn(({ data }: any) => {
        const row = { id: `ev-${Date.now()}`, ...data, occurredAt: new Date() };
        state.evidence.push(row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn(({ where }: any) =>
        Promise.resolve(state.evidence.filter((e: any) => e.tenantId === where.tenantId))
      ),
    },
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('prisma', makePrisma());
  await app.register(mfaRoutes, { prefix: '/api/v1/mfa' });
  return app;
}

describe('S006 — MFA & Safeguards Evidence', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
  });

  // AC1: Policy CRUD
  it('AC1: PUT /mfa/policy creates policy; GET returns it', async () => {
    const put = await app.inject({
      method: 'PUT', url: '/api/v1/mfa/policy',
      headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ enforcement: 'REQUIRED_FOR_FINANCE', totpEnabled: true, smsEnabled: false, exemptRoles: [] }),
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body).enforcement).toBe('REQUIRED_FOR_FINANCE');

    const get = await app.inject({ method: 'GET', url: '/api/v1/mfa/policy', headers: { 'x-tenant-id': TENANT } });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).enforcement).toBe('REQUIRED_FOR_FINANCE');
  });

  // AC2: Missing x-tenant-id → 400
  it('AC2: all endpoints return 400 when x-tenant-id header is absent', async () => {
    const [g1, p1, g2, p2] = await Promise.all([
      app.inject({ method: 'GET',  url: '/api/v1/mfa/policy' }),
      app.inject({ method: 'PUT',  url: '/api/v1/mfa/policy', headers: { 'content-type': 'application/json' }, body: '{}' }),
      app.inject({ method: 'GET',  url: '/api/v1/mfa/evidence' }),
      app.inject({ method: 'POST', url: '/api/v1/mfa/evidence', headers: { 'content-type': 'application/json' }, body: '{}' }),
    ]);
    expect(g1.statusCode).toBe(400);
    expect(p1.statusCode).toBe(400);
    expect(g2.statusCode).toBe(400);
    expect(p2.statusCode).toBe(400);
  });

  // AC3: Evidence with SHA-256 hash
  it('AC3: POST /mfa/evidence records event with evidenceHash', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/mfa/evidence',
      headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u-1', eventType: 'MFA_VERIFIED', mfaMethod: 'TOTP' }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.recorded).toBe(true);
    expect(state.evidence[0].tenantId).toBe(TENANT);
    expect(state.evidence[0].evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // AC4: Evidence query is tenant-scoped
  it('AC4: GET /mfa/evidence only returns records for the requesting tenant', async () => {
    // Seed evidence for two tenants via POST
    await app.inject({
      method: 'POST', url: '/api/v1/mfa/evidence',
      headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', eventType: 'MFA_VERIFIED', mfaMethod: 'TOTP' }),
    });
    await app.inject({
      method: 'POST', url: '/api/v1/mfa/evidence',
      headers: { 'x-tenant-id': OTHER_TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u2', eventType: 'MFA_VERIFIED', mfaMethod: 'TOTP' }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/mfa/evidence', headers: { 'x-tenant-id': TENANT } });
    const body = JSON.parse(res.body);
    expect(body.items.every((e: any) => e.tenantId === TENANT)).toBe(true);
    expect(body.items.some((e: any) => e.tenantId === OTHER_TENANT)).toBe(false);
  });

  // AC5: DEMO_FIXTURE mode labeled
  it('AC5: DEMO_FIXTURE method returns demoFixture label — clearly not real TOTP', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/mfa/evidence',
      headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u-demo', eventType: 'MFA_VERIFIED', mfaMethod: 'DEMO_FIXTURE' }),
    });
    const body = JSON.parse(res.body);
    expect(body.demoFixture).toContain('DEMO_FIXTURE');
    expect(body.demoFixture).toContain('simulated');
  });

  // AC6: Correlation ID persisted
  it('AC6: MFA_VERIFIED evidence has correlationId in persisted record', async () => {
    await app.inject({
      method: 'POST', url: '/api/v1/mfa/evidence',
      headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u-cor', eventType: 'MFA_VERIFIED', mfaMethod: 'TOTP', sessionId: 'sess-abc' }),
    });
    expect(state.evidence[0].correlationId).toBeDefined();
    expect(state.evidence[0].sessionId).toBe('sess-abc');
  });

  // AC7: Policy enforcement levels accepted
  it('AC7: all valid enforcement levels are accepted', async () => {
    for (const enforcement of ['OPTIONAL', 'REQUIRED_FOR_FINANCE', 'REQUIRED_ALL']) {
      const res = await app.inject({
        method: 'PUT', url: '/api/v1/mfa/policy',
        headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
        body: JSON.stringify({ enforcement }),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).enforcement).toBe(enforcement);
    }
  });
});
