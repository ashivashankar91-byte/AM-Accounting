import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { APARService } from '../application/apar-service';
import { FinanceChargeJob } from '../application/finance-charge-job';
import { asTenantId, AREntryType, authMiddleware, createAuthzGuard, AuthzClient, createServiceToken } from '@amacc/shared-kernel';
import {
  VendorService,
  VendorNotFoundError,
  VendorConflictError,
  VendorValidationError,
  VendorHasReferencesError,
  DuplicateVendorAcknowledgementRequiredError,
} from '../application/vendor-service';
import {
  VendorComplianceService,
  ComplianceCheckNotFoundError,
  ComplianceCheckValidationError,
  ComplianceCheckConflictError,
  VendorNotFoundForComplianceError,
} from '../application/vendor-compliance-service';
import {
  InsuranceCertificateService,
  InsuranceCertificateNotFoundError,
  VendorNotFoundForCertificateError,
  InsuranceCertificateConflictError,
  InsuranceCertificateValidationError,
  INSURANCE_TYPE_VALUES,
} from '../application/insurance-certificate-service';
import {
  CustomerService,
  CustomerNotFoundError,
  CustomerConflictError,
  CustomerValidationError,
  DuplicateCustomerAcknowledgementRequiredError,
} from '../application/customer-service';
import {
  InvoiceService,
  InvoiceNotFoundError,
  VendorNotFoundForInvoiceError,
  VendorNotEligibleForInvoiceError,
  InvoiceValidationError,
  InvoiceConflictError,
  DuplicateInvoiceAcknowledgementRequiredError,
  MatchExceptionOverrideRequiredError,
} from '../application/invoice-service';
import {
  GoodsReceiptService,
  GoodsReceiptNotFoundError,
  PurchaseOrderNotFoundForReceiptError,
  GoodsReceiptValidationError,
  GoodsReceiptConflictError,
} from '../application/goods-receipt-service';

function getTenantId(request: any) {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return asTenantId(id);
}

