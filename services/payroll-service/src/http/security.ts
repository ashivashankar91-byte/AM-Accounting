import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, asTenantId, createAuthzGuard, TenantId } from '@amacc/shared-kernel';
import type { PrismaClient } from '.prisma/payroll-client';

/**
 * CE-13 RBAC gap-closure manifest — see
 * services/auth-service/prisma/migrations/20260803000000_add_ce13_payroll_permissions/migration.sql
 * for the additive permission-catalog migration these keys map to.
 */
export const PAYROLL_PERMISSIONS = {
  CONFIG_VIEW: 'payroll.config.view',
  CONFIG_MANAGE: 'payroll.config.manage',
  SOURCE_MODE_MANAGE: 'payroll.source_mode.manage',
  RULE_PACK_VIEW: 'payroll.rule_pack.view',
  RULE_PACK_MANAGE: 'payroll.rule_pack.manage',
  RULE_PACK_ACTIVATE: 'payroll.rule_pack.activate',
  BATCH_VIEW: 'payroll.batch.view',
  BATCH_CREATE: 'payroll.batch.create',
  BATCH_EDIT: 'payroll.batch.edit',
  BATCH_VALIDATE: 'payroll.batch.validate',
  BATCH_APPROVE: 'payroll.batch.approve',
  BATCH_HOLD_RELEASE: 'payroll.batch.hold_release',
  BATCH_POST: 'payroll.batch.post',
  BATCH_VOID_REVERSE: 'payroll.batch.void_reverse',
  COMMISSION_VIEW: 'payroll.commission.view',
  COMMISSION_MANAGE: 'payroll.commission.manage',
  COMMISSION_DISPUTE_RESOLVE: 'payroll.commission_dispute.resolve',
  CLAWBACK_VIEW: 'payroll.clawback.view',
  CLAWBACK_MANAGE: 'payroll.clawback.manage',
  ACCRUAL_VIEW: 'payroll.accrual.view',
  ACCRUAL_MANAGE: 'payroll.accrual.manage',
  ACCRUAL_APPROVE: 'payroll.accrual.approve',
  TECH_BRIDGE_VIEW: 'payroll.tech_bridge.view',
  TECH_BRIDGE_MANAGE: 'payroll.tech_bridge.manage',
  REGISTER_YTD_VIEW: 'payroll.register_ytd.view',
  AUDIT_VIEW: 'payroll.audit.view',
  /** fix(integration) — dedicated CE-09 payment-handoff keys, see
   * services/auth-service/prisma/migrations/20260804000000_add_ce13_payroll_handoff_audit_permissions.
   * Replace the payroll.batch.* reuse from the prior integration pass. */
  PAYMENT_HANDOFF_VIEW: 'payroll.payment_handoff.view',
  PAYMENT_HANDOFF_MANAGE: 'payroll.payment_handoff.manage',
} as const;

export function getTenantId(request: any, statusCode = 400): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = statusCode;
    throw err;
  }
  return asTenantId(tenantId);
}

