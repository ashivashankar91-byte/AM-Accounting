import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SourceService } from '../application/source-service';
import { MappingService } from '../application/mapping-service';
import {
  attachAuth, getTenantId, getLegalEntityId, getActor, requirePermission, handle, hasPermission, parseIntOr,
} from './route-helpers';

export async function sourceRoutes(app: FastifyInstance) {
  attachAuth(app);

  app.get('/sources', { preHandler: requirePermission('migration.source.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    return handle(reply, async () => {
      const svc = container.resolve(SourceService);
      const [items, upstream] = await Promise.all([svc.listSystems(tenantId), svc.upstreamSignals()]);
      return {
        items,
        total: items.length,
        // A tenant with no registered source is reported as such rather than
        // shown an empty grid that looks like a healthy configuration.
        configured: items.length > 0,
        upstreamSignals: upstream,
      };
    });
  });

  app.post('/sources', { preHandler: requirePermission('migration.source.register') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(SourceService).registerSystem({
      tenantId,
      systemCode: body.systemCode,
      systemName: body.systemName,
      sourceType: body.sourceType,
      metadata: body.metadata,
      actor: getActor(request),
    }));
  });

  app.get('/sources/:id/snapshots', { preHandler: requirePermission('migration.extract.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(SourceService).listSnapshots(tenantId, id);
      return { items, total: items.length };
    });
  });

  app.post('/sources/:id/snapshots', { preHandler: requirePermission('migration.extract.import') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(SourceService).registerSnapshot({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      sourceSystemId: id,
      snapshotRef: body.snapshotRef,
      extractedAt: body.extractedAt ?? new Date().toISOString(),
      isDelta: Boolean(body.isDelta),
      baseSnapshotId: body.baseSnapshotId ?? null,
      actor: getActor(request),
    }));
  });

  app.get('/sources/:id/snapshots/:snapshotId/files', { preHandler: requirePermission('migration.extract.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { snapshotId } = request.params as any;
    return handle(reply, async () => {
      const items = await container.resolve(SourceService).listFiles(tenantId, snapshotId);
      return { items, total: items.length };
    });
  });

  app.post('/sources/:id/snapshots/:snapshotId/files', { preHandler: requirePermission('migration.extract.import') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { snapshotId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(SourceService).importRows({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      snapshotId,
      filename: body.filename,
      filePath: body.filePath ?? body.filename,
      declaredChecksum: body.checksumSha256 ?? '',
      rows: body.rows ?? [],
      actor: getActor(request),
    }));
  });

  app.get('/sources/:id/snapshots/:snapshotId/rows', { preHandler: requirePermission('migration.extract.read') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { snapshotId } = request.params as any;
    const q = request.query as any;
    const allowSensitive = await hasPermission(request, 'migration.sensitive.view');
    return handle(reply, async () => {
      const svc = container.resolve(SourceService);
      if (q.sourceFileId) {
        return svc.listRows(tenantId, q.sourceFileId, parseIntOr(q.limit, 50), parseIntOr(q.offset, 0), allowSensitive);
      }
      const files = await svc.listFiles(tenantId, snapshotId);
      if (files.length === 0) return { total: 0, items: [] };
      return svc.listRows(tenantId, files[0].id, parseIntOr(q.limit, 50), parseIntOr(q.offset, 0), allowSensitive);
    });
  });
}

export async function mappingRoutes(app: FastifyInstance) {
  attachAuth(app);

  app.get('/mapping-sets', { preHandler: requirePermission('migration.mapping.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const q = request.query as any;
    return handle(reply, async () => {
      const items = await container.resolve(MappingService)
        .listSets(tenantId, { legalEntityId: q.legalEntityId, sourceSystemId: q.sourceSystemId });
      return { items, total: items.length };
    });
  });

  app.post('/mapping-sets', { preHandler: requirePermission('migration.mapping.manage') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return handle(reply, () => container.resolve(MappingService).createSet({
      tenantId,
      legalEntityId: getLegalEntityId(request),
      sourceSystemId: body.sourceSystemId,
      actor: getActor(request),
    }));
  });

  app.get('/mapping-sets/:id', { preHandler: requirePermission('migration.mapping.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return handle(reply, async () => {
      const svc = container.resolve(MappingService);
      const [set, entries] = await Promise.all([svc.getSet(tenantId, id), svc.listEntries(tenantId, id)]);
      return { set, ...entries };
    });
  });

  app.get('/mapping-sets/:id/entries', { preHandler: requirePermission('migration.mapping.view') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return handle(reply, () => container.resolve(MappingService).listEntries(tenantId, id));
  });

  app.post('/mapping-sets/:id/seed', { preHandler: requirePermission('migration.mapping.manage') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(MappingService).seedFromSnapshot({
      tenantId,
      mappingSetId: id,
      snapshotId: body.snapshotId,
      fields: body.fields ?? ['accountCode'],
    }));
  });

  app.post('/mapping-sets/:id/entries', { preHandler: requirePermission('migration.mapping.manage') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(MappingService).upsertEntries({
      tenantId,
      mappingSetId: id,
      entries: body.entries ?? [],
      actor: getActor(request),
    }));
  });

  app.patch('/mapping-sets/:id/entries/:entryId', { preHandler: requirePermission('migration.mapping.manage') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id, entryId } = request.params as any;
    const body = request.body as any;
    return handle(reply, () => container.resolve(MappingService).updateEntry({
      tenantId, mappingSetId: id, entryId, actor: getActor(request), patch: body,
    }));
  });

  app.post('/mapping-sets/:id/entries/:entryId/approve', { preHandler: requirePermission('migration.mapping.approve') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id, entryId } = request.params as any;
    return handle(reply, () => container.resolve(MappingService).approveEntry({
      tenantId, mappingSetId: id, entryId, actor: getActor(request),
    }));
  });

  app.post('/mapping-sets/:id/freeze', { preHandler: requirePermission('migration.mapping.approve') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return handle(reply, () => container.resolve(MappingService).freeze({
      tenantId, mappingSetId: id, actor: getActor(request),
    }));
  });
}
