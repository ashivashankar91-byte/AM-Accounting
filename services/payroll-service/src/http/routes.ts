import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { PayrollService } from '../application/payroll-service';
import { asTenantId, authMiddleware } from '@amacc/shared-kernel';

function getTenantId(request: any) {
  const id = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
  return asTenantId(id);
}

function getUserId(request: any): string {
  return (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
}

function handleError(reply: any, err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal error';
  const statusCode = (err as any)?.statusCode ?? 500;
  if (statusCode === 404 || message.includes('not found')) {
    return reply.status(404).send({ error: message });
  }
  if (statusCode === 409 || message.includes('already exists')) {
    return reply.status(409).send({ error: message });
  }
  if (statusCode === 422 || message.includes('must be') || message.includes('cannot') || message.includes('has no')) {
    return reply.status(422).send({ error: message });
  }
  return reply.status(statusCode > 0 && statusCode < 600 ? statusCode : 500).send({ error: message });
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateEmployeeSchema = z.object({
  employeeCode: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  department: z.enum(['SERVICE', 'PARTS', 'SALES', 'ADMIN', 'BODY_SHOP', 'F_AND_I']),
  payType: z.enum(['HOURLY', 'SALARY', 'FLAT_RATE', 'COMMISSION']),
  payRate: z.number().positive().optional(),
  commissionRate: z.number().min(0).max(1).optional(),
  payFrequency: z.enum(['WEEKLY', 'BI_WEEKLY', 'SEMI_MONTHLY', 'MONTHLY']).default('BI_WEEKLY'),
  federalFilingStatus: z.enum(['SINGLE', 'MARRIED', 'HEAD_OF_HOUSEHOLD']).default('SINGLE'),
  stateCode: z.string().length(2).optional(),
  federalAllowances: z.number().int().min(0).default(0),
  stateAllowances: z.number().int().min(0).default(0),
  hireDate: z.string().transform((s) => new Date(s)),
  defaultGlDept: z.string().optional(),
});

const UpdateEmployeeSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  department: z.enum(['SERVICE', 'PARTS', 'SALES', 'ADMIN', 'BODY_SHOP', 'F_AND_I']).optional(),
  payType: z.enum(['HOURLY', 'SALARY', 'FLAT_RATE', 'COMMISSION']).optional(),
  payRate: z.number().positive().nullable().optional(),
  commissionRate: z.number().min(0).max(1).nullable().optional(),
  payFrequency: z.enum(['WEEKLY', 'BI_WEEKLY', 'SEMI_MONTHLY', 'MONTHLY']).optional(),
  federalFilingStatus: z.enum(['SINGLE', 'MARRIED', 'HEAD_OF_HOUSEHOLD']).optional(),
  stateCode: z.string().length(2).nullable().optional(),
  federalAllowances: z.number().int().min(0).optional(),
  stateAllowances: z.number().int().min(0).optional(),
  defaultGlDept: z.string().nullable().optional(),
});

const CreateBatchSchema = z.object({
  batchNumber: z.string().min(1),
  payPeriodStart: z.string().transform((s) => new Date(s)),
  payPeriodEnd: z.string().transform((s) => new Date(s)),
  payDate: z.string().transform((s) => new Date(s)),
  payFrequency: z.enum(['WEEKLY', 'BI_WEEKLY', 'SEMI_MONTHLY', 'MONTHLY']),
});

const AddItemSchema = z.object({
  employeeId: z.string().min(1),
  department: z.string().optional(),
  regularHours: z.number().min(0).optional(),
  overtimeHours: z.number().min(0).optional(),
  regularPay: z.number().min(0),
  overtimePay: z.number().min(0).optional(),
  commissionPay: z.number().min(0).optional(),
  bonusPay: z.number().min(0).optional(),
  otherPay: z.number().min(0).optional(),
  otherDeductions: z.number().min(0).optional(),
  glAccountCode: z.string().optional(),
  glDepartment: z.string().optional(),
});

const GLMappingSchema = z.object({
  department: z.string().min(1),
  payComponent: z.string().min(1),
  glAccountCode: z.string().min(1),
  isDebit: z.boolean(),
});

