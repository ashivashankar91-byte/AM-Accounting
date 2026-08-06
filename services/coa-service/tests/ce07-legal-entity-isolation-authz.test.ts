/**
 * CE-07 — final defect closure: proves cross-entity rule-pack reads and
 * mutations are DENIED at the HTTP/authz layer, not just filtered out at
 * the data layer (see posting-engine-legal-entity-isolation-live.test.ts
 * for the data-layer proof).
 *
 * Mirrors the harness already established by authz-guard-integration.test.ts
 * (Fastify app + createFakeAuthzClient + app.inject) — a fake, in-memory
 * PostingEngineService stub here (not permissiveFakeService) so
 * resolveVersionEntityId/resolveExecutionEntityId return real, fixed
 * entityIds for specific test fixture ids, exercising the actual async
 * scope-resolution wiring added to posting-engine-routes.ts by this fix
 * (see its CE-07 comments) — never real Prisma/business logic (already
 * covered by the live-db suite).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { createFakeAuthzClient, FakeAssignment } from './support/fake-authz-client';
import { postingEngineRoutes, POSTING_ENGINE_PERMISSIONS } from '../src/http/posting-engine-routes';

const JWT_SECRET = 'coa-ce07-entity-isolation-test-secret';

const ENTITY_A = 'entity-a';
const ENTITY_B = 'entity-b';
const VERSION_IN_A = 'version-in-entity-a';
const VERSION_IN_B = 'version-in-entity-b';
const EXECUTION_IN_A = 'execution-in-entity-a';
const EXECUTION_IN_B = 'execution-in-entity-b';

/** Fixed, deterministic entity resolution for known fixture ids — the same shape as the real PostingEngineService methods this fix added. */
function fakePostingEngineService() {
  return {
    resolveVersionEntityId: async (_tenantId: string, id: string) => (id === VERSION_IN_A ? ENTITY_A : id === VERSION_IN_B ? ENTITY_B : null),
    resolveExecutionEntityId: async (_tenantId: string, id: string) => (id === EXECUTION_IN_A ? ENTITY_A : id === EXECUTION_IN_B ? ENTITY_B : null),
    resolveExecutionEntityIdByEventId: async (_tenantId: string, eventId: string) => (eventId === 'evt-a' ? ENTITY_A : eventId === 'evt-b' ? ENTITY_B : null),
    activateVersion: async (_t: string, id: string) => ({ id, status: 'ACTIVE' }),
    validateVersion: async (_t: string, id: string) => ({ version: { id, status: 'VALIDATED' }, valid: true, findings: [] }),
    replayEvent: async (_t: string, id: string) => ({ executionId: id, eventId: 'evt', status: 'POSTED', idempotent: false }),
    getRulePack: async (_t: string, packKey: string, entityId: string) => ({ pack: { packKey, entityId }, versions: [] }),
    listRulePacks: async () => [],
    createRulePackVersion: async () => ({ id: 'new-version' }),
    validateDraftSource: async () => ({ valid: true, findings: [] }),
    simulateEvent: async () => ({ wouldPost: false, status: 'NO_RULE_MATCH' }),
    searchExecutions: async () => [],
    getExecutionById: async (_t: string, id: string) => ({ id, entityId: id === EXECUTION_IN_A ? ENTITY_A : ENTITY_B }),
    getExecutionByEventId: async (_t: string, eventId: string) => ({ id: eventId, entityId: eventId === 'evt-a' ? ENTITY_A : ENTITY_B }),
    listReplaysForExecution: async () => [],
    listExceptions: async () => [],
  };
}

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(role: string, tenantId: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-x') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

// Two identities, each granted every posting-engine permission but ONLY
// within their own legal entity — mirrors a real per-entity role
// assignment (see S207's own entityId-scoped grant model).
const ASSIGNMENTS: FakeAssignment[] = [
  { userId: 'ENTITY_A_USER', tenantId: 'tenant-x', role: 'ENTITY_A_USER', entityId: ENTITY_A },
  { userId: 'ENTITY_B_USER', tenantId: 'tenant-x', role: 'ENTITY_B_USER', entityId: ENTITY_B },
  // No entityId restriction — used only to isolate the route handler's own
  // getEntityIdParam 400 (distinct from the entity-scoped-grant 403 the
  // tests above exercise).
  { userId: 'TENANT_ONLY_USER', tenantId: 'tenant-x', role: 'TENANT_ONLY_USER' },
];

const ALL_POSTING_ENGINE_PERMISSIONS = new Set(Object.values(POSTING_ENGINE_PERMISSIONS));

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ENTITY_A_USER: ALL_POSTING_ENGINE_PERMISSIONS,
  ENTITY_B_USER: ALL_POSTING_ENGINE_PERMISSIONS,
  TENANT_ONLY_USER: ALL_POSTING_ENGINE_PERMISSIONS,
};