export function getActor(request: any): string {
  return (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
}

/**
 * Maps every CE-13 payroll-service route (employees/batches/config/reports/
 * runs from routes.ts, S025 rule-packs/S108 source-mode/S110 clawback/S111
 * accrual/S112 tech-bridge from ce13-routes.ts, and S109 commission/draw/
 * dispute from commission-routes.ts — all three route groups run on the
 * same `app` instance, see routes.ts) to its minimum required permission
 * key. Employee master-data setup is treated as payroll configuration
 * (`payroll.config.*`) since the Fable package's enumerated permission list
 * has no standalone "employee" family. `/runs/*` GET endpoints are read
 * aliases over batches/summaries used by register/YTD-style dashboard
 * screens, so they map to `payroll.register_ytd.view` rather than
 * `payroll.batch.view` to match the dashboard-read intent.
 */
function resolvePayrollPermission(method: string, url: string): string | null {
  const m = method.toUpperCase();

  // ── Employees (treated as payroll configuration) ──────────────────────────
  if (/^\/employees\/[^/]+\/ytd$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW;
  if (/^\/employees\/[^/]+\/terminate$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.CONFIG_MANAGE;
  if (/^\/employees(\/[^/]+)?$/.test(url)) {
    return m === 'GET' ? PAYROLL_PERMISSIONS.CONFIG_VIEW : PAYROLL_PERMISSIONS.CONFIG_MANAGE;
  }

  // ── Batches ────────────────────────────────────────────────────────────────
  if (/^\/batches\/[^/]+\/validate$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.BATCH_VALIDATE;
  if (/^\/batches\/[^/]+\/approve$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.BATCH_APPROVE;
  if (/^\/batches\/[^/]+\/(hold|release)$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.BATCH_HOLD_RELEASE;
  if (/^\/batches\/[^/]+\/post$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.BATCH_POST;
  if (/^\/batches\/[^/]+\/void$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.BATCH_VOID_REVERSE;
  if (/^\/batches\/[^/]+\/(register|summary|departmental-summary)$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW;
  if (/^\/batches\/[^/]+\/items(\/[^/]+)?$/.test(url)) return PAYROLL_PERMISSIONS.BATCH_EDIT;
  if (/^\/batches\/[^/]+$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.BATCH_VIEW;
  if (/^\/batches$/.test(url)) return m === 'GET' ? PAYROLL_PERMISSIONS.BATCH_VIEW : PAYROLL_PERMISSIONS.BATCH_CREATE;

  // ── Reports / runs (register + YTD dashboards) ────────────────────────────
  if (/^\/reports\/tax-liability$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW;
  if (/^\/runs(\/.*)?$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW;

  // ── GL mapping / tax-rate configuration ───────────────────────────────────
  if (/^\/config\/(gl-mappings|tax-rates)$/.test(url)) {
    return m === 'GET' ? PAYROLL_PERMISSIONS.CONFIG_VIEW : PAYROLL_PERMISSIONS.CONFIG_MANAGE;
  }

  // ── S108 statutory-source configuration ───────────────────────────────────
  if (/^\/config\/source-mode$/.test(url)) {
    return m === 'GET' ? PAYROLL_PERMISSIONS.CONFIG_VIEW : PAYROLL_PERMISSIONS.SOURCE_MODE_MANAGE;
  }

  // ── S025 rule-pack governance ──────────────────────────────────────────────
  if (/^\/rule-packs\/[^/]+\/activate$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.RULE_PACK_ACTIVATE;
  if (/^\/rule-packs\/[^/]+\/(validate|simulate)$/.test(url)) return PAYROLL_PERMISSIONS.RULE_PACK_VIEW;
  if (/^\/rule-packs$/.test(url)) return m === 'GET' ? PAYROLL_PERMISSIONS.RULE_PACK_VIEW : PAYROLL_PERMISSIONS.RULE_PACK_MANAGE;

  // ── S110 clawback / chargeback ─────────────────────────────────────────────
  if (/^\/clawbacks\/[^/]+\/resolve$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.CLAWBACK_MANAGE;
  if (/^\/clawbacks$/.test(url)) return m === 'GET' ? PAYROLL_PERMISSIONS.CLAWBACK_VIEW : PAYROLL_PERMISSIONS.CLAWBACK_MANAGE;

  // ── S111 accruals ──────────────────────────────────────────────────────────
  if (/^\/accruals\/[^/]+\/approve$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.ACCRUAL_APPROVE;
  if (/^\/accruals$/.test(url)) return m === 'GET' ? PAYROLL_PERMISSIONS.ACCRUAL_VIEW : PAYROLL_PERMISSIONS.ACCRUAL_MANAGE;

  // ── S112 tech flag-hour bridge ─────────────────────────────────────────────
  if (/^\/tech-bridge$/.test(url)) return m === 'GET' ? PAYROLL_PERMISSIONS.TECH_BRIDGE_VIEW : PAYROLL_PERMISSIONS.TECH_BRIDGE_MANAGE;

  // ── fix(integration) Gap 4 — payroll audit inquiry. Closes the previously
  // dead `payroll.audit.view` permission key with a real enforcement point.
  if (/^\/audit$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.AUDIT_VIEW;

  // ── fix(integration) — CE-09 payment handoff, dedicated keys. ───────────
  if (/^\/batches\/[^/]+\/payment-handoff$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.PAYMENT_HANDOFF_VIEW;
  if (/^\/payment-handoffs\/[^/]+\/(transmit|settle)$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.PAYMENT_HANDOFF_MANAGE;
  if (/^\/payment-handoffs$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.PAYMENT_HANDOFF_VIEW;
  if (/^\/payment-handoffs\/[^/]+$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.PAYMENT_HANDOFF_VIEW;

  // ── S109 commission / draw / dispute ───────────────────────────────────────
  if (/^\/commission-disputes\/[^/]+\/resolve$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.COMMISSION_DISPUTE_RESOLVE;
  if (/^\/commission-disputes$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.COMMISSION_VIEW;
  if (/^\/commissions\/[^/]+\/disputes$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.COMMISSION_MANAGE;
  if (/^\/commissions\/report$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.COMMISSION_VIEW;
  if (/^\/commissions\/calculate$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.COMMISSION_MANAGE;
  if (/^\/commissions\/[^/]+\/(correct|reverse|mark-paid|chargeback)$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.COMMISSION_MANAGE;
  if (/^\/commissions\/[^/]+$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.COMMISSION_VIEW;
  if (/^\/commissions$/.test(url) && m === 'GET') return PAYROLL_PERMISSIONS.COMMISSION_VIEW;
  if (/^\/commission-plans\/[^/]+\/(supersede|draws)$/.test(url) && m === 'POST') return PAYROLL_PERMISSIONS.COMMISSION_MANAGE;
  if (/^\/commission-plans$/.test(url)) return m === 'GET' ? PAYROLL_PERMISSIONS.COMMISSION_VIEW : PAYROLL_PERMISSIONS.COMMISSION_MANAGE;

  return null;
}

/**
 * fix(integration): resolves the legal entity a route's permission check
 * should be scoped against — for a create route (no persisted resource
 * yet), the client-supplied body/query legalEntityId IS the authorized
 * context being requested (the authz engine still denies it if the actor's
 * own role assignment isn't scoped to that entity — see authz-service.ts's
 * `a.entityId == null || a.entityId === scope.entityId` check, mirrors
 * CE-07's identical convention). For an action on an EXISTING resource
 * (batch approve/post/void, rule-pack activate), the entity is loaded from
 * the PERSISTED row — a client can never claim a different entity than the
 * resource actually belongs to.
 */
function resolveEntityScope(prisma: PrismaClient) {
  return async (request: any): Promise<{ entityId?: string | null }> => {
    const tenantId = getTenantId(request);
    const rawRouteUrl = request.routeOptions?.url ?? request.routerPath ?? request.url?.split('?')[0] ?? '';
    const routeUrl = String(rawRouteUrl).replace(/^\/api\/v1\/payroll/, '') || '/';
    const params = (request.params ?? {}) as Record<string, string>;

    let m: RegExpMatchArray | null;
    if ((m = routeUrl.match(/^\/batches\/([^/]+)/)) || params.id) {
      const batchId = m ? m[1] : (params.id as string);
      if (routeUrl.startsWith('/batches/')) {
        const batch = await (prisma as any).payrollBatch.findFirst({ where: { id: batchId, tenantId }, select: { legalEntityId: true } });
        return { entityId: batch?.legalEntityId ?? null };
      }
    }
    if (routeUrl.match(/^\/rule-packs\/([^/]+)/) && params.id) {
      const version = await (prisma as any).payrollRulePackVersion.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: version?.legalEntityId ?? null };
    }
    // fix(integration): /payment-handoffs/:id (view, transmit, settle) is
    // resource-loaded — the handoff's own PERSISTED legalEntityId is the
    // authorized scope; a request body/query legalEntityId is never
    // consulted for these routes, so a caller can never claim a different
    // entity than the resource actually belongs to.
    if (routeUrl.match(/^\/payment-handoffs\/([^/]+)/) && params.id) {
      const handoff = await (prisma as any).payrollPaymentHandoff.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: handoff?.legalEntityId ?? null };
    }
    // fix(integration): every action taken AGAINST an existing commission
    // plan/record/dispute, accrual, or clawback — as opposed to CREATING one,
    // where the body/query legalEntityId is the legitimately-requested new
    // scope — is resource-loaded from that row's own persisted legalEntityId.
    // Without this, a caller whose OWN role assignment happens to be scoped
    // to entity A could claim `legalEntityId: <entity A>` in the request
    // body/query while acting on a resource that actually belongs to entity
    // B, and the authz check (which only ever compared against the
    // CLIENT-SUPPLIED scope) would incorrectly allow it — a real
    // cross-entity bypass, not merely a UI-hiding gap.
    if (routeUrl.match(/^\/commission-plans\/([^/]+)\/(supersede|draws)$/) && params.id) {
      const plan = await (prisma as any).commissionPlan.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: plan?.legalEntityId ?? null };
    }
    if (routeUrl.match(/^\/commissions\/([^/]+)/) && params.id) {
      const record = await (prisma as any).commissionRecord.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: record?.legalEntityId ?? null };
    }
    if (routeUrl.match(/^\/commission-disputes\/([^/]+)\/resolve$/) && params.id) {
      const dispute = await (prisma as any).commissionDispute.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: dispute?.legalEntityId ?? null };
    }
    if (routeUrl.match(/^\/accruals\/([^/]+)\/approve$/) && params.id) {
      const accrual = await (prisma as any).accrualEntry.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: accrual?.legalEntityId ?? null };
    }
    if (routeUrl.match(/^\/clawbacks\/([^/]+)\/resolve$/) && params.id) {
      const clawback = await (prisma as any).clawbackRecord.findFirst({ where: { id: params.id, tenantId }, select: { legalEntityId: true } });
      return { entityId: clawback?.legalEntityId ?? null };
    }
    // Create/list routes: the body/query legalEntityId IS the requested
    // scope — the authz engine (not this extractor) is what denies an
    // actor whose role assignment isn't scoped to it.
    const body = (request.body ?? {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const entityId = (body['legalEntityId'] as string | undefined) ?? (query['legalEntityId'] as string | undefined);
    return { entityId: entityId ?? undefined };
  };
}

/** Wires per-route permission enforcement for every CE-13 payroll-service
 * route — mirrors tax-service's src/http/security.ts attachRouteSecurity,
 * the established repo pattern for adding RBAC without disturbing the
 * pre-existing JWT/tenant/SoD hooks (authMiddleware, tenantContextHook, and
 * the actor-comparison checks in rule-pack-service.ts / ce13-routes.ts
 * remain unchanged and still run). fix(integration): now also legal-entity
 * scoped via `scope`, mirroring CE-07's own posting-engine-routes.ts
 * `requirePostingEnginePermission` convention rather than inventing a
 * second one. */
export function attachPayrollRouteSecurity(app: FastifyInstance): void {
  const prisma = container.resolve<PrismaClient>('PrismaClient');
  const requirePermission = createAuthzGuard(
    container.resolve<AuthzClient>('AuthzClient'),
    { getTenantId: (request: any) => getTenantId(request), scope: resolveEntityScope(prisma) },
  );

  app.addHook('preHandler', async (request: any, reply: any) => {
    const rawRouteUrl = request.routeOptions?.url ?? request.routerPath ?? request.url?.split('?')[0] ?? '';
    const routeUrl = String(rawRouteUrl).replace(/^\/api\/v1\/payroll/, '') || '/';
    const permission = resolvePayrollPermission(String(request.method), routeUrl);
    if (!permission) return;
    return requirePermission(permission)(request, reply);
  });
}
