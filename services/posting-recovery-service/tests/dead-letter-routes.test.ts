import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { postingRecoveryRoutes } from '../src/http/dead-letter-routes';
import { PostingRecoveryQueryService } from '../src/application/posting-recovery-query-service';
import { DeadLetterIntakeService } from '../src/application/dead-letter-intake-service';
import { ReplayService } from '../src/application/replay-service';
import { ReplayReaperService } from '../src/application/replay-reaper-service';
import { PostingRecoveryConflictError, PostingRecoveryNotFoundError, PostingRecoveryValidationError } from '../src/domain/errors';
import { createFakeAuthzClient } from './support/fake-authz-client';
import { POSTING_RECOVERY_PERMISSIONS } from '../src/http/security';

// ── JWT helper (mirrors services/tenant-service/tests/legal-entity-authz.test.ts) ──
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

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(POSTING_RECOVERY_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(POSTING_RECOVERY_PERMISSIONS)),
  ACCOUNTANT: new Set([
    POSTING_RECOVERY_PERMISSIONS.QUEUE_READ,
    POSTING_RECOVERY_PERMISSIONS.CASE_READ,
    POSTING_RECOVERY_PERMISSIONS.PAYLOAD_READ,
    POSTING_RECOVERY_PERMISSIONS.AUDIT_READ,
    // deliberately NOT PAYLOAD_READ_SENSITIVE
  ]),
  VIEW_ONLY_NO_PAYLOAD: new Set([POSTING_RECOVERY_PERMISSIONS.QUEUE_READ, POSTING_RECOVERY_PERMISSIONS.CASE_READ]),
};

const CASE_ID = '11111111-1111-1111-1111-111111111111';
const MISSING_ID = '22222222-2222-2222-2222-222222222222';
const NOT_ELIGIBLE_ID = '33333333-3333-3333-3333-333333333333';
const CONFLICT_ID = '44444444-4444-4444-4444-444444444444';

const FAKE_CASE = {
  id: CASE_ID,
  tenantId: 'tenant-a',
  status: 'QUARANTINED',
  sourceEventId: 'evt-1',
  sourceEventType: 'DEAL_POSTED',
  sourceSystem: 'deal-service',
  sourceTransactionId: 'deal-42',
  correlationId: 'corr-1',
  originalEventTimestamp: new Date('2026-07-01T00:00:00.000Z'),
  postingIdempotencyKey: 'idem-secret-key-1234',
  payload: { dealNumber: 'D-1', ssn: '123-45-6789' },
  containsSensitiveData: true,
  firstFailureAt: new Date('2026-07-01T00:05:00.000Z'),
  latestFailureAt: new Date('2026-07-01T00:05:00.000Z'),
  latestFailureCategory: 'RULE_NOT_FOUND',
  latestFailureCode: 'RULE_PACK_NOT_FOUND',
  attemptCount: 0,
  version: 1,
  failures: [],
};

function fakeQueryService() {
  return {
    listQueue: vi.fn(async (_tenantId: string, filters: any, page: any) => ({
      items: [{ id: CASE_ID, status: 'QUARANTINED', latestFailureCategory: filters.failureCategory ?? 'RULE_NOT_FOUND' }],
      total: 1,
      page: page.page,
      pageSize: page.pageSize,
    })),
    getSummary: vi.fn(async () => ({ byStatus: { QUARANTINED: 1 }, byFailureCategory: { RULE_NOT_FOUND: 1 } })),
    getCase: vi.fn(async (_tenantId: string, id: string, opts: { revealSensitive: boolean }) => {
      if (id !== CASE_ID) throw new PostingRecoveryNotFoundError(`not found: ${id}`);
      return {
        ...FAKE_CASE,
        postingIdempotencyKey: opts.revealSensitive ? FAKE_CASE.postingIdempotencyKey : '***1234',
        payload: opts.revealSensitive ? FAKE_CASE.payload : { dealNumber: 'D-1', ssn: '***6789' },
      };
    }),
    listAttempts: vi.fn(async (_tenantId: string, id: string) => {
      if (id !== CASE_ID) throw new PostingRecoveryNotFoundError(`not found: ${id}`);
      return [{ id: 'att-1', attemptNumber: 1, status: 'FAILED' }];
    }),
    listCorrections: vi.fn(async (_tenantId: string, id: string) => {
      if (id !== CASE_ID) throw new PostingRecoveryNotFoundError(`not found: ${id}`);
      return [{ id: 'corr-1', revisionNumber: 1, status: 'PROPOSED' }];
    }),
    getLineage: vi.fn(async (_tenantId: string, id: string) => {
      if (id !== CASE_ID) throw new PostingRecoveryNotFoundError(`not found: ${id}`);
      return { sourceEventId: 'evt-1', transitions: [] };
    }),
    getAuditTimeline: vi.fn(async (_tenantId: string, id: string) => {
      if (id !== CASE_ID) throw new PostingRecoveryNotFoundError(`not found: ${id}`);
      return [{ id: 'audit-1', eventType: 'posting_recovery.dead_letter_created' }];
    }),
  };
}

