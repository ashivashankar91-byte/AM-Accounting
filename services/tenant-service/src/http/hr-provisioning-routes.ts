/**
 * S005 — HR-Event Provisioning Hooks — HTTP routes
 *
 * POST /api/v1/hr-provisioning/process   — inbound HR event (service-to-service)
 * GET  /api/v1/hr-provisioning/events    — audit log (tenant-scoped)
 * POST /api/v1/hr-provisioning/retry     — trigger retry of FAILED_RETRYABLE events
 *
 * Every endpoint enforces x-tenant-id header (CLAUDE.md critical rule).
 * The POST /process endpoint additionally enforces x-service-identity against
 * the allowlist defined in HrProvisioningService.
 */
import { FastifyInstance } from 'fastify';
import { HrProvisioningService, HrEventType, UnauthorizedServiceIdentityError, CrossTenantDeniedError } from '../application/hr-provisioning-service';
import { IAuthServiceClient, HttpAuthServiceClient } from '../infrastructure/auth-service-client';

function makeAuthClient(): IAuthServiceClient {
  return new HttpAuthServiceClient({
    baseUrl: process.env['AUTH_SERVICE_URL'] ?? 'http://auth-service:3001',
    serviceToken: process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
  });
}

export async function hrProvisioningRoutes(app: FastifyInstance) {
  const svc = new HrProvisioningService((app as any).prisma, makeAuthClient());

  // ── POST /process — inbound HR event ───────────────────────────────────────
  app.post('/process', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header required' });

    const serviceIdentity = request.headers['x-service-identity'] as string;
    if (!serviceIdentity) return reply.status(401).send({ error: 'x-service-identity header required' });

    const body = request.body as any;
    const { hrEventType, hrUserId, hrSystem, legalEntityId, sourceCorrelationId, payload } = body ?? {};

    const VALID_EVENT_TYPES: HrEventType[] = ['HR_USER_CREATED', 'HR_USER_TERMINATED', 'HR_USER_ROLE_CHANGED'];
    if (!VALID_EVENT_TYPES.includes(hrEventType)) {
      return reply.status(400).send({ error: `hrEventType must be one of: ${VALID_EVENT_TYPES.join(', ')}` });
    }
    if (!hrUserId) return reply.status(400).send({ error: 'hrUserId required' });
    if (!hrSystem) return reply.status(400).send({ error: 'hrSystem required' });

    try {
      const result = await svc.processHrEvent(
        {
          tenantId,
          legalEntityId,
          hrEventType,
          hrUserId,
          hrSystem,
          sourceCorrelationId,
          requestedByServiceIdentity: serviceIdentity,
          payload: payload ?? {},
        },
        tenantId,
      );

      if (result.status === 'DUPLICATE') {
        return reply.status(200).send({ ...result, message: 'Duplicate event — idempotent skip' });
      }
      if (result.status === 'FAILED_TERMINAL') {
        return reply.status(422).send({ ...result, message: 'Terminal failure — manual intervention required' });
      }
      if (result.status === 'FAILED_RETRYABLE') {
        return reply.status(503).send({ ...result, message: 'Transient failure — will be retried' });
      }
      return reply.status(200).send(result);
    } catch (err: any) {
      if (err instanceof UnauthorizedServiceIdentityError) {
        return reply.status(403).send({ error: err.message });
      }
      if (err instanceof CrossTenantDeniedError) {
        return reply.status(403).send({ error: err.message });
      }
      app.log.error(err, 'S005: unexpected error in /process');
      return reply.status(500).send({ error: 'Internal error' });
    }
  });

  // ── GET /events — tenant-scoped audit log ──────────────────────────────────
  app.get('/events', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header required' });

    const { legalEntityId, status, take } = request.query as any;
    const events = await svc.listEvents(tenantId, {
      legalEntityId,
      status,
      take: take ? parseInt(take, 10) : 200,
    });
    return reply.send({ events, total: events.length });
  });

  // ── POST /retry — operator-triggered retry of FAILED_RETRYABLE events ──────
  app.post('/retry', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) return reply.status(400).send({ error: 'x-tenant-id header required' });

    const serviceIdentity = request.headers['x-service-identity'] as string;
    if (!serviceIdentity) return reply.status(401).send({ error: 'x-service-identity header required' });

    const retried = await svc.retryFailed(tenantId);
    return reply.send({ retried });
  });
}
