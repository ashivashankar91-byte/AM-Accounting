/**
 * R0 Stabilization Phase 3 — route-level authorization tests for coa-service.
 *
 * Before this phase, ZERO coa-service tests exercised the HTTP/route layer at
 * all (confirmed: no test file constructed a Fastify app or called
 * app.inject before this one) — all 205 existing tests are pure
 * application/domain-service unit tests against mocked Prisma clients. This
 * file is the first to prove the 9 coa-service route files' permission
 * guards (now centralized through the real S207 AuthzService via
 * HttpAuthzClient, replacing the 9 duplicated local ROLE_PERMISSIONS stub
 * maps) actually deny-by-default, allow when granted, and enforce tenant
 * scope — end to end through the real guard/DI wiring, not just in theory.
 *
 * Scope: this exercises the GUARD mechanism per distinct permission key
 * (~20 across the 9 files), not every individual endpoint's business logic —
 * every endpoint gated by the same permission key runs the exact same guard
 * code, so testing it twice on two routes sharing one permission would be
 * redundant. Business logic correctness is already covered by each service's
 * own application-layer test file. For the "allowed" case we assert the
 * response is NOT 401/403 (i.e. the guard let the request through to
 * business logic) rather than a specific 2xx body shape, since supplying a
 * fully valid payload for every endpoint is incidental to what's being
 * proven here (see permissiveFakeService in ./support/fake-authz-client).
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { createFakeAuthzClient, permissiveFakeService, FakeAssignment } from './support/fake-authz-client';

import { accountRoutes, ACCOUNT_PERMISSIONS } from '../src/http/account-routes';
import { configRoutes, CONFIG_PERMISSIONS } from '../src/http/config-routes';
import { fiscalRoutes, FISCAL_PERMISSIONS } from '../src/http/fiscal-routes';
import { periodRoutes, PERIOD_PERMISSIONS } from '../src/http/period-routes';
import { seedRoutes, SEED_PERMISSIONS } from '../src/http/seed-routes';
import { sequenceRoutes, SEQUENCE_PERMISSIONS } from '../src/http/sequence-routes';
import { sourceRoutes, SOURCE_PERMISSIONS } from '../src/http/source-routes';
import { journalRoutes, JE_PERMISSIONS } from '../src/http/journal-routes';
import { draftRoutes, JE_DRAFT_PERMISSIONS } from '../src/http/draft-routes';

const JWT_SECRET = 'coa-authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// sub is the role name — the central S207 engine resolves persisted role
// assignments by userId, not the JWT's role claim (see fake-authz-client.ts).
function tokenFor(role: string, tenantId: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  // NOTE: digest('base64url') directly — not digest('binary') fed through
  // Buffer.from() (which defaults to utf8 and corrupts bytes >= 0x80). This
  // matches shared-kernel's verifyJWT/createServiceToken fix (see auth.ts).
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

const TENANT_A_ASSIGNMENTS: FakeAssignment[] = [
  { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
  { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
  { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
  { userId: 'CLERK', tenantId: 'tenant-a', role: 'CLERK' },
];

// Mirrors the 9 files' former local stub grants exactly (see
// docs/accounting-modernization/stabilization/AUTHORIZATION_WRITE_PATH_CENSUS.csv).
const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set([
    ACCOUNT_PERMISSIONS.VIEW, ACCOUNT_PERMISSIONS.MANAGE,
    CONFIG_PERMISSIONS.VIEW, CONFIG_PERMISSIONS.MANAGE,
    FISCAL_PERMISSIONS.VIEW, FISCAL_PERMISSIONS.MANAGE,
    PERIOD_PERMISSIONS.VIEW, PERIOD_PERMISSIONS.OPEN,
    SEED_PERMISSIONS.RUN,
    SEQUENCE_PERMISSIONS.GAP_REPORT, SEQUENCE_PERMISSIONS.ALLOCATE,
    SOURCE_PERMISSIONS.VIEW, SOURCE_PERMISSIONS.MANAGE,
    JE_PERMISSIONS.POST, JE_PERMISSIONS.VIEW, JE_PERMISSIONS.REVERSE,
    JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VIEW_ALL,
    JE_DRAFT_PERMISSIONS.VOID, JE_DRAFT_PERMISSIONS.VOID_ANY,
  ]),
  ACCOUNTANT: new Set([
    ACCOUNT_PERMISSIONS.VIEW, CONFIG_PERMISSIONS.VIEW, FISCAL_PERMISSIONS.VIEW,
    PERIOD_PERMISSIONS.VIEW, SEQUENCE_PERMISSIONS.GAP_REPORT, SOURCE_PERMISSIONS.VIEW,
    JE_PERMISSIONS.POST, JE_PERMISSIONS.VIEW, JE_PERMISSIONS.REVERSE,
    JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VOID,
  ]),
  CLERK: new Set([JE_PERMISSIONS.VIEW, JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VOID]),
};

function registerFakeAuthz(assignments: FakeAssignment[] = TENANT_A_ASSIGNMENTS) {
  container.registerInstance('AuthzClient', createFakeAuthzClient(assignments, ROLE_GRANTS));
}

async function buildApp(routeFn: (app: FastifyInstance) => Promise<void>, prefix: string) {
  const app = Fastify();
  await app.register(routeFn, { prefix });
  await app.ready();
  return app;
}

describe('coa-service route-level authorization (R0 Stabilization Phase 3)', () => {
  const origNodeEnv = process.env['NODE_ENV'];
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
  });

  afterEach(() => {
    process.env['NODE_ENV'] = origNodeEnv;
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  const cases: Array<{
    story: string;
    permission: string;
    routeFn: (app: FastifyInstance) => Promise<void>;
    serviceToken: string;
    prefix: string;
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    grantedRole: string;
    payload?: any;
  }> = [
    { story: 'S210', permission: ACCOUNT_PERMISSIONS.VIEW, routeFn: accountRoutes, serviceToken: 'AccountService', prefix: '/coa', method: 'GET', path: '/coa/accounts', grantedRole: 'ACCOUNTANT' },
    { story: 'S210', permission: ACCOUNT_PERMISSIONS.MANAGE, routeFn: accountRoutes, serviceToken: 'AccountService', prefix: '/coa', method: 'POST', path: '/coa/accounts', grantedRole: 'ADMIN', payload: { number: '10000', name: 'Cash', type: 'ASSET', normalBalance: 'DR' } },
    { story: 'S223', permission: CONFIG_PERMISSIONS.VIEW, routeFn: configRoutes, serviceToken: 'ConfigService', prefix: '/config', method: 'GET', path: '/config/catalog', grantedRole: 'ACCOUNTANT' },
    { story: 'S223', permission: CONFIG_PERMISSIONS.MANAGE, routeFn: configRoutes, serviceToken: 'ConfigService', prefix: '/config', method: 'PUT', path: '/config/some.key', grantedRole: 'ADMIN', payload: { scope: 'TENANT', value: 'x' } },
    { story: 'S208', permission: FISCAL_PERMISSIONS.MANAGE, routeFn: fiscalRoutes, serviceToken: 'FiscalCalendarService', prefix: '/fiscal', method: 'POST', path: '/fiscal/entities/e1/fiscal-calendar', grantedRole: 'ADMIN', payload: { fyStartMonth: 1, structure: 'TWELVE' } },
    { story: 'S209', permission: PERIOD_PERMISSIONS.VIEW, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'GET', path: '/fiscal/periods', grantedRole: 'ACCOUNTANT' },
    { story: 'S209', permission: PERIOD_PERMISSIONS.OPEN, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'POST', path: '/fiscal/periods/p1/open', grantedRole: 'ADMIN', payload: {} },
    { story: 'S010', permission: SEED_PERMISSIONS.RUN, routeFn: seedRoutes, serviceToken: 'SeedService', prefix: '/coa', method: 'POST', path: '/coa/seed', grantedRole: 'ADMIN', payload: {} },
    { story: 'S213', permission: SEQUENCE_PERMISSIONS.GAP_REPORT, routeFn: sequenceRoutes, serviceToken: 'SequenceService', prefix: '/coa', method: 'GET', path: '/coa/journals/gap-report', grantedRole: 'ACCOUNTANT' },
    { story: 'S213', permission: SEQUENCE_PERMISSIONS.ALLOCATE, routeFn: sequenceRoutes, serviceToken: 'SequenceService', prefix: '/coa', method: 'POST', path: '/coa/journal-sequences/allocate', grantedRole: 'ADMIN', payload: { sourceCode: 'GJ', periodCode: '2026-01' } },
    { story: 'S212', permission: SOURCE_PERMISSIONS.VIEW, routeFn: sourceRoutes, serviceToken: 'SourceService', prefix: '/coa', method: 'GET', path: '/coa/journal-sources', grantedRole: 'ACCOUNTANT' },
    { story: 'S212', permission: SOURCE_PERMISSIONS.MANAGE, routeFn: sourceRoutes, serviceToken: 'SourceService', prefix: '/coa', method: 'POST', path: '/coa/journal-sources', grantedRole: 'ADMIN', payload: { code: 'GJ', name: 'General Journal' } },
    { story: 'S013', permission: JE_PERMISSIONS.POST, routeFn: journalRoutes, serviceToken: 'PostingService', prefix: '/coa', method: 'POST', path: '/coa/journals', grantedRole: 'ACCOUNTANT', payload: { entityId: 'e1', date: '2026-01-01', sourceCode: 'GJ', idempotencyKey: 'k1', lines: [{ accountId: 'a1', storeId: 's1', dr: 100 }] } },
    { story: 'S217', permission: JE_PERMISSIONS.VIEW, routeFn: journalRoutes, serviceToken: 'JournalViewService', prefix: '/coa', method: 'GET', path: '/coa/journals/GJ-000001', grantedRole: 'CLERK' },
    { story: 'S218', permission: JE_PERMISSIONS.REVERSE, routeFn: journalRoutes, serviceToken: 'ReversalService', prefix: '/coa', method: 'POST', path: '/coa/journals/id1:reverse', grantedRole: 'ACCOUNTANT', payload: { reason: 'correction' } },
    { story: 'S214', permission: JE_DRAFT_PERMISSIONS.CREATE, routeFn: draftRoutes, serviceToken: 'DraftService', prefix: '/coa', method: 'POST', path: '/coa/manual-journals/drafts', grantedRole: 'CLERK', payload: {} },
    { story: 'S214', permission: JE_DRAFT_PERMISSIONS.EDIT, routeFn: draftRoutes, serviceToken: 'DraftService', prefix: '/coa', method: 'PUT', path: '/coa/manual-journals/drafts/d1', grantedRole: 'ACCOUNTANT', payload: {} },
  ];

  for (const c of cases) {
    describe(`${c.story} — ${c.permission}`, () => {
      let app: FastifyInstance;

      beforeEach(async () => {
        container.registerInstance(c.serviceToken, permissiveFakeService());
        if (c.routeFn === journalRoutes) {
          // journal-routes.ts registers all three services regardless of which endpoint is hit.
          container.registerInstance('PostingService', permissiveFakeService());
          container.registerInstance('JournalViewService', permissiveFakeService());
          container.registerInstance('ReversalService', permissiveFakeService());
        }
        registerFakeAuthz();
        app = await buildApp(c.routeFn, c.prefix);
      });

      afterEach(async () => {
        await app.close();
      });

      it('rejects an unauthenticated request with 401 before any permission check', async () => {
        const res = await app.inject({ method: c.method, url: c.path, headers: { 'x-tenant-id': 'tenant-a' }, payload: c.payload });
        expect(res.statusCode).toBe(401);
      });

      it(`denies a role with no ${c.permission} grant — deny-by-default`, async () => {
        const res = await app.inject({ method: c.method, url: c.path, headers: authed('NO_PERMISSIONS_ROLE'), payload: c.payload });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
      });

      it(`allows ${c.grantedRole}, which is granted ${c.permission}`, async () => {
        const res = await app.inject({ method: c.method, url: c.path, headers: authed(c.grantedRole), payload: c.payload });
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
      });

      it('cross-tenant negative: the grant only exists for tenant-a, so the same user in tenant-c is denied even with matching header+JWT tenantId', async () => {
        const res = await app.inject({
          method: c.method,
          url: c.path,
          headers: { 'x-tenant-id': 'tenant-c', authorization: `Bearer ${tokenFor(c.grantedRole, 'tenant-c')}` },
          payload: c.payload,
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
      });
    });
  }

  // ── draft-routes.ts special cases: requireDraftReader (any-of) + actorOf flags ──

  describe('S214/S219 — requireDraftReader (any granted draft permission may list/view)', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      container.registerInstance('DraftService', permissiveFakeService());
      registerFakeAuthz();
      app = await buildApp(draftRoutes, '/coa');
    });

    afterEach(async () => {
      await app.close();
    });

    it('denies a role with NO draft permissions at all', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/manual-journals/drafts', headers: authed('NO_PERMISSIONS_ROLE') });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', message: 'No draft permissions' });
    });

    it('allows CLERK (granted CREATE/EDIT/VOID, though not VIEW_ALL) to hit the reader-gated list endpoint', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/manual-journals/drafts', headers: authed('CLERK') });
      expect(res.statusCode).not.toBe(403);
    });
  });
});
