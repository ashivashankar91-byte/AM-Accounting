import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { PostingRecoveryQueryService, parsePagination, parseSortDir, parseSortField } from '../application/posting-recovery-query-service';
import { DeadLetterIntakeService } from '../application/dead-letter-intake-service';
import { FixtureService } from '../application/fixture-service';
import { ReplayService } from '../application/replay-service';
import { ReplayReaperService } from '../application/replay-reaper-service';
import { PostingRecoveryConflictError, PostingRecoveryNotFoundError, PostingRecoveryValidationError } from '../domain/errors';
import { attachRouteSecurity, getActor, getTenantId, hasPermission, POSTING_RECOVERY_PERMISSIONS, RouteAuditSpec } from './security';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(request: any, reply: any): string | null {
  const id = String(request.params?.deadLetterId ?? '');
  if (!UUID_RE.test(id)) {
    reply.status(400).send({ error: 'MALFORMED_ID', message: `deadLetterId is not a valid identifier: ${id}` });
    return null;
  }
  return id;
}

const UNPROCESSABLE_VALIDATION_CODES = new Set(['NOT_REPLAY_ELIGIBLE', 'REPLAY_ENVELOPE_INCOMPLETE']);

function mapError(err: any, reply: any) {
  if (err instanceof PostingRecoveryNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
  }
  if (err instanceof PostingRecoveryConflictError) {
    return reply.status(409).send({ error: err.code, message: err.message });
  }
  if (err instanceof PostingRecoveryValidationError) {
    const status = UNPROCESSABLE_VALIDATION_CODES.has(err.code) ? 422 : 400;
    return reply.status(status).send({ error: err.code, message: err.message });
  }
  if (err?.issues) {
    // zod error
    return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues });
  }
  throw err;
}

export function resolvePermission(method: string, url: string): string | null {
  if (url.startsWith('/_fixtures')) return null; // test/internal-only, gated separately by environment, not by these permissions
  // CE-07/S023 (D-S023-23) merged with CE-12's stricter service-to-service
  // producer boundary: POST /dead-letters is deliberately NOT gated by a
  // human-RBAC permission here (falls through to null) — a permission grant
  // must never let a human caller reach this route. The route handler's own
  // SERVICE-role check is the sole, unconditional gate (see
  // dead-letter-routes.ts's POST /dead-letters doc-comment).
  if (url === '/dead-letters' && method === 'GET') return POSTING_RECOVERY_PERMISSIONS.QUEUE_READ;
  if (url === '/dead-letters/summary' && method === 'GET') return POSTING_RECOVERY_PERMISSIONS.QUEUE_READ;
  if (url === '/dead-letters/:deadLetterId/audit-timeline' && method === 'GET') return POSTING_RECOVERY_PERMISSIONS.AUDIT_READ;
  if (url === '/dead-letters/:deadLetterId/replay' && method === 'POST') return POSTING_RECOVERY_PERMISSIONS.REPLAY_EXECUTE;
  if (url === '/dead-letters/reap-stale-replays' && method === 'POST') return POSTING_RECOVERY_PERMISSIONS.REPLAY_EXECUTE;
  if (url.startsWith('/dead-letters/:deadLetterId') && method === 'GET') return POSTING_RECOVERY_PERMISSIONS.CASE_READ;
  return null;
}

export function resolveAudit(method: string, url: string): RouteAuditSpec | null {
  if (method !== 'GET') return null;
  if (url === '/dead-letters') {
    return { eventType: 'posting_recovery.queue_viewed' };
  }
  if (url === '/dead-letters/:deadLetterId') {
    return { eventType: 'posting_recovery.case_viewed', deadLetterId: (request: any) => request.params?.deadLetterId ?? null };
  }
  if (url === '/dead-letters/:deadLetterId/attempts' || url === '/dead-letters/:deadLetterId/corrections' || url === '/dead-letters/:deadLetterId/lineage') {
    return { eventType: 'posting_recovery.case_viewed', deadLetterId: (request: any) => request.params?.deadLetterId ?? null };
  }
  return null;
}

const ReplayRequestSchema = z.object({}).optional();

