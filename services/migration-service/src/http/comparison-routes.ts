import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ComparisonService } from '../application/comparison-service';
import { ArchiveService } from '../application/archive-service';
import { RunbookService } from '../application/runbook-service';
import {
  attachAuth, getTenantId, getLegalEntityId, getActor, requirePermission, handle, parseIntOr,
} from './route-helpers';

export async function comparisonRoutes(app: FastifyInstance) {
  attachAuth(app);

  app.get('/runs/:runId/comparison', { preHandler: requirePermission('migration.reconcile.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(ComparisonService).list(tenantId, runId);
      return { items, total: items.length };
    });
  });

  app.post('/runs/:runId/comparison', { preHandler: requirePermission('migration.reconcile.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { runId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(ComparisonService).createComparison({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      runId,
      periodYear: parseIntOr(body.periodYear, new Date().getUTCFullYear()),
      periodMonth: parseIntOr(body.periodMonth, 1),
      legacyFigures: body.legacyFigures ?? [],
      modernFigures: body.modernFigures,
      legacySnapshotRef: body.legacySnapshotRef ?? null,
      actor: getActor(request),
    }));
  });

  app.get('/runs/:runId/comparison/:comparisonRunId', { preHandler: requirePermission('migration.reconcile.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { comparisonRunId } = request.params as any;
    return handle(reply, () => container.resolve(ComparisonService).getComparison(tenantId, comparisonRunId));
  });

  app.patch('/runs/:runId/comparison/diffs/:diffId', { preHandler: requirePermission('migration.reconcile.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { diffId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(ComparisonService).classifyDiff({
      tenantId,
      comparisonRunId: body.comparisonRunId,
      diffId,
      classification: body.classification,
      reason: body.reason ?? '',
      disposition: body.disposition,
      actor: getActor(request),
    }));
  });

  app.post('/runs/:runId/comparison/sign-off', { preHandler: requirePermission('migration.reconcile.execute') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(ComparisonService).signOff({
      tenantId,
      comparisonRunId: body.comparisonRunId,
      actor: getActor(request),
      evidence: body.evidence,
    }));
  });
}

export async function archiveRoutes(app: FastifyInstance) {
  attachAuth(app);

  app.get('/archive', { preHandler: requirePermission('migration.audit.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const q = request.query as any;
    return handle(reply, async () => {
      const items = await container.resolve(ArchiveService).list(tenantId, {
        legalEntityId: q.legalEntityId,
        periodYear: q.periodYear ? parseIntOr(q.periodYear, 0) : undefined,
        periodMonth: q.periodMonth ? parseIntOr(q.periodMonth, 0) : undefined,
        statementType: q.statementType,
        search: q.search,
      });
      return { items, total: items.length };
    });
  });

  app.post('/archive', { preHandler: requirePermission('migration.extract.import') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(ArchiveService).import({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      periodYear: parseIntOr(body.periodYear, 0),
      periodMonth: parseIntOr(body.periodMonth, 0),
      statementType: body.statementType,
      sourceSystem: body.sourceSystem ?? 'LEGACY',
      filename: body.filename,
      contentBase64: body.contentBase64,
      checksumSha256: body.checksumSha256,
      fileSize: body.fileSize,
      wormClass: body.wormClass,
      metadata: body.metadata,
      actor: getActor(request),
    }));
  });

  app.post('/archive/:id/access', { preHandler: requirePermission('migration.audit.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return handle(reply, () => container.resolve(ArchiveService).recordAccess(tenantId, id));
  });
}

export async function runbookRoutes(app: FastifyInstance) {
  attachAuth(app);

  app.get('/runbooks/templates', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    return handle(reply, async () => {
      const items = await container.resolve(RunbookService).listTemplates(tenantId);
      return { items, total: items.length };
    });
  });

  app.post('/runbooks/templates', { preHandler: requirePermission('migration.run.create') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(RunbookService).createTemplate({
      tenantId, name: body.name, steps: body.steps, actor: getActor(request),
    }));
  });

  app.get('/runbooks', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const q = request.query as any;
    return handle(reply, async () => {
      const items = await container.resolve(RunbookService).listInstances(tenantId, q.runId);
      return { items, total: items.length };
    });
  });

  app.post('/runbooks', { preHandler: requirePermission('migration.run.create') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(RunbookService).createInstance({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      runId: body.runId,
      templateId: body.templateId,
      actor: getActor(request),
    }));
  });

  app.get('/runbooks/:id', { preHandler: requirePermission('migration.run.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return handle(reply, () => container.resolve(RunbookService).getInstance(tenantId, id));
  });

  app.patch('/runbooks/:id/steps/:stepCode', { preHandler: requirePermission('migration.run.create') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id, stepCode } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(RunbookService).updateStep({
      tenantId,
      instanceId: id,
      stepCode,
      status: body.status,
      owner: body.owner,
      evidenceRefs: body.evidenceRefs,
      note: body.note,
      actor: getActor(request),
    }));
  });
}
