import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { postingRecoveryRoutes } from '../src/http/dead-letter-routes';
import { PostingRecoveryQueryService } from '../src/application/posting-recovery-query-service';
import { FixtureService } from '../src/application/fixture-service';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { POSTING_RECOVERY_PERMISSIONS } from '../src/http/security';

// R1 S021-completion — Phase 4 regression: _fixtures/* routes must be
// unavailable in a normal (production-shaped) configuration. index.ts only
// registers them when POSTING_RECOVERY_FIXTURES_ENABLED === 'true'
// (see dead-letter-routes.ts's `if (process.env[...] === 'true')` guard,
// evaluated at app.register() time) — this proves both halves: absent by
// default/unset/misspelled, and present only under the explicit opt-in.

const JWT_SECRET = 'posting-recovery-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

function registerCommonFakes() {
  container.registerInstance('PrismaClient', { postingRecoveryAuditReference: { create: vi.fn(async () => ({})) } } as any);
  container.registerInstance(PostingRecoveryQueryService, {
    listQueue: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
  } as any);
  container.registerInstance('AuthzClient', createFakeAuthzClient(
    [{ userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' }],
    { ADMIN: new Set(Object.values(POSTING_RECOVERY_PERMISSIONS)) },
  ));
  container.registerInstance('CH01PostingExecutionPort', { replay: vi.fn(async () => ({ outcome: 'FAILED' })) } as any);
}

describe('Fixture route production safety', () => {
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];
  const originalFixturesFlag = process.env['POSTING_RECOVERY_FIXTURES_ENABLED'];

  afterAll(() => {
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
    process.env['POSTING_RECOVERY_FIXTURES_ENABLED'] = originalFixturesFlag;
  });

  describe('default / unset / misspelled configuration (production-shaped)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
      delete process.env['POSTING_RECOVERY_FIXTURES_ENABLED'];
      registerCommonFakes();
      app = Fastify();
      await app.register(postingRecoveryRoutes, { prefix: '/posting-recovery/v1' });
      await app.ready();
    });

    afterAll(async () => app.close());

    it('POST /_fixtures/dead-letters does not exist when the flag is unset', async () => {
      const res = await app.inject({
        method: 'POST', url: '/posting-recovery/v1/_fixtures/dead-letters',
        headers: authed('ADMIN'), payload: { envelope: {}, actor: 'test' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /_fixtures/dead-letters/:id/attempts does not exist when the flag is unset', async () => {
      const res = await app.inject({
        method: 'POST', url: '/posting-recovery/v1/_fixtures/dead-letters/00000000-0000-0000-0000-000000000000/attempts',
        headers: authed('ADMIN'), payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /_fixtures/dead-letters/:id/transition does not exist when the flag is unset', async () => {
      const res = await app.inject({
        method: 'POST', url: '/posting-recovery/v1/_fixtures/dead-letters/00000000-0000-0000-0000-000000000000/transition',
        headers: authed('ADMIN'), payload: { toStatus: 'RESOLVED' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('remains absent even with an unexpected truthy-but-wrong value ("1", "yes", "TRUE")', async () => {
      for (const value of ['1', 'yes', 'TRUE', 'enabled']) {
        process.env['POSTING_RECOVERY_FIXTURES_ENABLED'] = value;
        const misconfiguredApp = Fastify();
        await misconfiguredApp.register(postingRecoveryRoutes, { prefix: '/posting-recovery/v1' });
        await misconfiguredApp.ready();
        const res = await misconfiguredApp.inject({
          method: 'POST', url: '/posting-recovery/v1/_fixtures/dead-letters',
          headers: authed('ADMIN'), payload: { envelope: {}, actor: 'test' },
        });
        expect(res.statusCode, `flag value "${value}" must not enable fixtures — only the literal string "true" may`).toBe(404);
        await misconfiguredApp.close();
      }
      delete process.env['POSTING_RECOVERY_FIXTURES_ENABLED'];
    });
  });

  describe('explicit test/demo-only opt-in (POSTING_RECOVERY_FIXTURES_ENABLED=true)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
      process.env['POSTING_RECOVERY_FIXTURES_ENABLED'] = 'true';
      registerCommonFakes();
      container.registerInstance(FixtureService, {
        intakeFixture: vi.fn(async () => ({ deadLetterId: 'dl-1', created: true })),
      } as any);
      app = Fastify();
      await app.register(postingRecoveryRoutes, { prefix: '/posting-recovery/v1' });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      delete process.env['POSTING_RECOVERY_FIXTURES_ENABLED'];
    });

    it('POST /_fixtures/dead-letters exists and is reachable once explicitly enabled', async () => {
      const res = await app.inject({
        method: 'POST', url: '/posting-recovery/v1/_fixtures/dead-letters',
        headers: authed('ADMIN'), payload: { envelope: {}, actor: 'test' },
      });
      expect(res.statusCode).not.toBe(404);
    });
  });
});