const QueueQuerySchema = z.object({
  status: z.string().optional(),
  failureCategory: z.string().optional(),
  sourceSystem: z.string().optional(),
  eventType: z.string().optional(),
  assignedOwner: z.string().optional(),
  escalationState: z.string().optional(),
  failureDateFrom: z.string().optional(),
  failureDateTo: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

export async function postingRecoveryRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting posting-recovery-service.');
  }
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const prisma = container.resolve<import('.prisma/posting-recovery-client').PrismaClient>('PrismaClient');
  // CLAUDE.md rule #3: every API endpoint requires x-tenant-id — return 400
  // if missing (not 401 — a missing tenant header is a malformed request,
  // distinct from a missing/invalid Authorization header).
  attachRouteSecurity(app, prisma as any, resolvePermission, resolveAudit, 400);

  const svc = container.resolve(PostingRecoveryQueryService);
  const intake = container.resolve(DeadLetterIntakeService);

  // CE-07/S023 (D-S023-23) case intake, merged with CE-12's stricter
  // service-to-service producer boundary: this is the seam a source-of-
  // truth service (coa-service's posting engine, or a CE-12 workstream
  // service) calls when a posting attempt is REJECTED/FAILED. Restricted to
  // trusted service-to-service callers (createServiceToken, role SERVICE) —
  // never reachable from a browser/end user, even a fully-permissioned
  // human ADMIN. Idempotent on (tenantId, event.eventId): see
  // DeadLetterIntakeService.intake()'s doc-comment for the exact
  // same-hash/different-hash contract.
  const IntakeRequestSchema = z.object({ envelope: z.object({}).passthrough(), actor: z.string().optional() });
  app.post('/dead-letters', async (request, reply) => {
    if ((request as any).user?.role !== 'SERVICE') {
      return reply.status(403).send({ error: 'SERVICE_CALLERS_ONLY', message: 'POST /dead-letters is a service-to-service producer endpoint.' });
    }
    try {
      const body = IntakeRequestSchema.parse(request.body ?? {});
      const actor = getActor(request) ?? body.actor ?? 'system';
      const result = await intake.intake(body.envelope as any, actor);
      return reply.status(result.created ? 201 : 200).send(result);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/dead-letters', async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const query = QueueQuerySchema.parse(request.query);
      const page = parsePagination(request.query as Record<string, unknown>);
      const sort = { sortBy: parseSortField(query.sortBy), sortDir: parseSortDir(query.sortDir) };
      const result = await svc.listQueue(tenantId, query, page, sort);
      return reply.send(result);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/dead-letters/summary', async (request, reply) => {
    const tenantId = getTenantId(request);
    const result = await svc.getSummary(tenantId);
    return reply.send(result);
  });

  app.get('/dead-letters/:deadLetterId', async (request, reply) => {
    const tenantId = getTenantId(request);
    const id = requireUuidParam(request, reply);
    if (!id) return;
    try {
      const canReadPayload = await hasPermission(request, POSTING_RECOVERY_PERMISSIONS.PAYLOAD_READ);
      const canReadSensitive = canReadPayload && (await hasPermission(request, POSTING_RECOVERY_PERMISSIONS.PAYLOAD_READ_SENSITIVE));
      const detail: any = await svc.getCase(tenantId, id, { revealSensitive: canReadSensitive });
      // R1 S021-completion: lets the UI show/hide (not just disable) the
      // replay action per-caller, same pattern as canReadPayload above.
      detail.canReplay = await hasPermission(request, POSTING_RECOVERY_PERMISSIONS.REPLAY_EXECUTE);

      if (!canReadPayload) {
        detail.payload = null;
        detail.payloadRedacted = true;
      } else {
        detail.payloadRedacted = false;
        await appendPayloadAuditRows(prisma as any, tenantId, id, getActor(request), canReadSensitive);
      }

      return reply.send(detail);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/dead-letters/:deadLetterId/attempts', async (request, reply) => {
    const tenantId = getTenantId(request);
    const id = requireUuidParam(request, reply);
    if (!id) return;
    try {
      const attempts = await svc.listAttempts(tenantId, id);
      return reply.send({ items: attempts });
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/dead-letters/:deadLetterId/corrections', async (request, reply) => {
    const tenantId = getTenantId(request);
    const id = requireUuidParam(request, reply);
    if (!id) return;
    try {
      const corrections = await svc.listCorrections(tenantId, id);
      return reply.send({ items: corrections });
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/dead-letters/:deadLetterId/lineage', async (request, reply) => {
    const tenantId = getTenantId(request);
    const id = requireUuidParam(request, reply);
    if (!id) return;
    try {
      const lineage = await svc.getLineage(tenantId, id);
      return reply.send(lineage);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  app.get('/dead-letters/:deadLetterId/audit-timeline', async (request, reply) => {
    const tenantId = getTenantId(request);
    const id = requireUuidParam(request, reply);
    if (!id) return;
    try {
      const timeline = await svc.getAuditTimeline(tenantId, id);
      return reply.send({ items: timeline });
    } catch (err) {
      return mapError(err, reply);
    }
  });

  // ── R1 S021-completion — real replay execution ──────────────────────────
  const replaySvc = container.resolve(ReplayService);

  app.post('/dead-letters/:deadLetterId/replay', async (request, reply) => {
    const tenantId = getTenantId(request);
    const id = requireUuidParam(request, reply);
    if (!id) return;
    try {
      ReplayRequestSchema.parse(request.body ?? {});
      const actor = getActor(request);
      const result = await replaySvc.replay(tenantId, id, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  // ── CE-07 integration — crash/restart recovery (stale replay-lock reaper) ──
  // Reclaims cases left stuck in REPLAY_IN_PROGRESS by a process crash
  // between lock acquisition and replay completion — see
  // replay-reaper-service.ts for the full mechanism and its per-tenant
  // scope boundary. Same permission as replay itself: reclaiming a lock is
  // part of the same authority as executing a replay.
  const reaperSvc = container.resolve(ReplayReaperService);

  app.post('/dead-letters/reap-stale-replays', async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const actor = getActor(request);
      const body = (request.body ?? {}) as { staleAfterMs?: number };
      const staleAfterMs = typeof body.staleAfterMs === 'number' && body.staleAfterMs > 0 ? body.staleAfterMs : undefined;
      const result = staleAfterMs
        ? await reaperSvc.reapStaleReplays(tenantId, actor, staleAfterMs)
        : await reaperSvc.reapStaleReplays(tenantId, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return mapError(err, reply);
    }
  });

  // ── Test-only / internal fixture routes ────────────────────────────────
  // Registered on the same app instance but deliberately not covered by
  // resolvePermission (see above) — gated instead by environment in
  // index.ts (only mounted when POSTING_RECOVERY_FIXTURES_ENABLED=true,
  // which is NOT the default in a production-shaped start). Exists so
  // automated tests and the browser journey can create representative
  // failed events without any production replay implementation.
  if (process.env['POSTING_RECOVERY_FIXTURES_ENABLED'] === 'true') {
    const fixtures = container.resolve(FixtureService);

    app.post('/_fixtures/dead-letters', async (request, reply) => {
      const body = request.body as any;
      try {
        const result = await fixtures.intakeFixture(body.envelope, body.actor ?? 'fixture-loader');
        return reply.status(result.created ? 201 : 200).send(result);
      } catch (err) {
        return mapError(err, reply);
      }
    });

    app.post('/_fixtures/dead-letters/:deadLetterId/attempts', async (request, reply) => {
      const tenantId = getTenantId(request);
      const id = requireUuidParam(request, reply);
      if (!id) return;
      try {
        const attempt = await fixtures.addReplayAttemptFixture(tenantId, id, request.body as any);
        return reply.status(201).send(attempt);
      } catch (err) {
        return mapError(err, reply);
      }
    });

    app.post('/_fixtures/dead-letters/:deadLetterId/corrections', async (request, reply) => {
      const tenantId = getTenantId(request);
      const id = requireUuidParam(request, reply);
      if (!id) return;
      try {
        const correction = await fixtures.addCorrectionFixture(tenantId, id, request.body as any);
        return reply.status(201).send(correction);
      } catch (err) {
        return mapError(err, reply);
      }
    });

    app.post('/_fixtures/dead-letters/:deadLetterId/transition', async (request, reply) => {
      const tenantId = getTenantId(request);
      const id = requireUuidParam(request, reply);
      if (!id) return;
      const body = request.body as any;
      try {
        const result = await fixtures.transitionFixture(tenantId, id, body.toStatus, body.actor ?? 'fixture-loader', body.reason);
        return reply.send(result);
      } catch (err) {
        return mapError(err, reply);
      }
    });
  }
}

async function appendPayloadAuditRows(prisma: any, tenantId: string, deadLetterId: string, actor: string, revealedSensitive: boolean) {
  const { appendAuditReference } = await import('../infrastructure/audit');
  await appendAuditReference(prisma, {
    tenantId,
    deadLetterId,
    eventType: 'posting_recovery.payload_viewed',
    actor,
  });
  if (revealedSensitive) {
    await appendAuditReference(prisma, {
      tenantId,
      deadLetterId,
      eventType: 'posting_recovery.sensitive_payload_viewed',
      actor,
    });
  }
}