async function buildApp() {
  const app = Fastify();
  await app.register(postingEngineRoutes, { prefix: '/coa' });
  await app.ready();
  return app;
}

describe('CE-07 — cross-entity rule-pack reads and mutations are denied (HTTP/authz layer)', () => {
  let app: FastifyInstance;
  const origNodeEnv = process.env['NODE_ENV'];
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('PostingEngineService', fakePostingEngineService());
    container.registerInstance('AuthzClient', createFakeAuthzClient(ASSIGNMENTS, ROLE_GRANTS));
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    process.env['NODE_ENV'] = origNodeEnv;
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  describe('activation ceremony', () => {
    it('an entity-A-scoped user is denied activating a version that resolves to entity B', async () => {
      const res = await app.inject({ method: 'POST', url: `/coa/posting-engine/rule-pack-versions/${VERSION_IN_B}/activate`, headers: authed('ENTITY_A_USER'), payload: {} });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });

    it('an entity-A-scoped user CAN activate a version that resolves to entity A', async () => {
      const res = await app.inject({ method: 'POST', url: `/coa/posting-engine/rule-pack-versions/${VERSION_IN_A}/activate`, headers: authed('ENTITY_A_USER'), payload: {} });
      expect(res.statusCode).not.toBe(403);
    });

    it('an entity-B-scoped user is denied activating a version that resolves to entity A (symmetric negative)', async () => {
      const res = await app.inject({ method: 'POST', url: `/coa/posting-engine/rule-pack-versions/${VERSION_IN_A}/activate`, headers: authed('ENTITY_B_USER'), payload: {} });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
    });
  });

  describe('validate', () => {
    it('an entity-A-scoped user is denied validating entity B\'s draft version', async () => {
      const res = await app.inject({ method: 'POST', url: `/coa/posting-engine/rule-pack-versions/${VERSION_IN_B}/validate`, headers: authed('ENTITY_A_USER'), payload: {} });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('replay', () => {
    it('an entity-A-scoped user is denied replaying an execution that resolves to entity B', async () => {
      const res = await app.inject({ method: 'POST', url: `/coa/posting-engine/executions/${EXECUTION_IN_B}/replay`, headers: authed('ENTITY_A_USER'), payload: { reason: 'x' } });
      expect(res.statusCode).toBe(403);
    });

    it('an entity-A-scoped user CAN replay an execution that resolves to entity A', async () => {
      const res = await app.inject({ method: 'POST', url: `/coa/posting-engine/executions/${EXECUTION_IN_A}/replay`, headers: authed('ENTITY_A_USER'), payload: { reason: 'x' } });
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('execution inquiry (by id / by event id / replays)', () => {
    it('GET /executions/:id — entity-A user denied entity B\'s execution', async () => {
      const res = await app.inject({ method: 'GET', url: `/coa/posting-engine/executions/${EXECUTION_IN_B}`, headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).toBe(403);
    });

    it('GET /executions/:id — entity-A user allowed entity A\'s execution', async () => {
      const res = await app.inject({ method: 'GET', url: `/coa/posting-engine/executions/${EXECUTION_IN_A}`, headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).not.toBe(403);
    });

    it('GET /executions/:id/replays — entity-A user denied entity B\'s execution\'s replay evidence', async () => {
      const res = await app.inject({ method: 'GET', url: `/coa/posting-engine/executions/${EXECUTION_IN_B}/replays`, headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).toBe(403);
    });

    it('GET /executions/by-event/:eventId — entity-A user denied entity B\'s event', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/posting-engine/executions/by-event/evt-b', headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).toBe(403);
    });

    it('GET /executions/by-event/:eventId — entity-A user allowed entity A\'s event', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/posting-engine/executions/by-event/evt-a', headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('list/filter routes require an explicit entityId — the browser never infers it', () => {
    it('GET /rule-packs without an entityId query param is never a silent all-entities list (denied — 403 here because this user\'s own grant is itself entity-scoped, so a null scope matches nothing; a tenant-only grant instead gets the handler\'s own 400 — see authz-guard-integration.test.ts)', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/posting-engine/rule-packs', headers: authed('ENTITY_A_USER') });
      expect([400, 403]).toContain(res.statusCode);
    });

    it('GET /rule-packs — entity-A user denied when the entityId query param is entity B\'s', async () => {
      const res = await app.inject({ method: 'GET', url: `/coa/posting-engine/rule-packs?entityId=${ENTITY_B}`, headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).toBe(403);
    });

    it('GET /rule-packs — a tenant-only (not entity-scoped) grant still gets the route handler\'s own 400 for a missing entityId, proving the handler-level guard fires independently of the authz scope outcome', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/posting-engine/rule-packs', headers: authed('TENANT_ONLY_USER') });
      expect(res.statusCode).toBe(400);
    });

    it('GET /rule-packs — entity-A user allowed with their own entityId query param', async () => {
      const res = await app.inject({ method: 'GET', url: `/coa/posting-engine/rule-packs?entityId=${ENTITY_A}`, headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).not.toBe(403);
      expect(res.statusCode).not.toBe(400);
    });

    it('GET /executions without an entityId query param is never a silent all-entities search (denied — see the /rule-packs case above for why this is 403 here, not 400)', async () => {
      const res = await app.inject({ method: 'GET', url: '/coa/posting-engine/executions', headers: authed('ENTITY_A_USER') });
      expect([400, 403]).toContain(res.statusCode);
    });

    it('GET /executions — entity-A user denied when the entityId query param is entity B\'s', async () => {
      const res = await app.inject({ method: 'GET', url: `/coa/posting-engine/executions?entityId=${ENTITY_B}`, headers: authed('ENTITY_A_USER') });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('draft creation cannot claim a different entity than the caller is authorized for', () => {
    it('an entity-A-scoped user is denied creating a draft whose sourceText claims entity B', async () => {
      const res = await app.inject({
        method: 'POST', url: '/coa/posting-engine/rule-packs', headers: authed('ENTITY_A_USER'),
        payload: { packKey: 'x', sourceText: JSON.stringify({ entityId: ENTITY_B, packKey: 'x' }) },
      });
      expect(res.statusCode).toBe(403);
    });

    it('an entity-A-scoped user CAN create a draft claiming their own entity', async () => {
      const res = await app.inject({
        method: 'POST', url: '/coa/posting-engine/rule-packs', headers: authed('ENTITY_A_USER'),
        payload: { packKey: 'x', sourceText: JSON.stringify({ entityId: ENTITY_A, packKey: 'x' }) },
      });
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe('simulate scopes off the envelope\'s own legalEntityId', () => {
    it('an entity-A-scoped user is denied simulating an envelope whose legalEntityId is entity B', async () => {
      const res = await app.inject({
        method: 'POST', url: '/coa/posting-engine/simulate', headers: authed('ENTITY_A_USER'),
        payload: { legalEntityId: ENTITY_B, eventId: 'e1' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('an entity-A-scoped user CAN simulate an envelope whose legalEntityId is their own', async () => {
      const res = await app.inject({
        method: 'POST', url: '/coa/posting-engine/simulate', headers: authed('ENTITY_A_USER'),
        payload: { legalEntityId: ENTITY_A, eventId: 'e1' },
      });
      expect(res.statusCode).not.toBe(403);
    });
  });
});
