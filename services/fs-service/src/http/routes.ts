import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { FSService } from '../application/fs-service';
import { authMiddleware } from '@amacc/shared-kernel';

const JWT_SECRET = process.env['AMACC_JWT_SECRET'];

function getTenantId(request: FastifyRequest): string {
  const id = (request.headers as Record<string, string>)['x-tenant-id'];
  if (typeof id !== 'string' || !id) throw new Error('x-tenant-id header required');
  return id;
}

function handleError(reply: FastifyReply, err: unknown): ReturnType<FastifyReply['send']> {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('not found') || msg.includes('No ')) return reply.status(404).send({ error: msg });
  if (msg.includes('already exists') || msg.includes('duplicate')) return reply.status(409).send({ error: msg });
  if (msg.includes('must be') || msg.includes('validation') || msg.includes('required')) return reply.status(422).send({ error: msg });
  return reply.status(500).send({ error: msg });
}

const OEMProfileCreateSchema = z.object({
  oemCode: z.string().min(1).max(20),
  oemName: z.string().min(1),
  dealerCode: z.string().min(1),
  reportFormat: z.enum(['STANDARD', 'CUSTOM']).optional(),
  submissionMethod: z.enum(['API', 'XML_UPLOAD', 'MANUAL']).optional(),
  submissionUrl: z.string().url().optional(),
});

const OEMProfileUpdateSchema = OEMProfileCreateSchema.partial().omit({ oemCode: true });

const MappingCreateSchema = z.object({
  oemLineNumber: z.string().min(1),
  oemLineLabel: z.string().min(1),
  oemSection: z.enum(['REVENUE', 'COST_OF_SALES', 'GROSS_PROFIT', 'EXPENSE', 'OTHER']),
  glAccountCodes: z.array(z.string()).default([]),
  calculationType: z.enum(['SUM', 'DIFFERENCE', 'FORMULA']).optional(),
  formula: z.string().optional(),
  displayOrder: z.number().int(),
  isSubtotal: z.boolean().optional(),
  isTotal: z.boolean().optional(),
});

const MappingUpdateSchema = MappingCreateSchema.partial();

const GenerateSchema = z.object({
  oemCode: z.string().min(1),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  statementType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
  comparePriorMonth: z.boolean().optional(),
  comparePriorYear: z.boolean().optional(),
});

const ReviewSchema = z.object({ reviewedBy: z.string().min(1) });
const SubmitSchema = z.object({ submittedBy: z.string().min(1) });

const ResponseSchema = z.object({
  responseCode: z.string().min(1),
  responseMessage: z.string().min(1),
  accepted: z.boolean(),
  rejectionReason: z.string().optional(),
});

const SupplementalUpsertSchema = z.object({
  oemCode: z.string().min(1),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  fieldName: z.string().min(1),
  fieldValue: z.string(),
  fieldType: z.enum(['STRING', 'NUMBER', 'DATE', 'BOOLEAN']).optional(),
});

