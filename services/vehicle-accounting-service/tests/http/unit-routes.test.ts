// CE-12 gap-close — HTTP-level (Fastify .inject()) test proving
// GET /units/:idOrStockNumber returns the new schedule-service-sourced
// tie-out data (tieOut.schedule), not just this service's own recomputed
// componentSumCents. Mirrors services/tax-service/tests/http/routes.test.ts's
// JWT/authz-guard test pattern. VehicleUnitService itself is a test double
// registered directly into the tsyringe container (route-level plumbing —
// auth, param parsing, serialization — is what's under test here); the
// service's real getUnit()->ScheduleServiceClient wiring is proven both by
// a fake-fetch unit test (tests/infrastructure/schedule-client.test.ts) and,
// for real, by tests/live-db/schedule-linkage-live.test.ts.
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { unitRoutes } from '../../src/http/unit-routes';
import { VehicleUnitService } from '../../src/application/vehicle-unit-service';
import { VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from '../../src/http/security';

const JWT_SECRET = 'vehicle-accounting-test-secret';

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
  VIEWER: new Set([PERM.UNIT_VIEW]),
  NO_PERMS: new Set([]),
};

function createFakeAuthzClient() {
  return {
    async check(req: any) {
      const grants = ROLE_GRANTS[req.userId];
      if (grants?.has(req.permissionKey)) return { allow: true, matchedRole: req.userId };
      return { allow: false, reason: 'NO_MATCHING_ROLE' };
    },
  };
}

const UNIT_WITH_SCHEDULE_TIE_OUT = {
  unit: { id: 'unit-1', stockNumber: 'STK-1001', bookValue: '9500.00' },
  costComponents: [{ id: 'cc-1', componentType: 'INVOICE', amount: '9500.00' }],
  stockInEvents: [],
  reconEvents: [],
  componentEvents: [],
  tieOut: {
    bookValueCents: 950_000,
    componentSumCents: 950_000,
    tiesOut: true,
    schedule: {
      scheduleNumber: '80',
      controlNumber: 'STK-1001',
      remainingBalanceCents: 950_000,
      openItemCount: 1,
      tiesOutToSchedule: true,
    },
  },
};

describe('unit-routes — GET /units/:idOrStockNumber schedule tie-out (CE-12 gap-close)', () => {
  let app: FastifyInstance;
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('AuthzClient', createFakeAuthzClient() as any);
    container.registerInstance(VehicleUnitService, {
      getUnit: vi.fn(async () => UNIT_WITH_SCHEDULE_TIE_OUT),
    } as any);

    app = Fastify();
    await app.register(unitRoutes, { prefix: '/api/v1/vehicle-accounting' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicle-accounting/units/STK-1001', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a caller missing vehicle_accounting.unit.view with 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicle-accounting/units/STK-1001', headers: authed('NO_PERMS') });
    expect(res.statusCode).toBe(403);
  });

  it('returns the real schedule-service-sourced tie-out balance (tieOut.schedule), distinct from the local cost-component sum', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicle-accounting/units/STK-1001', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tieOut.schedule).toEqual({
      scheduleNumber: '80',
      controlNumber: 'STK-1001',
      remainingBalanceCents: 950_000,
      openItemCount: 1,
      tiesOutToSchedule: true,
    });
    // The local cost-buildup number is still present, but as a DISTINCT field
    // — never silently conflated with the schedule-sourced authoritative one.
    expect(body.tieOut.componentSumCents).toBe(950_000);
  });
});
