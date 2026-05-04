import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { APARService } from '../application/apar-service';
import { FinanceChargeJob } from '../application/finance-charge-job';
import { asTenantId, AREntryType, authMiddleware } from '@amacc/shared-kernel';

function getTenantId(request: any) {
  const id = request.headers['x-tenant-id'] as string || 'tenant-kunes';
  return asTenantId(id);
}

const CreateARSchema = z.object({
  dealerRef: z.string().min(1),
  type: z.nativeEnum(AREntryType),
  amount: z.number(),
  dueDate: z.string().transform((s) => new Date(s)),
  status: z.string().default('OPEN'),
  oemSource: z.string().nullable().optional(),
});

const CreateAPSchema = z.object({
  vendorName: z.string().min(1),
  invoiceRef: z.string().min(1),
  amount: z.number(),
  dueDate: z.string().transform((s) => new Date(s)),
  status: z.string().default('OPEN'),
  glAccountId: z.string().uuid().nullable().optional(),
});

const OEMImportSchema = z.object({
  entries: z.array(CreateARSchema).min(1),
});

export async function aparRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<APARService>('APARService');

  app.post('/ar', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = CreateARSchema.parse(request.body);
    const entry = await svc.createAREntry({ ...body, tenantId, oemSource: body.oemSource ?? null }, tenantId);
    return reply.status(201).send(entry);
  });

  app.get('/ar', async (request, reply) => {
    const tenantId = getTenantId(request);
    return reply.send(await svc.getAREntries(tenantId));
  });

  app.post('/ap', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = CreateAPSchema.parse(request.body);
    const entry = await svc.createAPEntry({ ...body, tenantId, glAccountId: body.glAccountId ?? null }, tenantId);
    return reply.status(201).send(entry);
  });

  app.get('/ap', async (request, reply) => {
    const tenantId = getTenantId(request);
    return reply.send(await svc.getAPEntries(tenantId));
  });

  app.post('/ar/oem-import', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entries } = OEMImportSchema.parse(request.body);
    const created = await svc.importOEMRemittance(
      tenantId,
      entries.map((e) => ({ ...e, tenantId, oemSource: e.oemSource ?? null })),
    );
    return reply.status(201).send(created);
  });

  // ── Finance Charge Job routes ─────────────────────────────────────────────
  // @trace-cobol finchg.cbl — FINANCE-CHARGE-CALC + POST-FC-JOURNAL paragraphs

  const FinanceChargeSchema = z.object({
    annualRatePercent: z.number().positive().max(100),
    minimumBalance: z.number().min(0).default(0.01),
    chargeReceivableCode: z.string().min(1),
    chargeRevenueCode: z.string().min(1),
    journalSource: z.string().min(1).max(2).default('FC'),
    gracePeriodDays: z.number().int().min(0).default(0),
    asOfDate: z.string().datetime().optional(),
    dryRun: z.boolean().default(false),
  });

  /**
   * POST /finance-charges/run
   * Calculate and post monthly finance charges for overdue AR balances.
   * @cobol-origin finchg.cbl
   */
  app.post('/finance-charges/run', async (request, reply) => {
    const tenantId = getTenantId(request);

    const body = FinanceChargeSchema.parse(request.body);
    const asOfDate = body.asOfDate ? new Date(body.asOfDate) : new Date();

    const jwtSecret = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';

    // Build service token (reuse pattern from eom-service)
    let serviceToken: string;
    try {
      const { createServiceToken } = await import('@amacc/shared-kernel') as any;
      serviceToken = typeof createServiceToken === 'function'
        ? createServiceToken('apar-service', jwtSecret)
        : `Bearer internal-${jwtSecret.substring(0, 8)}`;
    } catch {
      // If createServiceToken not available, use x-user-id fallback
      serviceToken = `internal-${Date.now()}`;
    }

    const job = new FinanceChargeJob();
    const result = await job.run(
      tenantId,
      asOfDate,
      {
        annualRatePercent: body.annualRatePercent,
        minimumBalance: body.minimumBalance,
        chargeReceivableCode: body.chargeReceivableCode,
        chargeRevenueCode: body.chargeRevenueCode,
        journalSource: body.journalSource,
        gracePeriodDays: body.gracePeriodDays,
      },
      serviceToken,
      body.dryRun,
    );

    const statusCode = result.errors.length > 0 ? 207 : 200;
    return reply.status(statusCode).send(result);
  });

  /**
   * GET /finance-charges/preview
   * Preview which control numbers would be charged without posting.
   * Alias for POST /finance-charges/run with dryRun=true.
   */
  app.post('/finance-charges/preview', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = FinanceChargeSchema.parse({ ...(request.body as any), dryRun: true });
    const asOfDate = body.asOfDate ? new Date(body.asOfDate) : new Date();

    const job = new FinanceChargeJob();
    const result = await job.run(
      tenantId,
      asOfDate,
      {
        annualRatePercent: body.annualRatePercent,
        minimumBalance: body.minimumBalance,
        chargeReceivableCode: body.chargeReceivableCode,
        chargeRevenueCode: body.chargeRevenueCode,
        journalSource: body.journalSource,
        gracePeriodDays: body.gracePeriodDays,
      },
      '',   // dry run — no actual posting
      true, // dryRun
    );

    return reply.send(result);
  });
}
