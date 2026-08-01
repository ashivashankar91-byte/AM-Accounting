import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, authMiddleware, createAuthzGuard } from '@amacc/shared-kernel';
import { TAX_PERMISSIONS, getTenantId, getActor, getLegalEntityId } from './security';
import {
  normalizeJurisdictionInput, toJurisdictionResponse,
  normalizeExemptionInput, toExemptionResponse,
  normalizeFeeInput, toFeeResponse,
  normalizeAdapterConfigInput, toAdapterConfigResponse,
  toAdapterStatusResponse,
  toExceptionResponse, toExceptionListResponse,
  toReconciliationResponse,
  normalizeResultSearchFilters, toResultListResponse, toResultDetailResponse,
} from './dto-mappers';
import { TaxCalculationService } from '../application/tax-calculation-service';
import { TaxEngineConfigService } from '../application/tax-engine-config-service';
import { JurisdictionRegistrationService } from '../application/jurisdiction-registration-service';
import { ExemptionCertificateService } from '../application/exemption-certificate-service';
import { TaxResultQueryService, TaxAuditQueryService } from '../application/tax-result-query-service';
import { TaxExceptionService } from '../application/tax-exception-service';
import { ReconciliationService } from '../application/reconciliation-service';
import { FeeTableService } from '../application/fee-table-service';
import { TaxAccountMappingService } from '../application/tax-account-mapping-service';
import {
  AccountMappingPendingError, CrossEntityAccessDeniedError, DivergentResultIntegrityAlertError,
  NonTestTenantRefusedError, NotFoundError, OptimisticConcurrencyError, OverlappingEffectiveDateError,
  ReferencedRowCannotBeDeactivatedError, TaxServiceValidationError,
} from '../domain/errors';

function errorToResponse(err: any): { statusCode: number; body: Record<string, unknown> } {
  if (err instanceof TaxServiceValidationError) return { statusCode: 400, body: { error: err.code, message: err.message } };
  if (err instanceof NotFoundError) return { statusCode: 404, body: { error: 'NOT_FOUND', message: err.message } };
  if (err instanceof CrossEntityAccessDeniedError) return { statusCode: 404, body: { error: 'NOT_FOUND', message: err.message } };
  if (err instanceof OptimisticConcurrencyError) return { statusCode: 409, body: { error: 'VERSION_CONFLICT', message: err.message } };
  if (err instanceof OverlappingEffectiveDateError) return { statusCode: 400, body: { error: 'OVERLAPPING_EFFECTIVE_DATE', message: err.message } };
  if (err instanceof ReferencedRowCannotBeDeactivatedError) return { statusCode: 409, body: { error: 'REFERENCED', message: err.message, referenceCount: err.referenceCount } };
  if (err instanceof AccountMappingPendingError) return { statusCode: 409, body: { error: 'ACCOUNT_MAPPING_VALUES_PENDING', message: err.message } };
  if (err instanceof DivergentResultIntegrityAlertError) return { statusCode: 409, body: { error: 'INTEGRITY_ALERT', message: err.message, alertId: err.alertId } };
  if (err instanceof NonTestTenantRefusedError) return { statusCode: 403, body: { error: 'NON_TEST_TENANT_REFUSED', message: err.message } };
  return { statusCode: 500, body: { error: 'INTERNAL_ERROR', message: err?.message ?? 'Unexpected error' } };
}

