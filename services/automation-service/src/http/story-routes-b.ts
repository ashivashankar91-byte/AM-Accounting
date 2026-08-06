import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { OemMatchService } from '../application/oem-match-service';
import { IncentiveAccrualService } from '../application/incentive-accrual-service';
import { CompositeExportService } from '../application/composite-export-service';
import { GaapBridgeService } from '../application/gaap-bridge-service';
import { DsarService } from '../application/dsar-service';
import { UnclaimedPropertyService } from '../application/unclaimed-property-service';
import { SoxEvidenceService } from '../application/sox-evidence-service';
import {
  attachAuth, handle, getTenantId, getLegalEntityId, getActor,
  requirePermission, requireBody, parseIntOr,
} from './route-helpers';
import { PERMS } from './permissions';

/**
 * CE-17 — Story surfaces S101B, S103B, S107, S118, S126, S127, S128.
 */
export async function storyRoutesB(app: FastifyInstance) {
  attachAuth(app);

  // ── S101B OEM Statement Auto-Matcher ──────────────────────────────────────
  const oem = () => container.resolve(OemMatchService);

  app.get('/oem/suggestions', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => oem().list(getTenantId(req), getLegalEntityId(req), req.query?.state, req.query?.sessionId)));

  app.post('/oem/suggestions', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['s101aSessionId']);
      return oem().suggest({
        ...body,
        tenantId: getTenantId(req),
        legalEntityId: getLegalEntityId(req),
        automationIdentity: body.automationIdentity ?? 'automation:ce17.s101b',
      });
    }));

  app.post('/oem/suggestions/:id/dispose', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['decision']);
      return oem().dispose({
        tenantId: getTenantId(req), id: req.params.id,
        decision: body.decision, actor: getActor(req), reason: body.reason,
      });
    }));

  // ── S103B Probability-Weighted Incentive Accruals ─────────────────────────
  const incentives = () => container.resolve(IncentiveAccrualService);

  app.get('/incentives/recommendations', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => incentives().list(
      getTenantId(req), getLegalEntityId(req),
      req.query?.periodYear ? parseIntOr(req.query.periodYear, 0) : undefined,
      req.query?.periodMonth ? parseIntOr(req.query.periodMonth, 0) : undefined,
    )));

  app.get('/incentives/recommendations/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => incentives().get(getTenantId(req), req.params.id)));

  app.post('/incentives/recommendations', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['programRef', 'periodYear', 'periodMonth', 'attainmentPace', 'weightingMethod', 'tiers']);
      return incentives().recommend({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.post('/incentives/recommendations/:id/approve', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['accrualAccountCode', 'offsetAccountCode']);
      return incentives().approve({
        tenantId: getTenantId(req), id: req.params.id, approver: getActor(req),
        accrualAccountCode: body.accrualAccountCode, offsetAccountCode: body.offsetAccountCode,
      });
    }));

  app.post('/incentives/recommendations/:id/reject', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['reason']);
      return incentives().reject({ tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), reason: body.reason });
    }));

  // ── S107 NCM/NADA Composite Export ────────────────────────────────────────
  const exports_ = () => container.resolve(CompositeExportService);

  app.get('/exports', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => exports_().list(getTenantId(req), getLegalEntityId(req), req.query?.state)));

  app.get('/exports/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => exports_().get(getTenantId(req), req.params.id)));

  app.get('/exports/baseline-status', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, () => exports_().baselineStatus(getTenantId(req), getLegalEntityId(req))));

  app.post('/exports', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['exportType', 'formatProfileVersion', 'periodYear', 'periodMonth']);
      return exports_().generate({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.post('/exports/:id/approve', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, () => exports_().approve({ tenantId: getTenantId(req), id: req.params.id, approver: getActor(req) })));

  app.post('/exports/:id/response', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['response']);
      return exports_().recordResponse({
        tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), response: body.response,
      });
    }));

  // ── S118 GAAP Bridge Memo Generator ───────────────────────────────────────
  const memos = () => container.resolve(GaapBridgeService);

  app.get('/memos', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, () => memos().list(getTenantId(req), getLegalEntityId(req))));

  app.get('/memos/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => memos().get(getTenantId(req), req.params.id)));

  app.post('/memos', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['periodYear', 'periodMonth']);
      return memos().generateDraft({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.patch('/memos/:id', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['sections']);
      return memos().edit({
        tenantId: getTenantId(req), id: req.params.id, actor: getActor(req),
        sections: body.sections, note: body.note,
      });
    }));

  app.post('/memos/:id/finalize', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, () => memos().finalize({ tenantId: getTenantId(req), id: req.params.id, finalizedBy: getActor(req) })));

  // ── S126 DSAR Automation ──────────────────────────────────────────────────
  const dsar = () => container.resolve(DsarService);

  app.get('/dsar/cases', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, () => dsar().list(getTenantId(req), req.query?.state)));

  app.get('/dsar/cases/:id', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, () => dsar().get(getTenantId(req), req.params.id)));

  app.post('/dsar/cases', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['subjectIdentifier', 'requestType', 'verificationEvidence']);
      return dsar().intake({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.post('/dsar/cases/:id/scan', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, () => dsar().scan({
      tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), locations: (req.body as any)?.locations,
    })));

  app.post('/dsar/cases/:id/disclosure', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['packageRef']);
      return dsar().prepareDisclosure({
        tenantId: getTenantId(req), id: req.params.id, actor: getActor(req), packageRef: body.packageRef,
      });
    }));

  // Two calls by two different people. The service refuses the second if it
  // carries the same identity as the first.
  app.post('/dsar/cases/:id/authorize-erasure', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, () => dsar().approveErasure({ tenantId: getTenantId(req), id: req.params.id, approver: getActor(req) })));

  app.post('/dsar/cases/:id/erase', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, () => dsar().executeErasure({
      tenantId: getTenantId(req), id: req.params.id, actor: getActor(req),
      s017ShredEventRef: (req.body as any)?.s017ShredEventRef ?? null,
    })));

  app.post('/dsar/cases/:id/close', { preHandler: requirePermission(PERMS.DSAR_MANAGE) }, async (req: any, reply) =>
    handle(reply, () => dsar().close({ tenantId: getTenantId(req), id: req.params.id, actor: getActor(req) })));

  // ── S127 Unclaimed Property ───────────────────────────────────────────────
  const property = () => container.resolve(UnclaimedPropertyService);

  app.get('/unclaimed-property', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => property().list(getTenantId(req), getLegalEntityId(req), req.query?.state)));

  app.get('/unclaimed-property/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => property().get(getTenantId(req), req.params.id)));

  app.post('/unclaimed-property/identify', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['holderState', 'dormancyMonths']);
      return property().identifyCandidates({
        ...body, tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req), actor: getActor(req),
      });
    }));

  app.post('/unclaimed-property/:id/due-diligence', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['method', 'contactRef', 'outcome']);
      return property().recordDueDiligence({
        tenantId: getTenantId(req), id: req.params.id, actor: getActor(req),
        method: body.method, contactRef: body.contactRef, outcome: body.outcome, noticeRef: body.noticeRef ?? null,
      });
    }));

  app.post('/unclaimed-property/:id/remittance', { preHandler: requirePermission(PERMS.ITEM_APPROVE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['escheatLiabilityAccountCode', 'sourceAccountCode']);
      return property().prepareRemittance({
        tenantId: getTenantId(req), id: req.params.id, approver: getActor(req),
        escheatLiabilityAccountCode: body.escheatLiabilityAccountCode,
        sourceAccountCode: body.sourceAccountCode,
      });
    }));

  // ── S128 SOX Evidence Automation ──────────────────────────────────────────
  const sox = () => container.resolve(SoxEvidenceService);

  app.get('/sox/controls', { preHandler: requirePermission(PERMS.READ) }, async (req, reply) =>
    handle(reply, () => sox().listControls(getTenantId(req))));

  app.post('/sox/controls', { preHandler: requirePermission(PERMS.SOX_ATTEST) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['controlCode', 'controlName', 'controlType']);
      return sox().upsertControl({ ...body, tenantId: getTenantId(req) });
    }));

  app.get('/sox/binders', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => sox().listBinders(
      getTenantId(req), getLegalEntityId(req),
      req.query?.periodYear ? parseIntOr(req.query.periodYear, 0) : undefined,
      req.query?.periodMonth ? parseIntOr(req.query.periodMonth, 0) : undefined,
    )));

  app.get('/sox/binders/:id', { preHandler: requirePermission(PERMS.READ) }, async (req: any, reply) =>
    handle(reply, () => sox().getBinder(getTenantId(req), req.params.id)));

  app.post('/sox/binders', { preHandler: requirePermission(PERMS.STORY_OPERATE) }, async (req: any, reply) =>
    handle(reply, async () => {
      const body = requireBody<any>(req, ['periodYear', 'periodMonth']);
      return sox().assembleBinders({
        tenantId: getTenantId(req), legalEntityId: getLegalEntityId(req),
        periodYear: Number(body.periodYear), periodMonth: Number(body.periodMonth), actor: getActor(req),
      });
    }));

  app.post('/sox/binders/:id/attest', { preHandler: requirePermission(PERMS.SOX_ATTEST) }, async (req: any, reply) =>
    handle(reply, () => sox().attest({ tenantId: getTenantId(req), id: req.params.id, attestedBy: getActor(req) })));
}
