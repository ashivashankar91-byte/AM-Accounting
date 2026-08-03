/**
 * CE-13 RBAC gap-closure — route-level authorization tests for
 * payroll-service.
 *
 * Before this file, payroll-service's HTTP tests (test-ce13-routes.ts,
 * test-commission-routes.ts) called `ce13Routes`/`commissionRoutes`
 * directly against a mocked Prisma client, bypassing `payrollRoutes()`
 * entirely — so none of them exercised JWT auth, tenant scoping, or (now)
 * the RBAC permission guard. This file builds the real `payrollRoutes()`
 * plugin (JWT auth -> attachPayrollRouteSecurity -> employees/batches/
 * config/reports/runs + the inline commissionRoutes/ce13Routes groups) end
 * to end against a fake AuthzClient, proving every one of the ~26
 * `payroll.*` permission keys actually gates its route: unauthenticated ->
 * 401, authenticated-but-unauthorized -> 403 deny-by-default, granted role
 * -> allowed through to business logic, and cross-tenant grants don't leak.
 *
 * Scope: this exercises the GUARD mechanism per distinct permission key, not
 * every endpoint's business logic (already covered by test-payroll-service.ts,
 * test-commission-service.ts, test-rule-pack-service.ts, test-ce13-routes.ts,
 * test-commission-routes.ts). For the "allowed" case we assert the response
 * is NOT 401/403 rather than a specific 2xx body, since supplying a fully
 * valid payload for every endpoint is incidental to what's being proven here
 * (see permissiveFakeService / fakePrisma in ./support).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { payrollRoutes } from '../http/routes';
import { PAYROLL_PERMISSIONS } from '../http/security';
import { PayrollService } from '../application/payroll-service';
import { CommissionService } from '../application/commission-service';
import { PayrollRulePackService } from '../application/rule-pack-service';
import { createFakeAuthzClient, FakeAssignment } from './support/fake-authz-client';
import { permissiveFakeService } from './support/fake-service';
import { fakePrisma } from './support/fake-prisma';

const JWT_SECRET = 'payroll-authz-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// sub is the role name — the central S207 engine resolves persisted role
// assignments by userId, not the JWT's role claim (mirrors coa-service's
// tests/authz-guard-integration.test.ts tokenFor()).
function tokenFor(role: string, tenantId: string): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

const TENANT_A_ASSIGNMENTS: FakeAssignment[] = [
  { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
  { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
  { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
  { userId: 'NO_PERMISSIONS_ROLE', tenantId: 'tenant-a', role: 'NO_PERMISSIONS_ROLE' },
];

// Mirrors the auth-service migration's tiering exactly: broad view grants to
// ADMIN/CONTROLLER/ACCOUNTANT, mutating/destructive grants to ADMIN/CONTROLLER only.
const VIEW_ONLY_KEYS = [
  PAYROLL_PERMISSIONS.CONFIG_VIEW, PAYROLL_PERMISSIONS.RULE_PACK_VIEW, PAYROLL_PERMISSIONS.BATCH_VIEW,
  PAYROLL_PERMISSIONS.COMMISSION_VIEW, PAYROLL_PERMISSIONS.CLAWBACK_VIEW, PAYROLL_PERMISSIONS.ACCRUAL_VIEW,
  PAYROLL_PERMISSIONS.TECH_BRIDGE_VIEW, PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, PAYROLL_PERMISSIONS.AUDIT_VIEW,
];
const MANAGE_KEYS = Object.values(PAYROLL_PERMISSIONS).filter((k) => !(VIEW_ONLY_KEYS as string[]).includes(k));

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(PAYROLL_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(PAYROLL_PERMISSIONS)),
  ACCOUNTANT: new Set(VIEW_ONLY_KEYS),
  NO_PERMISSIONS_ROLE: new Set(),
};

function registerFakeAuthz(assignments: FakeAssignment[] = TENANT_A_ASSIGNMENTS) {
  container.registerInstance('AuthzClient', createFakeAuthzClient(assignments, ROLE_GRANTS));
}

async function buildApp() {
  const app = Fastify();
  await app.register(payrollRoutes);
  await app.ready();
  return app;
}

describe('payroll-service route-level authorization (CE-13 RBAC gap-closure)', () => {
  const origJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeEach(() => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.reset();
    container.registerInstance('PrismaClient', fakePrisma());
    container.registerInstance('PayrollService', permissiveFakeService());
    container.registerInstance(CommissionService as any, permissiveFakeService());
    container.registerInstance(PayrollRulePackService as any, permissiveFakeService());
    container.registerInstance('PaymentHandoffService', permissiveFakeService());
    container.registerInstance('PayrollAuditService', permissiveFakeService());
  });

  afterEach(() => {
    process.env['AMACC_JWT_SECRET'] = origJwtSecret;
  });

  const cases: Array<{
    permission: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    grantedRole: 'ADMIN' | 'CONTROLLER' | 'ACCOUNTANT';
    payload?: any;
  }> = [
    // ── Employees / config ──────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.CONFIG_VIEW, method: 'GET', path: '/employees', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.CONFIG_MANAGE, method: 'POST', path: '/employees', grantedRole: 'ADMIN', payload: { firstName: 'A', lastName: 'B', department: 'Sales' } },
    { permission: PAYROLL_PERMISSIONS.CONFIG_MANAGE, method: 'POST', path: '/employees/e1/terminate', grantedRole: 'ADMIN', payload: { terminationDate: '2026-01-01' } },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/employees/e1/ytd', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.CONFIG_VIEW, method: 'GET', path: '/config/gl-mappings', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.CONFIG_MANAGE, method: 'PUT', path: '/config/gl-mappings', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.CONFIG_VIEW, method: 'GET', path: '/config/tax-rates', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.CONFIG_MANAGE, method: 'PUT', path: '/config/tax-rates', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/reports/tax-liability', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/runs/in-process', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/runs', grantedRole: 'ACCOUNTANT' },

    // ── Batches ──────────────────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.BATCH_VIEW, method: 'GET', path: '/batches', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.BATCH_CREATE, method: 'POST', path: '/batches', grantedRole: 'ADMIN', payload: { payFrequency: 'BIWEEKLY', payPeriodStart: '2026-01-01', payPeriodEnd: '2026-01-14' } },
    { permission: PAYROLL_PERMISSIONS.BATCH_VIEW, method: 'GET', path: '/batches/b1', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.BATCH_EDIT, method: 'POST', path: '/batches/b1/items', grantedRole: 'ADMIN', payload: { employeeId: 'e1' } },
    { permission: PAYROLL_PERMISSIONS.BATCH_VALIDATE, method: 'POST', path: '/batches/b1/validate', grantedRole: 'ADMIN' },
    { permission: PAYROLL_PERMISSIONS.BATCH_APPROVE, method: 'POST', path: '/batches/b1/approve', grantedRole: 'ADMIN' },
    { permission: PAYROLL_PERMISSIONS.BATCH_HOLD_RELEASE, method: 'POST', path: '/batches/b1/hold', grantedRole: 'ADMIN', payload: { holdReason: 'x' } },
    { permission: PAYROLL_PERMISSIONS.BATCH_HOLD_RELEASE, method: 'POST', path: '/batches/b1/release', grantedRole: 'ADMIN' },
    { permission: PAYROLL_PERMISSIONS.BATCH_POST, method: 'POST', path: '/batches/b1/post', grantedRole: 'ADMIN' },
    { permission: PAYROLL_PERMISSIONS.BATCH_VOID_REVERSE, method: 'POST', path: '/batches/b1/void', grantedRole: 'ADMIN', payload: { voidReason: 'x' } },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/batches/b1/register', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/batches/b1/summary', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.REGISTER_YTD_VIEW, method: 'GET', path: '/batches/b1/departmental-summary', grantedRole: 'ACCOUNTANT' },

    // ── S108 source-mode ─────────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.CONFIG_VIEW, method: 'GET', path: '/config/source-mode', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.SOURCE_MODE_MANAGE, method: 'PUT', path: '/config/source-mode', grantedRole: 'ADMIN', payload: { payrollSourceMode: 'TEST_FIXTURE' } },

    // ── S025 rule packs ──────────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.RULE_PACK_VIEW, method: 'GET', path: '/rule-packs', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.RULE_PACK_MANAGE, method: 'POST', path: '/rule-packs', grantedRole: 'ADMIN', payload: { packKey: 'k', rows: [] } },
    { permission: PAYROLL_PERMISSIONS.RULE_PACK_VIEW, method: 'GET', path: '/rule-packs/v1/simulate', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.RULE_PACK_VIEW, method: 'POST', path: '/rule-packs/v1/validate', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.RULE_PACK_ACTIVATE, method: 'POST', path: '/rule-packs/v1/activate', grantedRole: 'ADMIN' },

    // ── S110 clawbacks ───────────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.CLAWBACK_VIEW, method: 'GET', path: '/clawbacks', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.CLAWBACK_MANAGE, method: 'POST', path: '/clawbacks', grantedRole: 'ADMIN', payload: { employeeId: 'e1', dealId: 'd1', method: 'DIRECT_DEDUCTION', clawbackAmount: 100 } },
    { permission: PAYROLL_PERMISSIONS.CLAWBACK_MANAGE, method: 'POST', path: '/clawbacks/c1/resolve', grantedRole: 'ADMIN' },

    // ── S111 accruals ────────────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.ACCRUAL_VIEW, method: 'GET', path: '/accruals', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.ACCRUAL_MANAGE, method: 'POST', path: '/accruals', grantedRole: 'ADMIN', payload: { periodYear: 2026, periodMonth: 1, accrualType: 'BONUS', amount: 100 } },
    { permission: PAYROLL_PERMISSIONS.ACCRUAL_APPROVE, method: 'POST', path: '/accruals/a1/approve', grantedRole: 'ADMIN' },

    // ── S112 tech-bridge ─────────────────────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.TECH_BRIDGE_VIEW, method: 'GET', path: '/tech-bridge', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.TECH_BRIDGE_MANAGE, method: 'POST', path: '/tech-bridge', grantedRole: 'ADMIN', payload: { employeeId: 'e1', periodStart: '2026-01-01', periodEnd: '2026-01-14', flagHours: 10 } },

    // ── S109 commission / draw / dispute ────────────────────────────────
    { permission: PAYROLL_PERMISSIONS.COMMISSION_VIEW, method: 'GET', path: '/commission-plans', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commission-plans', grantedRole: 'ADMIN', payload: { employee_id: 'e1', plan_type: 'FLAT', flat_amount: 100, effective_date: '2026-01-01' } },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commission-plans/p1/supersede', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commission-plans/p1/draws', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commissions/calculate', grantedRole: 'ADMIN', payload: { deal_id: 'd1', employee_id: 'e1', deal_type: 'RETAIL', gross_profit: 100, deal_date: '2026-01-01' } },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_VIEW, method: 'GET', path: '/commissions', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commissions/c1/correct', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commissions/c1/reverse', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commissions/c1/mark-paid', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commissions/c1/chargeback', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_MANAGE, method: 'POST', path: '/commissions/c1/disputes', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_VIEW, method: 'GET', path: '/commission-disputes', grantedRole: 'ACCOUNTANT' },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_DISPUTE_RESOLVE, method: 'POST', path: '/commission-disputes/d1/resolve', grantedRole: 'ADMIN', payload: {} },
    { permission: PAYROLL_PERMISSIONS.COMMISSION_VIEW, method: 'GET', path: '/commissions/report', grantedRole: 'ACCOUNTANT' },
  ];

  for (const c of cases) {
    describe(`${c.method} ${c.path} — ${c.permission}`, () => {
      let app: FastifyInstance;

      beforeEach(async () => {
        registerFakeAuthz();
        app = await buildApp();
      });

      afterEach(async () => {
        await app.close();
      });

      it('rejects an unauthenticated request with 401 before any permission check', async () => {
        const res = await app.inject({ method: c.method, url: c.path, headers: { 'x-tenant-id': 'tenant-a' }, payload: c.payload });
        expect(res.statusCode).toBe(401);
      });

      it(`denies a role with no ${c.permission} grant — deny-by-default`, async () => {
        const res = await app.inject({ method: c.method, url: c.path, headers: authed('NO_PERMISSIONS_ROLE'), payload: c.payload });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
      });

      it(`allows ${c.grantedRole}, which is granted ${c.permission}`, async () => {
        const res = await app.inject({ method: c.method, url: c.path, headers: authed(c.grantedRole), payload: c.payload });
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
      });

      it('cross-tenant negative: the grant only exists for tenant-a, so the same role in tenant-c is denied', async () => {
        const res = await app.inject({
          method: c.method,
          url: c.path,
          headers: { 'x-tenant-id': 'tenant-c', authorization: `Bearer ${tokenFor(c.grantedRole, 'tenant-c')}` },
          payload: c.payload,
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: 'FORBIDDEN', reason: 'NO_MATCHING_ROLE' });
      });
    });
  }

  // ── SoD preservation: RBAC guards are additive, not a replacement for the
  // existing actor-comparison self-activation/self-approval denials ────────
  describe('SoD preservation — RBAC guard does not bypass existing actor-comparison checks', () => {
    it('S025 rule-pack: an ADMIN with RULE_PACK_ACTIVATE permission granted is still subject to rule-pack-service.ts author-cannot-activate-own-pack logic (not re-tested here — proven directly in test-rule-pack-service.ts / test-ce13-routes.ts; this only proves the RBAC guard runs first and lets an authorized ADMIN reach that business-logic layer)', async () => {
      registerFakeAuthz();
      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/rule-packs/v1/activate', headers: authed('ADMIN') });
      // Reaches business logic (permissiveFakeService.activate() resolves) —
      // proves the guard is additive, not a bypass or a replacement.
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
      await app.close();
    });
  });
});
