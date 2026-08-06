import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { taxRoutes } from '../../src/http/routes';
import { TaxAccountMappingService } from '../../src/application/tax-account-mapping-service';
import { TaxCalculationService } from '../../src/application/tax-calculation-service';
import { TaxEngineConfigService } from '../../src/application/tax-engine-config-service';
import { JurisdictionRegistrationService } from '../../src/application/jurisdiction-registration-service';
import { ExemptionCertificateService } from '../../src/application/exemption-certificate-service';
import { TaxResultQueryService, TaxAuditQueryService } from '../../src/application/tax-result-query-service';
import { TaxExceptionService } from '../../src/application/tax-exception-service';
import { ReconciliationService } from '../../src/application/reconciliation-service';
import { FeeTableService } from '../../src/application/fee-table-service';
import { createFakeAuthzClient } from '../support/fake-authz-client';
import { TAX_PERMISSIONS } from '../../src/http/security';

// ── JWT helper — mirrors services/posting-recovery-service/tests/dead-letter-routes.test.ts ──
const JWT_SECRET = 'tax-service-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set(Object.values(TAX_PERMISSIONS)),
  CONTROLLER: new Set(Object.values(TAX_PERMISSIONS)),
  ACCOUNTANT: new Set([
    TAX_PERMISSIONS.CONFIG_VIEW, TAX_PERMISSIONS.RESULT_VIEW, TAX_PERMISSIONS.EXCEPTION_VIEW,
    TAX_PERMISSIONS.EXCEPTION_DISPOSITION, TAX_PERMISSIONS.RECONCILIATION_VIEW, TAX_PERMISSIONS.FEE_VIEW,
    TAX_PERMISSIONS.EXEMPTION_VIEW, TAX_PERMISSIONS.JURISDICTION_VIEW, TAX_PERMISSIONS.ADAPTER_VIEW,
    // deliberately NOT any *_MANAGE key
  ]),
  VIEW_ONLY: new Set([TAX_PERMISSIONS.RESULT_VIEW]),
};

describe('tax-service routes — authorization (S207)', () => {
  let app: FastifyInstance;
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('AuthzClient', createFakeAuthzClient(
      [
        { userId: 'ADMIN', tenantId: 'tenant-a', role: 'ADMIN' },
        { userId: 'CONTROLLER', tenantId: 'tenant-a', role: 'CONTROLLER' },
        { userId: 'ACCOUNTANT', tenantId: 'tenant-a', role: 'ACCOUNTANT' },
        { userId: 'VIEW_ONLY', tenantId: 'tenant-a', role: 'VIEW_ONLY' },
      ],
      ROLE_GRANTS,
    ));
    container.registerInstance(TaxAccountMappingService, { lookup: vi.fn(async () => ({ mappingStatus: 'ACCOUNT_MAPPING_VALUES_PENDING' })) } as any);
    container.registerInstance(TaxCalculationService, { calculate: vi.fn(async () => ({ result: { status: 'CALCULATED' } })) } as any);
    container.registerInstance(TaxEngineConfigService, { getStatus: vi.fn(async () => ({ configured: false })), list: vi.fn(async () => []), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), testConnection: vi.fn(async () => ({})) } as any);
    container.registerInstance(JurisdictionRegistrationService, { list: vi.fn(async () => []), getById: vi.fn(async () => ({})), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) } as any);
    container.registerInstance(ExemptionCertificateService, { list: vi.fn(async () => []), expiring: vi.fn(async () => []), getById: vi.fn(async () => ({})), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) } as any);
    container.registerInstance(TaxResultQueryService, { search: vi.fn(async () => []), getById: vi.fn(async () => ({})) } as any);
    container.registerInstance(TaxAuditQueryService, { list: vi.fn(async () => []) } as any);
    container.registerInstance(TaxExceptionService, { list: vi.fn(async () => []), getById: vi.fn(async () => ({})), reRequest: vi.fn(async () => ({ resolved: true })), bulkReRequest: vi.fn(async () => []) } as any);
    container.registerInstance(ReconciliationService, { threeWayTie: vi.fn(async () => ({})), jurisdictionLiabilityReport: vi.fn(async () => ({})), closePeriodGate: vi.fn(async () => ({})) } as any);
    container.registerInstance(FeeTableService, { list: vi.fn(async () => []), resolve: vi.fn(async () => []), getById: vi.fn(async () => ({})), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), deactivate: vi.fn(async () => ({})) } as any);

    app = Fastify();
    await app.register(taxRoutes, { prefix: '/api/v1/tax' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tax/account-mapping?legalEntityId=e1&eventType=COUNTER_SALE', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a role missing the required permission', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tax/jurisdictions', headers: authed('VIEW_ONLY') });
    expect(res.statusCode).toBe(403);
  });

  it('allows a role with the required *_VIEW permission (ACCOUNTANT)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tax/jurisdictions', headers: authed('ACCOUNTANT') });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when ACCOUNTANT (view-only) attempts a *_MANAGE write', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/tax/jurisdictions', headers: authed('ACCOUNTANT'),
      payload: { legalEntityId: 'e1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows ADMIN to perform a *_MANAGE write', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/tax/jurisdictions', headers: authed('ADMIN'),
      payload: { legalEntityId: 'e1', jurisdictionRef: 'STATE-XX', effectiveFrom: '2025-01-01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('allows CONTROLLER to manage fee tables', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/tax/fees', headers: authed('CONTROLLER'),
      payload: { legalEntityId: 'e1', jurisdictionRef: 'STATE-XX', feeCode: 'TIRE_FEE', name: 'Tire Fee', basis: 'FIXED_PER_UNIT', amount: '5.00', effectiveFrom: '2025-01-01' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('requires x-tenant-id even for an authenticated user (400, not 401/403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tax/jurisdictions', headers: { authorization: `Bearer ${tokenFor('ADMIN')}` } });
    expect(res.statusCode).toBe(400);
  });
});
