import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { SandboxService } from '../application/sandbox-service';
import { IngestionService } from '../application/ingestion-service';
import { LockboxService } from '../application/lockbox-service';
import { LifoService } from '../application/lifo-service';
import { ChargebackModelService } from '../application/chargeback-model-service';
import { PortfolioReserveService } from '../application/portfolio-reserve-service';
import { CessionService } from '../application/cession-service';
import {
  attachAuth, handle, getTenantId, getLegalEntityId, getActor, requirePermission, requireBody,
} from './route-helpers';
import { PERMS } from './permissions';

/**
 * CE-17 — Story surfaces S022, S040, S058, S073, S091B, S095, S096.
 */
export async function storyRoutesA(app: FastifyInstance) {
  attachAuth(app);

  // ── S022 Rule Simulation Sandbox ──────────────────────────────────────────
  const sandbox = () => container.resolve(SandboxService);

  app.get('/sandbox', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, async () => {
      const items = await sandbox().list(getTenantId(req), getLegalEntityId(req));
      return { items, total: items.length };
    }));

  app.get('/sandbox/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => sandbox().get(getTenantId(req), req.params.id)));

  app.get('/sandbox/:id/diff', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => sandbox().diff(getTenantId(req), req.params.id)));

  app.post('/sandbox/run', { preHandler: requirePermission(PERMS.SANDBOX_RUN) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['name', 'scenarioType']);
      return sandbox().run({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        createdBy: getActor(req),
      });
    }));

  // ── S040 OCR/EDI Invoice Ingestion ────────────────────────────────────────
  const ingestion = () => container.resolve(IngestionService);

  app.get('/ingestion/drafts', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, async () => {
      const items = await ingestion().list(getTenantId(req), getLegalEntityId(req), req.query?.state);
      return { items, total: items.length };
    }));

  app.get('/ingestion/drafts/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => ingestion().get(getTenantId(req), req.params.id)));

  app.post('/ingestion/drafts', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['channel', 'extractedFields']);
      return ingestion().ingest({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        actor: getActor(req),
      });
    }));

  app.post('/ingestion/drafts/:id/accept', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, () => ingestion().accept({
      tenantId: getTenantId(req), id: req.params.id, actor: getActor(req),
      s039InvoiceId: (req.body as any)?.s039InvoiceId ?? null,
      overrideDuplicate: Boolean((req.body as any)?.overrideDuplicate),
    })));

  app.post('/ingestion/drafts/:id/reject', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reason']);
      return ingestion().reject({ tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), reason: body.reason });
    }));

  // ── S058 Lockbox AI Remittance Matching ───────────────────────────────────
  const lockbox = () => container.resolve(LockboxService);

  app.get('/lockbox/files', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, async () => {
      const items = await lockbox().listFiles(getTenantId(req), getLegalEntityId(req));
      return { items, total: items.length };
    }));

  app.get('/lockbox/files/:id/lines', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => lockbox().listLines(getTenantId(req), req.params.id)));

  app.post('/lockbox/files', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['fileRef', 'depositDate', 'lines']);
      return lockbox().ingest({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        actor: getActor(req),
      });
    }));

  app.post('/lockbox/lines/:id/review', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['decision']);
      return lockbox().reviewLine({
        tenantId: getTenantId(req), id: req.params.id,
        decision: body.decision, actor: getActor(req), reason: body.reason,
      });
    }));

  // ── S073 LIFO Overlay ─────────────────────────────────────────────────────
  const lifo = () => container.resolve(LifoService);

  app.get('/lifo/pools', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, () => lifo().listPools(getTenantId(req), getLegalEntityId(req))));

  app.post('/lifo/pools', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['poolCode', 'poolName', 'methodElection', 'indexSource', 'effectiveDate']);
      return lifo().createPool({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        electedBy: body.electedBy ?? getActor(req),
      });
    }));

  app.post('/lifo/pools/:id/compute', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['layers']);
      return lifo().computeLayers({
        tenantId: getTenantId(req), poolId: req.params.id, layers: body.layers, actor: getActor(req),
      });
    }));

  app.post('/lifo/layers/:id/approve', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reserveAccountCode', 'offsetAccountCode']);
      return lifo().approveLayer({
        tenantId: getTenantId(req), id: req.params.id, approver: getActor(req),
        reserveAccountCode: body.reserveAccountCode, offsetAccountCode: body.offsetAccountCode,
      });
    }));

  // ── S091B Experience-Rated Chargeback Model ───────────────────────────────
  const chargeback = () => container.resolve(ChargebackModelService);

  app.get('/chargeback/models', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => chargeback().list(getTenantId(req), getLegalEntityId(req), req.query?.state)));

  app.get('/chargeback/models/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => chargeback().get(getTenantId(req), req.params.id)));

  app.post('/chargeback/models', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['modelVersion', 'trainingWindowStart', 'trainingWindowEnd']);
      return chargeback().runModel({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        actor: getActor(req),
      });
    }));

  // Adoption is the ceremony, so it needs the approval permission — not the
  // permission that lets somebody run the model in the first place.
  app.post('/chargeback/models/:id/adopt', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['s091ConfigVersion']);
      return chargeback().adopt({
        tenantId: getTenantId(req), id: req.params.id, adoptedBy: getActor(req),
        s091ConfigVersion: body.s091ConfigVersion, acknowledgeDrift: Boolean(body.acknowledgeDrift),
      });
    }));

  // ── S095 Retro/Portfolio Reserve Accrual ──────────────────────────────────
  const portfolio = () => container.resolve(PortfolioReserveService);

  app.get('/portfolio/statements', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => portfolio().list(getTenantId(req), getLegalEntityId(req), req.query?.state)));

  app.get('/portfolio/statements/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => portfolio().get(getTenantId(req), req.params.id)));

  app.post('/portfolio/statements', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['statementDate', 'lenderRef', 'totalAmount', 'evidenceRef', 'allocationBasis']);
      return portfolio().enter({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.post('/portfolio/statements/:id/allocate', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, () => portfolio().allocate({
      tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), weights: (req.body as any)?.weights,
    })));

  app.post('/portfolio/statements/:id/approve', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reserveAccountCode', 'offsetAccountCode']);
      return portfolio().approve({
        tenantId: getTenantId(req), id: req.params.id, approver: getActor(req),
        reserveAccountCode: body.reserveAccountCode, offsetAccountCode: body.offsetAccountCode,
      });
    }));

  // ── S096 Reinsurance / DOWC Cession ───────────────────────────────────────
  const cession = () => container.resolve(CessionService);

  app.get('/cession/statements', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => cession().list(getTenantId(req), getLegalEntityId(req), req.query?.state)));

  app.get('/cession/statements/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => cession().get(getTenantId(req), req.params.id)));

  app.get('/cession/position', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => cession().position(getTenantId(req), getLegalEntityId(req), req.query?.treatyCode)));

  app.post('/cession/statements', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, [
        'statementDate', 'programAdminRef', 'treatyCode',
        'premiumCession', 'reserveCession', 'claimCession', 'statementEvidenceRef',
      ]);
      return cession().enter({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.post('/cession/statements/:id/approve', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['cededPremiumAccountCode', 'cededReserveAccountCode', 'offsetAccountCode']);
      return cession().approve({
        tenantId: getTenantId(req), id: req.params.id, approver: getActor(req),
        cededPremiumAccountCode: body.cededPremiumAccountCode,
        cededReserveAccountCode: body.cededReserveAccountCode,
        offsetAccountCode: body.offsetAccountCode,
      });
    }));
}