const CreateARSchema = z.object({
  // S2-09: dealerRef is optional — auto-generated server-side if not provided
  dealerRef: z.string().optional(),
  type: z.nativeEnum(AREntryType),
  amount: z.number(),
  dueDate: z.string().transform((s) => new Date(s)),
  status: z.string().default('OPEN'),
  oemSource: z.string().nullable().optional(),
  // S4-04: new cashiering fields
  journalSource: z.string().max(2).optional(),
  sourceDocumentType: z.string().max(20).optional(),
  sourceDocumentNumber: z.string().max(20).optional(),
  cashierUserId: z.string().optional(),
  cashierDateTime: z.string().transform((s) => new Date(s)).optional(),
  customerPayPortion: z.number().optional(),
  checkName: z.string().max(50).optional(),
  remarks: z.string().optional(),
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
  // ── S1-07: AMACC DATA INTEGRITY RULE — VENDOR SOFT-DELETE ONLY ────────────
  // Per BR-AP-001: Vendors MUST NEVER be hard-deleted. When vendor maintenance
  // is implemented (Sprint 3), the only permissible "delete" operation is:
  //   PATCH /vendors/:id  →  { isActive: false }
  // A DELETE /vendors/:id endpoint is STRICTLY PROHIBITED.
  // Rationale: Hard-deleting a vendor corrupts AP history, GL audit trail, and
  // 1099 reporting. Legacy COBOL vendor file used inactivation flags, not deletion.
  // ──────────────────────────────────────────────────────────────────────────

  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<APARService>('APARService');
  const vendorSvc = container.resolve<VendorService>('VendorService');
  const complianceSvc = container.resolve<VendorComplianceService>('VendorComplianceService');
  const insuranceSvc = container.resolve<InsuranceCertificateService>('InsuranceCertificateService');
  const customerSvc = container.resolve<CustomerService>('CustomerService');
  const invoiceSvc = container.resolve<InvoiceService>('InvoiceService');
  const goodsReceiptSvc = container.resolve<GoodsReceiptService>('GoodsReceiptService');
  const authzClient = container.resolve<AuthzClient>('AuthzClient');
  const requirePermission = createAuthzGuard(authzClient, { getTenantId });

  app.post('/ar', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = CreateARSchema.parse(request.body);
    // S2-09: auto-generate receipt# if not supplied by caller
    const dealerRef = body.dealerRef ?? ('RCP-' + Date.now().toString().slice(-6));
    const entry = await svc.createAREntry({ ...body, dealerRef, tenantId, oemSource: body.oemSource ?? null }, tenantId);
    return reply.status(201).send(entry);
  });

  app.get('/ar', async (request, reply) => {
    const tenantId = getTenantId(request);
    const query = request.query as { source?: string; status?: string; from?: string; to?: string };
    const entries = await svc.getAREntries(tenantId);
    let filtered = entries as any[];
    if (query.source) filtered = filtered.filter((e: any) => e.journalSource === query.source);
    if (query.status) filtered = filtered.filter((e: any) => e.status === query.status);
    if (query.from) filtered = filtered.filter((e: any) => new Date(e.createdAt) >= new Date(query.from!));
    if (query.to) filtered = filtered.filter((e: any) => new Date(e.createdAt) <= new Date(query.to!));
    return reply.send(filtered);
  });

  // S4-05: Void a receipt — creates reversing GL entry
  app.post('/ar/:id/void', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const { reason, notes, reversalDate } = ((request.body as any) ?? {}) as { reason?: string; notes?: string; reversalDate?: string };
    const prisma = (app as any).prisma;
    const entry = await prisma.aREntry.findFirst({ where: { id, tenantId } });
    if (!entry) return reply.status(404).send({ error: 'NOT_FOUND' });
    if (entry.status === 'VOIDED') return reply.status(409).send({ error: 'ALREADY_VOIDED' });
    const updated = await prisma.aREntry.update({
      where: { id },
      data: {
        status: 'VOIDED',
        remarks: [entry.remarks, `VOID(${new Date(reversalDate ?? new Date()).toISOString().slice(0,10)}): ${reason ?? 'No reason'}${notes ? ' — ' + notes : ''}`].filter(Boolean).join(' | '),
      },
    });
    return reply.send(updated);
  });

  // S4-05: Mark receipt as POSTED (from PENDING_MANUAL)
  app.post('/ar/:id/post', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const prisma = (app as any).prisma;
    const entry = await prisma.aREntry.findFirst({ where: { id, tenantId } });
    if (!entry) return reply.status(404).send({ error: 'NOT_FOUND' });
    const updated = await prisma.aREntry.update({ where: { id }, data: { status: 'POSTED' } });
    return reply.send(updated);
  });

  // S4-01: Bank deposit slips — group posted AR receipts into a deposit batch
  app.get('/deposits', async (request, reply) => {
    const tenantId = getTenantId(request);
    const prisma = (app as any).prisma;
    const posted = await prisma.aREntry.findMany({
      where: { tenantId, status: { in: ['POSTED', 'PAID', 'OUTSTANDING', 'OVERDUE'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).catch(() => []);
    const grouped: Record<string, any> = {};
    for (const r of posted) {
      const date = r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : 'unscheduled';
      if (!grouped[date]) grouped[date] = { id: `dep-${date}`, depositDate: date, status: 'POSTED', receipts: [], total: 0 };
      grouped[date].receipts.push(r);
      grouped[date].total += Number(r.amount || 0);
    }
    return reply.send(Object.values(grouped));
  });

  app.post('/deposits', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = ((request.body as any) ?? {});
    return reply.status(201).send({
      id: `dep-${Date.now()}`,
      tenantId,
      depositDate: body.depositDate ?? new Date().toISOString().slice(0, 10),
      bankGlAccountId: body.bankGlAccountId,
      depositRef: body.depositRef,
      status: 'DRAFT',
      total: 0,
      createdAt: new Date().toISOString(),
    });
  });

  app.post('/deposits/:id/receipts', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ depositId: id, ok: true });
  });

  app.post('/deposits/:id/allocate', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ depositId: id, ok: true, status: 'ALLOCATED' });
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
      entries.map((e) => ({
        ...e,
        dealerRef: e.dealerRef ?? ('RCP-' + Date.now().toString().slice(-6)),
        tenantId,
        oemSource: e.oemSource ?? null,
      })),
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

  // ===== AMACC-CH04 S036A: Internal Vendor Master (hardened S3-07) =====
  //
  // Permission keys — registered in auth-service's S207 catalog via
  // 20260729030000_extend_authz_catalog_s036a_vendor_master/migration.sql
  // (renumbered at r1-integration time; originally 20260729010000).
  const AP_VENDOR_PERMISSIONS = {
    VIEW:               'ap.vendor.view',
    CREATE:             'ap.vendor.create',
    EDIT:               'ap.vendor.edit',
    INACTIVATE:         'ap.vendor.inactivate',
    REACTIVATE:         'ap.vendor.reactivate',
    DELETE:             'ap.vendor.delete',
    DUPLICATE_OVERRIDE: 'ap.vendor.duplicate_override',
    AUDIT_VIEW:         'ap.vendor.audit_view',
    TAX_IDENTIFIER_VIEW: 'ap.vendor.tax_identifier_view',
  } as const;

  const VENDOR_TYPE_ENUM = z.enum(['SUPPLIER', 'SERVICE_PROVIDER', 'GOVERNMENT', 'OTHER']);

  // NOTE: taxId and the four banking fields (bankName/bankRoutingNumber/
  // bankAccountNumber/bankAccountType) are deliberately ABSENT from this
  // schema. S036A disables new plaintext tax-ID writes (no approved
  // encrypted-field mechanism exists repository-wide) and banking storage is
  // out of S036A's scope boundary — both fields remain readable (masked, for
  // tax ID) but are no longer writable through this API. See
  // services/apar-service/src/application/vendor-service.ts header comments.
  const VendorCreateSchema = z.object({
    vendorNumber:         z.string().max(20).optional(),
    vendorName:           z.string().min(1),
    vendorType:           VENDOR_TYPE_ENUM.optional(),
    dba:                  z.string().optional(),
    contactName:          z.string().optional(),
    phone:                z.string().optional(),
    fax:                  z.string().optional(),
    email:                z.string().email().optional().or(z.literal('')),
    address1:             z.string().optional(),
    address2:             z.string().optional(),
    city:                 z.string().optional(),
    state:                z.string().max(2).optional(),
    zip:                  z.string().max(10).optional(),
    is1099Misc:           z.boolean().default(false),
    is1099Nec:            z.boolean().default(false),
    income1099Type:       z.string().optional(),
    w9OnFile:             z.boolean().default(false),
    w9ReceivedDate:       z.string().optional(),
    paymentTerms:         z.string().default('Net30'),
    defaultGlAccount:     z.string().optional(),
    paymentMethod:        z.string().default('Check'),
    discountPercent:      z.number().min(0).max(100).default(0),
    discountDays:         z.number().int().min(0).default(0),
    separateCheck:        z.boolean().default(false),
    holdPayments:         z.boolean().default(false),
    defaultExpenseAccount: z.string().optional(),
    notes:                z.string().optional(),
    // S036A duplicate-vendor override — permission checked explicitly below,
    // independent of the CREATE permission gating this whole route.
    override:             z.object({ reason: z.string().min(1).max(500) }).optional(),
  });

  const VendorUpdateSchema = VendorCreateSchema.omit({ vendorNumber: true, override: true }).partial().extend({
    version: z.number().int().min(1),
  });

  const DuplicateCheckSchema = z.object({
    vendorName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    zip: z.string().optional(),
    excludeVendorId: z.string().optional(),
  });

  const InactivateSchema = z.object({ version: z.number().int().min(1), reason: z.string().min(1).max(500) });
  const ReactivateSchema = z.object({ version: z.number().int().min(1) });
  const DeleteSchema = z.object({ version: z.number().int().min(1), reason: z.string().max(500).optional() });

  function handleVendorError(error: unknown, reply: any) {
    if (error instanceof VendorNotFoundError) {
      return reply.status(404).send({ error: 'VENDOR_NOT_FOUND', message: error.message });
    }
    if (error instanceof DuplicateVendorAcknowledgementRequiredError) {
      return reply.status(409).send({
        error: 'DUPLICATE_VENDOR_ACKNOWLEDGEMENT_REQUIRED',
        message: error.message,
        candidates: error.candidates,
      });
    }
    if (error instanceof VendorHasReferencesError) {
      return reply.status(409).send({ error: 'VENDOR_HAS_REFERENCES', message: error.message, references: error.references });
    }
    if (error instanceof VendorConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof VendorValidationError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    }
    throw error;
  }

  // ── GET /vendors — list (search/status/vendorType filter) ──────────────────
  app.get('/vendors', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { q, status, vendorType, page, pageSize } = request.query as {
      q?: string; status?: string; vendorType?: string; page?: string; pageSize?: string;
    };
    try {
      const result = await vendorSvc.list({
        tenantId,
        search: q?.trim() || undefined,
        status: status || undefined,
        vendorType: vendorType || undefined,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      });
      return reply.send(result);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── POST /vendors/duplicate-check — candidate duplicate signals ────────────
  app.post('/vendors/duplicate-check', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = DuplicateCheckSchema.parse(request.body);
      const candidates = await vendorSvc.checkDuplicates({ tenantId, ...body });
      return reply.send({ candidates });
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── GET /vendors/:id — detail ───────────────────────────────────────────────
  app.get('/vendors/:id', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const vendor = await vendorSvc.getById(tenantId, id);
      return reply.send(vendor);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── POST /vendors — create ──────────────────────────────────────────────────
  app.post('/vendors', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = VendorCreateSchema.parse(request.body);

      // Duplicate-override permission is independent of CREATE — checked
      // explicitly (not a static preHandler) because it only applies when
      // the caller is actually attempting to bypass a duplicate warning.
      if (body.override) {
        const result = await authzClient.check({
          userId: (request as any).user?.sub,
          permissionKey: AP_VENDOR_PERMISSIONS.DUPLICATE_OVERRIDE,
          scope: { tenantId },
          route: (request as any).routeOptions?.url ?? request.url,
        });
        if (!result.allow) {
          return reply.status(403).send({
            error: 'DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN',
            message: `Missing required permission: ${AP_VENDOR_PERMISSIONS.DUPLICATE_OVERRIDE}`,
          });
        }
      }

      const vendor = await vendorSvc.create(
        {
          ...body,
          tenantId,
          email: body.email || undefined,
          w9ReceivedDate: body.w9ReceivedDate ? new Date(body.w9ReceivedDate) : undefined,
        },
        actor,
        correlationId,
      );
      return reply.status(201).send(vendor);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── PATCH /vendors/:id — update ─────────────────────────────────────────────
  app.patch('/vendors/:id', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.EDIT) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = VendorUpdateSchema.parse(request.body);
      const vendor = await vendorSvc.update(
        tenantId,
        id,
        {
          ...body,
          email: body.email || undefined,
          w9ReceivedDate: body.w9ReceivedDate ? new Date(body.w9ReceivedDate) : undefined,
        },
        actor,
        correlationId,
      );
      return reply.send(vendor);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── DELETE /vendors/:id — guarded logical delete ────────────────────────────
  app.delete('/vendors/:id', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.DELETE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = DeleteSchema.parse(request.body ?? {});
      const vendor = await vendorSvc.delete(tenantId, id, body, actor, correlationId);
      return reply.send(vendor);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── POST /vendors/:id/inactivate ────────────────────────────────────────────
  app.post('/vendors/:id/inactivate', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.INACTIVATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = InactivateSchema.parse(request.body);
      const vendor = await vendorSvc.inactivate(tenantId, id, body, actor, correlationId);
      return reply.send(vendor);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── POST /vendors/:id/reactivate ────────────────────────────────────────────
  app.post('/vendors/:id/reactivate', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.REACTIVATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = ReactivateSchema.parse(request.body);
      const vendor = await vendorSvc.reactivate(tenantId, id, body, actor, correlationId);
      return reply.send(vendor);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── GET /vendors/:id/eligibility — new-invoice eligibility ──────────────────
  app.get('/vendors/:id/eligibility', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const result = await vendorSvc.eligibility(tenantId, id, actor, correlationId);
      return reply.send(result);
    } catch (err) {
      return handleVendorError(err, reply);
    }
  });

  // ── GET /vendors/:id/audit-events — history from audit-service ─────────────
  app.get('/vendors/:id/audit-events', { preHandler: requirePermission(AP_VENDOR_PERMISSIONS.AUDIT_VIEW) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auditUrl =
      (process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031') +
      `/api/v1/audit/entity/Vendor/${id}`;
    try {
      // audit-service's authMiddleware is applied globally (all routes,
      // including this read), so this server-to-server call needs its own
      // bearer token — same createServiceToken() pattern HttpAuditClient
      // already uses for outbox delivery. Without this the call always got
      // 401'd and silently fell back to `[]`, regardless of what audit-service
      // actually had recorded — found and fixed while certifying S036A.
      const jwtSecret = process.env['AMACC_JWT_SECRET'] ?? process.env['JWT_SECRET'];
      const headers: Record<string, string> = { 'x-tenant-id': getTenantId(request) };
      if (jwtSecret) headers['authorization'] = `Bearer ${createServiceToken('apar-service', jwtSecret)}`;
      const res = await fetch(auditUrl, { headers });
      if (!res.ok) return reply.send([]);
      const data = await res.json();
      return reply.send(data);
    } catch {
      return reply.send([]);
    }
  });

  // ===== AMACC-CH04 S036B: Vendor Compliance Adapters =====
  //
  // Additive to S036A's vendor master — no vendor CRUD behavior changes.
  // Permission keys registered in auth-service's catalog via
  // 20260730040000_extend_authz_catalog_s036b_vendor_compliance/migration.sql.
  const AP_VENDOR_COMPLIANCE_PERMISSIONS = {
    VIEW:             'ap.vendor_compliance.view',
    CREATE:           'ap.vendor_compliance.create',
    EDIT:             'ap.vendor_compliance.edit',
    RUN_VERIFICATION: 'ap.vendor_compliance.run_verification',
    REVIEW:           'ap.vendor_compliance.review',
  } as const;

  const COMPLIANCE_CHECK_TYPE_ENUM = z.enum([
    'TAX_ID_VERIFICATION', 'INSURANCE_CERTIFICATE', 'W9_VERIFICATION', 'GENERAL_COMPLIANCE_DOCUMENT', 'OTHER',
  ]);

  const ComplianceCheckCreateSchema = z.object({
    checkType:          COMPLIANCE_CHECK_TYPE_ENUM,
    jurisdiction:       z.string().max(100).optional(),
    country:            z.string().max(100).optional(),
    externalReference:  z.string().max(200).optional(),
    notes:              z.string().optional(),
    expirationDate:     z.string().optional(),
  });

  const ComplianceCheckUpdateSchema = z.object({
    version:            z.number().int().min(1),
    jurisdiction:       z.string().max(100).optional(),
    country:            z.string().max(100).optional(),
    externalReference:  z.string().max(200).optional(),
    notes:              z.string().optional(),
    expirationDate:     z.string().nullable().optional(),
  });

  const ComplianceCheckReviewSchema = z.object({
    version:  z.number().int().min(1),
    decision: z.enum(['VERIFIED', 'REJECTED', 'EXPIRED']),
    reason:   z.string().max(500).optional(),
  });

  function handleComplianceError(error: unknown, reply: any) {
    if (error instanceof VendorNotFoundForComplianceError) {
      return reply.status(404).send({ error: 'VENDOR_NOT_FOUND', message: error.message });
    }
    if (error instanceof ComplianceCheckNotFoundError) {
      return reply.status(404).send({ error: 'COMPLIANCE_CHECK_NOT_FOUND', message: error.message });
    }
    if (error instanceof ComplianceCheckConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof ComplianceCheckValidationError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    }
    throw error;
  }

  // ── GET /vendors/:vendorId/compliance-checks — list ────────────────────────
  app.get('/vendors/:vendorId/compliance-checks', { preHandler: requirePermission(AP_VENDOR_COMPLIANCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId } = request.params as { vendorId: string };
    try {
      const checks = await complianceSvc.list({ tenantId, vendorId });
      return reply.send(checks);
    } catch (err) {
      return handleComplianceError(err, reply);
    }
  });

  // ── GET /vendors/:vendorId/compliance-checks/:id — detail ──────────────────
  app.get('/vendors/:vendorId/compliance-checks/:id', { preHandler: requirePermission(AP_VENDOR_COMPLIANCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId, id } = request.params as { vendorId: string; id: string };
    try {
      const check = await complianceSvc.getById(tenantId, vendorId, id);
      return reply.send(check);
    } catch (err) {
      return handleComplianceError(err, reply);
    }
  });

  // ── POST /vendors/:vendorId/compliance-checks — create ─────────────────────
  app.post('/vendors/:vendorId/compliance-checks', { preHandler: requirePermission(AP_VENDOR_COMPLIANCE_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId } = request.params as { vendorId: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = ComplianceCheckCreateSchema.parse(request.body);
      const check = await complianceSvc.create(
        tenantId,
        { ...body, vendorId, expirationDate: body.expirationDate ? new Date(body.expirationDate) : undefined },
        actor,
        correlationId,
      );
      return reply.status(201).send(check);
    } catch (err) {
      return handleComplianceError(err, reply);
    }
  });

  // ── PATCH /vendors/:vendorId/compliance-checks/:id — edit (pre-review only) ─
  app.patch('/vendors/:vendorId/compliance-checks/:id', { preHandler: requirePermission(AP_VENDOR_COMPLIANCE_PERMISSIONS.EDIT) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId, id } = request.params as { vendorId: string; id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = ComplianceCheckUpdateSchema.parse(request.body);
      const check = await complianceSvc.update(
        tenantId, vendorId, id,
        { ...body, expirationDate: body.expirationDate === undefined ? undefined : (body.expirationDate ? new Date(body.expirationDate) : null) },
        actor,
        correlationId,
      );
      return reply.send(check);
    } catch (err) {
      return handleComplianceError(err, reply);
    }
  });

  // ── POST /vendors/:vendorId/compliance-checks/:id/run-verification ─────────
  // Invokes the configured adapter (ManualComplianceAdapter — truthfully
  // reports NOT_CONFIGURED; never fabricates a passing verification).
  app.post('/vendors/:vendorId/compliance-checks/:id/run-verification', { preHandler: requirePermission(AP_VENDOR_COMPLIANCE_PERMISSIONS.RUN_VERIFICATION) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId, id } = request.params as { vendorId: string; id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const check = await complianceSvc.runVerification(tenantId, vendorId, id, actor, correlationId);
      return reply.send(check);
    } catch (err) {
      return handleComplianceError(err, reply);
    }
  });

  // ── POST /vendors/:vendorId/compliance-checks/:id/review — manual review ───
  // The only path that can set VERIFIED/REJECTED/EXPIRED.
  app.post('/vendors/:vendorId/compliance-checks/:id/review', { preHandler: requirePermission(AP_VENDOR_COMPLIANCE_PERMISSIONS.REVIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId, id } = request.params as { vendorId: string; id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = ComplianceCheckReviewSchema.parse(request.body);
      const check = await complianceSvc.review(tenantId, vendorId, id, body, actor, correlationId);
      return reply.send(check);
    } catch (err) {
      return handleComplianceError(err, reply);
    }
  });

  // ===== AMACC-CH04 S038: Vendor Insurance Certificate Management =====
  //
  // Permission keys — registered in auth-service's catalog via
  // 20260730070000_extend_authz_catalog_s038_vendor_insurance/migration.sql
  // (renumbered during INTEGRATE BATCH R1-02; originally 20260730000000).
  // S036B BOUNDARY: no "verification"/"compliance" permission or endpoint is
  // defined here — S036B owns external compliance-verification adapters and
  // any resulting summary status. GET .../insurance-summary is the read-only
  // integration point a future S036B adapter may call.
  const AP_VENDOR_INSURANCE_PERMISSIONS = {
    VIEW:       'ap.vendor_insurance.view',
    CREATE:     'ap.vendor_insurance.create',
    EDIT:       'ap.vendor_insurance.edit',
    RENEW:      'ap.vendor_insurance.renew',
    REVOKE:     'ap.vendor_insurance.revoke',
    AUDIT_VIEW: 'ap.vendor_insurance.audit_view',
  } as const;

  const INSURANCE_TYPE_ENUM = z.enum(INSURANCE_TYPE_VALUES);

  const CertificateCreateSchema = z.object({
    certificateNumber:   z.string().min(1).max(50),
    insuranceProvider:   z.string().min(1).max(200),
    insuranceType:       INSURANCE_TYPE_ENUM,
    effectiveDate:       z.string(),
    expirationDate:      z.string(),
    coverageAmount:      z.number().nonnegative().optional(),
    coverageDescription: z.string().max(500).optional(),
    documentId:          z.string().optional(),
    documentFileName:    z.string().max(255).optional(),
    documentMimeType:    z.string().max(100).optional(),
    notes:               z.string().max(1000).optional(),
  });

  const CertificateUpdateSchema = z.object({
    version:             z.number().int().min(1),
    coverageAmount:      z.number().nonnegative().optional(),
    coverageDescription: z.string().max(500).optional(),
    documentId:          z.string().optional(),
    documentFileName:    z.string().max(255).optional(),
    documentMimeType:    z.string().max(100).optional(),
    notes:               z.string().max(1000).optional(),
  });

  const CertificateRenewSchema = z.object({
    version:             z.number().int().min(1),
    certificateNumber:   z.string().min(1).max(50),
    insuranceProvider:   z.string().min(1).max(200),
    effectiveDate:       z.string(),
    expirationDate:      z.string(),
    coverageAmount:      z.number().nonnegative().optional(),
    coverageDescription: z.string().max(500).optional(),
    documentId:          z.string().optional(),
    documentFileName:    z.string().max(255).optional(),
    documentMimeType:    z.string().max(100).optional(),
    notes:               z.string().max(1000).optional(),
  });

  const CertificateRevokeSchema = z.object({
    version: z.number().int().min(1),
    reason:  z.string().min(1).max(500),
  });

  function handleICError(error: unknown, reply: any) {
    if (error instanceof InsuranceCertificateNotFoundError) {
      return reply.status(404).send({ error: 'INSURANCE_CERTIFICATE_NOT_FOUND', message: error.message });
    }
    if (error instanceof VendorNotFoundForCertificateError) {
      return reply.status(404).send({ error: 'VENDOR_NOT_FOUND', message: error.message });
    }
    if (error instanceof InsuranceCertificateConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof InsuranceCertificateValidationError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    }
    throw error;
  }

  // ── GET /vendors/:vendorId/insurance-certificates — list ───────────────────
  app.get('/vendors/:vendorId/insurance-certificates', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId } = request.params as { vendorId: string };
    const { status, insuranceType, scope, expirationFilter, withinDays, page, pageSize } = request.query as Record<string, string | undefined>;
    try {
      const result = await insuranceSvc.list({
        tenantId,
        vendorId,
        status: status || undefined,
        insuranceType: insuranceType || undefined,
        scope: (scope as 'current' | 'all') || 'current',
        expirationFilter: expirationFilter as 'expired' | 'expiring' | undefined,
        withinDays: withinDays ? parseInt(withinDays, 10) : undefined,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      });
      return reply.send(result);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── GET /insurance-certificates/expiring — cross-vendor operator list ──────
  app.get('/insurance-certificates/expiring', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { withinDays, page, pageSize } = request.query as Record<string, string | undefined>;
    try {
      const result = await insuranceSvc.list({
        tenantId,
        scope: 'current',
        expirationFilter: 'expiring',
        withinDays: withinDays ? parseInt(withinDays, 10) : undefined,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 100,
      });
      return reply.send(result);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── GET /vendors/:vendorId/insurance-summary — S036B integration point ─────
  app.get('/vendors/:vendorId/insurance-summary', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId } = request.params as { vendorId: string };
    try {
      const result = await insuranceSvc.getVendorInsuranceSummary(tenantId, vendorId);
      return reply.send(result);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── GET /insurance-certificates/:id — detail ────────────────────────────────
  app.get('/insurance-certificates/:id', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const cert = await insuranceSvc.getById(tenantId, id);
      return reply.send(cert);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── POST /vendors/:vendorId/insurance-certificates — create ────────────────
  app.post('/vendors/:vendorId/insurance-certificates', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId } = request.params as { vendorId: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CertificateCreateSchema.parse(request.body);
      const cert = await insuranceSvc.create(
        {
          ...body,
          tenantId,
          vendorId,
          effectiveDate: new Date(body.effectiveDate),
          expirationDate: new Date(body.expirationDate),
        },
        actor,
        correlationId,
      );
      return reply.status(201).send(cert);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── PATCH /insurance-certificates/:id — limited in-place edit ──────────────
  app.patch('/insurance-certificates/:id', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.EDIT) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CertificateUpdateSchema.parse(request.body);
      const cert = await insuranceSvc.update(tenantId, id, body, actor, correlationId);
      return reply.send(cert);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── POST /insurance-certificates/:id/renew — supersede with a new period ───
  app.post('/insurance-certificates/:id/renew', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.RENEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CertificateRenewSchema.parse(request.body);
      const cert = await insuranceSvc.renew(
        tenantId,
        id,
        { ...body, effectiveDate: new Date(body.effectiveDate), expirationDate: new Date(body.expirationDate) },
        actor,
        correlationId,
      );
      return reply.status(201).send(cert);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── POST /insurance-certificates/:id/revoke ─────────────────────────────────
  app.post('/insurance-certificates/:id/revoke', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.REVOKE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CertificateRevokeSchema.parse(request.body);
      const cert = await insuranceSvc.revoke(tenantId, id, body, actor, correlationId);
      return reply.send(cert);
    } catch (err) {
      return handleICError(err, reply);
    }
  });

  // ── GET /insurance-certificates/:id/audit-events — history from audit-service ─
  app.get('/insurance-certificates/:id/audit-events', { preHandler: requirePermission(AP_VENDOR_INSURANCE_PERMISSIONS.AUDIT_VIEW) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auditUrl =
      (process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031') +
      `/api/v1/audit/entity/VendorInsuranceCertificate/${id}`;
    try {
      const jwtSecret = process.env['AMACC_JWT_SECRET'] ?? process.env['JWT_SECRET'];
      const headers: Record<string, string> = { 'x-tenant-id': getTenantId(request) };
      if (jwtSecret) headers['authorization'] = `Bearer ${createServiceToken('apar-service', jwtSecret)}`;
      const res = await fetch(auditUrl, { headers });
      if (!res.ok) return reply.send([]);
      const data = await res.json();
      return reply.send(data);
    } catch {
      return reply.send([]);
    }
  });


  // ===== S3-08: AP Payment Void =====

  // GET /ap-payments
  app.get('/ap-payments', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId, checkNumber, from, to, status, method, vendor, date_from, date_to } = request.query as Record<string, string | undefined>;
    const prisma = (app as any).prisma;
    const payments = await prisma.aPPayment.findMany({
      where: {
        tenantId,
        ...(checkNumber ? { checkNumber: { contains: checkNumber } } : {}),
        ...((from || to || date_from || date_to) ? {
          paymentDate: {
            ...(from || date_from ? { gte: new Date((from ?? date_from)!) } : {}),
            ...(to || date_to ? { lte: new Date((to ?? date_to)!) } : {}),
          },
        } : {}),
      },
      orderBy: { paymentDate: 'desc' },
    });

    // S5-10: Enrich each payment with vendor billing address by joining ap_entries → vendors by vendorName
    const entryIds = [...new Set(payments.map((p: any) => p.apEntryId))];
    const entries = entryIds.length > 0
      ? await prisma.aPEntry.findMany({ where: { id: { in: entryIds as string[] }, tenantId } })
      : [];
    const entryMap = new Map<string, any>(entries.map((e: any) => [e.id, e]));

    // Collect unique vendor names to fetch addresses
    const vendorNames = [...new Set(entries.map((e: any) => e.vendorName))];
    const vendors = vendorNames.length > 0
      ? await prisma.vendor.findMany({ where: { vendorName: { in: vendorNames as string[] }, tenantId }, select: { vendorName: true, vendorNumber: true, address1: true, address2: true, city: true, state: true, zip: true } })
      : [];
    const vendorByName = new Map(vendors.map((v: any) => [v.vendorName, v]));

    const result = payments
      .filter((p: any) => {
        if (status && status !== 'ALL') {
          if (status === 'VOIDED' && !p.voidedAt) return false;
          if (status === 'CLEARED' && !p.clearedFlag) return false;
          if (status === 'ISSUED' && (p.voidedAt || p.clearedFlag)) return false;
        }
        if (method && method !== 'ALL') {
          if (p.paymentMethod !== method) return false;
        }
        if (vendor) {
          const entry = entryMap.get(p.apEntryId);
          if (!entry?.vendorName?.toLowerCase().includes(vendor.toLowerCase())) return false;
        }
        return true;
      })
      .map((p: any) => {
        const entry = entryMap.get(p.apEntryId) as any;
        const vendorRecord = entry ? vendorByName.get(entry.vendorName) : null;
        return {
          ...p,
          vendor_name: entry?.vendorName,
          vendor_code: (vendorRecord as any)?.vendorNumber,
          billing_address: vendorRecord
            ? { address1: (vendorRecord as any).address1, address2: (vendorRecord as any).address2, city: (vendorRecord as any).city, state: (vendorRecord as any).state, zip: (vendorRecord as any).zip }
            : null,
        };
      });

    return reply.send(result);
  });

  // POST /ap-payments/:id/void
  app.post('/ap-payments/:id/void', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const { reason } = (request.body as any) ?? {};
    const prisma = (app as any).prisma;
    const payment = await prisma.aPPayment.findFirst({ where: { id, tenantId } });
    if (!payment) return reply.status(404).send({ error: 'NOT_FOUND' });
    if ((payment as any).voidedAt) return reply.status(409).send({ error: 'ALREADY_VOIDED' });
    const updated = await prisma.$transaction(async (tx: any) => {
      const p = await tx.aPPayment.update({
        where: { id },
        data: { voidedAt: new Date(), voidReason: reason ?? null },
      });
      // Re-open the AP entry if it was fully paid
      if (payment.apEntryId) {
        await tx.aPEntry.updateMany({
          where: { id: payment.apEntryId, tenantId, status: 'PAID' },
          data: { status: 'OPEN', paidDate: null },
        });
      }
      return p;
    });
    return reply.send(updated);
  });

  // ===== S3-09: Sequential Check Numbers =====

  // POST /ap-payments/assign-check-numbers
  // Atomically assigns sequential check numbers to a batch of payment IDs
  app.post('/ap-payments/assign-check-numbers', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { bankAccountId, paymentIds } = (request.body as any) ?? {};
    if (!bankAccountId || !Array.isArray(paymentIds) || paymentIds.length === 0) {
      return reply.status(400).send({ error: 'bankAccountId and paymentIds[] required' });
    }
    const prisma = (app as any).prisma;
    const result = await prisma.$transaction(async (tx: any) => {
      const bank = await tx.aPBankAccount.findFirst({
        where: { id: bankAccountId, tenantId, isActive: true },
      });
      if (!bank) throw new Error('BANK_ACCOUNT_NOT_FOUND');
      const startCheck = bank.nextCheckNumber;
      const assignments: { paymentId: string; checkNumber: string }[] = [];
      for (let i = 0; i < paymentIds.length; i++) {
        const checkNumber = String(startCheck + i);
        await tx.aPPayment.update({
          where: { id: paymentIds[i] },
          data: { checkNumber },
        });
        assignments.push({ paymentId: paymentIds[i], checkNumber });
      }
      await tx.aPBankAccount.update({
        where: { id: bankAccountId },
        data: { nextCheckNumber: startCheck + paymentIds.length },
      });
      return { startCheck, endCheck: startCheck + paymentIds.length - 1, assignments };
    });
    return reply.send(result);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S046: Customer AR Master and Credit Profile — hardened S5-01
  // (AMACC-CH04, mirrors the S036A vendor-master pattern). This slice
  // implements only the master-record + credit-profile portion of the S046
  // story title ("Customer AR Master, Credit & Statements") — statements,
  // invoicing, receipts, cash application, write-offs and NSF processing are
  // explicitly OUT of scope (see S047-S051).
  // ─────────────────────────────────────────────────────────────────────────

  // Permission keys — registered in auth-service's S207 catalog via
  // 20260730080000_extend_authz_catalog_s046_customer_master/migration.sql.
  const AR_CUSTOMER_PERMISSIONS = {
    VIEW:               'ar.customer.view',
    CREATE:             'ar.customer.create',
    EDIT:               'ar.customer.edit',
    INACTIVATE:         'ar.customer.inactivate',
    REACTIVATE:         'ar.customer.reactivate',
    DELETE:             'ar.customer.delete',
    DUPLICATE_OVERRIDE: 'ar.customer.duplicate_override',
    AUDIT_VIEW:         'ar.customer.audit_view',
    CREDIT_HOLD:        'ar.customer.credit_hold',
    CREDIT_RELEASE:     'ar.customer.credit_release',
  } as const;

  const CUSTOMER_TYPE_ENUM = z.enum(['Individual', 'Business', 'Government', 'Fleet']);
  const CREDIT_TERMS_ENUM = z.enum(['COD', 'Net10', 'Net15', 'Net30', 'Net45', 'Net60']);
  const CONTACT_METHOD_ENUM = z.enum(['Phone', 'Email', 'Mail', 'Text']);

  const CustomerCreateSchema = z.object({
    customerNumber:         z.string().max(20).optional(), // auto-generated if omitted
    customerName:           z.string().min(1),
    customerType:           CUSTOMER_TYPE_ENUM.optional(),
    salespersonCode:        z.string().max(10).optional(),
    arAccountOverride:      z.string().uuid().optional(),
    companyNumber:          z.string().max(4).optional(),
    taxId:                  z.string().optional(),
    taxExemptStatus:        z.boolean().default(false),
    taxExemptCertNumber:    z.string().optional(),
    taxExemptExpiration:    z.string().optional(),
    creditLimit:            z.number().min(0).default(0),
    creditTerms:            CREDIT_TERMS_ENUM.optional(),
    preferredContactMethod: CONTACT_METHOD_ENUM.optional(),
    doNotSolicit:           z.boolean().default(false),
    doNotMail:              z.boolean().default(false),
    address1:               z.string().optional(),
    address2:               z.string().optional(),
    city:                   z.string().optional(),
    state:                  z.string().max(2).optional(),
    zip:                    z.string().max(10).optional(),
    country:                z.string().optional(),
    phone:                  z.string().optional(),
    phone2:                 z.string().optional(),
    fax:                    z.string().optional(),
    email:                  z.string().email().optional().or(z.literal('')),
    secondaryStreet:        z.string().optional(),
    secondaryCity:          z.string().optional(),
    secondaryState:         z.string().max(2).optional(),
    secondaryZip:           z.string().max(10).optional(),
    secondaryCountry:       z.string().optional(),
    addressLabel:           z.string().optional(),
    flagAR:                 z.boolean().default(false),
    flagVehicle:            z.boolean().default(false),
    flagParts:              z.boolean().default(false),
    flagService:            z.boolean().default(false),
    flagFI:                 z.boolean().default(false),
    employeeFlag:           z.boolean().default(false),
    notes:                  z.any().optional(),
    // S046 duplicate-customer override — permission checked explicitly
    // below, independent of the CREATE permission gating this whole route.
    override:               z.object({ reason: z.string().min(1).max(500) }).optional(),
  });

  const CustomerUpdateSchema = CustomerCreateSchema.omit({ customerNumber: true, override: true }).partial().extend({
    version: z.number().int().min(1),
  });

  const CustomerDuplicateCheckSchema = z.object({
    customerName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    zip: z.string().optional(),
    excludeCustomerId: z.string().optional(),
  });

  const CustomerInactivateSchema = z.object({ version: z.number().int().min(1), reason: z.string().min(1).max(500) });
  const CustomerReactivateSchema = z.object({ version: z.number().int().min(1) });
  const CustomerDeleteSchema = z.object({ version: z.number().int().min(1), reason: z.string().max(500).optional() });
  const CustomerCreditHoldSchema = z.object({ version: z.number().int().min(1), reason: z.string().min(1).max(500) });
  const CustomerCreditReleaseSchema = z.object({ version: z.number().int().min(1) });

  function handleCustomerError(error: unknown, reply: any) {
    if (error instanceof CustomerNotFoundError) {
      return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND', message: error.message });
    }
    if (error instanceof DuplicateCustomerAcknowledgementRequiredError) {
      return reply.status(409).send({
        error: 'DUPLICATE_CUSTOMER_ACKNOWLEDGEMENT_REQUIRED',
        message: error.message,
        candidates: error.candidates,
      });
    }
    if (error instanceof CustomerConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof CustomerValidationError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    }
    throw error;
  }

  // ── GET /customers — list (search/status filter) ───────────────────────────
  app.get('/customers', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { q, mode, status, page, pageSize } = request.query as {
      q?: string; mode?: string; status?: string; page?: string; pageSize?: string;
    };
    try {
      const result = await customerSvc.list({
        tenantId,
        search: q?.trim() || undefined,
        searchMode: (mode as any) || undefined,
        status: status || undefined,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 200,
      });
      // Preserves the pre-S046 response shape (a bare array) for existing
      // frontend consumers — S046 adds total/page/pageSize alongside it.
      return reply.send(result.items);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── POST /customers/duplicate-check — candidate duplicate signals ──────────
  app.post('/customers/duplicate-check', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CustomerDuplicateCheckSchema.parse(request.body);
      const candidates = await customerSvc.checkDuplicates({ tenantId, ...body });
      return reply.send({ candidates });
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── GET /customers/:id — detail ─────────────────────────────────────────────
  app.get('/customers/:id', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const customer = await customerSvc.getById(tenantId, id);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── POST /customers — create ────────────────────────────────────────────────
  app.post('/customers', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerCreateSchema.parse(request.body);

      // Duplicate-override permission is independent of CREATE — checked
      // explicitly (not a static preHandler) because it only applies when
      // the caller is actually attempting to bypass a duplicate warning.
      if (body.override) {
        const result = await authzClient.check({
          userId: (request as any).user?.sub,
          permissionKey: AR_CUSTOMER_PERMISSIONS.DUPLICATE_OVERRIDE,
          scope: { tenantId },
          route: (request as any).routeOptions?.url ?? request.url,
        });
        if (!result.allow) {
          return reply.status(403).send({
            error: 'DUPLICATE_CUSTOMER_OVERRIDE_FORBIDDEN',
            message: `Missing required permission: ${AR_CUSTOMER_PERMISSIONS.DUPLICATE_OVERRIDE}`,
          });
        }
      }

      const customer = await customerSvc.create(
        {
          ...body,
          tenantId,
          email: body.email || undefined,
          taxExemptExpiration: body.taxExemptExpiration ? new Date(body.taxExemptExpiration) : undefined,
        },
        actor,
        correlationId,
      );
      return reply.status(201).send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── PATCH /customers/:id — update ───────────────────────────────────────────
  app.patch('/customers/:id', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.EDIT) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerUpdateSchema.parse(request.body);
      const customer = await customerSvc.update(
        tenantId,
        id,
        {
          ...body,
          email: body.email || undefined,
          taxExemptExpiration: body.taxExemptExpiration ? new Date(body.taxExemptExpiration) : undefined,
        },
        actor,
        correlationId,
      );
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── DELETE /customers/:id — guarded logical delete ──────────────────────────
  app.delete('/customers/:id', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.DELETE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerDeleteSchema.parse(request.body ?? {});
      const customer = await customerSvc.delete(tenantId, id, body, actor, correlationId);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── POST /customers/:id/inactivate ──────────────────────────────────────────
  app.post('/customers/:id/inactivate', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.INACTIVATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerInactivateSchema.parse(request.body);
      const customer = await customerSvc.inactivate(tenantId, id, body, actor, correlationId);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // Back-compat alias for the pre-S046 frontend contract
  // (PATCH /customers/:id/deactivate, no version/reason). Deprecated —
  // callers should migrate to POST /customers/:id/inactivate.
  app.patch('/customers/:id/deactivate', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.INACTIVATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const current = await customerSvc.getById(tenantId, id);
      const customer = await customerSvc.inactivate(tenantId, id, { version: current.version, reason: 'Deactivated (legacy endpoint)' }, actor, correlationId);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── POST /customers/:id/reactivate ──────────────────────────────────────────
  app.post('/customers/:id/reactivate', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.REACTIVATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerReactivateSchema.parse(request.body);
      const customer = await customerSvc.reactivate(tenantId, id, body, actor, correlationId);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── GET /customers/:id/eligibility — new-charge eligibility ────────────────
  app.get('/customers/:id/eligibility', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const result = await customerSvc.eligibility(tenantId, id, actor, correlationId);
      return reply.send(result);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── POST /customers/:id/credit-hold — place a credit hold ──────────────────
  app.post('/customers/:id/credit-hold', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.CREDIT_HOLD) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerCreditHoldSchema.parse(request.body);
      const customer = await customerSvc.setCreditHold(tenantId, id, body, actor, correlationId);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── POST /customers/:id/credit-release — release a credit hold ─────────────
  app.post('/customers/:id/credit-release', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.CREDIT_RELEASE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = CustomerCreditReleaseSchema.parse(request.body);
      const customer = await customerSvc.releaseCreditHold(tenantId, id, body, actor, correlationId);
      return reply.send(customer);
    } catch (err) {
      return handleCustomerError(err, reply);
    }
  });

  // ── GET /customers/:id/audit-events — history from audit-service ───────────
  app.get('/customers/:id/audit-events', { preHandler: requirePermission(AR_CUSTOMER_PERMISSIONS.AUDIT_VIEW) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auditUrl =
      (process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031') +
      `/api/v1/audit/entity/Customer/${id}`;
    try {
      // Same server-to-server bearer-token requirement discovered/fixed for
      // the vendor audit-events route (S036A) — audit-service's
      // authMiddleware is applied globally, including to this read.
      const jwtSecret = process.env['AMACC_JWT_SECRET'] ?? process.env['JWT_SECRET'];
      const headers: Record<string, string> = { 'x-tenant-id': getTenantId(request) };
      if (jwtSecret) headers['authorization'] = `Bearer ${createServiceToken('apar-service', jwtSecret)}`;
      const res = await fetch(auditUrl, { headers });
      if (!res.ok) return reply.send([]);
      const data = await res.json();
      return reply.send(data);
    } catch {
      return reply.send([]);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S6-01/02/03: Purchase Order routes — PO state machine
  // ══════════════════════════════════════════════════════════════════════════

  const CreatePOSchema = z.object({
    poType:       z.enum(['GENERAL', 'SUBLET', 'VEHICLE']).default('GENERAL'),
    vendorId:     z.string().optional(),
    vendorName:   z.string().optional(),
    department:   z.string().max(50).optional(),
    requestedBy:  z.string().optional(),
    shipTo:       z.string().optional(),
    requiredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes:        z.string().optional(),
    freight:      z.number().default(0),
    tax:          z.number().default(0),
    // S6-02: Sublet PO — RO number
    roNumber:     z.string().max(20).optional(),
    // S6-03: Vehicle stock number (for type=VEHICLE)
    stockNumber:  z.string().max(20).optional(),
    lines: z.array(z.object({
      lineNumber:   z.number().int(),
      description:  z.string(),
      qty:          z.number(),
      unitCost:     z.number(),
      glAccountId:  z.string().optional(),
      controlNumber: z.string().max(20).optional(),
    })).default([]),
  });

  const prismaForPO = (app as any).prisma;

  // GET /purchase-orders
  app.get('/purchase-orders', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { status, q } = request.query as { status?: string; q?: string };
    const where: any = { tenantId };
    if (status) where.status = status;
    if (q) where.OR = [
      { poNumber:   { contains: q, mode: 'insensitive' } },
      { vendorName: { contains: q, mode: 'insensitive' } },
    ];
    const pos = await prismaForPO.purchaseOrder.findMany({
      where,
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(pos);
  });

  // GET /purchase-orders/:id
  app.get('/purchase-orders/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const po = await prismaForPO.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!po) return reply.status(404).send({ error: 'PO not found' });
    return reply.send(po);
  });

  // POST /purchase-orders — create (status = DRAFT, no PO# assigned yet)
  app.post('/purchase-orders', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = CreatePOSchema.parse(request.body);

    // S6-02: Sublet PO — verify RO is OPEN (stub: accept roNumber, real validation via connector-service)
    if (body.poType === 'SUBLET' && body.roNumber) {
      // In production: call connector-service GET /ros/:roNumber/status
      // If RO status = CLOSED | INVOICED → return 422
      // Stub: accept all roNumbers (connector-service integration deferred)
    }

    // S6-03: Vehicle PO — block if vehicle_status = SOLD (stub via vehicle service)
    if (body.poType === 'VEHICLE' && body.stockNumber) {
      // In production: call vehicle-service GET /vehicles?stockNumber=X and check status
      // If vehicle_status = SOLD → return 422
      // Stub: accept all stock numbers (vehicle-service integration deferred)
    }

    const lineTotal = body.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const total = lineTotal + body.freight + body.tax;

    const po = await prismaForPO.purchaseOrder.create({
      data: {
        tenantId,
        poType:       body.poType,
        vendorId:     body.vendorId,
        vendorName:   body.vendorName,
        department:   body.department,
        requestedBy:  body.requestedBy,
        shipTo:       body.shipTo,
        requiredDate: body.requiredDate ? new Date(body.requiredDate) : null,
        notes:        body.notes,
        freight:      body.freight,
        tax:          body.tax,
        lineTotal,
        total,
        roNumber:     body.roNumber,
        status:       'DRAFT',
        lines: { create: body.lines.map(l => ({
          lineNumber:    l.lineNumber,
          description:   l.description,
          qty:           l.qty,
          unitCost:      l.unitCost,
          extCost:       l.qty * l.unitCost,
          glAccountId:   l.glAccountId,
          controlNumber: l.controlNumber,
        })) },
      },
      include: { lines: true },
    });
    return reply.status(201).send(po);
  });

  // POST /purchase-orders/:id/submit — DRAFT → SUBMITTED (assigns PO#)
  app.post('/purchase-orders/:id/submit', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const po = await prismaForPO.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!po) return reply.status(404).send({ error: 'PO not found' });
    if (po.status !== 'DRAFT') return reply.status(422).send({ error: `Cannot submit PO in status ${po.status}` });

    // Assign PO# on first submit
    const year = new Date().getFullYear().toString().slice(-2);
    const countResult = await prismaForPO.purchaseOrder.count({ where: { tenantId } });
    const poNumber = `PO${year}-${String(countResult + 1).padStart(5, '0')}`;

    const updated = await prismaForPO.purchaseOrder.update({
      where: { id },
      data: { status: 'SUBMITTED', poNumber },
    });
    return reply.send(updated);
  });

  // POST /purchase-orders/:id/approve — SUBMITTED → APPROVED
  app.post('/purchase-orders/:id/approve', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = request.body as { approvedBy?: string };
    const po = await prismaForPO.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!po) return reply.status(404).send({ error: 'PO not found' });
    if (po.status !== 'SUBMITTED') return reply.status(422).send({ error: `Cannot approve PO in status ${po.status}` });
    const updated = await prismaForPO.purchaseOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: body?.approvedBy, approvedAt: new Date() },
    });
    return reply.send(updated);
  });

  // POST /purchase-orders/:id/cancel — DRAFT only (no PO# consumed)
  // S6-01: CANCEL = DRAFT action; just deactivate, no audit record needed
  app.post('/purchase-orders/:id/cancel', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };
    const po = await prismaForPO.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!po) return reply.status(404).send({ error: 'PO not found' });
    if (po.status !== 'DRAFT') {
      return reply.status(422).send({ error: 'Only DRAFT POs can be cancelled. Use Void for submitted/approved POs.' });
    }
    const updated = await prismaForPO.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: body?.reason, isActive: false },
    });
    return reply.send(updated);
  });

  // POST /purchase-orders/:id/void — SUBMITTED or APPROVED only
  // S6-01: VOID = PO# consumed, creates audit record, blocks if receipts exist
  app.post('/purchase-orders/:id/void', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string; voidedBy?: string };

    const po = await prismaForPO.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!po) return reply.status(404).send({ error: 'PO not found' });

    const voidableStatuses = ['SUBMITTED', 'APPROVED'];
    if (!voidableStatuses.includes(po.status)) {
      return reply.status(422).send({
        error: po.status === 'PARTIALLY_RECEIVED'
          ? 'Cannot void a partially received PO. Close it instead.'
          : `Cannot void PO in status ${po.status}. Only SUBMITTED or APPROVED POs can be voided.`,
      });
    }

    // Block void if any AP entries reference this PO number
    if (po.poNumber) {
      const linkedAP = await prismaForPO.aPEntry.findFirst({
        where: { tenantId, poNumber: po.poNumber },
      });
      if (linkedAP) {
        return reply.status(422).send({ error: `Cannot void PO #${po.poNumber} — linked AP invoice exists.` });
      }
    }

    const updated = await prismaForPO.purchaseOrder.update({
      where: { id },
      data: {
        status:     'VOIDED',
        voidedAt:   new Date(),
        voidReason: body?.reason,
        voidedBy:   body?.voidedBy,
        isActive:   false,
      },
    });
    return reply.send(updated);
  });

  // POST /purchase-orders/:id/close — RECEIVED → CLOSED
  app.post('/purchase-orders/:id/close', async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const po = await prismaForPO.purchaseOrder.findFirst({ where: { id, tenantId } });
    if (!po) return reply.status(404).send({ error: 'PO not found' });
    if (!['RECEIVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      return reply.status(422).send({ error: `Cannot close PO in status ${po.status}` });
    }
    const updated = await prismaForPO.purchaseOrder.update({
      where: { id },
      data: { status: 'CLOSED' },
    });
    return reply.send(updated);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S6-08: 1099 IRS FIRE Format Export
  // ══════════════════════════════════════════════════════════════════════════

  const FIREExportSchema = z.object({
    taxYear:          z.number().int().min(2020).max(2099),
    transmitterTin:   z.string().length(9),
    transmitterName:  z.string().max(40),
    contactName:      z.string().max(40),
    contactPhone:     z.string().max(15),
    contactEmail:     z.string().email().max(50).optional(),
  });

  app.post('/1099/export-fire', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = FIREExportSchema.parse(request.body);

    // Fetch all 1099 vendors for this tenant
    const vendors = await prismaForPO.vendor.findMany({
      where: { tenantId, OR: [{ is1099Misc: true }, { is1099Nec: true }], isActive: true },
    });

    const padRight = (s: string, len: number) => s.substring(0, len).padEnd(len, ' ');
    const padLeft  = (s: string, len: number) => s.substring(0, len).padStart(len, ' ');
    const taxYearStr = String(body.taxYear);

    // T Record (Transmitter) — 750 chars
    const tRecord = [
      'T',                                         // pos 1: record type
      taxYearStr,                                  // pos 2-5: tax year
      ' ',                                         // pos 6: prior year indicator
      padRight(body.transmitterTin, 9),            // pos 7-15: transmitter TIN
      padRight('', 4),                             // pos 16-19: transmitter control code (blank)
      padRight('', 5),                             // pos 20-24: blank
      padRight(body.transmitterName, 40),          // pos 25-64: transmitter name
      padRight('', 40),                            // pos 65-104: company name (same)
      padRight('', 40),                            // pos 105-144: company name 2
      padRight('', 40),                            // pos 145-184: address
      padRight('', 40),                            // pos 185-224: city
      padRight('', 2),                             // pos 225-226: state
      padRight('', 9),                             // pos 227-235: ZIP
      padRight('', 15),                            // pos 236-250: blank
      padRight(body.contactName, 40),              // pos 251-290: contact name
      padRight(body.contactPhone, 15),             // pos 291-305: contact phone
      padRight(body.contactEmail ?? '', 50),       // pos 306-355: contact email
      padRight('', 395),                           // remaining to 750
    ].join('').substring(0, 750);

    // A Record (Payer) — 750 chars (one per tenant/company)
    const aRecord = [
      'A',
      taxYearStr,
      padRight('', 4),  // combined federal/state indicator
      padRight('', 5),  // blank
      padRight(body.transmitterTin, 9),
      padRight('', 1),  // last filing indicator
      padRight('NE', 2), // type of return (NE=1099-NEC)
      padRight('', 16), // amount codes
      padRight('', 8),  // blank
      padRight('', 1),  // foreign entity
      padRight(body.transmitterName, 40),
      padRight('', 40), // second payer name
      padRight('', 1),  // transfer agent
      padRight('', 40), // address
      padRight('', 40), // city
      padRight('', 2),  // state
      padRight('', 9),  // ZIP
      padRight('', 15), // blank
      padRight(body.contactPhone, 15),
      padRight('', 260),
    ].join('').substring(0, 750);

    // B Records (Payees) — one per 1099 vendor
    const bRecords: string[] = [];
    let totalAmount = 0;

    for (const v of vendors) {
      // Get YTD payments to this vendor for the tax year
      const yearStart = new Date(`${body.taxYear}-01-01`);
      const yearEnd   = new Date(`${body.taxYear}-12-31`);
      const payments = await prismaForPO.aPEntry.findMany({
        where: { tenantId, vendorName: v.vendorName, status: 'PAID',
                 paidDate: { gte: yearStart, lte: yearEnd } },
      });
      const ytdAmount = payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
      if (ytdAmount < 600) continue; // IRS threshold

      totalAmount += ytdAmount;
      const amtStr = padLeft(Math.round(ytdAmount * 100).toString(), 12); // cents, no decimal

      const bRecord = [
        'B',
        taxYearStr,
        padRight('', 1),  // correction indicator
        padRight('', 4),  // blank
        padRight(v.taxId ?? '', 9),                 // payee TIN
        padRight(v.vendorNumber, 20),               // payer's account number for payee
        padRight('', 4),  // blank
        padRight('', 1),  // type of TIN
        padRight('', 1),  // blank
        padRight('', 1),  // foreign entity
        padRight('', 1),  // blank
        padRight(v.vendorName, 40),                 // payee name
        padRight('', 40), // second payee name
        padRight(v.address1 ?? '', 40),             // payee address
        padRight('', 40), // blank
        padRight(v.city ?? '', 40),                 // city
        padRight(v.state ?? '', 2),                 // state
        padRight(v.zip ?? '', 9),                   // ZIP
        padRight('', 1),  // blank
        amtStr,                                     // payment amount (box 1 NEC)
        padRight('', 438),
      ].join('').substring(0, 750);

      bRecords.push(bRecord);
    }

    // C Record (End of Payer)
    const cRecord = [
      'C',
      padLeft(String(bRecords.length), 8),
      padRight('', 6),
      padLeft(Math.round(totalAmount * 100).toString(), 18),
      padRight('', 196),
      padRight('', 522),
    ].join('').substring(0, 750);

    // F Record (End of Transmission)
    const fRecord = [
      'F',
      padLeft('1', 8),  // number of A records
      padLeft(String(bRecords.length), 21),
      padRight('', 721),
    ].join('').substring(0, 750);

    const fireFileContent = [tRecord, aRecord, ...bRecords, cRecord, fRecord].join('\n');

    return reply.send({
      fireFileContent,
      recordCount: bRecords.length + 4,
      payeeCount:  bRecords.length,
      totalAmount,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // S6-09: Positive Pay Export
  // ══════════════════════════════════════════════════════════════════════════

  const PositivePaySchema = z.object({
    bankAccountId: z.string().optional(),
    dateFrom:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    format:        z.enum(['COMMA_DELIMITED', 'TAB_DELIMITED', 'FIXED_WIDTH']).default('COMMA_DELIMITED'),
  });

  app.post('/payments/positive-pay-export', async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = PositivePaySchema.parse(request.body);

    const payments = await prismaForPO.aPPayment.findMany({
      where: {
        tenantId,
        paymentDate: { gte: new Date(body.dateFrom), lte: new Date(body.dateTo) },
        voidedAt:    null,
      },
      orderBy: { checkNumber: 'asc' },
    });

    // Enrich with vendor name via APEntry
    const entryIds = [...new Set(payments.map((p: any) => p.apEntryId))];
    const entries  = await prismaForPO.aPEntry.findMany({ where: { id: { in: entryIds as string[] } } });
    const entryMap = new Map<string, any>(entries.map((e: any) => [e.id, e]));

    const sep = body.format === 'TAB_DELIMITED' ? '\t' : ',';

    if (body.format === 'FIXED_WIDTH') {
      // 94-char fixed-width: check# (10) + date (8) + amount (12) + payee (64)
      const rows = payments.map((p: any) => {
        const entry = entryMap.get(p.apEntryId);
        const payee = (entry?.vendorName ?? '').substring(0, 64).padEnd(64, ' ');
        const dt    = new Date(p.paymentDate).toISOString().slice(0, 10).replace(/-/g, '');
        const amt   = Math.round(Number(p.amount) * 100).toString().padStart(12, '0');
        return `${(p.checkNumber ?? '').padEnd(10, ' ')}${dt}${amt}${payee}`;
      });
      reply.header('Content-Type', 'text/plain');
      reply.header('Content-Disposition', `attachment; filename="positive-pay-${body.dateFrom}-to-${body.dateTo}.txt"`);
      return reply.send(rows.join('\n'));
    }

    const header = ['Check Number', 'Check Date', 'Amount', 'Payee Name'].join(sep);
    const rows   = payments.map((p: any) => {
      const entry  = entryMap.get(p.apEntryId);
      const payee  = entry?.vendorName ?? '';
      const dt     = new Date(p.paymentDate).toISOString().slice(0, 10);
      const amt    = Number(p.amount).toFixed(2);
      return [p.checkNumber ?? '', dt, amt, payee].join(sep);
    });

    const content = [header, ...rows].join('\n');
    const ext = body.format === 'TAB_DELIMITED' ? 'tsv' : 'csv';
    reply.header('Content-Type', 'text/plain');
    reply.header('Content-Disposition', `attachment; filename="positive-pay-${body.dateFrom}-to-${body.dateTo}.${ext}"`);
    return reply.send(content);
  });

  // ── S7-03: ACH NACHA File Generation ────────────────────────────────────────
  // @net-new: Generates NACHA ACH file for batch payments to vendors with banking info
  // NACHA specification: 94-character fixed-width records

  app.post('/payments/generate-ach', async (request, reply) => {
    const tenantId = getTenantId(request);
    const prisma = (app as any).prisma;
    const { bankAccountId, paymentIds, companyName, companyId, companyEntryDescription } = request.body as any;

    if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
      return reply.status(400).send({ error: 'paymentIds array required' });
    }

    // Fetch payments with vendor info
    const payments = await prisma.aPPayment.findMany({
      where: { id: { in: paymentIds }, tenantId },
      include: { vendor: true },
    });

    if (payments.length === 0) {
      return reply.status(404).send({ error: 'No payments found' });
    }

    // Validate all vendors have banking info
    const missingBanking: string[] = [];
    for (const pay of payments as any[]) {
      if (!pay.vendor?.bankRoutingNumber || !pay.vendor?.bankAccountNumber) {
        missingBanking.push(`${pay.vendor?.vendorNumber ?? pay.vendorId} (${pay.vendor?.vendorName ?? 'Unknown'})`);
      }
    }
    if (missingBanking.length > 0) {
      return reply.status(422).send({
        error: 'The following vendors are missing ACH banking information',
        vendors: missingBanking,
      });
    }

    // NACHA helper functions
    const pad = (s: string, len: number, char = ' ') => s.slice(0, len).padEnd(len, char);
    const padLeft = (s: string, len: number, char = '0') => s.slice(0, len).padStart(len, char);

    const now = new Date();
    const fileDate = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
    const fileTime = now.toTimeString().slice(0, 5).replace(':', '');   // HHMM
    const originRoutingNumber = (bankAccountId ?? '000000000').slice(0, 9).padStart(9, '0');
    const fileControlId = 'A';
    const batchNumber = '0000001';
    const coName = pad(companyName ?? 'AUTOMATE DMS', 16);
    const coId = pad(companyId ?? '1000000000', 10);
    const entryDesc = pad(companyEntryDescription ?? 'VENDOR PAY', 10);
    const effectiveDate = fileDate;

    const lines: string[] = [];

    // File Header Record (type 1)
    lines.push(
      '1' +
      padLeft('23', 2) +            // priority code
      ' ' + pad(originRoutingNumber, 9) + // immediate destination (space + 9 digits)
      pad(coId.replace(/\s/g, ''), 10) + // immediate origin
      fileDate +                    // file creation date YYMMDD
      fileTime +                    // file creation time HHMM
      fileControlId +               // file id modifier
      '094' +                       // record size
      '10' +                        // blocking factor
      '1' +                         // format code
      pad('BANK', 23) +             // immediate destination name
      pad(coName, 23) +             // immediate origin name
      pad('', 8),                   // reference code
    );

    // Batch Header (type 5)
    lines.push(
      '5' +
      '220' +                       // service class code (credits only)
      coName +                      // company name
      pad('', 20) +                 // company discretionary data
      coId +                        // company identification
      'PPD' +                       // standard entry class code
      entryDesc +                   // company entry description
      pad('', 6) +                  // company descriptive date
      effectiveDate +               // effective entry date
      pad('', 3) +                  // settlement date (bank fills)
      '1' +                         // originator status code
      pad(originRoutingNumber.slice(0, 8), 8) + // ODFI routing (8 digits)
      batchNumber,                  // batch number
    );

    let totalDebit = 0;
    let totalCredit = 0;
    let entryCount = 0;
    let entryHash = 0;

    // Entry Detail Records (type 6)
    for (const pay of payments as any[]) {
      const vendor = pay.vendor;
      const routing = (vendor.bankRoutingNumber ?? '').padStart(9, '0').slice(0, 9);
      const accountNum = pad(vendor.bankAccountNumber ?? '', 17);
      const amount = Math.round(Number(pay.amount) * 100); // cents
      const transCode = vendor.bankAccountType === 'SAVINGS' ? '32' : '22'; // 22=checking credit, 32=savings credit
      totalCredit += amount;
      entryCount++;
      entryHash += parseInt(routing, 10);

      const individualId = pad(vendor.vendorNumber ?? pay.id.slice(0, 15), 15);
      const individualName = pad(vendor.vendorName ?? 'VENDOR', 22);
      const traceNum = `${originRoutingNumber.slice(0, 8)}${padLeft(String(entryCount), 7)}`;

      lines.push(
        '6' +
        transCode +
        routing +
        accountNum +
        padLeft(String(amount), 10) +
        individualId +
        individualName +
        pad('', 2) +               // discretionary data
        '0' +                       // addenda indicator
        traceNum,
      );
    }

    // Batch Control (type 8)
    const hashStr = padLeft(String(entryHash % 10000000000), 10);
    lines.push(
      '8' +
      '220' +
      padLeft(String(entryCount), 6) +
      hashStr +
      padLeft(String(totalDebit), 12) +
      padLeft(String(totalCredit), 12) +
      coId +
      pad('', 39) +
      pad(originRoutingNumber.slice(0, 8), 8) +
      batchNumber,
    );

    // File Control (type 9)
    const blockCount = Math.ceil((lines.length + 1) / 10);
    lines.push(
      '9' +
      '000001' +                    // batch count
      padLeft(String(blockCount), 6) +
      padLeft(String(entryCount), 8) +
      hashStr +
      padLeft(String(totalDebit), 12) +
      padLeft(String(totalCredit), 12) +
      pad('', 39),
    );

    // Pad to block boundary (each block = 10 records of 94 chars)
    const paddingRecords = blockCount * 10 - lines.length;
    for (let i = 0; i < paddingRecords; i++) {
      lines.push('9'.repeat(94));
    }

    const nachContent = lines.map(l => l.padEnd(94, ' ')).join('\n') + '\n';
    const fileDate8 = now.toISOString().slice(0, 10).replace(/-/g, '');
    reply.header('Content-Type', 'text/plain');
    reply.header('Content-Disposition', `attachment; filename="ach-${fileDate8}.nacha"`);
    return reply.send(nachContent);
  });

  // GET /payments — alias for /ap-payments (frontend compatibility)
  app.get('/payments', async (request, reply) => {
    const tenantId = getTenantId(request);
    const prisma = (app as any).prisma;
    const payments = await prisma.aPPayment.findMany({
      where: { tenantId },
      orderBy: { paymentDate: 'desc' },
      take: 100,
    });
    return reply.send(payments);
  });

  // GET /1099/vendors — list vendors flagged for 1099 reporting
  app.get('/1099/vendors', async (request, reply) => {
    const tenantId = getTenantId(request);
    const vendors = await prismaForPO.vendor.findMany({
      where: { tenantId, OR: [{ is1099Misc: true }, { is1099Nec: true }], isActive: true },
      select: {
        id: true, vendorName: true, taxId: true, address1: true, city: true, state: true, zip: true,
        is1099Misc: true, is1099Nec: true, income1099Type: true,
      },
      orderBy: { vendorName: 'asc' },
    });
    return reply.send(vendors);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AMACC-CH04 S039: AP Invoice Entry & 2/3-Way Match
  // ═══════════════════════════════════════════════════════════════════════

  const AP_INVOICE_PERMISSIONS = {
    VIEW:               'ap.invoice.view',
    CREATE:             'ap.invoice.create',
    EDIT:               'ap.invoice.edit',
    MATCH:              'ap.invoice.match',
    MATCH_OVERRIDE:     'ap.invoice.match_override',
    SUBMIT:             'ap.invoice.submit',
    VOID:               'ap.invoice.void',
    DUPLICATE_OVERRIDE: 'ap.invoice.duplicate_override',
    AUDIT_VIEW:         'ap.invoice.audit_view',
  } as const;

  const AP_GOODS_RECEIPT_PERMISSIONS = {
    VIEW:   'ap.goods_receipt.view',
    CREATE: 'ap.goods_receipt.create',
    VOID:   'ap.goods_receipt.void',
  } as const;

  const InvoiceLineSchema = z.object({
    poLineId: z.string().uuid().optional(),
    glAccountId: z.string().uuid().optional(),
    description: z.string().min(1),
    quantity: z.number().positive().optional(),
    unitPrice: z.number(),
    taxAmount: z.number().optional(),
  });

  const InvoiceCreateSchema = z.object({
    vendorId: z.string().uuid(),
    invoiceNumber: z.string().min(1),
    invoiceDate: z.string().transform((s) => new Date(s)),
    dueDate: z.string().transform((s) => new Date(s)),
    poId: z.string().uuid().optional(),
    freightAmount: z.number().optional(),
    notes: z.string().optional(),
    lines: z.array(InvoiceLineSchema).min(1),
    override: z.object({ reason: z.string().min(1) }).optional(),
  });

  const InvoiceUpdateSchema = z.object({
    version: z.number().int().min(1),
    dueDate: z.string().transform((s) => new Date(s)).optional(),
    notes: z.string().optional(),
    freightAmount: z.number().optional(),
    lines: z.array(InvoiceLineSchema).min(1).optional(),
  });

  const InvoiceDuplicateCheckSchema = z.object({
    vendorId: z.string().uuid(),
    invoiceNumber: z.string().min(1),
    excludeInvoiceId: z.string().uuid().optional(),
  });

  const InvoiceSubmitSchema = z.object({
    version: z.number().int().min(1),
    override: z.object({ reason: z.string().min(1) }).optional(),
  });

  const InvoiceVoidSchema = z.object({
    version: z.number().int().min(1),
    reason: z.string().min(1),
  });

  const GoodsReceiptCreateSchema = z.object({
    poId: z.string().uuid(),
    receiptDate: z.string().transform((s) => new Date(s)).optional(),
    receivedBy: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(z.object({
      poLineId: z.string().uuid(),
      description: z.string().min(1),
      qtyReceived: z.number().positive(),
    })).min(1),
  });

  const GoodsReceiptVoidSchema = z.object({
    reason: z.string().min(1),
  });

  function handleInvoiceError(error: unknown, reply: any) {
    if (error instanceof InvoiceNotFoundError || error instanceof VendorNotFoundForInvoiceError) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
    }
    if (error instanceof VendorNotEligibleForInvoiceError) {
      return reply.status(422).send({ error: 'VENDOR_NOT_ELIGIBLE', message: error.message, vendorStatus: error.vendorStatus });
    }
    if (error instanceof DuplicateInvoiceAcknowledgementRequiredError) {
      return reply.status(409).send({ error: 'DUPLICATE_INVOICE_ACKNOWLEDGEMENT_REQUIRED', message: error.message, candidates: error.candidates });
    }
    if (error instanceof MatchExceptionOverrideRequiredError) {
      return reply.status(409).send({ error: 'MATCH_EXCEPTION_OVERRIDE_REQUIRED', message: error.message, variances: error.variances });
    }
    if (error instanceof InvoiceConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof InvoiceValidationError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    }
    throw error;
  }

  function handleGoodsReceiptError(error: unknown, reply: any) {
    if (error instanceof GoodsReceiptNotFoundError || error instanceof PurchaseOrderNotFoundForReceiptError) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
    }
    if (error instanceof GoodsReceiptConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof GoodsReceiptValidationError) {
      return reply.status(422).send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
    }
    throw error;
  }

  // ── GET /invoices — list ────────────────────────────────────────────────
  app.get('/invoices', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { vendorId, status, poId, page, pageSize } = request.query as {
      vendorId?: string; status?: string; poId?: string; page?: string; pageSize?: string;
    };
    try {
      const result = await invoiceSvc.list({
        tenantId, vendorId, status, poId,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      });
      return reply.send(result);
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── POST /invoices/duplicate-check ──────────────────────────────────────
  app.post('/invoices/duplicate-check', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = InvoiceDuplicateCheckSchema.parse(request.body);
      const candidates = await invoiceSvc.checkDuplicates({ tenantId, ...body });
      return reply.send({ candidates });
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── GET /invoices/:id — detail (header + lines + match history) ─────────
  app.get('/invoices/:id', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const invoice = await invoiceSvc.getById(tenantId, id);
      return reply.send(invoice);
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── POST /invoices — create (DRAFT) ─────────────────────────────────────
  app.post('/invoices', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = InvoiceCreateSchema.parse(request.body);

      if (body.override) {
        const result = await authzClient.check({
          userId: (request as any).user?.sub,
          permissionKey: AP_INVOICE_PERMISSIONS.DUPLICATE_OVERRIDE,
          scope: { tenantId },
          route: (request as any).routeOptions?.url ?? request.url,
        });
        if (!result.allow) {
          return reply.status(403).send({ error: 'DUPLICATE_INVOICE_OVERRIDE_FORBIDDEN', message: `Missing required permission: ${AP_INVOICE_PERMISSIONS.DUPLICATE_OVERRIDE}` });
        }
      }

      const invoice = await invoiceSvc.create({ ...body, tenantId }, actor, correlationId);
      return reply.status(201).send(invoice);
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── PATCH /invoices/:id — update (DRAFT only) ───────────────────────────
  app.patch('/invoices/:id', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.EDIT) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = InvoiceUpdateSchema.parse(request.body);
      const invoice = await invoiceSvc.update(tenantId, id, body, actor, correlationId);
      return reply.send(invoice);
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── POST /invoices/:id/match — run 2/3-way match ────────────────────────
  app.post('/invoices/:id/match', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.MATCH) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const { invoice, result } = await invoiceSvc.runMatch(tenantId, id, actor, correlationId);
      return reply.send({ invoice, result });
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── POST /invoices/:id/submit — DRAFT -> SUBMITTED ──────────────────────
  app.post('/invoices/:id/submit', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.SUBMIT) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = InvoiceSubmitSchema.parse(request.body);

      if (body.override) {
        const result = await authzClient.check({
          userId: (request as any).user?.sub,
          permissionKey: AP_INVOICE_PERMISSIONS.MATCH_OVERRIDE,
          scope: { tenantId },
          route: (request as any).routeOptions?.url ?? request.url,
        });
        if (!result.allow) {
          return reply.status(403).send({ error: 'MATCH_OVERRIDE_FORBIDDEN', message: `Missing required permission: ${AP_INVOICE_PERMISSIONS.MATCH_OVERRIDE}` });
        }
      }

      const invoice = await invoiceSvc.submit(tenantId, id, body, actor, correlationId);
      return reply.send(invoice);
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── POST /invoices/:id/void ──────────────────────────────────────────────
  app.post('/invoices/:id/void', { preHandler: requirePermission(AP_INVOICE_PERMISSIONS.VOID) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = InvoiceVoidSchema.parse(request.body);
      const invoice = await invoiceSvc.void(tenantId, id, body, actor, correlationId);
      return reply.send(invoice);
    } catch (err) {
      return handleInvoiceError(err, reply);
    }
  });

  // ── Goods Receipts (3-way match input) ──────────────────────────────────

  // ── GET /purchase-orders/:poId/receipts ─────────────────────────────────
  app.get('/purchase-orders/:poId/receipts', { preHandler: requirePermission(AP_GOODS_RECEIPT_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { poId } = request.params as { poId: string };
    try {
      const receipts = await goodsReceiptSvc.listForPO(tenantId, poId);
      return reply.send(receipts);
    } catch (err) {
      return handleGoodsReceiptError(err, reply);
    }
  });

  // ── GET /goods-receipts/:id ──────────────────────────────────────────────
  app.get('/goods-receipts/:id', { preHandler: requirePermission(AP_GOODS_RECEIPT_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const receipt = await goodsReceiptSvc.getById(tenantId, id);
      return reply.send(receipt);
    } catch (err) {
      return handleGoodsReceiptError(err, reply);
    }
  });

  // ── POST /goods-receipts — receive against a PO ─────────────────────────
  app.post('/goods-receipts', { preHandler: requirePermission(AP_GOODS_RECEIPT_PERMISSIONS.CREATE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = GoodsReceiptCreateSchema.parse(request.body);
      const receipt = await goodsReceiptSvc.create({ ...body, tenantId }, actor, correlationId);
      return reply.status(201).send(receipt);
    } catch (err) {
      return handleGoodsReceiptError(err, reply);
    }
  });

  // ── POST /goods-receipts/:id/void ───────────────────────────────────────
  app.post('/goods-receipts/:id/void', { preHandler: requirePermission(AP_GOODS_RECEIPT_PERMISSIONS.VOID) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    const actor = (request as any).user?.sub ?? 'system';
    const correlationId = request.headers['x-correlation-id'] as string | undefined;
    try {
      const body = GoodsReceiptVoidSchema.parse(request.body);
      const receipt = await goodsReceiptSvc.void(tenantId, id, body, actor, correlationId);
      return reply.send(receipt);
    } catch (err) {
      return handleGoodsReceiptError(err, reply);
    }
  });
}