const TaxRateSchema = z.object({
  taxType: z.enum(['FICA', 'MEDICARE', 'FUTA', 'SUTA']),
  rate: z.number().min(0).max(1),
  wageBase: z.number().positive().optional(),
  effectiveYear: z.number().int().min(2020).max(2099),
  isEmployer: z.boolean(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function payrollRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET env var is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<PayrollService>('PayrollService');

  // ── Employees ──────────────────────────────────────────────────────────────

  app.post('/employees', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateEmployeeSchema.parse(request.body);
      const emp = await svc.createEmployee(tenantId, body);
      return reply.status(201).send(emp);
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/employees', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const query = request.query as { department?: string; isActive?: string };
      const filters = {
        ...(query.department && { department: query.department }),
        ...(query.isActive !== undefined && { isActive: query.isActive === 'true' }),
      };
      return reply.send(await svc.listEmployees(tenantId, filters));
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/employees/:id', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.getEmployee(tenantId, id));
    } catch (err) { return handleError(reply, err); }
  });

  app.put('/employees/:id', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = UpdateEmployeeSchema.parse(request.body);
      return reply.send(await svc.updateEmployee(tenantId, id, body));
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/employees/:id/terminate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const { terminationDate } = z.object({ terminationDate: z.string().transform((s) => new Date(s)) }).parse(request.body);
      return reply.send(await svc.terminateEmployee(tenantId, id, terminationDate));
    } catch (err) { return handleError(reply, err); }
  });

  // ── Batches ────────────────────────────────────────────────────────────────

  app.post('/batches', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateBatchSchema.parse(request.body);
      const batch = await svc.createBatch(tenantId, { ...body, createdBy: getUserId(request) });
      return reply.status(201).send(batch);
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/batches', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const query = request.query as { status?: string; payFrequency?: string };
      return reply.send(await svc.listBatches(tenantId, query));
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/batches/:id', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.getBatch(tenantId, id));
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/batches/:id/items', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = AddItemSchema.parse(request.body);
      const item = await svc.addItemToBatch(tenantId, id, body);
      return reply.status(201).send(item);
    } catch (err) { return handleError(reply, err); }
  });

  app.delete('/batches/:id/items/:itemId', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id, itemId } = request.params as { id: string; itemId: string };
      await svc.removeItemFromBatch(tenantId, id, itemId);
      return reply.status(204).send();
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/batches/:id/validate', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const result = await svc.validateBatch(tenantId, id);
      return reply.status(result.valid ? 200 : 422).send(result);
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/batches/:id/approve', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const result = await svc.approveBatch(tenantId, id, getUserId(request));
      return reply.status(result.valid ? 200 : 422).send(result);
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/batches/:id/post', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const result = await svc.postBatch(tenantId, id);
      return reply.send(result);
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/batches/:id/void', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const { voidReason } = z.object({ voidReason: z.string().min(1) }).parse(request.body);
      const result = await svc.voidBatch(tenantId, id, voidReason);
      return reply.send(result);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Reports ────────────────────────────────────────────────────────────────

  app.get('/batches/:id/register', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.payrollRegister(tenantId, id));
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/batches/:id/summary', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.payrollSummary(tenantId, id));
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/batches/:id/departmental-summary', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.departmentalSummary(tenantId, id));
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/employees/:id/ytd', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const query = request.query as { year?: string };
      const year = query.year ? parseInt(query.year, 10) : new Date().getFullYear();
      return reply.send(await svc.employeeYTD(tenantId, id, year));
    } catch (err) { return handleError(reply, err); }
  });

  app.get('/reports/tax-liability', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const query = request.query as { year?: string };
      const year = query.year ? parseInt(query.year, 10) : new Date().getFullYear();
      return reply.send(await svc.taxLiabilityReport(tenantId, year));
    } catch (err) { return handleError(reply, err); }
  });

  // ── GL Mapping configuration ───────────────────────────────────────────────

  app.get('/config/gl-mappings', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      return reply.send(await svc.listGLMappings(tenantId));
    } catch (err) { return handleError(reply, err); }
  });

  app.put('/config/gl-mappings', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = GLMappingSchema.parse(request.body);
      return reply.send(await svc.upsertGLMapping(tenantId, body));
    } catch (err) { return handleError(reply, err); }
  });

  app.delete('/config/gl-mappings', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { department, payComponent } = z.object({
        department: z.string().min(1), payComponent: z.string().min(1),
      }).parse(request.query);
      await svc.deleteGLMapping(tenantId, department, payComponent);
      return reply.status(204).send();
    } catch (err) { return handleError(reply, err); }
  });

  // ── Tax Rate configuration ─────────────────────────────────────────────────

  app.get('/config/tax-rates', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const query = request.query as { year?: string };
      const year = query.year ? parseInt(query.year, 10) : undefined;
      return reply.send(await svc.listTaxRates(tenantId, year));
    } catch (err) { return handleError(reply, err); }
  });

  app.put('/config/tax-rates', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = TaxRateSchema.parse(request.body);
      return reply.send(await svc.upsertTaxRate(tenantId, body));
    } catch (err) { return handleError(reply, err); }
  });
}