export function fsRoutes(svc: FSService) {
  return async function (app: FastifyInstance) {
    if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET env var is required');
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // ── OEM Profile Management ─────────────────────────────────────────────

    app.post('/profiles', async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const body = OEMProfileCreateSchema.parse(request.body);
        return reply.status(201).send(await svc.createOEMProfile(tenantId, body));
      } catch (err) { return handleError(reply, err); }
    });

    app.get('/profiles', async (request, reply) => {
      try {
        return reply.send(await svc.listOEMProfiles(getTenantId(request)));
      } catch (err) { return handleError(reply, err); }
    });

    app.get<{ Params: { oemCode: string } }>('/profiles/:oemCode', async (request, reply) => {
      try {
        return reply.send(await svc.getOEMProfile(getTenantId(request), request.params.oemCode));
      } catch (err) { return handleError(reply, err); }
    });

    app.put<{ Params: { oemCode: string } }>('/profiles/:oemCode', async (request, reply) => {
      try {
        const body = OEMProfileUpdateSchema.parse(request.body);
        return reply.send(await svc.updateOEMProfile(getTenantId(request), request.params.oemCode, body));
      } catch (err) { return handleError(reply, err); }
    });

    // ── Account Mappings ───────────────────────────────────────────────────

    app.post<{ Params: { oemCode: string } }>('/profiles/:oemCode/mappings', async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const profile = await svc.getOEMProfile(tenantId, request.params.oemCode);
        const body = MappingCreateSchema.parse(request.body);
        return reply.status(201).send(await svc.createMapping(tenantId, { ...body, oemProfileId: profile.id }));
      } catch (err) { return handleError(reply, err); }
    });

    app.get<{ Params: { oemCode: string } }>('/profiles/:oemCode/mappings', async (request, reply) => {
      try {
        return reply.send(await svc.getMappings(getTenantId(request), request.params.oemCode));
      } catch (err) { return handleError(reply, err); }
    });

    app.put<{ Params: { id: string } }>('/mappings/:id', async (request, reply) => {
      try {
        const body = MappingUpdateSchema.parse(request.body);
        return reply.send(await svc.updateMapping(getTenantId(request), request.params.id, body));
      } catch (err) { return handleError(reply, err); }
    });

    app.delete<{ Params: { id: string } }>('/mappings/:id', async (request, reply) => {
      try {
        await svc.deleteMapping(getTenantId(request), request.params.id);
        return reply.status(204).send();
      } catch (err) { return handleError(reply, err); }
    });

    app.post<{ Params: { oemCode: string } }>('/profiles/:oemCode/mappings/import-template', async (request, reply) => {
      try {
        const count = await svc.importMappingTemplate(getTenantId(request), request.params.oemCode, request.body as any);
        return reply.send({ imported: count });
      } catch (err) { return handleError(reply, err); }
    });

    // ── Statement Lifecycle ────────────────────────────────────────────────

    app.post('/statements/generate', async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const body = GenerateSchema.parse(request.body);
        const statement = await svc.generateStatement(
          tenantId, body.oemCode, body.periodYear, body.periodMonth,
          { statementType: body.statementType, comparePriorMonth: body.comparePriorMonth, comparePriorYear: body.comparePriorYear },
        );
        return reply.status(201).send(statement);
      } catch (err) { return handleError(reply, err); }
    });

    app.get<{ Querystring: { status?: string } }>('/statements', async (request, reply) => {
      try {
        return reply.send(await svc.listStatements(getTenantId(request), request.query.status));
      } catch (err) { return handleError(reply, err); }
    });

    app.get<{ Params: { id: string } }>('/statements/:id', async (request, reply) => {
      try {
        return reply.send(await svc.getStatement(request.params.id));
      } catch (err) { return handleError(reply, err); }
    });

    app.post<{ Params: { id: string } }>('/statements/:id/validate', async (request, reply) => {
      try {
        return reply.send(await svc.validateStatement(getTenantId(request), request.params.id));
      } catch (err) { return handleError(reply, err); }
    });

    app.post<{ Params: { id: string } }>('/statements/:id/review', async (request, reply) => {
      try {
        const { reviewedBy } = ReviewSchema.parse(request.body);
        return reply.send(await svc.reviewStatement(getTenantId(request), request.params.id, reviewedBy));
      } catch (err) { return handleError(reply, err); }
    });

    app.post<{ Params: { id: string } }>('/statements/:id/submit', async (request, reply) => {
      try {
        const { submittedBy } = SubmitSchema.parse(request.body);
        return reply.send(await svc.submitStatement(getTenantId(request), request.params.id, submittedBy));
      } catch (err) { return handleError(reply, err); }
    });

    app.post<{ Params: { id: string } }>('/statements/:id/response', async (request, reply) => {
      try {
        const body = ResponseSchema.parse(request.body);
        return reply.send(await svc.recordResponse(getTenantId(request), request.params.id, body));
      } catch (err) { return handleError(reply, err); }
    });

    app.get<{ Params: { id: string }; Querystring: { type?: string } }>('/statements/:id/comparison', async (request, reply) => {
      try {
        const { type } = request.query;
        if (!type || !['PRIOR_MONTH', 'PRIOR_YEAR', 'BUDGET'].includes(type)) {
          return reply.status(400).send({ error: 'type query param must be PRIOR_MONTH, PRIOR_YEAR, or BUDGET' });
        }
        return reply.send(
          await svc.getStatementComparison(getTenantId(request), request.params.id, type as 'PRIOR_MONTH' | 'PRIOR_YEAR' | 'BUDGET'),
        );
      } catch (err) { return handleError(reply, err); }
    });

    // ── Supplemental Data ──────────────────────────────────────────────────

    app.get<{ Params: { oemCode: string }; Querystring: { year?: string; month?: string } }>('/supplemental/:oemCode', async (request, reply) => {
      try {
        const { year, month } = request.query;
        if (!year || !month) return reply.status(400).send({ error: 'year and month query params required' });
        return reply.send(await svc.getSupplementalData(getTenantId(request), request.params.oemCode, parseInt(year), parseInt(month)));
      } catch (err) { return handleError(reply, err); }
    });

    app.put('/supplemental', async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const body = SupplementalUpsertSchema.parse(request.body);
        return reply.send(await svc.upsertSupplementalData({ tenantId, ...body }));
      } catch (err) { return handleError(reply, err); }
    });
  };
}