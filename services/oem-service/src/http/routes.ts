import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, authMiddleware, createAuthzGuard } from '@amacc/shared-kernel';
import { OEM_PERMISSIONS, getTenantId, getActor, getStoreId, requireStoreId } from './security';
import { OemProfileService } from '../application/profile-service';
import { OemStagingService } from '../application/staging-service';
import { OemMatchService } from '../application/match-service';
import { OemIncentiveService } from '../application/incentive-service';
import { OemStatementService } from '../application/statement-service';
import { OemWarrantyService } from '../application/warranty-service';
import { OemCoopService } from '../application/coop-service';
import { OemNotFoundError, OemSeparationOfDutiesError, OemValidationError } from '../domain/errors';

function errorToResponse(err: any): { statusCode: number; body: Record<string, unknown> } {
  if (err instanceof OemValidationError) return { statusCode: 400, body: { error: err.code, message: err.message } };
  if (err instanceof OemNotFoundError) return { statusCode: 404, body: { error: 'NOT_FOUND', message: err.message } };
  if (err instanceof OemSeparationOfDutiesError) return { statusCode: 409, body: { error: 'SEPARATION_OF_DUTIES', message: err.message } };
  return { statusCode: 500, body: { error: 'INTERNAL_ERROR', message: err?.message ?? 'Unexpected error' } };
}

