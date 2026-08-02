import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MigrationRunService } from '../application/migration-run-service';
import { StagingService } from '../application/staging-service';
import { PromotionService } from '../application/promotion-service';
import { ExceptionService } from '../application/exception-service';
import { CutoverService } from '../application/cutover-service';
import {
  attachAuth, getTenantId, getLegalEntityId, getActor, requirePermission, handle, hasPermission, parseIntOr,
} from './route-helpers';

export async function runRoutes(app: FastifyInstance) {
  attachAuth(app);

  app.get('/runs', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const q = request.query as any;
    return handle(reply, async () => {
      const runs = await container.resolve(MigrationRunService).list(tenantId, {
        legalEntityId: q.legalEntityId,
        state: q.state,
        mode: q.mode,
      });
      return { items: runs, total: runs.length };
    });
  });

  app.post('/runs', { preHandler: requirePermission('migration.run.create') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(MigrationRunService).create({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      mode: body.mode,
      transformationVersion: body.transformationVersion ?? 'ce16.v1:unpinned',
      sourceSnapshotRef: body.sourceSnapshotRef ?? null,
      runId: body.runId,
      metadata: body.metadata,
      actor: getActor(request),
    }));
  });

  app.get('/runs/:runId', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, async () => {
      const svc = container.resolve(MigrationRunService);
      const [run, readiness, datasets] = await Promise.all([
        svc.get(tenantId, runId),
        svc.computeReadiness(tenantId, runId),
        container.resolve(StagingService).listDatasets(tenantId, runId),
      ]);
      return { run, readiness, datasets };
    });
  });

  app.patch('/runs/:runId', { preHandler: requirePermission('migration.run.create') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(MigrationRunService)
      .transition(tenantId, runId, body.toState, getActor(request), body.reason));
  });

  app.get('/runs/:runId/audit', { preHandler: requirePermission('migration.audit.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(MigrationRunService).getAudit(tenantId, runId);
      return { items, total: items.length };
    });
  });

  app.post('/runs/:runId/freeze', { preHandler: requirePermission('migration.cutover.prepare') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(MigrationRunService)
      .attestFreeze(tenantId, runId, getActor(request), body.attestation ?? ''));
  });

  app.post('/runs/:runId/delta-complete', { preHandler: requirePermission('migration.extract.import') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(MigrationRunService)
      .markDeltaComplete(tenantId, runId, getActor(request), body.deltaSnapshotRef ?? ''));
  });

  app.get('/runs/:runId/readiness', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, () => container.resolve(MigrationRunService).computeReadiness(tenantId, runId));
  });

  // ── Staging & validation ───────────────────────────────────────────────────

  app.get('/runs/:runId/datasets', { preHandler: requirePermission('migration.staging.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(StagingService).listDatasets(tenantId, runId);
      return { items, total: items.length };
    });
  });

  app.get('/runs/:runId/datasets/:datasetId/rows', { preHandler: requirePermission('migration.staging.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { datasetId } = request.params as any;
    const q = request.query as any;
    const allowSensitive = await hasPermission(request, 'migration.sensitive.view');
    return handle(reply, () => container.resolve(StagingService)
      .listRows(tenantId, datasetId, parseIntOr(q.limit, 50), parseIntOr(q.offset, 0), allowSensitive));
  });

  app.post('/runs/:runId/stage', { preHandler: requirePermission('migration.staging.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(StagingService).stage({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      runId,
      snapshotId: body.snapshotId,
      mappingSetId: body.mappingSetId,
      datasetType: body.datasetType,
      actor: getActor(request),
    }));
  });

  app.get('/runs/:runId/preview', { preHandler: requirePermission('migration.staging.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const q = request.query as any;
    const allowSensitive = await hasPermission(request, 'migration.sensitive.view');
    return handle(reply, () => container.resolve(StagingService).preview({
      tenantId,
      snapshotId: q.snapshotId,
      mappingSetId: q.mappingSetId,
      limit: parseIntOr(q.limit, 25),
      allowSensitive,
    }));
  });

  app.post('/runs/:runId/validate', { preHandler: requirePermission('migration.validation.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = (request.body ?? {}) as any;
    return handle(reply, () => container.resolve(StagingService).validate({
      tenantId, runId, actor: getActor(request),
      convertedControlBalances: body.convertedControlBalances,
      agingAsOf: body.agingAsOf ?? null,
    }));
  });

  app.get('/runs/:runId/gates', { preHandler: requirePermission('migration.validation.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(StagingService).listGates(tenantId, runId);
      return { items, total: items.length };
    });
  });

  app.get('/runs/:runId/control-totals', { preHandler: requirePermission('migration.reconcile.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(StagingService).listControlTotals(tenantId, runId);
      return { items, total: items.length };
    });
  });

  // ── Exceptions ─────────────────────────────────────────────────────────────

  app.get('/runs/:runId/exceptions', { preHandler: requirePermission('migration.exception.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const q = request.query as any;
    const allowSensitive = await hasPermission(request, 'migration.sensitive.view');
    return handle(reply, () => container.resolve(ExceptionService)
      .list(tenantId, runId, { disposition: q.disposition, exceptionType: q.exceptionType }, allowSensitive));
  });

  app.patch('/runs/:runId/exceptions/:exceptionId', { preHandler: requirePermission('migration.exception.disposition') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId, exceptionId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(ExceptionService).disposition({
      tenantId, runId, exceptionId,
      disposition: body.disposition,
      reason: body.reason ?? '',
      correctedValue: body.correctedValue ?? null,
      actor: getActor(request),
    }));
  });

  // ── Promotion, cutover, rollback, lineage ──────────────────────────────────

  app.post('/runs/:runId/promote', { preHandler: requirePermission('migration.staging.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = (request.body ?? {}) as any;
    return handle(reply, () => container.resolve(PromotionService).promote({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      runId,
      actor: getActor(request),
      businessDate: body.businessDate,
    }));
  });

  app.get('/runs/:runId/lineage', { preHandler: requirePermission('migration.audit.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const q = request.query as any;
    const allowSensitive = await hasPermission(request, 'migration.sensitive.view');
    return handle(reply, async () => {
      const items = await container.resolve(PromotionService)
        .listLineage(tenantId, runId, { sourceRowRef: q.sourceRowRef, journalRef: q.journalRef }, allowSensitive);
      return { items, total: items.length };
    });
  });

  app.get('/runs/:runId/cutover-ceremony', { preHandler: requirePermission('migration.cutover.prepare') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, () => container.resolve(CutoverService).getCeremony(tenantId, runId));
  });

  app.post('/runs/:runId/cutover/prepare', { preHandler: requirePermission('migration.cutover.prepare') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(CutoverService).prepare({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      runId,
      actor: getActor(request),
      sourceSystemIds: body.sourceSystemIds ?? [],
      targetEnvironment: body.targetEnvironment ?? 'PRODUCTION',
      rollbackBoundary: body.rollbackBoundary ?? '',
      backupEvidence: body.backupEvidence ?? {},
      rollbackPlanEvidence: body.rollbackPlanEvidence ?? {},
    }));
  });

  app.post('/runs/:runId/cutover/approve', { preHandler: requirePermission('migration.cutover.approve') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(CutoverService).approve({
      tenantId, runId, actor: getActor(request),
      acknowledgedStatement: body.acknowledgedStatement ?? '',
    }));
  });

  app.post('/runs/:runId/cutover', { preHandler: requirePermission('migration.cutover.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, () => container.resolve(CutoverService).execute({
      tenantId, runId, actor: getActor(request),
    }));
  });

  app.post('/runs/:runId/rollback', { preHandler: requirePermission('migration.rollback.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = (request.body ?? {}) as any;
    return handle(reply, () => container.resolve(CutoverService).rollback({
      tenantId, runId, actor: getActor(request),
      reason: body.reason ?? '',
      requestedKind: body.kind,
    }));
  });

  app.get('/runs/:runId/restart-plan', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, () => container.resolve(CutoverService).restartPlan(tenantId, runId));
  });
}
