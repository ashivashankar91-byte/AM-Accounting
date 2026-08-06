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
import { glInquiryRoutes, INQUIRY_PERMISSIONS } from '../src/http/gl-inquiry-routes';
import { glSearchRoutes, SEARCH_PERMISSIONS } from '../src/http/gl-search-routes';
import { recurringTemplateRoutes, TEMPLATE_PERMISSIONS } from '../src/http/recurring-template-routes';
import { postingEngineRoutes, POSTING_ENGINE_PERMISSIONS } from '../src/http/posting-engine-routes';

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
    // S008 — ADMIN holds every period-close permission, including the two
    // elevated, ADMIN-only tiers (reopen_hard_closed, lock).
    PERIOD_PERMISSIONS.SOFT_CLOSE, PERIOD_PERMISSIONS.HARD_CLOSE, PERIOD_PERMISSIONS.REOPEN,
    PERIOD_PERMISSIONS.REOPEN_HARD_CLOSED, PERIOD_PERMISSIONS.LOCK,
    SEED_PERMISSIONS.RUN,
    SEQUENCE_PERMISSIONS.GAP_REPORT, SEQUENCE_PERMISSIONS.ALLOCATE,
    SOURCE_PERMISSIONS.VIEW, SOURCE_PERMISSIONS.MANAGE,
    JE_PERMISSIONS.POST, JE_PERMISSIONS.VIEW, JE_PERMISSIONS.REVERSE,
    JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VIEW_ALL,
    JE_DRAFT_PERMISSIONS.VOID, JE_DRAFT_PERMISSIONS.VOID_ANY,
    INQUIRY_PERMISSIONS.VIEW,
    SEARCH_PERMISSIONS.SEARCH,
    // S032 — ADMIN holds all three recurring-template permissions.
    TEMPLATE_PERMISSIONS.MANAGE, TEMPLATE_PERMISSIONS.GENERATE, TEMPLATE_PERMISSIONS.VIEW,
    // S019/S020 — ADMIN holds every posting-engine permission, including the
    // ADMIN-only activation tier (matches the period-close reopen_hard_closed/
    // lock precedent: the highest-risk, hardest-to-reverse transition).
    POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK, POSTING_ENGINE_PERMISSIONS.EDIT_RULE_PACK,
    POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK, POSTING_ENGINE_PERMISSIONS.ACTIVATE_RULE_PACK,
    POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, POSTING_ENGINE_PERMISSIONS.VIEW_EXCEPTION,
  ]),
  ACCOUNTANT: new Set([
    ACCOUNT_PERMISSIONS.VIEW, CONFIG_PERMISSIONS.VIEW, FISCAL_PERMISSIONS.VIEW,
    PERIOD_PERMISSIONS.VIEW, SEQUENCE_PERMISSIONS.GAP_REPORT, SOURCE_PERMISSIONS.VIEW,
    JE_PERMISSIONS.POST, JE_PERMISSIONS.VIEW, JE_PERMISSIONS.REVERSE,
    JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VOID,
    INQUIRY_PERMISSIONS.VIEW,
    SEARCH_PERMISSIONS.SEARCH,
    // S032 — ACCOUNTANT may view the registry and generate journals from a
    // template, but (per the certified authorization matrix / db411c9's
    // corrective pass) does NOT hold MANAGE — deliberately excluded here;
    // see the dedicated "S032 — Accountant may generate but not manage
    // templates" describe block below for the differentiated proof.
    TEMPLATE_PERMISSIONS.GENERATE, TEMPLATE_PERMISSIONS.VIEW,
    // S019/S020 — ACCOUNTANT: read-only/non-destructive posting-engine
    // actions only (no edit, no activate — matches the migration's grants).
    POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK, POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK,
    POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, POSTING_ENGINE_PERMISSIONS.VIEW_EXCEPTION,
  ]),
  // S008 — CONTROLLER: soft-close/hard-close/reopen (SOFT_CLOSED->OPEN) per
  // the auth-service migration's ADMIN+CONTROLLER grant. Deliberately does
  // NOT include reopen_hard_closed or lock — those are the ADMIN-only tier;
  // their absence here is what the dedicated two-tier-separation test below
  // proves (a role with SOME period-close permissions but not the elevated
  // ones is still denied on those two, not just a role with none at all).
  CONTROLLER: new Set([
    PERIOD_PERMISSIONS.VIEW,
    PERIOD_PERMISSIONS.SOFT_CLOSE, PERIOD_PERMISSIONS.HARD_CLOSE, PERIOD_PERMISSIONS.REOPEN,
    // S032 — CONTROLLER holds the same recurring-template grants as ADMIN
    // (view/manage/generate), per the certified authorization matrix.
    TEMPLATE_PERMISSIONS.MANAGE, TEMPLATE_PERMISSIONS.GENERATE, TEMPLATE_PERMISSIONS.VIEW,
    // S019/S020 — CONTROLLER holds rule-pack authoring but NOT activation
    // (the dedicated two-tier test below proves that negative).
    POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK, POSTING_ENGINE_PERMISSIONS.EDIT_RULE_PACK,
    POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK,
    POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, POSTING_ENGINE_PERMISSIONS.VIEW_EXCEPTION,
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
    { story: 'S008', permission: PERIOD_PERMISSIONS.SOFT_CLOSE, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'POST', path: '/fiscal/periods/p1/soft-close', grantedRole: 'CONTROLLER', payload: { reason: 'x' } },
    { story: 'S008', permission: PERIOD_PERMISSIONS.HARD_CLOSE, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'POST', path: '/fiscal/periods/p1/hard-close', grantedRole: 'CONTROLLER', payload: { reason: 'x' } },
    { story: 'S008', permission: PERIOD_PERMISSIONS.REOPEN, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'POST', path: '/fiscal/periods/p1/reopen', grantedRole: 'CONTROLLER', payload: { reason: 'x' } },
    { story: 'S008', permission: PERIOD_PERMISSIONS.REOPEN_HARD_CLOSED, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'POST', path: '/fiscal/periods/p1/reopen-hard-closed', grantedRole: 'ADMIN', payload: { reason: 'x', confirm: true } },
    { story: 'S008', permission: PERIOD_PERMISSIONS.LOCK, routeFn: periodRoutes, serviceToken: 'PeriodService', prefix: '/fiscal', method: 'POST', path: '/fiscal/periods/p1/lock', grantedRole: 'ADMIN', payload: { reason: 'x', confirm: true } },
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
    { story: 'S220', permission: INQUIRY_PERMISSIONS.VIEW, routeFn: glInquiryRoutes, serviceToken: 'GLInquiryService', prefix: '/coa', method: 'GET', path: '/coa/inquiry/accounts/acc-1/activity?periodCode=2026-08', grantedRole: 'ACCOUNTANT' },
    { story: 'S221', permission: SEARCH_PERMISSIONS.SEARCH, routeFn: glSearchRoutes, serviceToken: 'GLSearchService', prefix: '/coa', method: 'GET', path: '/coa/inquiry/search?sourceCode=GJ', grantedRole: 'ACCOUNTANT' },
    { story: 'S032', permission: TEMPLATE_PERMISSIONS.MANAGE, routeFn: recurringTemplateRoutes, serviceToken: 'RecurringTemplateService', prefix: '/coa', method: 'POST', path: '/coa/journal-templates', grantedRole: 'ADMIN', payload: { entityId: 'e1', code: 'RENT', name: 'Rent', lines: [{ accountId: 'a1', storeId: 's1', dr: 100 }, { accountId: 'a2', storeId: 's1', cr: 100 }] } },
    { story: 'S032', permission: TEMPLATE_PERMISSIONS.GENERATE, routeFn: recurringTemplateRoutes, serviceToken: 'RecurringTemplateService', prefix: '/coa', method: 'POST', path: '/coa/journal-templates:generate', grantedRole: 'ACCOUNTANT', payload: { entityId: 'e1', periodId: 'p1' } },
    { story: 'S019', permission: POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK, routeFn: postingEngineRoutes, serviceToken: 'PostingEngineService', prefix: '/coa', method: 'GET', path: '/coa/posting-engine/rule-packs', grantedRole: 'ACCOUNTANT' },
    { story: 'S019', permission: POSTING_ENGINE_PERMISSIONS.EDIT_RULE_PACK, routeFn: postingEngineRoutes, serviceToken: 'PostingEngineService', prefix: '/coa', method: 'POST', path: '/coa/posting-engine/rule-packs', grantedRole: 'CONTROLLER', payload: { packKey: 'cert', sourceText: '{}' } },
    { story: 'S019', permission: POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK, routeFn: postingEngineRoutes, serviceToken: 'PostingEngineService', prefix: '/coa', method: 'POST', path: '/coa/posting-engine/rule-packs/validate', grantedRole: 'ACCOUNTANT', payload: { sourceText: '{}' } },
    { story: 'S019', permission: POSTING_ENGINE_PERMISSIONS.ACTIVATE_RULE_PACK, routeFn: postingEngineRoutes, serviceToken: 'PostingEngineService', prefix: '/coa', method: 'POST', path: '/coa/posting-engine/rule-pack-versions/v1/activate', grantedRole: 'ADMIN', payload: {} },
    { story: 'S020', permission: POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, routeFn: postingEngineRoutes, serviceToken: 'PostingEngineService', prefix: '/coa', method: 'GET', path: '/coa/posting-engine/executions', grantedRole: 'ACCOUNTANT' },
    { story: 'S020', permission: POSTING_ENGINE_PERMISSIONS.VIEW_EXCEPTION, routeFn: postingEngineRoutes, serviceToken: 'PostingEngineService', prefix: '/coa', method: 'GET', path: '/coa/posting-engine/exceptions', grantedRole: 'ACCOUNTANT' },
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

  // ── S008 — two-tier reopen/lock separation ──────────────────────────────────
  // The generic loop above proves each permission is enforced against a role
  // with NO period-close permissions at all. That's not the same as proving
  // the two-TIER split is real: CONTROLLER genuinely holds three of the five
  // S008 permissions (soft_close/hard_close/reopen) yet must still be denied
  // on the two elevated, ADMIN-only ones (reopen_hard_closed, lock) — a
  // stronger negative than "holds nothing".
  describe('S008 — reopen-hard-closed and lock are ADMIN-only, not CONTROLLER (two-tier reopen model)', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      container.registerInstance('PeriodService', permissiveFakeService());
      registerFakeAuthz();
      app = await buildApp(periodRoutes, '/fiscal');
    });

    afterEach(async () => {
      await app.close();
    });

    it('CONTROLLER (holds soft_close/hard_close/reopen) is denied reopen-hard-closed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/fiscal/periods/p1/reopen-hard-closed',
        headers: authed('CONTROLLER'),
        payload: { reason: 'x', confirm: true },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('CONTROLLER (holds soft_close/hard_close/reopen) is denied lock', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/fiscal/periods/p1/lock',
        headers: authed('CONTROLLER'),
        payload: { reason: 'x', confirm: true },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('CONTROLLER can still soft-close, hard-close, and reopen (the ordinary tier is unaffected)', async () => {
      for (const path of ['/fiscal/periods/p1/soft-close', '/fiscal/periods/p1/hard-close', '/fiscal/periods/p1/reopen']) {
        const res = await app.inject({ method: 'POST', url: path, headers: authed('CONTROLLER'), payload: { reason: 'x' } });
        expect(res.statusCode, `expected ${path} to allow CONTROLLER`).not.toBe(403);
      }
    });

    it('ADMIN holds both elevated permissions', async () => {
      for (const path of ['/fiscal/periods/p1/reopen-hard-closed', '/fiscal/periods/p1/lock']) {
        const res = await app.inject({ method: 'POST', url: path, headers: authed('ADMIN'), payload: { reason: 'x', confirm: true } });
        expect(res.statusCode, `expected ${path} to allow ADMIN`).not.toBe(403);
      }
    });
  });

  // ── S019/S020 — activation is ADMIN-only, not CONTROLLER (two-tier model,
  // same shape as the S008 reopen-hard-closed/lock split above) ────────────
  describe('S019 — rule_pack.activate is ADMIN-only, not CONTROLLER (CONTROLLER holds edit/validate but not activate)', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      container.registerInstance('PostingEngineService', permissiveFakeService());
      registerFakeAuthz();
      app = await buildApp(postingEngineRoutes, '/coa');
    });

    afterEach(async () => {
      await app.close();
    });

    it('CONTROLLER (holds edit/validate) is denied activate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/coa/posting-engine/rule-pack-versions/v1/activate',
        headers: authed('CONTROLLER'),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('CONTROLLER can still edit and validate rule packs (the ordinary tier is unaffected)', async () => {
      const edit = await app.inject({ method: 'POST', url: '/coa/posting-engine/rule-packs', headers: authed('CONTROLLER'), payload: { packKey: 'cert', sourceText: '{}' } });
      expect(edit.statusCode).not.toBe(403);
      const validate = await app.inject({ method: 'POST', url: '/coa/posting-engine/rule-packs/validate', headers: authed('CONTROLLER'), payload: { sourceText: '{}' } });
      expect(validate.statusCode).not.toBe(403);
    });

    it('ADMIN holds activate', async () => {
      const res = await app.inject({ method: 'POST', url: '/coa/posting-engine/rule-pack-versions/v1/activate', headers: authed('ADMIN'), payload: {} });
      expect(res.statusCode).not.toBe(403);
    });
  });

  // ── S020 — POST /posting-engine/events is an internal application
  // boundary, not gated by a posting_engine.* business permission (see the
  // route file's header comment). It still requires an authenticated tenant
  // context — proving that distinction is deliberate, not a gap.
  describe('S020 — POST /posting-engine/events requires authentication but no specific business permission', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      container.registerInstance('PostingEngineService', permissiveFakeService());
      registerFakeAuthz();
      app = await buildApp(postingEngineRoutes, '/coa');
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects an unauthenticated request with 401', async () => {
      const res = await app.inject({ method: 'POST', url: '/coa/posting-engine/events', headers: { 'x-tenant-id': 'tenant-a' }, payload: {} });
      expect(res.statusCode).toBe(401);
    });

    it('allows an authenticated role with NO posting_engine.* grants at all (no business permission required)', async () => {
      const res = await app.inject({ method: 'POST', url: '/coa/posting-engine/events', headers: authed('NO_PERMISSIONS_ROLE'), payload: {} });
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });
  });

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

  // ── S032 — Accountant generate-yes/manage-no separation ─────────────────────
  // The generic loop above proves MANAGE is enforced against a role with NO
  // template permissions at all. That's not the same as proving the
  // GENERATE/MANAGE split is real: ACCOUNTANT genuinely holds
  // je.template.generate and je.template.view (per the certified
  // authorization matrix / db411c9's corrective pass) yet must still be
  // denied on every MANAGE-gated action — a stronger negative than "holds
  // nothing", the same shape as the S008 two-tier proof above.
  describe('S032 — Accountant may generate but not manage recurring journal templates', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      container.registerInstance('RecurringTemplateService', permissiveFakeService());
      registerFakeAuthz();
      app = await buildApp(recurringTemplateRoutes, '/coa');
    });

    afterEach(async () => {
      await app.close();
    });

    it('Accountant create template -> 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/coa/journal-templates',
        headers: authed('ACCOUNTANT'),
        payload: { entityId: 'e1', code: 'RENT', name: 'Rent', lines: [{ accountId: 'a1', storeId: 's1', dr: 100 }, { accountId: 'a2', storeId: 's1', cr: 100 }] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('Accountant update template -> 403', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/coa/journal-templates/t1',
        headers: authed('ACCOUNTANT'),
        payload: { name: 'Rent (revised)' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('Accountant deactivate template -> 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/coa/journal-templates/t1/deactivate',
        headers: authed('ACCOUNTANT'),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('Accountant activate template -> 403 (also MANAGE-gated)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/coa/journal-templates/t1/activate',
        headers: authed('ACCOUNTANT'),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('Accountant generate journal -> allowed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/coa/journal-templates:generate',
        headers: authed('ACCOUNTANT'),
        payload: { entityId: 'e1', periodId: 'p1' },
      });
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    it('Accountant can list/view templates (requireTemplateReader — any-of MANAGE/GENERATE/VIEW)', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/journal-templates', headers: authed('ACCOUNTANT') });
      expect(res.statusCode).not.toBe(403);
    });

    it('a role with NO template permissions is denied the reader-gated list endpoint too', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/journal-templates', headers: authed('NO_PERMISSIONS_ROLE') });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', message: 'No recurring-template permissions' });
    });

    it('Controller and Admin (holders of MANAGE) can create/update/deactivate (the manage tier is unaffected)', async () => {
      for (const role of ['ADMIN', 'CONTROLLER']) {
        // Only ADMIN is granted MANAGE per the certified matrix; CONTROLLER
        // is included here to prove it too is denied (matches the S032
        // matrix: CONTROLLER holds view/manage/generate exactly like ADMIN).
        const res = await app.inject({
          method: 'POST',
          url: '/coa/journal-templates',
          headers: authed(role),
          payload: { entityId: 'e1', code: 'RENT', name: 'Rent', lines: [{ accountId: 'a1', storeId: 's1', dr: 100 }, { accountId: 'a2', storeId: 's1', cr: 100 }] },
        });
        expect(res.statusCode, `expected create to allow ${role}`).not.toBe(403);
      }
    });
  });
});
