/**
 * S006 — MFA & Safeguards Evidence
 *
 * Routes for:
 *   - MFA policy management per tenant (OPTIONAL | REQUIRED_FOR_FINANCE | REQUIRED_ALL)
 *   - Safeguards evidence query (read-only audit trail of MFA events)
 *   - MFA event recording (called by auth-service on TOTP verification)
 *
 * The TOTP provider integration uses a DEMO_FIXTURE adapter for the prototype.
 * [DEMO_FIXTURE] All TOTP verifications in this environment are simulated.
 * Real TOTP integration connects to the configured TOTP provider at runtime.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';

function getTenantId(request: any): string {
  return (
    request.headers['x-tenant-id'] ??
    (request as any).tenantId ??
    'default'
  );
}

function getActor(request: any): string {
  return (request as any).user?.sub ?? request.headers['x-user-id'] ?? 'system';
}

export async function mfaRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma;

  // GET /mfa/policy — Get MFA policy for tenant
  app.get('/policy', async (request, reply) => {
    const tenantId = getTenantId(request);
    let policy = await prisma.mfaPolicy.findUnique({ where: { tenantId } });
    if (!policy) {
      // Return default policy if not configured
      policy = {
        tenantId,
        enforcement: 'OPTIONAL',
        totpEnabled: true,
        smsEnabled: false,
        exemptRoles: [],
      };
    }
    return reply.send(policy);
  });

  // PUT /mfa/policy — Set MFA policy for tenant
  app.put('/policy', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = z.object({
      enforcement: z.enum(['OPTIONAL', 'REQUIRED_FOR_FINANCE', 'REQUIRED_ALL']),
      totpEnabled: z.boolean().default(true),
      smsEnabled: z.boolean().default(false),
      exemptRoles: z.array(z.string()).default([]),
    }).parse(request.body);

    const policy = await prisma.mfaPolicy.upsert({
      where: { tenantId },
      create: { tenantId, ...body },
      update: body,
    });
    return reply.send(policy);
  });

  // GET /mfa/evidence — Query safeguards evidence
  app.get('/evidence', async (request, reply) => {
    const tenantId = getTenantId(request);
    const query = z.object({
      userId: z.string().optional(),
      eventType: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().max(500).default(100),
    }).parse(request.query ?? {});

    const where: any = { tenantId };
    if (query.userId) where.userId = query.userId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) where.occurredAt.gte = new Date(query.from);
      if (query.to) where.occurredAt.lte = new Date(query.to);
    }

    const evidence = await prisma.safeguardsEvidence.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: query.limit,
    });
    return reply.send({ items: evidence, count: evidence.length });
  });

  // POST /mfa/evidence — Record an MFA safeguards event (called by auth-service)
  // [DEMO_FIXTURE] In prototype mode, this endpoint accepts any TOTP code and records
  // it as verified. Production connects to the configured TOTP provider.
  app.post('/evidence', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = z.object({
      userId: z.string().min(1),
      eventType: z.enum(['MFA_VERIFIED', 'MFA_FAILED', 'MFA_BYPASS_GRANTED', 'MFA_ENROLLED', 'MFA_RESET']),
      mfaMethod: z.enum(['TOTP', 'SMS', 'DEMO_FIXTURE']).default('DEMO_FIXTURE'),
      resourceType: z.string().optional(),
      resourceId: z.string().optional(),
      sessionId: z.string().optional(),
    }).parse(request.body);

    const ipAddress = request.headers['x-forwarded-for']?.toString() ?? request.ip;
    const userAgent = request.headers['user-agent'];
    const correlationId = crypto.randomUUID();
    const occurredAt = new Date();

    // Evidence hash — SHA-256 of key fields for tamper detection
    const evidenceHash = crypto
      .createHash('sha256')
      .update(`${body.userId}:${body.eventType}:${occurredAt.toISOString()}:${correlationId}`)
      .digest('hex');

    const evidence = await prisma.safeguardsEvidence.create({
      data: {
        tenantId,
        userId: body.userId,
        eventType: body.eventType,
        mfaMethod: body.mfaMethod,
        resourceType: body.resourceType,
        resourceId: body.resourceId,
        ipAddress,
        userAgent,
        evidenceHash,
        sessionId: body.sessionId,
        correlationId,
      },
    });

    return reply.status(201).send({
      id: evidence.id,
      evidenceHash,
      recorded: true,
      // [DEMO_FIXTURE] Label demo mode clearly — never present as real MFA verification
      demoFixture: body.mfaMethod === 'DEMO_FIXTURE' ? 'DEMO_FIXTURE: This is a simulated MFA verification for prototype purposes only' : undefined,
    });
  });
}