export async function oemRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting oem-service.');
  }
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId: (r: any) => getTenantId(r) });

  const profiles = container.resolve(OemProfileService);
  const staging = container.resolve(OemStagingService);
  const match = container.resolve(OemMatchService);
  const incentives = container.resolve(OemIncentiveService);
  const statements = container.resolve(OemStatementService);
  const warranty = container.resolve(OemWarrantyService);
  const coop = container.resolve(OemCoopService);

  app.setErrorHandler((err: any, request, reply) => {
    if (err?.statusCode === 400 && /x-tenant-id|storeId/i.test(err.message ?? '')) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
    }
    const mapped = errorToResponse(err);
    return reply.status(mapped.statusCode).send(mapped.body);
  });

  // ── S098 — Profiles / dealer codes ─────────────────────────────────────
  app.post('/profiles', { preHandler: requirePermission(OEM_PERMISSIONS.PROFILE_MANAGE) }, async (request: any) => {
    return profiles.create(getTenantId(request), request.body, getActor(request));
  });
  app.get('/profiles', { preHandler: requirePermission(OEM_PERMISSIONS.PROFILE_VIEW) }, async (request: any) => {
    return profiles.list(getTenantId(request));
  });
  app.get('/profiles/:make', { preHandler: requirePermission(OEM_PERMISSIONS.PROFILE_VIEW) }, async (request: any) => {
    return profiles.getByMake(getTenantId(request), request.params.make);
  });
  app.patch('/profiles/:make/status', { preHandler: requirePermission(OEM_PERMISSIONS.PROFILE_MANAGE) }, async (request: any) => {
    const { status, certificationEvidenceRef } = request.body;
    return profiles.setConnectionStatus(getTenantId(request), request.params.make, status, certificationEvidenceRef ?? null, getActor(request));
  });
  app.put('/profiles/:make/dealer-codes/:storeId', { preHandler: requirePermission(OEM_PERMISSIONS.PROFILE_MANAGE) }, async (request: any) => {
    return profiles.setDealerCode(getTenantId(request), request.params.make, request.params.storeId, request.body.dealerCode, getActor(request));
  });

  // ── S098/S099/S100 — Staging / diff alerts ─────────────────────────────
  app.post('/staging/import/feed', { preHandler: requirePermission(OEM_PERMISSIONS.STAGING_IMPORT) }, async (request: any) => {
    return staging.importFeed(getTenantId(request), request.body, getActor(request));
  });
  app.post('/staging/import/manual', { preHandler: requirePermission(OEM_PERMISSIONS.STAGING_IMPORT) }, async (request: any) => {
    return staging.importManual(getTenantId(request), request.body, getActor(request));
  });
  app.get('/staging/documents', { preHandler: requirePermission(OEM_PERMISSIONS.STAGING_VIEW) }, async (request: any) => {
    return staging.listDocuments(getTenantId(request), request.query?.make);
  });
  app.get('/staging/documents/:id', { preHandler: requirePermission(OEM_PERMISSIONS.STAGING_VIEW) }, async (request: any) => {
    return staging.getDocument(getTenantId(request), request.params.id);
  });
  app.get('/staging/diff-alerts', { preHandler: requirePermission(OEM_PERMISSIONS.STAGING_VIEW) }, async (request: any) => {
    const resolved = request.query?.resolved === undefined ? undefined : request.query.resolved === 'true';
    return staging.listDiffAlerts(getTenantId(request), resolved);
  });
  app.post('/staging/diff-alerts/:id/resolve', { preHandler: requirePermission(OEM_PERMISSIONS.STAGING_IMPORT) }, async (request: any) => {
    return staging.resolveDiffAlert(getTenantId(request), request.params.id, getActor(request));
  });

  // ── S101A — Match workbench ─────────────────────────────────────────────
  app.post('/match/sessions', { preHandler: requirePermission(OEM_PERMISSIONS.MATCH_DISPOSE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    return match.createSession(getTenantId(request), storeId, request.body.statementDocumentId, getActor(request));
  });
  app.get('/match/sessions', { preHandler: requirePermission(OEM_PERMISSIONS.MATCH_VIEW) }, async (request: any) => {
    return match.listSessions(getTenantId(request), getStoreId(request));
  });
  app.get('/match/sessions/:id', { preHandler: requirePermission(OEM_PERMISSIONS.MATCH_VIEW) }, async (request: any) => {
    return match.getSession(getTenantId(request), request.params.id);
  });
  app.post('/match/sessions/:id/rows/:rowId/dispose', { preHandler: requirePermission(OEM_PERMISSIONS.MATCH_DISPOSE) }, async (request: any) => {
    const { disposition, note } = request.body;
    return match.disposeRow(getTenantId(request), request.params.id, request.params.rowId, disposition, getActor(request), note);
  });
  app.post('/match/sessions/:id/complete', { preHandler: requirePermission(OEM_PERMISSIONS.MATCH_DISPOSE) }, async (request: any) => {
    return match.completeSession(getTenantId(request), request.params.id, getActor(request));
  });

  // ── S103A — Incentive registry / RDR accruals ──────────────────────────
  app.post('/incentives/programs', { preHandler: requirePermission(OEM_PERMISSIONS.INCENTIVE_MANAGE) }, async (request: any) => {
    return incentives.registerProgram(getTenantId(request), request.body, getActor(request));
  });
  app.get('/incentives/programs', { preHandler: requirePermission(OEM_PERMISSIONS.INCENTIVE_VIEW) }, async (request: any) => {
    return incentives.listPrograms(getTenantId(request));
  });
  app.post('/incentives/accrue', { preHandler: requirePermission(OEM_PERMISSIONS.INCENTIVE_MANAGE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    const since = request.body?.since ?? '1970-01-01';
    return incentives.accrueFromDeliveries(getTenantId(request), storeId, since, getActor(request));
  });
  app.get('/incentives/accruals', { preHandler: requirePermission(OEM_PERMISSIONS.INCENTIVE_VIEW) }, async (request: any) => {
    return incentives.listAccruals(getTenantId(request), getStoreId(request));
  });
  app.post('/incentives/accruals/:id/true-up', { preHandler: requirePermission(OEM_PERMISSIONS.INCENTIVE_TRUEUP) }, async (request: any) => {
    const { adjustmentAmount, reason, statementRowRef } = request.body;
    return incentives.trueUp(getTenantId(request), request.params.id, adjustmentAmount, reason, statementRowRef ?? null, getActor(request));
  });
  app.get('/incentives/receivable-tie', { preHandler: requirePermission(OEM_PERMISSIONS.INCENTIVE_VIEW) }, async (request: any) => {
    return incentives.receivableTie(getTenantId(request), requireStoreId(request));
  });

  // ── S104 — Statement renderer ────────────────────────────────────────────
  app.post('/statement/profiles', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_RENDER) }, async (request: any) => {
    const { make, version, pageLineDefinitions, effectiveFrom } = request.body;
    return statements.createProfile(getTenantId(request), make, version, pageLineDefinitions, effectiveFrom, getActor(request));
  });
  app.get('/statement/profiles', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_VIEW) }, async (request: any) => {
    return statements.listProfiles(getTenantId(request));
  });
  app.post('/statement/profiles/:id/mappings', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_MAPPING_AUTHOR) }, async (request: any) => {
    const { glAccountId, statementLineRef } = request.body;
    return statements.authorMapping(getTenantId(request), request.params.id, glAccountId, statementLineRef, getActor(request));
  });
  app.get('/statement/profiles/:id/mappings', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_VIEW) }, async (request: any) => {
    return statements.listMappings(getTenantId(request), request.params.id);
  });
  app.post('/statement/mappings/:id/activate', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_MAPPING_ACTIVATE) }, async (request: any) => {
    return statements.activateMapping(getTenantId(request), request.params.id, getActor(request));
  });
  app.post('/statement/renders', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_RENDER) }, async (request: any) => {
    const storeId = requireStoreId(request);
    const { statementProfileId, period, injectVarianceForCertification } = request.body;
    return statements.render(getTenantId(request), storeId, statementProfileId, period, getActor(request), injectVarianceForCertification);
  });
  app.get('/statement/renders/:id', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_VIEW) }, async (request: any) => {
    return statements.getRender(getTenantId(request), request.params.id);
  });
  app.get('/statement/renders/:id/drill', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_VIEW) }, async (request: any) => {
    return statements.drillCell(getTenantId(request), request.params.id, request.query.lineRef);
  });
  app.post('/statement/renders/:id/export', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_RENDER) }, async (request: any) => {
    return statements.exportRender(getTenantId(request), request.params.id, request.body?.format ?? 'JSON', getActor(request));
  });
  app.get('/statement/exports', { preHandler: requirePermission(OEM_PERMISSIONS.STATEMENT_VIEW) }, async (request: any) => {
    return statements.listExports(getTenantId(request), request.query?.renderId);
  });

  // ── S105 — Warranty chargeback / reserve ─────────────────────────────────
  app.post('/warranty/notices', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_CHARGEBACK_DISPOSE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    const { make, sourceDocumentId, noticeDate, lines } = request.body;
    return warranty.createNotice(getTenantId(request), storeId, make, sourceDocumentId ?? null, noticeDate, lines, getActor(request));
  });
  app.get('/warranty/notices', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_VIEW) }, async (request: any) => {
    return warranty.listNotices(getTenantId(request), getStoreId(request));
  });
  app.get('/warranty/notices/:id', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_VIEW) }, async (request: any) => {
    return warranty.getNotice(getTenantId(request), request.params.id);
  });
  app.post('/warranty/lines/:id/dispose', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_CHARGEBACK_DISPOSE) }, async (request: any) => {
    return warranty.disposeLine(getTenantId(request), request.params.id, request.body.disposition, getActor(request));
  });
  app.post('/warranty/lines/:id/evidence', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_CHARGEBACK_DISPOSE) }, async (request: any) => {
    return warranty.addEvidence(getTenantId(request), request.params.id, request.body.evidenceRef, request.body.note ?? null, getActor(request));
  });
  app.post('/warranty/reserve/config', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_RESERVE_MANAGE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    return warranty.setReserveConfig(getTenantId(request), storeId, request.body.ratePercent, request.body.effectiveFrom, getActor(request));
  });
  app.post('/warranty/reserve/preview', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_RESERVE_MANAGE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    const { period, paidWarrantyVolume } = request.body;
    return warranty.previewReserve(getTenantId(request), storeId, period, paidWarrantyVolume, getActor(request));
  });
  app.post('/warranty/reserve/previews/:id/approve', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_RESERVE_MANAGE) }, async (request: any) => {
    return warranty.approveReservePreview(getTenantId(request), request.params.id, getActor(request));
  });
  app.post('/warranty/reserve/draws', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_RESERVE_MANAGE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    return warranty.drawReserve(getTenantId(request), storeId, request.body.chargebackLineId, getActor(request));
  });
  app.get('/warranty/reserve/rollforward', { preHandler: requirePermission(OEM_PERMISSIONS.WARRANTY_VIEW) }, async (request: any) => {
    return warranty.reserveRollforward(getTenantId(request), requireStoreId(request));
  });

  // ── S106 — Co-op advertising claims ──────────────────────────────────────
  app.post('/coop/programs', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_ACCRUAL_MANAGE) }, async (request: any) => {
    const { make, programId, accrualBasis, ratePercent, termsSummary } = request.body;
    return coop.registerProgram(getTenantId(request), make, programId, accrualBasis, ratePercent ?? null, termsSummary ?? null, getActor(request));
  });
  app.get('/coop/programs', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_VIEW) }, async (request: any) => {
    return coop.listPrograms(getTenantId(request));
  });
  app.post('/coop/claims', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_CLAIM_MANAGE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    return coop.createClaim(getTenantId(request), storeId, request.body.programId, getActor(request));
  });
  app.get('/coop/claims', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_VIEW) }, async (request: any) => {
    return coop.listClaims(getTenantId(request), getStoreId(request));
  });
  app.get('/coop/claims/:id', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_VIEW) }, async (request: any) => {
    return coop.getClaim(getTenantId(request), request.params.id);
  });
  app.post('/coop/claims/:id/lines', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_CLAIM_MANAGE) }, async (request: any) => {
    const { spendItemRef, description, amount, evidenceRef } = request.body;
    return coop.addClaimLine(getTenantId(request), request.params.id, spendItemRef, description, amount, evidenceRef, getActor(request));
  });
  app.post('/coop/claims/:id/export', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_CLAIM_MANAGE) }, async (request: any) => {
    return coop.exportClaim(getTenantId(request), request.params.id, getActor(request));
  });
  app.post('/coop/lines/:id/response', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_CLAIM_MANAGE) }, async (request: any) => {
    const { responseStatus, approvedAmount } = request.body;
    return coop.recordLineResponse(getTenantId(request), request.params.id, responseStatus, approvedAmount ?? null, getActor(request));
  });
  app.post('/coop/lines/:id/write-off', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_CLAIM_MANAGE) }, async (request: any) => {
    return coop.writeOffDenied(getTenantId(request), request.params.id, getActor(request));
  });
  app.post('/coop/accrual/preview', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_ACCRUAL_MANAGE) }, async (request: any) => {
    const storeId = requireStoreId(request);
    const { programId, period, periodQualifyingSalesAmount } = request.body;
    return coop.previewAccrual(getTenantId(request), storeId, programId, period, periodQualifyingSalesAmount, getActor(request));
  });
  app.post('/coop/accrual/previews/:id/approve', { preHandler: requirePermission(OEM_PERMISSIONS.COOP_ACCRUAL_MANAGE) }, async (request: any) => {
    return coop.approveAccrual(getTenantId(request), request.params.id, getActor(request));
  });
}