export async function taxRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting tax-service.');
  }
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId: (r: any) => getTenantId(r) });

  const calculationService = container.resolve(TaxCalculationService);
  const engineConfigService = container.resolve(TaxEngineConfigService);
  const jurisdictionService = container.resolve(JurisdictionRegistrationService);
  const exemptionService = container.resolve(ExemptionCertificateService);
  const resultQueryService = container.resolve(TaxResultQueryService);
  const auditQueryService = container.resolve(TaxAuditQueryService);
  const exceptionService = container.resolve(TaxExceptionService);
  const reconciliationService = container.resolve(ReconciliationService);
  const feeTableService = container.resolve(FeeTableService);
  const mappingService = container.resolve(TaxAccountMappingService);

  app.setErrorHandler((err: any, request, reply) => {
    if (err?.statusCode === 400 && /x-tenant-id/i.test(err.message ?? '')) {
      return reply.status(400).send({ error: 'MISSING_TENANT_ID', message: err.message });
    }
    const mapped = errorToResponse(err);
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  // ── Calculate (idempotent adapter internal) ───────────────────────────
  app.post('/calculate', { preHandler: requirePermission(TAX_PERMISSIONS.RESULT_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const outcome = await calculationService.calculate({ ...request.body, tenantId }, getActor(request));
    return outcome;
  });

  // ── Adapter status / test-connection / reference data ─────────────────
  app.get('/adapter/status', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { businessDate } = request.query as any;
    // No legal-entity scope selected yet ⇒ truthful NOT_CONFIGURED default,
    // never an error — matches the "truthful default" principle for an
    // unconfigured/unscoped context.
    if (!legalEntityId) return toAdapterStatusResponse({ configured: false }, 0);
    const raw = await engineConfigService.getStatus(tenantId, legalEntityId, businessDate);
    const parked = await exceptionService.list(tenantId, legalEntityId, 'PARKED');
    const queueDepth = Array.isArray(parked) ? parked.length : (parked?.items?.length ?? 0);
    return toAdapterStatusResponse(raw, queueDepth);
  });

  app.post('/adapter/test-connection', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_MANAGE) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { businessDate } = (request.body ?? {}) as any;
    const result = await engineConfigService.testConnection(tenantId, legalEntityId!, getActor(request), businessDate);
    return { success: result.ok, message: result.detail ?? (result.ok ? 'Connection succeeded' : 'Connection failed'), testedAt: new Date().toISOString() };
  });

  app.get('/adapter/reference-data', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { kind, search, businessDate } = request.query as any;
    return engineConfigService.browseReferenceData(tenantId, legalEntityId!, kind, search, businessDate);
  });

  app.get('/adapter/config', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const items = await engineConfigService.list(tenantId, legalEntityId);
    return { items: items.map(toAdapterConfigResponse), total: items.length };
  });

  app.post('/adapter/config', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_MANAGE) }, async (request: any, reply) => {
    const tenantId = getTenantId(request);
    const dto = normalizeAdapterConfigInput(request.body, getLegalEntityId(request));
    const created = await engineConfigService.create(tenantId, dto, getActor(request));
    reply.status(201);
    return toAdapterConfigResponse(created);
  });

  async function updateAdapterConfigHandler(request: any) {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const { version, ...rest } = request.body as any;
    const dto = normalizeAdapterConfigInput(rest, getLegalEntityId(request));
    const updated = await engineConfigService.update(tenantId, id, dto, version, getActor(request));
    return toAdapterConfigResponse(updated);
  }
  app.patch('/adapter/config/:id', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_MANAGE) }, updateAdapterConfigHandler);
  app.put('/adapter/config/:id', { preHandler: requirePermission(TAX_PERMISSIONS.ADAPTER_MANAGE) }, updateAdapterConfigHandler);

  // ── Jurisdictions ──────────────────────────────────────────────────────
  app.get('/jurisdictions', { preHandler: requirePermission(TAX_PERMISSIONS.JURISDICTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const items = await jurisdictionService.list(tenantId, legalEntityId);
    return { items: items.map(toJurisdictionResponse), total: items.length };
  });

  app.get('/jurisdictions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.JURISDICTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const legalEntityId = getLegalEntityId(request);
    return toJurisdictionResponse(await jurisdictionService.getById(tenantId, legalEntityId!, id));
  });

  app.post('/jurisdictions', { preHandler: requirePermission(TAX_PERMISSIONS.JURISDICTION_MANAGE) }, async (request: any, reply) => {
    const tenantId = getTenantId(request);
    const dto = normalizeJurisdictionInput(request.body, getLegalEntityId(request));
    const created = await jurisdictionService.create(tenantId, dto, getActor(request));
    reply.status(201);
    return toJurisdictionResponse(created);
  });

  async function updateJurisdictionHandler(request: any) {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const { version, legalEntityId: bodyEntityId, ...rest } = request.body as any;
    const legalEntityId = bodyEntityId ?? getLegalEntityId(request);
    const dto = normalizeJurisdictionInput(rest, legalEntityId);
    const updated = await jurisdictionService.update(tenantId, legalEntityId, id, dto, version, getActor(request));
    return toJurisdictionResponse(updated);
  }
  app.patch('/jurisdictions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.JURISDICTION_MANAGE) }, updateJurisdictionHandler);
  app.put('/jurisdictions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.JURISDICTION_MANAGE) }, updateJurisdictionHandler);

  app.post('/jurisdictions/:id/deactivate', { preHandler: requirePermission(TAX_PERMISSIONS.JURISDICTION_MANAGE) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const { version, reason, legalEntityId: bodyEntityId } = request.body as any;
    const legalEntityId = bodyEntityId ?? getLegalEntityId(request);
    const updated = await jurisdictionService.deactivate(tenantId, legalEntityId, id, version, reason, getActor(request));
    return toJurisdictionResponse(updated);
  });

  // ── Exemptions ──────────────────────────────────────────────────────────
  app.get('/exemptions', { preHandler: requirePermission(TAX_PERMISSIONS.EXEMPTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { partyRef, party, status, expiring } = request.query as any;
    const items = expiring === 'true'
      ? await exemptionService.expiring(tenantId, legalEntityId)
      : await exemptionService.list(tenantId, legalEntityId, partyRef ?? party, status);
    return { items: items.map(toExemptionResponse), total: items.length };
  });

  app.get('/exemptions/expiring', { preHandler: requirePermission(TAX_PERMISSIONS.EXEMPTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { withinDays } = request.query as any;
    const items = await exemptionService.expiring(tenantId, legalEntityId, withinDays ? Number(withinDays) : undefined);
    return { items: items.map(toExemptionResponse), total: items.length };
  });

  app.get('/exemptions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.EXEMPTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const legalEntityId = getLegalEntityId(request);
    return toExemptionResponse(await exemptionService.getById(tenantId, legalEntityId!, id));
  });

  app.post('/exemptions', { preHandler: requirePermission(TAX_PERMISSIONS.EXEMPTION_MANAGE) }, async (request: any, reply) => {
    const tenantId = getTenantId(request);
    const dto = normalizeExemptionInput(request.body, getLegalEntityId(request));
    const created = await exemptionService.create(tenantId, dto, getActor(request));
    reply.status(201);
    return toExemptionResponse(created);
  });

  async function updateExemptionHandler(request: any) {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const { version, legalEntityId: bodyEntityId, ...rest } = request.body as any;
    const legalEntityId = bodyEntityId ?? getLegalEntityId(request);
    const dto = normalizeExemptionInput(rest, legalEntityId);
    const updated = await exemptionService.update(tenantId, legalEntityId, id, dto, version, getActor(request));
    return toExemptionResponse(updated);
  }
  app.patch('/exemptions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.EXEMPTION_MANAGE) }, updateExemptionHandler);
  app.put('/exemptions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.EXEMPTION_MANAGE) }, updateExemptionHandler);

  // ── Results ─────────────────────────────────────────────────────────────
  app.get('/results', { preHandler: requirePermission(TAX_PERMISSIONS.RESULT_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const filters = normalizeResultSearchFilters(request.query as any);
    const rows = await resultQueryService.search(tenantId, filters);
    return toResultListResponse(rows);
  });

  app.get('/results/:id', { preHandler: requirePermission(TAX_PERMISSIONS.RESULT_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const row = await resultQueryService.getById(tenantId, id);
    return toResultDetailResponse(row);
  });

  // ── Exceptions ──────────────────────────────────────────────────────────
  app.get('/exceptions', { preHandler: requirePermission(TAX_PERMISSIONS.EXCEPTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { legalEntityId: queryLegalEntityId, status } = request.query as any;
    const legalEntityId = queryLegalEntityId ?? getLegalEntityId(request);
    const rows = await exceptionService.list(tenantId, legalEntityId, status);
    return toExceptionListResponse(rows);
  });

  app.get('/exceptions/:id', { preHandler: requirePermission(TAX_PERMISSIONS.EXCEPTION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const row = await exceptionService.getById(tenantId, id);
    return toExceptionResponse(row);
  });

  app.post('/exceptions/:id/re-request', { preHandler: requirePermission(TAX_PERMISSIONS.EXCEPTION_DISPOSITION) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const row = await exceptionService.reRequest(tenantId, id, getActor(request));
    return toExceptionResponse(row);
  });

  app.post('/exceptions/bulk-re-request', { preHandler: requirePermission(TAX_PERMISSIONS.EXCEPTION_DISPOSITION) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { ids } = request.body as any;
    return exceptionService.bulkReRequest(tenantId, ids, getActor(request));
  });

  // ── Reconciliation ──────────────────────────────────────────────────────
  app.get('/reconciliation', { preHandler: requirePermission(TAX_PERMISSIONS.RECONCILIATION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { period, entityId } = request.query as any;
    const report = await reconciliationService.threeWayTie(tenantId, entityId, period);
    return toReconciliationResponse(report);
  });

  app.get('/reconciliation/report', { preHandler: requirePermission(TAX_PERMISSIONS.RECONCILIATION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { period, entityId } = request.query as any;
    return reconciliationService.jurisdictionLiabilityReport(tenantId, entityId, period);
  });

  app.get('/reconciliation/close-period', { preHandler: requirePermission(TAX_PERMISSIONS.RECONCILIATION_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { period, entityId } = request.query as any;
    return reconciliationService.closePeriodGate(tenantId, entityId, period);
  });

  // ── Fee tables ──────────────────────────────────────────────────────────
  app.get('/fees', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { active, status } = request.query as any;
    const activeFilter = active !== undefined ? active === 'true' : (status ? status === 'ACTIVE' : undefined);
    const items = await feeTableService.list(tenantId, legalEntityId, activeFilter);
    return { items: items.map(toFeeResponse), total: items.length };
  });

  app.get('/fees/resolve', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const legalEntityId = getLegalEntityId(request);
    const { businessDate, itemClassCode, documentTypeCode, documentType, documentId } = request.query as any;
    const documentContext = documentType && documentId ? { documentType, documentId } : undefined;
    const items = await feeTableService.resolve(tenantId, legalEntityId!, businessDate, itemClassCode, documentTypeCode, documentContext);
    return { items: items.map(toFeeResponse) };
  });

  app.get('/fees/:id', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return toFeeResponse(await feeTableService.getById(tenantId, id));
  });

  app.post('/fees', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_MANAGE) }, async (request: any, reply) => {
    const tenantId = getTenantId(request);
    const dto = normalizeFeeInput(request.body, getLegalEntityId(request));
    const created = await feeTableService.create(tenantId, dto, getActor(request));
    reply.status(201);
    return toFeeResponse(created);
  });

  async function updateFeeHandler(request: any) {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const { version, ...rest } = request.body as any;
    const dto = normalizeFeeInput(rest, getLegalEntityId(request));
    const updated = await feeTableService.update(tenantId, id, dto, version, getActor(request));
    return toFeeResponse(updated);
  }
  app.patch('/fees/:id', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_MANAGE) }, updateFeeHandler);
  app.put('/fees/:id', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_MANAGE) }, updateFeeHandler);

  app.post('/fees/:id/deactivate', { preHandler: requirePermission(TAX_PERMISSIONS.FEE_MANAGE) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return toFeeResponse(await feeTableService.deactivate(tenantId, id, getActor(request)));
  });

  // ── Account mapping lookup (S023 boundary) ──────────────────────────────
  app.get('/account-mapping', { preHandler: requirePermission(TAX_PERMISSIONS.CONFIG_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { legalEntityId, eventType, feeCode } = request.query as any;
    return mappingService.lookup(tenantId, legalEntityId, eventType, feeCode);
  });

  // ── Audit trail ──────────────────────────────────────────────────────────
  app.get('/audit/:entityType/:entityId', { preHandler: requirePermission(TAX_PERMISSIONS.CONFIG_VIEW) }, async (request: any) => {
    const tenantId = getTenantId(request);
    const { entityType, entityId } = request.params as any;
    return auditQueryService.trail(tenantId, entityType, entityId);
  });
}
