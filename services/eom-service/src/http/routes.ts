import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import {
  EOMService,
  EOMCloseInProgressError,
  PreviousEOMFailedError,
  UnpostedTransactionsBlockedError,
  PriorYearNotClosedError,
  LastMonthNotClosedError,
  YearAlreadyClosedError,
  GLRecordsLockedError,
  InvalidYearEndSourceError,
  InvalidRetainedEarningsAccountError,
  YELineCountExceededError,
} from '../application/eom-service';
import { asTenantId, authMiddleware } from '@amacc/shared-kernel';

/**
 * Extract and validate the tenant ID from the request header.
 * Returns HTTP 401 if the header is missing — never falls back to a default tenant.
 *
 * @trace-improvement Security fix — previous code fell back to 'tenant-kunes',
 *   allowing callers with no tenant header to read/write another tenant's data.
 */
function requireTenantId(request: any, reply: any): string | null {
  const id = request.headers['x-tenant-id'] as string | undefined;
  if (!id || !id.trim()) {
    reply.status(401).send({ error: 'Missing required header: x-tenant-id' });
    return null;
  }
  return id.trim();
}

const InitiateCloseSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  initiatedBy: z.string().min(1),
  firstFiscalMonth: z.number().int().min(1).max(12).optional().default(1),
});

const YearEndCloseSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  lastClosedMonth: z.number().int().min(1).max(12),
  lastFiscalMonth: z.number().int().min(1).max(12),
  initiatedBy: z.string().min(1),
});

const PreviewYearEndSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
});

export async function eomRoutes(app: FastifyInstance) {
  // Fail startup if JWT secret is not configured.
  // @trace-improvement Security fix — previous code silently used a well-known fallback secret.
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
  }

  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<EOMService>('EOMService');

  /**
   * Error handler: map typed domain errors to appropriate HTTP status codes.
   */
  function handleError(err: unknown, reply: any): void {
    if (
      err instanceof EOMCloseInProgressError ||
      err instanceof PreviousEOMFailedError ||
      err instanceof YearAlreadyClosedError ||
      err instanceof GLRecordsLockedError
    ) {
      reply.status(409).send({ error: (err as Error).message, code: (err as any).code });
    } else if (
      err instanceof UnpostedTransactionsBlockedError ||
      err instanceof PriorYearNotClosedError ||
      err instanceof LastMonthNotClosedError ||
      err instanceof InvalidYearEndSourceError ||
      err instanceof InvalidRetainedEarningsAccountError ||
      err instanceof YELineCountExceededError
    ) {
      reply.status(400).send({ error: (err as Error).message, code: (err as any).code });
    } else {
      throw err;
    }
  }

  // ── Preview ────────────────────────────────────────────

  /** Preview month-end close readiness — no writes performed. */
  app.get('/preview', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { year, month, firstFiscalMonth } = request.query as {
      year: string;
      month: string;
      firstFiscalMonth?: string;
    };
    const preview = await svc.previewMonthEnd(
      tenantId,
      parseInt(year, 10),
      parseInt(month, 10),
      firstFiscalMonth ? parseInt(firstFiscalMonth, 10) : 1,
    );
    return reply.send(preview);
  });

  /** Preview year-end close — shows P&L balances and retained earnings impact. */
  app.get('/year-end/preview', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { fiscalYear } = PreviewYearEndSchema.parse(request.query);
    const preview = await svc.previewYearEnd(tenantId, fiscalYear);
    return reply.send(preview);
  });

  // ── EOM Closes ─────────────────────────────────────────

  app.post('/', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { year, month, initiatedBy, firstFiscalMonth } = InitiateCloseSchema.parse(request.body);
    try {
      const close = await svc.initiateClose(tenantId, year, month, initiatedBy, firstFiscalMonth);
      return reply.status(201).send(close);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    return reply.send(await svc.getCloses(tenantId));
  });

  app.get('/:id', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { id: closeId } = request.params as { id: string };
    const close = await svc.getCloseById(closeId, tenantId);
    if (!close) return reply.status(404).send({ error: 'Not found' });
    return reply.send(close);
  });

  app.post('/:id/advance', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { id: closeId } = request.params as { id: string };
    const result = await svc.advanceStep(closeId, tenantId);
    return reply.send(result);
  });

  app.post('/:id/retry-step', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { id: closeId } = request.params as { id: string };
    const result = await svc.retryStep(closeId, tenantId);
    return reply.send(result);
  });

  app.get('/:id/steps', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { id: closeId } = request.params as { id: string };
    const close = await svc.getCloseById(closeId, tenantId);
    if (!close) return reply.status(404).send({ error: 'Not found' });
    return reply.send(close.steps);
  });

  /**
   * Admin reset for a BLOCKED close.
   * Equivalent to reseteom.cbl — only safe for steps < 100.
   * @trace-cobol reseteom.cbl / RESETEOM
   */
  app.post('/:id/reset', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { id: closeId } = request.params as { id: string };
    const { resetByUserId } = request.body as { resetByUserId: string };
    try {
      const close = await svc.resetClose(closeId, tenantId, resetByUserId);
      return reply.send(close);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ── Year-End Close ─────────────────────────────────────

  /**
   * Initiate a fiscal year-end close.
   * @trace-cobol yrend.cbl / YREND
   */
  app.post('/year-end', async (request, reply) => {
    const id = requireTenantId(request, reply);
    if (!id) return;
    const tenantId = asTenantId(id);
    const { fiscalYear, lastClosedMonth, lastFiscalMonth, initiatedBy } =
      YearEndCloseSchema.parse(request.body);
    try {
      const result = await svc.yearEndClose(
        tenantId,
        fiscalYear,
        lastClosedMonth,
        lastFiscalMonth,
        initiatedBy,
      );
      return reply.status(201).send(result);
    } catch (err) {
      handleError(err, reply);
    }
  });
}