describe('Posting Recovery routes — authorization, masking, pagination, errors', () => {
  let app: FastifyInstance;
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('PrismaClient', {
      postingRecoveryAuditReference: { create: vi.fn(async () => ({})) },
    } as any);
    container.registerInstance(PostingRecoveryQueryService, fakeQueryService() as any);
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [
        { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
        { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
        { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
        { userId: 'VIEW_ONLY_NO_PAYLOAD', tenantId: 'tenant-a', role: 'VIEW_ONLY_NO_PAYLOAD' },
      ],
      ROLE_GRANTS,
    ));
    // R1 S021-completion: ReplayService (constructed by container.resolve in
    // postingRecoveryRoutes) needs a registered CH01PostingExecutionPort even
    // in tests that never call POST .../replay — see tests/replay-service.test.ts
    // for real replay behavior coverage.
    container.registerInstance('CH01PostingExecutionPort', { replay: vi.fn(async () => ({ outcome: 'FAILED', message: 'not exercised by this test file' })) } as any);
    // Fake ReplayService — this file only proves the ROUTE's authorization/
    // status-code wiring, not replay business logic (see replay-service.test.ts).
    container.registerInstance(ReplayService, {
      replay: vi.fn(async (_tenantId: string, id: string, _actor: string) => {
        if (id === MISSING_ID) throw new PostingRecoveryNotFoundError(`not found: ${id}`);
        if (id === NOT_ELIGIBLE_ID) throw new PostingRecoveryValidationError('NOT_REPLAY_ELIGIBLE', 'Case is "QUARANTINED"');
        if (id === CONFLICT_ID) throw new PostingRecoveryConflictError('REPLAY_ALREADY_IN_PROGRESS', 'already in progress');
        return { deadLetterId: id, attemptNumber: 1, outcome: 'POSTED', message: 'Posted as journal JE-1.', journalReference: 'JE-1', status: 'RESOLVED', idempotentPassthrough: false };
      }),
    } as any);
    // CE-07 integration — crash/restart recovery reaper. Same "route wiring
    // only" fake as ReplayService above; real reap logic is covered by
    // tests/replay-reaper-service.test.ts.
    container.registerInstance(ReplayReaperService, {
      reapStaleReplays: vi.fn(async (_tenantId: string, _actor: string, _staleAfterMs?: number) => ({
        reapedCaseIds: ['dl-stuck-1', 'dl-stuck-2'],
      })),
    } as any);
    // CE-07/S023 (D-S023-23) — real production case-intake route. Same
    // "route wiring only" fake as ReplayService/ReplayReaperService above;
    // real intake idempotency/validation logic is covered by
    // tests/dead-letter-intake-service.test.ts. Also covers CE-12's
    // conflict-on-replay scenario (evt-conflict) via the same fake.
    container.registerInstance(DeadLetterIntakeService, {
      intake: vi.fn(async (envelope: any, _actor: string) => {
        if (envelope?.event?.eventId === MISSING_ID) {
          throw new PostingRecoveryValidationError('EVENT_CONTRACT_INVALID', 'event.tenantId is required');
        }
        if (envelope?.event?.eventId === 'evt-conflict') {
          throw new PostingRecoveryConflictError('IDEMPOTENCY_CONFLICT', 'A different payload was already recorded');
        }
        return { deadLetterId: 'dl-new-1', created: true };
      }),
    } as any);
    app = Fastify();
    await app.register(postingRecoveryRoutes, { prefix: '/posting-recovery/v1' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
  });

  // ── Authentication / authorization ──────────────────────────────────────

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('denies queue access to an authenticated role with no granted permissions (deny-by-default)', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters', headers: authed('NO_PERMISSIONS_ROLE') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('rejects a request missing x-tenant-id with 400 before any permission check', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/posting-recovery/v1/dead-letters',
      headers: { authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows queue access for a role holding posting-recovery.queue.read', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  // ── Queue: pagination, sorting, filters ─────────────────────────────────

  it('lists the queue with default pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters', headers: authed('ACCOUNTANT') });
    const body = res.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(body.items).toHaveLength(1);
  });

  it('accepts page/pageSize query params', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters?page=2&pageSize=10', headers: authed('ACCOUNTANT') });
    const body = res.json();
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(10);
  });

  it('accepts sortBy/sortDir query params', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters?sortBy=attemptCount&sortDir=asc', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['status', 'UNDER_REVIEW'],
    ['failureCategory', 'REFERENCE_DATA_MISSING'],
    ['sourceSystem', 'deal-service'],
    ['eventType', 'DEAL_POSTED'],
    ['assignedOwner', 'user-1'],
    ['escalationState', 'ESCALATED'],
    ['search', 'deal-42'],
  ])('accepts the %s filter', async (key, value) => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters?${key}=${encodeURIComponent(value)}`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an invalid page number with a stable error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters?page=0', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_PAGE' });
  });

  // ── Case detail, attempts, corrections, lineage, audit timeline ─────────

  it('returns case detail for an authorized role', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().sourceEventId).toBe('evt-1');
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${MISSING_ID}`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns 400 MALFORMED_ID for a malformed identifier', async () => {
    const res = await app.inject({ method: 'GET', url: '/posting-recovery/v1/dead-letters/not-a-uuid', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'MALFORMED_ID' });
  });

  it('returns replay-attempt history', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/attempts`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it('returns correction history', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/corrections`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  it('returns lineage', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/lineage`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().sourceEventId).toBe('evt-1');
  });

  it('denies the audit timeline without posting-recovery.audit.read', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/audit-timeline`, headers: authed('VIEW_ONLY_NO_PAYLOAD') });
    expect(res.statusCode).toBe(403);
  });

  it('allows the audit timeline with posting-recovery.audit.read', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/audit-timeline`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });

  // ── Payload masking / sensitive-payload permission behavior ─────────────

  it('omits the payload entirely for a role without posting-recovery.payload.read', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}`, headers: authed('VIEW_ONLY_NO_PAYLOAD') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payloadRedacted).toBe(true);
    expect(body.payload).toBeNull();
  });

  it('returns a masked payload for a role with payload.read but not payload.read-sensitive', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}`, headers: authed('ACCOUNTANT') });
    const body = res.json();
    expect(body.payloadRedacted).toBe(false);
    expect(body.payload.ssn).toBe('***6789');
    expect(body.postingIdempotencyKey).toBe('***1234');
  });

  it('returns the unmasked payload for a role with payload.read-sensitive', async () => {
    const res = await app.inject({ method: 'GET', url: `/posting-recovery/v1/dead-letters/${CASE_ID}`, headers: authed('ADMIN') });
    const body = res.json();
    expect(body.payload.ssn).toBe('123-45-6789');
    expect(body.postingIdempotencyKey).toBe('idem-secret-key-1234');
  });

  // ── R1 S021-completion: POST /dead-letters/:id/replay authorization ──────

  it('rejects an unauthenticated replay request with 401', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/replay`, headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('requires x-tenant-id on a replay request (400, not 401)', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/replay`, headers: { authorization: `Bearer ${tokenFor('ADMIN')}` } });
    expect(res.statusCode).toBe(400);
  });

  it('denies replay to ACCOUNTANT (has queue/case/payload/audit read, but not replay.execute)', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/replay`, headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('denies replay to a role with no granted permissions', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/replay`, headers: authed('NO_PERMISSIONS_ROLE') });
    expect(res.statusCode).toBe(403);
  });

  it('allows replay for ADMIN (holds posting-recovery.replay.execute) and returns the outcome', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/replay`, headers: authed('ADMIN') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'POSTED', journalReference: 'JE-1', status: 'RESOLVED' });
  });

  it('allows replay for CONTROLLER (holds posting-recovery.replay.execute)', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CASE_ID}/replay`, headers: authed('CONTROLLER') });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 replaying a nonexistent case', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${MISSING_ID}/replay`, headers: authed('ADMIN') });
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 replaying a case that is not eligible', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${NOT_ELIGIBLE_ID}/replay`, headers: authed('ADMIN') });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'NOT_REPLAY_ELIGIBLE' });
  });

  it('returns 409 when a replay is already in progress (concurrent-replay conflict)', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/${CONFLICT_ID}/replay`, headers: authed('ADMIN') });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'REPLAY_ALREADY_IN_PROGRESS' });
  });

  it('rejects a malformed deadLetterId on the replay route with 400', async () => {
    const res = await app.inject({ method: 'POST', url: `/posting-recovery/v1/dead-letters/not-a-uuid/replay`, headers: authed('ADMIN') });
    expect(res.statusCode).toBe(400);
  });

  // ── CE-07 integration — crash/restart recovery (stale replay-lock reaper) ──

  it('rejects an unauthenticated reap-stale-replays request with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters/reap-stale-replays', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('denies reap-stale-replays to ACCOUNTANT (same authority as replay.execute)', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters/reap-stale-replays', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(403);
  });

  it('allows reap-stale-replays for ADMIN and returns the reaped case ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters/reap-stale-replays', headers: authed('ADMIN') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reapedCaseIds: ['dl-stuck-1', 'dl-stuck-2'] });
  });

  it('allows reap-stale-replays for CONTROLLER', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters/reap-stale-replays', headers: authed('CONTROLLER') });
    expect(res.statusCode).toBe(200);
  });

  // ── CE-07/S023 (D-S023-23) case intake, merged with CE-12's stricter
  // service-to-service producer boundary: POST /dead-letters is gated on
  // request.user.role === 'SERVICE', not a business permission (mirrors
  // coa-service's own producer boundary at POST /posting-engine/events). A
  // human ADMIN token — even with every permission granted — must NOT be
  // able to call this route; only a genuine SERVICE-role caller can. ──────

  const VALID_INTAKE_BODY = {
    envelope: {
      event: {
        eventId: 'evt-intake-1', tenantId: 'tenant-a', eventType: 'ap.invoice.accepted', sourceSystem: 'coa-service',
        correlationId: 'corr-1', occurredAt: '2026-08-01T00:00:00.000Z', postingIdempotencyKey: 'tenant-a:evt-intake-1',
        payload: { foo: 'bar' }, payloadHash: 'irrelevant-for-this-fake',
      },
      failure: { failureCategory: 'RULE_NOT_FOUND', failureCode: 'NO_RULE_MATCH', failureStage: 'RULE_RESOLUTION', failureMessage: 'no rule matched', occurredAt: '2026-08-01T00:00:00.000Z' },
    },
  };

  it('rejects an unauthenticated case-intake request with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters', headers: { 'x-tenant-id': 'tenant-a' }, payload: VALID_INTAKE_BODY });
    expect(res.statusCode).toBe(401);
  });

  it('denies case intake to a caller without SERVICE role (e.g. ACCOUNTANT)', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters', headers: authed('ACCOUNTANT'), payload: VALID_INTAKE_BODY });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SERVICE_CALLERS_ONLY');
  });

  it('rejects a human ADMIN token (even fully permissioned) with 403 — this route is service-to-service only', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters', headers: authed('ADMIN'), payload: VALID_INTAKE_BODY });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SERVICE_CALLERS_ONLY');
  });

  it('allows case intake for a SERVICE-role caller and returns 201 with the created case id', async () => {
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters', headers: authed('SERVICE'), payload: VALID_INTAKE_BODY });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ deadLetterId: 'dl-new-1', created: true });
  });

  it('surfaces a validation error from the intake service as 400', async () => {
    const badBody = { envelope: { event: { ...VALID_INTAKE_BODY.envelope.event, eventId: MISSING_ID }, failure: VALID_INTAKE_BODY.envelope.failure } };
    const res = await app.inject({ method: 'POST', url: '/posting-recovery/v1/dead-letters', headers: authed('SERVICE'), payload: badBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('EVENT_CONTRACT_INVALID');
  });

  it('maps an idempotency conflict from the intake service to 409', async () => {
    const res = await app.inject({
      method: 'POST', url: '/posting-recovery/v1/dead-letters', headers: authed('SERVICE'),
      payload: { envelope: { event: { eventId: 'evt-conflict' }, failure: {} } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('IDEMPOTENCY_CONFLICT');
  });
});
